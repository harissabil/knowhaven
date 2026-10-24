"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Send, ShieldAlert, Scale, FileText, MessageCircle, ListChecks } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { answerFor, SUGGESTIONS, type Answer } from "@/mock/chat";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";

interface Msg { role: "user" | "bot"; text: string; answer?: Answer; at: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KIND_ICON = { chat: <MessageCircle size={14} />, doc: <FileText size={14} />, task: <ListChecks size={14} /> };

function render(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>);
}

function Stream({ text, onDone }: { text: string; onDone: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n >= text.length) { onDone(); return; }
    const t = setTimeout(() => setN((x) => Math.min(text.length, x + 2)), 16);
    return () => clearTimeout(t);
  }, [n, text, onDone]);
  return <p>{render(text.slice(0, n))}{n < text.length && <span className="inline-block w-[2px] h-4 bg-fg align-middle ml-0.5 animate-pulse" />}</p>;
}

export default function Chat() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [state, setState] = useState<MascotState>("idle");
  const [requested, setRequested] = useState(false);
  const [streamDone, setStreamDone] = useState(true);
  const busy = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, streamDone, state]);

  async function ask(text: string) {
    if (!text.trim() || busy.current) return;
    busy.current = true;
    setQ("");
    const now = () => new Date().toLocaleTimeString(lang === "id" ? "id-ID" : "en-US");
    setMsgs((m) => [...m, { role: "user", text, at: now() }]);
    setState("listening");
    await sleep(350);
    setState("thinking");
    await sleep(650);
    const a = answerFor(text, lang);
    setState(a.state);
    setStreamDone(false);
    setMsgs((m) => [...m, { role: "bot", text: a.text, answer: a, at: now() }]);
    busy.current = false;
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
              const reveal = !last || m.role === "user" || streamDone;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex gap-3.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "bot" && (
                    <div className="shrink-0 mt-0.5">
                      <Mascot size={46} state={m.answer?.state} />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] md:max-w-[80%] p-4 rounded-erp shadow-xs ${
                      m.role === "user" ? "bg-surface2 border border-line2" : "border border-line bg-surface"
                    }`}
                  >
                    {m.role === "bot" && last && !streamDone ? (
                      <Stream text={m.text} onDone={() => setStreamDone(true)} />
                    ) : (
                      <p className="leading-relaxed text-[0.98rem]">{render(m.text)}</p>
                    )}

                    {reveal && (
                      <>
                        {m.answer?.conflict && (
                          <p className="mt-3 flex gap-1.5 text-warn text-sm">
                            <Scale size={16} className="shrink-0 mt-0.5" />
                            <span><b>{l("Konflik sumber", "Source conflict")}:</b> {m.answer.conflict.reason}</span>
                          </p>
                        )}
                        {m.answer?.idkOwner && (
                          <p className="mt-2 text-sm">
                            {l("Pemilik topik", "Topic owner")}: <b>{m.answer.idkOwner}</b>
                          </p>
                        )}
                        {m.answer?.canRequestAccess && (
                          <button
                            className="btn btn-primary mt-2.5"
                            disabled={requested}
                            onClick={() => {
                              setRequested(true);
                              setState("waiting");
                            }}
                          >
                            <ShieldAlert size={16} />{" "}
                            {requested ? l("Menunggu approver…", "Waiting for approver…") : t("requestAccess")}
                          </button>
                        )}
                        {!!m.answer?.citations.length && (
                          <div className="mt-3 pt-2 border-t border-line/60 flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted mr-1">{t("sources")}:</span>
                            {m.answer.citations.map((c, n) => (
                              <a
                                key={c.id}
                                href={`/sources/${encodeURIComponent(c.id)}`}
                                className="btn !py-1 !px-2.5 text-xs hover:border-brand inline-flex items-center gap-1.5"
                                title={c.label}
                              >
                                [{n + 1}] {KIND_ICON[c.kind]} {c.id}
                              </a>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-muted mt-2">{t("dataAsOf")} {m.at}</p>
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}

            {state === "thinking" && (
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
