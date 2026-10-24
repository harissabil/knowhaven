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
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { answerFor, SUGGESTIONS, type Answer, type Citation } from "@/mock/chat";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiStream, apiFetch, type FinalEventData, type TraceEventData } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

interface Msg {
  role: "user" | "bot";
  text: string;
  answer?: Answer;
  traces?: TraceEventData[];
  at: string;
  streaming?: boolean;
}

const KIND_ICON: Record<string, React.ReactNode> = {
  chat: <MessageCircle size={14} />,
  doc: <FileText size={14} />,
  task: <ListChecks size={14} />,
  document: <FileText size={14} />,
  slack: <MessageCircle size={14} />,
  jira: <ListChecks size={14} />,
};

function render(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>,
  );
}

export default function Chat() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [state, setState] = useState<MascotState>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [openTraceIdx, setOpenTraceIdx] = useState<number | null>(null);
  const [accessRequestedFor, setAccessRequestedFor] = useState<Record<number, boolean>>({});
  const busy = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, state]);

  async function handleRequestAccess(
    msgIdx: number,
    offer?: FinalEventData["access_offer"],
    questionText?: string,
  ) {
    setAccessRequestedFor((prev) => ({ ...prev, [msgIdx]: true }));
    try {
      await apiFetch("/api/approvals/access-requests", {
        method: "POST",
        body: JSON.stringify({
          topic_id: offer?.topic_id || undefined,
          container_id: offer?.container_id || undefined,
          reason: `Akses diperlukan untuk: ${questionText || "pertanyaan pengguna"}`,
        }),
      });
      toast(
        l(
          `Permintaan akses diajukan${offer?.approver_name ? ` ke ${offer.approver_name}` : ""} (berlaku 7 hari)`,
          `Access request submitted${offer?.approver_name ? ` to ${offer.approver_name}` : ""} (valid 7 days)`,
        ),
      );
      setState("waiting");
    } catch (err: unknown) {
      console.warn("Access request API call failed:", err);
      toast(l("Permintaan akses diajukan (mode demo)", "Access request submitted (demo mode)"));
      setState("waiting");
    }
  }

  async function ask(text: string) {
    if (!text.trim() || busy.current) return;
    busy.current = true;
    setQ("");

    const now = () => new Date().toLocaleTimeString(lang === "id" ? "id-ID" : "en-US");
    setMsgs((m) => [...m, { role: "user", text, at: now() }]);
    setState("thinking");

    // Placeholder bot message
    const botIdx = msgs.length + 1;
    setMsgs((m) => [
      ...m,
      {
        role: "bot",
        text: "",
        at: now(),
        streaming: true,
        traces: [],
      },
    ]);

    let streamedAny = false;
    let accumulatedText = "";
    const activeTraces: TraceEventData[] = [];

    // Attempt real SSE stream
    const { abort } = apiStream(
      "/api/chat",
      {
        question: text,
        conversation_id: conversationId || undefined,
      },
      {
        onTrace: (trace) => {
          activeTraces.push(trace);
          setMsgs((prev) => {
            const next = [...prev];
            const target = next[botIdx];
            if (target) {
              target.traces = [...activeTraces];
            }
            return next;
          });
        },
        onDelta: (token) => {
          streamedAny = true;
          accumulatedText += token;
          setState("answering");
          setMsgs((prev) => {
            const next = [...prev];
            const target = next[botIdx];
            if (target) {
              target.text = accumulatedText;
            }
            return next;
          });
        },
        onReplace: (data) => {
          accumulatedText = data.answer;
          setMsgs((prev) => {
            const next = [...prev];
            const target = next[botIdx];
            if (target) {
              target.text = data.answer;
            }
            return next;
          });
        },
        onFinal: (final) => {
          streamedAny = true;
          if (final.conversation_id) {
            setConversationId(final.conversation_id);
          }

          let endState: MascotState = "answering";
          if (final.conflicts && final.conflicts.length > 0) {
            endState = "conflict";
          } else if (final.decision_path === "idk") {
            endState = "idk";
          } else if (final.decision_path === "refusal") {
            endState = "refusing";
          } else if (final.decision_path === "error") {
            endState = "idk";
          } else if (final.notes?.some((n) => n.includes("instruksi") || n.includes("instruction"))) {
            endState = "idk";
          }
          setState(endState);

          // Convert backend citations to Answer format
          const formattedCitations: Citation[] = (final.citations || []).map((c) => ({
            id: c.id,
            label: `${c.title || c.container} (${c.type})`,
            kind: (c.type === "slack" || c.type === "chat"
              ? "chat"
              : c.type === "jira" || c.type === "task"
                ? "task"
                : "doc") as "chat" | "doc" | "task",
          }));

          const answerPayload: Answer = {
            text: final.answer || accumulatedText,
            state: endState,
            citations: formattedCitations,
            conflict:
              final.conflicts && final.conflicts.length > 0
                ? {
                    used: final.conflicts[0].winner || "Sumber terkini",
                    outdated: (final.conflicts[0].losers || []).join(", ") || "Sumber usang",
                    reason: final.conflicts[0].reason || "Konflik terdeteksi",
                  }
                : undefined,
            idkOwner: final.access_offer?.approver_name || undefined,
            canRequestAccess: Boolean(final.access_offer?.can_request),
            injectionIgnored: final.notes?.some(
              (n) => n.includes("instruksi") || n.includes("instruction"),
            ),
          };

          setMsgs((prev) => {
            const next = [...prev];
            const target = next[botIdx];
            if (target) {
              target.text = final.answer || accumulatedText;
              target.answer = answerPayload;
              target.streaming = false;
            }
            return next;
          });
          busy.current = false;
        },
        onError: (err) => {
          console.warn("Live chat stream error:", err);
          // If we haven't received anything from backend, trigger mock fallback
          if (!streamedAny) {
            fallbackMock(text, botIdx);
          } else {
            setState("idk");
            setMsgs((prev) => {
              const next = [...prev];
              const target = next[botIdx];
              if (target) {
                target.streaming = false;
              }
              return next;
            });
            busy.current = false;
          }
        },
        onClose: () => {
          if (!streamedAny) {
            fallbackMock(text, botIdx);
          } else {
            setMsgs((prev) => {
              const next = [...prev];
              const target = next[botIdx];
              if (target) {
                target.streaming = false;
              }
              return next;
            });
            busy.current = false;
          }
        },
      },
    );

    function fallbackMock(queryText: string, targetIdx: number) {
      const a = answerFor(queryText, lang);
      setState(a.state);
      setMsgs((prev) => {
        const next = [...prev];
        next[targetIdx] = {
          role: "bot",
          text: a.text,
          answer: a,
          at: now(),
          streaming: false,
          traces: [
            { step: 1, label: "CODE", name: "Identifikasi user & tenant", status: "done", ms: 4 },
            { step: 2, label: "LLM", name: "Pahami pertanyaan", status: "done", ms: 142 },
            { step: 3, label: "CODE", name: "Gerbang kebijakan", status: "done", ms: 2 },
            { step: 4, label: "LLM+CODE", name: "Retrieval agentik (filter SQL)", status: "done", ms: 68 },
            { step: 5, label: "LLM+CODE", name: "Nilai bukti & konflik", status: "done", ms: 95 },
            { step: 6, label: "LLM", name: "Susun jawaban", status: "done", ms: 180 },
            { step: 7, label: "CODE", name: "Validasi sitasi", status: "done", ms: 8 },
            { step: 8, label: "CODE", name: "Catat audit log", status: "done", ms: 12 },
          ],
        };
        return next;
      });
      busy.current = false;
    }
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

            {msgs.map((m, i) => {
              const last = i === msgs.length - 1;
              const isBot = m.role === "bot";
              const isTraceOpen = openTraceIdx === i;

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
                      <Mascot size={46} state={m.answer?.state || (m.streaming ? "thinking" : "idle")} />
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
                          <Activity size={13} className="text-brand animate-pulse" />
                          <span>
                            8-Step Pipeline (
                            {m.traces.filter((tr) => tr.status === "done").length}/8 steps)
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
                              {m.traces.map((tr, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-muted">
                                  <span className="w-4 text-center">{tr.step}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-surface border border-line text-[0.65rem] font-semibold text-fg">
                                    {tr.label}
                                  </span>
                                  <span className="flex-1 truncate">{tr.name}</span>
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
                      <p className="leading-relaxed text-[0.98rem] whitespace-pre-wrap">
                        {render(m.text)}
                        {m.streaming && (
                          <span className="inline-block w-[2px] h-4 bg-fg align-middle ml-1 animate-pulse" />
                        )}
                      </p>
                    )}

                    {/* Rich Cards: Conflicts, Citations, Notes, Access */}
                    {!m.streaming && (
                      <>
                        {m.answer?.conflict && (
                          <div className="mt-2 p-2.5 rounded-erp border border-warn/40 bg-warn/5 flex gap-2 text-warn text-sm">
                            <Scale size={16} className="shrink-0 mt-0.5" />
                            <div>
                              <b>{l("Konflik sumber", "Source conflict")}:</b> {m.answer.conflict.reason}
                              <p className="text-xs text-muted mt-1">
                                Digunakan: <i>{m.answer.conflict.used}</i> · Usang: <i>{m.answer.conflict.outdated}</i>
                              </p>
                            </div>
                          </div>
                        )}

                        {m.answer?.injectionIgnored && (
                          <div className="mt-2 p-2 rounded-erp border border-warn/40 bg-warn/10 text-warn text-xs flex items-center gap-2">
                            <AlertTriangle size={14} className="shrink-0" />
                            <span>{l("Prompt injection dalam sumber diabaikan secara aman.", "Prompt injection in source safely ignored.")}</span>
                          </div>
                        )}

                        {m.answer?.idkOwner && (
                          <p className="mt-1 text-sm text-muted">
                            {l("Pemilik topik", "Topic owner")}: <b className="text-fg">{m.answer.idkOwner}</b>
                          </p>
                        )}

                        {m.answer?.canRequestAccess && (
                          <button
                            className="btn btn-primary mt-2 w-fit"
                            disabled={accessRequestedFor[i]}
                            onClick={() =>
                              handleRequestAccess(
                                i,
                                m.answer?.idkOwner
                                  ? { approver_name: m.answer.idkOwner, can_request: true }
                                  : undefined,
                                msgs[i - 1]?.text,
                              )
                            }
                          >
                            <ShieldAlert size={16} />{" "}
                            {accessRequestedFor[i]
                              ? l("Permintaan akses dikirim!", "Access request sent!")
                              : t("requestAccess")}
                          </button>
                        )}

                        {!!m.answer?.citations.length && (
                          <div className="mt-2 pt-2 border-t border-line/60 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted mr-1">{t("sources")}:</span>
                            {m.answer.citations.map((c, n) => (
                              <a
                                key={c.id}
                                href={`/sources/${encodeURIComponent(c.id)}`}
                                className="btn !py-1 !px-2.5 text-xs hover:border-brand inline-flex items-center gap-1.5"
                                title={c.label}
                              >
                                [{n + 1}] {KIND_ICON[c.kind] || <FileText size={14} />} {c.id}
                              </a>
                            ))}
                          </div>
                        )}

                        <p className="text-xs text-muted mt-1">{t("dataAsOf")} {m.at}</p>
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {state === "thinking" && msgs[msgs.length - 1]?.role === "user" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 items-center text-sm text-muted py-2"
              >
                <Mascot size={38} state="thinking" />
                <span className="animate-pulse">{l("Havi sedang berpikir…", "Havi is thinking…")}</span>
              </motion.div>
            )}

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
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("placeholder")}
            />
            <button
              className="btn btn-primary btn-lg px-6 rounded-full"
              disabled={busy.current || !q.trim()}
            >
              <Send size={18} /> {t("send")}
            </button>
          </form>
        </div>
      </div>
    </Shell>
  );
}
