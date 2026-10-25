"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  X,
  Download,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  AtSign,
  MessageSquare,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { formatChunkText, relTime } from "@/components/documents";
import { SUGGESTIONS } from "@/mock/chat";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiStream, apiFetch, errorText, type CitationItem, type FinalEventData, type TraceEventData } from "@/lib/api";
import type { ConversationOut, DocumentOut, MessageOut, SourceOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";
import { MentionInput } from "@/components/MentionInput";
import { plain, present, segments, toMarkup, type Mention } from "@/lib/mentions";

interface Msg {
  role: "user" | "bot";
  text: string;
  question?: string;
  final?: FinalEventData;
  traces?: TraceEventData[];
  traceLoading?: boolean;
  error?: string;
  at: string;
  streaming?: boolean;
  queryId?: string | null; // history: the step log is fetched when opened
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
  const storedConvId = useSession((s) => (s.tenantId ? s.activeConversations?.[s.tenantId] : undefined));
  const setActiveConversation = useSession((s) => s.setActiveConversation);

  const [convs, setConvs] = useState<ConversationOut[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [state, setState] = useState<MascotState>("idle");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [openTraceIdx, setOpenTraceIdx] = useState<number | null>(null);
  const [accessRequestedFor, setAccessRequestedFor] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  // Document tagging (@) state
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]); // tags present in the message box
  const [pickerReq, setPickerReq] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [focusReq, setFocusReq] = useState(0);
  const abortRef = useRef<(() => void) | null>(null);

  const fmt = useCallback(
    (iso: string | Date) => new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-US"),
    [lang],
  );

  // Load readable documents for @ tagging and ?docs=... query param
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    apiFetch<DocumentOut[]>("/api/documents")
      .then((all) => {
        if (cancelled) return;
        const readable = all.filter((d) => d.can_read);
        setDocs(readable);
        const params = new URLSearchParams(window.location.search);
        const docsParam = params.get("docs");
        if (docsParam) {
          const wantedIds = docsParam
            .split(",")
            .map((x) => decodeURIComponent(x.trim()))
            .filter(Boolean);
          const matched = readable.filter((d) => wantedIds.includes(d.id));
          if (matched.length > 0) {
            const tags = matched.map((d) => ({ id: d.id, title: (d.title || d.filename).replace(/[[\]\n]/g, " ").trim() }));
            setMentions(tags);
            setQ(`${lang === "id" ? "Ringkas" : "Summarize"} ${tags.map((t) => `@${t.title}`).join(" ")} `);
            setFocusReq((n) => n + 1);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const loadConversationMessages = useCallback(
    async (convId: string) => {
      const history = await apiFetch<MessageOut[]>(`/api/conversations/${convId}`);
      setConversationId(convId);
      setOpenTraceIdx(null);
      setMsgs(
        history.map((m): Msg =>
          m.role === "user"
            ? { role: "user", text: m.content, at: fmt(m.created_at) }
            : {
                role: "bot",
                text: m.content,
                at: fmt(m.created_at),
                queryId: m.query_id,
                final: {
                  query_id: m.query_id ?? "",
                  conversation_id: convId,
                  answer: m.content,
                  decision_path: (m.decision_path ?? "answer") as FinalEventData["decision_path"],
                  citations: m.sources.map((c) => ({ ...c, url: null })),
                  conflicts: [],
                  stale_doc_ids: [],
                  access_offer: null,
                  notes: [],
                  action_draft_ids: [],
                  data_as_of: null,
                  latency_ms: 0,
                },
              },
        ),
      );
    },
    [fmt],
  );

  // Load conversations list and restore active conversation for this session (defaults to latest on login)
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const allConvs = await apiFetch<ConversationOut[]>("/api/conversations");
        const webConvs = allConvs.filter((c) => c.channel === "web");
        if (cancelled) return;
        setConvs(webConvs);

        const desired = useSession.getState().activeConversations?.[tenantId];
        if (desired === "new") {
          setConversationId(null);
          setMsgs([]);
          return;
        }
        const target =
          (desired ? webConvs.find((c) => c.id === desired) : undefined) ?? webConvs[0];
        if (!target) {
          setConversationId(null);
          setMsgs([]);
          return;
        }
        setActiveConversation(tenantId, target.id);
        await loadConversationMessages(target.id);
      } catch {
        // no history is fine
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleSelectConversation = async (convId: string) => {
    if (busy || convId === conversationId) return;
    abortRef.current?.();
    if (tenantId) setActiveConversation(tenantId, convId);
    setState("idle");
    try {
      await loadConversationMessages(convId);
    } catch (e) {
      toast(l(`Gagal memuat percakapan: ${errorText(e)}`, `Could not load conversation: ${errorText(e)}`));
    }
  };

  const handleNewChat = () => {
    if (busy) return;
    abortRef.current?.();
    setMsgs([]);
    setConversationId(null);
    setOpenTraceIdx(null);
    setState("idle");
    if (tenantId) setActiveConversation(tenantId, "new");
    setFocusReq((n) => n + 1);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, state]);

  // "Ask Havi" pre-filled question query param if present
  useEffect(() => {
    const pre = new URLSearchParams(window.location.search).get("q");
    if (pre) setQ(pre.slice(0, 2000));
  }, []);

  const [preview, setPreview] = useState<{ id: string; data?: SourceOut; missing?: boolean } | null>(null);
  async function openSource(id: string) {
    setPreview({ id });
    try {
      setPreview({ id, data: await apiFetch<SourceOut>(`/api/sources/${encodeURIComponent(id)}`) });
    } catch {
      setPreview({ id, missing: true }); // forbidden and missing look the same
    }
  }

  const patchMsg = (idx: number, p: Partial<Msg> | ((m: Msg) => Partial<Msg>)) =>
    setMsgs((prev) => prev.map((m, i) => (i === idx ? { ...m, ...(typeof p === "function" ? p(m) : p) } : m)));

  async function toggleTrace(i: number, m: Msg) {
    const nextOpen = openTraceIdx === i ? null : i;
    setOpenTraceIdx(nextOpen);
    const qid = m.queryId || m.final?.query_id;
    if (nextOpen === i && qid && !m.traces?.length && !m.traceLoading) {
      patchMsg(i, { traceLoading: true });
      try {
        const steps = await apiFetch<{ step: number; label: string; name: string; ms: number | null; summary: string | null }[]>(`/api/queries/${qid}/trace`);
        patchMsg(i, {
          traceLoading: false,
          traces: steps.map((x) => ({
            step: x.step,
            label: x.label,
            name: x.name,
            status: "done",
            ms: x.ms ?? undefined,
            summary: x.summary ?? undefined,
          })),
        });
      } catch {
        patchMsg(i, { traceLoading: false });
      }
    }
  }

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
    const visible = text.trim();
    if (!visible || busy) return;
    const tags = present(visible, mentions);
    // Only tags typed ("@SOP Cuti")? Treat it as "summarize these".
    const rest = tags.reduce((acc, t) => acc.split(`@${t.title}`).join(""), visible).trim();
    const effective = rest ? visible : `${lang === "id" ? "Ringkas" : "Summarize"} ${visible}`;
    const question = toMarkup(effective, tags); // "@[Title](DOC-id)": kept in history, resolved by the API
    const effectiveQuestion = plain(question);

    setBusy(true);
    setQ("");
    setMentions([]);
    setState("thinking");

    const now = fmt(new Date());
    let botIdx = 0;
    setMsgs((m) => {
      botIdx = m.length + 1;
      return [
        ...m,
        { role: "user", text: question, at: now },
        { role: "bot", text: "", question: effectiveQuestion, at: now, streaming: true, traces: [] },
      ];
    });

    let draft = "";
    const traces = new Map<number, TraceEventData>();
    const { abort } = apiStream(
      "/api/chat",
      {
        question,
        conversation_id: conversationId ?? undefined,
      },
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
          if (tenantId) setActiveConversation(tenantId, final.conversation_id);
          setState(moodOf(final));
          patchMsg(botIdx, {
            text: final.answer || draft,
            final,
            queryId: final.query_id,
            streaming: false,
            at: final.data_as_of ? fmt(final.data_as_of) : now,
          });
          // Refresh conversation list so a newly created conversation appears in the sidebar
          apiFetch<ConversationOut[]>("/api/conversations")
            .then((all) => setConvs(all.filter((c) => c.channel === "web")))
            .catch(() => {});
        },
        onError: (err) => {
          setState("idk");
          patchMsg(botIdx, { error: err.message, queryId: err.query_id, streaming: false });
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
      <div className="flex-1 flex h-full min-h-0 w-full bg-bg overflow-hidden relative">
        {/* Collapsible Chat History Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              key="chat-history-sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 272, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeInOut" }}
              className="shrink-0 h-full border-r border-line bg-surface flex flex-col overflow-hidden"
            >
              <div className="p-3 border-b border-line flex items-center justify-between gap-2 min-w-[272px]">
                <button
                  type="button"
                  onClick={handleNewChat}
                  disabled={busy}
                  className="btn btn-primary !py-1.5 !px-3 text-xs flex-1 justify-center"
                >
                  <Plus size={15} /> {l("Percakapan Baru", "New Chat")}
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="btn !p-1.5 text-muted hover:text-fg"
                  title={l("Sembunyikan riwayat", "Collapse history")}
                  aria-label={l("Sembunyikan riwayat", "Collapse history")}
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>

              <div className="px-3.5 pt-3 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted/70 min-w-[272px]">
                {l("Riwayat Percakapan", "Chat History")} ({convs.length})
              </div>

              <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 min-w-[272px]">
                {convs.map((c) => {
                  const active = c.id === conversationId && storedConvId !== "new";
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => handleSelectConversation(c.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-erp text-sm transition-colors flex items-start gap-2.5 ${
                        active
                          ? "bg-tint text-brand font-medium border border-brand/25"
                          : "text-fg hover:bg-surface2 border border-transparent"
                      }`}
                    >
                      <MessageSquare size={15} className={`mt-0.5 shrink-0 ${active ? "text-brand" : "text-muted"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate leading-snug">
                          {c.title || l("Percakapan tanpa judul", "Untitled conversation")}
                        </p>
                        <p className="text-[11px] text-muted mt-0.5">{relTime(c.created_at, lang)}</p>
                      </div>
                    </button>
                  );
                })}
                {convs.length === 0 && (
                  <p className="text-xs text-muted px-3 py-6 text-center">
                    {l("Belum ada riwayat percakapan.", "No conversations yet.")}
                  </p>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col h-full min-h-0 min-w-0 bg-bg">
          {/* Top bar when sidebar is collapsed or active chat info */}
          <div className="shrink-0 px-4 md:px-6 py-2 border-b border-line/60 bg-surface/50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {!sidebarOpen && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="btn !py-1 !px-2 text-xs text-muted hover:text-fg"
                  title={l("Buka riwayat percakapan", "Open chat history")}
                >
                  <PanelLeftOpen size={15} />
                  <span className="hidden sm:inline">{l("Riwayat", "History")}</span>
                </button>
              )}
              <span className="text-xs text-muted truncate">
                {conversationId
                  ? convs.find((c) => c.id === conversationId)?.title || l("Percakapan aktif", "Active conversation")
                  : l("Percakapan baru", "New conversation")}
              </span>
            </div>

            {msgs.length > 0 && (
              <button
                type="button"
                className="btn !py-1 !px-2.5 text-xs"
                disabled={busy}
                onClick={handleNewChat}
              >
                <Plus size={13} /> {l("Percakapan baru", "New chat")}
              </button>
            )}
          </div>

          {/* Messages scroll area */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 flex flex-col scroll-smooth">
            <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col gap-5">
              {msgs.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12 text-center max-w-xl mx-auto my-auto">
                  <Mascot size={140} state={state} />
                  <p className="text-2xl font-semibold mt-2">{t("welcome")}</p>
                  <p className="text-sm text-muted">
                    {l(
                      "Ketik @ di kolom pesan untuk menandai dokumen tertentu, atau pilih pertanyaan contoh:",
                      "Type @ in the message box to tag specific documents, or try a starter question:",
                    )}
                  </p>
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
                const isBot = m.role === "bot";
                const isTraceOpen = openTraceIdx === i;
                const f = m.final;
                const conflict = f?.conflicts[0];
                const cites: CitationItem[] = f?.citations ?? [];
                const hasTrace = Boolean(m.streaming || (m.traces && m.traces.length > 0) || m.queryId || f?.query_id);

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
                      {isBot && hasTrace && (
                        <div className="border-b border-line/60 pb-2 mb-1">
                          <button
                            type="button"
                            onClick={() => toggleTrace(i, m)}
                            className="flex items-center gap-1.5 text-xs text-muted hover:text-brand font-mono transition-colors"
                          >
                            <Activity size={13} className={`text-brand ${m.streaming || m.traceLoading ? "animate-pulse" : ""}`} />
                            <span>
                              {l("Pipeline 8 langkah", "8-step pipeline")}{" "}
                              {m.traces?.length ? `(${m.traces.filter((tr) => tr.status === "done").length}/8)` : ""}
                              {f?.latency_ms ? ` · ${(f.latency_ms / 1000).toFixed(1)} s` : ""}
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
                                {m.traceLoading && (!m.traces || m.traces.length === 0) && (
                                  <div className="text-muted animate-pulse py-1">
                                    {l("Memuat jejak proses…", "Loading process trace…")}
                                  </div>
                                )}
                                {!m.traceLoading && (!m.traces || m.traces.length === 0) && (
                                  <div className="text-muted py-1">
                                    {l("Jejak proses tidak tersedia untuk pesan ini.", "Process trace unavailable for this message.")}
                                  </div>
                                )}
                                {m.traces?.map((tr) => (
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
                            {isBot ? render(m.text) : segments(m.text).map((seg, k) => seg.kind === "text" ? <span key={k}>{seg.text}</span> : (
                              <button key={k} type="button" onClick={() => openSource(seg.id)} title={seg.id}
                                className="inline-flex items-center gap-1 px-1.5 rounded-md bg-tint text-brand font-medium hover:underline align-baseline">
                                <FileText size={13} className="shrink-0" />{seg.title}
                              </button>
                            ))}
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
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => openSource(c.id)}
                                  className={`btn !py-1 !px-2.5 text-xs hover:border-brand inline-flex items-center gap-1.5 ${f.stale_doc_ids.includes(c.id) ? "opacity-60 line-through" : ""}`}
                                  title={`${c.title} · ${c.container}${c.date ? ` · ${c.date}` : ""}`}
                                >
                                  [{n + 1}] {KIND_ICON[kindOf(c.type)]} {c.title || c.id}
                                </button>
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
          <div className="shrink-0 border-t border-line bg-surface/90 backdrop-blur-md px-4 md:px-8 py-3">
            <div className="max-w-4xl mx-auto relative flex flex-col gap-2">
              <form
                className="flex gap-2 items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(q);
                }}
              >
                <button
                  type="button"
                  onClick={() => setPickerReq((n) => n + 1)}
                  disabled={busy}
                  className="btn !p-3 rounded-full text-muted hover:text-brand hover:border-brand shrink-0"
                  title={l("Tandai dokumen (@)", "Tag a document (@)")}
                  aria-label={l("Tandai dokumen (@)", "Tag a document (@)")}
                >
                  <AtSign size={18} />
                </button>
                <MentionInput
                  value={q}
                  onChange={setQ}
                  mentions={mentions}
                  onMentionsChange={setMentions}
                  docs={docs}
                  onSubmit={() => ask(q)}
                  disabled={busy}
                  focusRequest={focusReq}
                  pickerRequest={pickerReq}
                  placeholder={`${t("placeholder")} · ${l("ketik @ untuk tandai dokumen", "type @ to tag a document")}`}
                />
                <button className="btn btn-primary btn-lg px-6 rounded-full shrink-0" disabled={busy || !q.trim()}>
                  <Send size={18} /> {t("send")}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={() => setPreview(null)}>
          <aside role="dialog" aria-modal="true" aria-label={l("Pratinjau sumber", "Source preview")}
            className="h-full w-full max-w-xl bg-surface border-l border-line shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2 p-4 border-b border-line">
              <div className="flex-1 min-w-0">
                <p className="eyebrow font-mono truncate">{preview.id}</p>
                <h2 className="font-semibold text-lg truncate">{preview.data?.title ?? (preview.missing ? l("Sumber tidak tersedia", "Source unavailable") : "…")}</h2>
                {preview.data && <p className="text-xs text-muted">{preview.data.container} · {preview.data.authority} · {new Date(preview.data.updated_at).toLocaleDateString()}</p>}
              </div>
              <button className="btn !p-1.5" onClick={() => setPreview(null)} aria-label="close"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {!preview.data && !preview.missing && <p className="text-muted animate-pulse">{l("Memeriksa izin…", "Checking permissions…")}</p>}
              {preview.missing && <p className="text-muted text-sm">{l("Sumber ini tidak ada atau di luar akses peran Anda saat ini.", "This source doesn't exist or is outside your roles' current access.")}</p>}
              {preview.data?.injection_flag && (
                <p className="text-xs p-2 rounded-erp border border-warn/40 bg-warn/10 text-warn">{l("Berisi teks mirip instruksi untuk AI; diperlakukan sebagai data.", "Contains instruction-like text aimed at the AI; treated as data.")}</p>
              )}
              {preview.data?.chunks.map((c) => (
                <div key={c.citation_id} className={`p-3 rounded-erp border whitespace-pre-wrap text-sm leading-relaxed ${c.citation_id === preview.id ? "bg-tint border-brand" : "bg-surface2/60 border-line"}`}>
                  {c.anchor && <p className="eyebrow mb-1">{c.anchor}</p>}
                  {formatChunkText(c.text)}
                </div>
              ))}
            </div>
            {preview.data && (
              <div className="p-4 border-t border-line flex gap-2 flex-wrap">
                {preview.data.source === "upload" && (
                  <a className="btn" href={`/documents/${encodeURIComponent(preview.data.id)}`}><FileText size={14} /> {l("Buka dokumen", "Open document")}</a>
                )}
                {preview.data.download_url && <a className="btn" href={preview.data.download_url} target="_blank" rel="noreferrer"><Download size={14} /> {l("File asli", "Original file")}</a>}
                {preview.data.url && <a className="btn" href={preview.data.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {l("Buka di sumber", "Open at source")}</a>}
                <a className="btn ml-auto" href={`/sources/${encodeURIComponent(preview.id)}`}>{l("Halaman penuh", "Full page")}</a>
              </div>
            )}
          </aside>
        </div>
      )}
    </Shell>
  );
}
