"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  ShieldAlert,
  Scale,
  FileText,
  MessageCircle,
  ListChecks,
  ChevronDown,
  ChevronUp,
  Activity,
  CheckCircle2,
  Clock,
  Sparkles,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { SUGGESTIONS } from "@/mock/chat";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiStream, apiFetch, errorText, type CitationItem, type FinalEventData, type TraceEventData } from "@/lib/api";
import type { ConversationOut, MessageOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

interface Msg {
  role: "user" | "bot";
  text: string;
  question?: string;
  final?: FinalEventData;
  traces?: TraceEventData[];
  error?: string;
  at: string;
  streaming?: boolean;
}

function kindOf(type: string): "chat" | "task" | "doc" {
  const t = type.toLowerCase();
  if (t.includes("chat") || t.includes("message") || t.includes("slack") || t.includes("whatsapp")) return "chat";
  if (t.includes("task") || t.includes("jira")) return "task";
  return "doc";
}
const KIND_ICON = {
  chat: <MessageCircle size={14} />,
  doc: <FileText size={14} />,
  task: <ListChecks size={14} />,
};

function moodOf(f: FinalEventData): MascotState {
  if (f.decision_path === "conflict" || f.conflicts.length > 0) return "conflict";
  if (f.decision_path === "policy_refusal") return "refusing";
  if (f.decision_path === "idk" || f.decision_path === "error") return "idk";
  return "answering";
}

function render(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>,
  );
}

export default function Chat() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const tenantId = useSession((s) => s.tenantId);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [state, setState] = useState<MascotState>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [openTraceIdx, setOpenTraceIdx] = useState<number | null>(null);
  const [accessRequestedFor, setAccessRequestedFor] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const fmt = (iso: string | Date) => new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-US");

  // Resume the latest web conversation of this tenant (history lives on the server).
  useEffect(() => {
    let cancelled = false;
    setMsgs([]);
    setConversationId(null);
    (async () => {
      try {
        const convs = await apiFetch<ConversationOut[]>("/api/conversations");
        const last = convs.find((c) => c.channel === "web");
        if (!last || cancelled) return;
        const history = await apiFetch<MessageOut[]>(`/api/conversations/${last.id}`);
        if (cancelled) return;
        setConversationId(last.id);
        setMsgs(history.map((m) => ({ role: m.role === "user" ? "user" : "bot", text: m.content, at: fmt(m.created_at) })));
      } catch {
        // no history is fine
      }
    })();
    return () => { cancelled = true; abortRef.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, state]);

  const patchMsg = (idx: number, p: Partial<Msg> | ((m: Msg) => Partial<Msg>)) =>
    setMsgs((prev) => prev.map((m, i) => (i === idx ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)));

  async function handleRequestAccess(msgIdx: number, final: FinalEventData, questionText?: string) {
    if (!final.access_offer) return;
    setAccessRequestedFor((prev) => ({ ...prev, [msgIdx]: true }));
    try {
      await apiFetch("/api/approvals/access-requests", {
        method: "POST",
        body: JSON.stringify({
          topic_key: final.access_offer.topic_key,
          reason: (questionText || final.access_offer.display_name).slice(0, 1000),
        }),
      });
      toast(l(`Permintaan akses ke "${final.access_offer.display_name}" dikirim ke pemiliknya`,
        `Access request for "${final.access_offer.display_name}" sent to its owner`));
      setState("waiting");
    } catch (err) {
      setAccessRequestedFor((prev) => ({ ...prev, [msgIdx]: false }));
      toast(l(`Gagal mengajukan akses: ${errorText(err)}`, `Could not request access: ${errorText(err)}`));
    }
  }

  function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setQ("");
    setState("thinking");

    const now = fmt(new Date());
    let botIdx = 0;
    setMsgs((m) => {
      botIdx = m.length + 1;
      return [...m, { role: "user", text, at: now }, { role: "bot", text: "", question: text, at: now, streaming: true, traces: [] }];
    });

    let draft = "";
    const traces = new Map<number, TraceEventData>();
    const { abort } = apiStream(
      "/api/chat",
      { question: text, conversation_id: conversationId ?? undefined },
      {
        onTrace: (trace) => {
          traces.set(trace.step, trace); // "running" then "done" for the same step
          patchMsg(botIdx, { traces: [...traces.values()].sort((a, b) => a.step - b.step) });
        },
        onDelta: (chunk) => {
          draft += chunk;
          setState("answering");
          patchMsg(botIdx, { text: draft });
        },
        onReplace: (data) => {
          // The validator rejected the streamed draft; show the corrected answer instead.
          draft = data.answer;
          patchMsg(botIdx, { text: data.answer });
        },
        onFinal: (final) => {
          setConversationId(final.conversation_id);
          setState(moodOf(final));
          patchMsg(botIdx, {
            text: final.answer || draft,
            final,
            streaming: false,
            at: final.data_as_of ? fmt(final.data_as_of) : now,
          });
        },
        onError: (err) => {
          setState("idk");
          patchMsg(botIdx, { error: err.message, streaming: false });
        },
        onClose: () => {
          patchMsg(botIdx, { streaming: false });
          setBusy(false);
          abortRef.current = null;
        },
      },
    );
    abortRef.current = abort;
  }

  return (
    <Shell fullBleed title={t("chat")}>
      <div className="flex-1 flex flex-col h-full min-h-0 w-full bg-bg">
        {/* Messages scroll area */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 flex flex-col scroll-smooth">
          <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col gap-5">
            {msgs.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-center max-w-xl mx-auto my-auto">
                <Mascot size={140} state={state} />
                <p className="text-2xl font-semibold mt-2">{t("welcome")}</p>
                <p className="text-sm text-muted">{t("suggestions")}:</p>
                <div className="flex flex-wrap gap-2.5 justify-center mt-2">
                  {SUGGESTIONS[lang].map((s) => (
                    <button
                      key={s}
                      className="btn hover:border-brand hover:text-brand transition-colors text-sm py-2 px-3.5"
                      onClick={() => ask(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.length > 0 && (
              <div className="flex justify-end">
                <button className="btn text-xs" disabled={busy}
                  onClick={() => { setMsgs([]); setConversationId(null); setState("idle"); }}>
                  <RotateCcw size={13} /> {l("Percakapan baru", "New conversation")}
                </button>
              </div>
            )}

            {msgs.map((m, i) => {
              const isBot = m.role === "bot";
              const isTraceOpen = openTraceIdx === i;
              const f = m.final;
              const conflict = f?.conflicts[0];
              const cites: CitationItem[] = f?.citations ?? [];

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex gap-3.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {isBot && (
                    <div className="shrink-0 mt-0.5">
                      <Mascot size={46} state={f ? moodOf(f) : m.streaming ? "thinking" : "idle"} />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] md:max-w-[80%] p-4 rounded-erp shadow-xs flex flex-col gap-2 ${
                      m.role === "user" ? "bg-surface2 border border-line2" : "border border-line bg-surface"
                    }`}
                  >
                    {/* Pipeline trace badge header */}
                    {isBot && m.traces && m.traces.length > 0 && (
                      <div className="border-b border-line/60 pb-2 mb-1">
                        <button
                          type="button"
                          onClick={() => setOpenTraceIdx(isTraceOpen ? null : i)}
                          className="flex items-center gap-1.5 text-xs text-muted hover:text-brand font-mono transition-colors"
                        >
                          <Activity size={13} className={`text-brand ${m.streaming ? "animate-pulse" : ""}`} />
                          <span>
                            {l("Pipeline 8 langkah", "8-step pipeline")} ({m.traces.filter((tr) => tr.status === "done").length}/8)
                            {f ? ` · ${(f.latency_ms / 1000).toFixed(1)} s` : ""}
                          </span>
                          {isTraceOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>

                        <AnimatePresence>
                          {isTraceOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden mt-2 flex flex-col gap-1 bg-surface2/60 p-2.5 rounded-erp font-mono text-[0.75rem]"
                            >
                              {m.traces.map((tr) => (
                                <div key={tr.step} className="flex items-center gap-2 text-muted" title={tr.summary}>
                                  <span className="w-4 text-center">{tr.step}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-surface border border-line text-[0.65rem] font-semibold text-fg">
                                    {tr.label}
                                  </span>
                                  <span className="flex-1 truncate">{tr.name}{tr.summary ? ` · ${tr.summary}` : ""}</span>
                                  {tr.status === "done" ? (
                                    <span className="text-ok flex items-center gap-1">
                                      <CheckCircle2 size={11} />
                                      {tr.ms !== undefined ? `${tr.ms}ms` : "ok"}
                                    </span>
                                  ) : (
                                    <span className="text-warn flex items-center gap-1">
                                      <Clock size={11} className="animate-spin" /> running
                                    </span>
                                  )}
                                </div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Answer content */}
                    {isBot && m.streaming && !m.text ? (
                      <p className="text-sm text-muted animate-pulse flex items-center gap-2">
                        <Sparkles size={15} className="text-brand" /> {l("Havi sedang menyusun jawaban…", "Havi is composing answer…")}
                      </p>
                    ) : (
                      m.text && (
                        <p className="leading-relaxed text-[0.98rem] whitespace-pre-wrap">
                          {render(m.text)}
                          {m.streaming && <span className="inline-block w-[2px] h-4 bg-fg align-middle ml-1 animate-pulse" />}
                        </p>
                      )
                    )}

                    {m.error && (
                      <p role="alert" className="text-sm text-bad flex items-center gap-2">
                        <AlertTriangle size={14} /> {l("Gagal mendapat jawaban: ", "Could not get an answer: ")}{m.error}
                      </p>
                    )}

                    {/* Rich cards: conflicts, notes, access, citations */}
                    {!m.streaming && f && (
                      <>
                        {conflict && (
                          <div className="mt-2 p-2.5 rounded-erp border border-warn/40 bg-warn/5 flex gap-2 text-warn text-sm">
                            <Scale size={16} className="shrink-0 mt-0.5" />
                            <div>
                              <b>{l("Konflik sumber", "Source conflict")}:</b> {conflict.reason}
                              {conflict.chosen && (
                                <p className="text-xs text-muted mt-1">
                                  {l("Dipakai", "Used")}: <i>{conflict.chosen.value} · {conflict.chosen.source} ({conflict.chosen.date})</i>
                                </p>
                              )}
                              {conflict.competing.length > 0 && (
                                <p className="text-xs text-muted">
                                  {l("Bersaing/usang", "Competing/outdated")}: {conflict.competing.map((c) => `${c.value} · ${c.source} (${c.date})`).join("; ")}
                                </p>
                              )}
                              {conflict.unverified.length > 0 && (
                                <p className="text-xs text-muted">
                                  {l("Belum terverifikasi", "Unverified")}: {conflict.unverified.map((c) => `${c.value} · ${c.source}`).join("; ")}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {f.notes.map((n) => (
                          <div key={n} className="mt-1 p-2 rounded-erp border border-warn/40 bg-warn/10 text-warn text-xs flex items-center gap-2">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>{n}</span>
                          </div>
                        ))}

                        {f.access_offer && (
                          <button
                            className="btn btn-primary mt-2 w-fit"
                            disabled={accessRequestedFor[i]}
                            onClick={() => handleRequestAccess(i, f, m.question)}
                          >
                            <ShieldAlert size={16} />{" "}
                            {accessRequestedFor[i]
                              ? l("Permintaan akses dikirim", "Access request sent")
                              : `${t("requestAccess")}: ${f.access_offer.display_name}`}
                          </button>
                        )}

                        {cites.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-line/60 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted mr-1">{t("sources")}:</span>
                            {cites.map((c, n) => (
                              <a
                                key={c.id}
                                href={`/sources/${encodeURIComponent(c.id)}`}
                                className={`btn !py-1 !px-2.5 text-xs hover:border-brand inline-flex items-center gap-1.5 ${f.stale_doc_ids.includes(c.id) ? "opacity-60 line-through" : ""}`}
                                title={`${c.title} · ${c.container}${c.date ? ` · ${c.date}` : ""}`}
                              >
                                [{n + 1}] {KIND_ICON[kindOf(c.type)]} {c.title || c.id}
                              </a>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {!m.streaming && isBot && <p className="text-xs text-muted mt-1">{t("dataAsOf")} {m.at}</p>}
                  </div>
                </motion.div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Bar pinned at the bottom */}
        <div className="shrink-0 border-t border-line bg-surface/90 backdrop-blur-md px-4 md:px-8 py-3.5">
          <form
            className="max-w-4xl mx-auto flex gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              ask(q);
            }}
          >
            <input
              className="input flex-1 py-3 px-4 text-base rounded-full"
              value={q}
              maxLength={2000}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("placeholder")}
            />
            <button className="btn btn-primary btn-lg px-6 rounded-full" disabled={busy || !q.trim()}>
              <Send size={18} /> {t("send")}
            </button>
          </form>
        </div>
      </div>
    </Shell>
  );
}
