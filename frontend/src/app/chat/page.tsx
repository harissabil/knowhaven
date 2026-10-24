"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Send, ShieldAlert, Scale, FileText, MessageCircle, ListChecks } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { answerFor, SUGGESTIONS, TRACE_STEPS, type Answer, type Citation } from "@/mock/chat";
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
  const [step, setStep] = useState(0);
  const [cite, setCite] = useState<Citation | null>(null);
  const [requested, setRequested] = useState(false);
  const [streamDone, setStreamDone] = useState(true);
  const busy = useRef(false);

  async function ask(text: string) {
    if (!text.trim() || busy.current) return;
    busy.current = true; setQ(""); setCite(null);
    const now = () => new Date().toLocaleTimeString(lang === "id" ? "id-ID" : "en-US");
    setMsgs((m) => [...m, { role: "user", text, at: now() }]);
    setState("listening"); await sleep(400);
    setState("thinking");
    for (const s of TRACE_STEPS) { setStep(s.n); await sleep(350); }
    const a = answerFor(text, lang);
    setState(a.state); setStep(0);
    setStreamDone(false);
    setMsgs((m) => [...m, { role: "bot", text: a.text, answer: a, at: now() }]);
    busy.current = false;
  }

  return (
    <Shell title={t("chat")}>
      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <section className="card p-4 flex flex-col gap-3 min-h-[60vh]">
          {msgs.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6">
              <Mascot size={120} state={state} />
              <p>{t("welcome")}</p>
              <p className="text-sm text-muted">{t("suggestions")}:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS[lang].map((s) => <button key={s} className="btn" onClick={() => ask(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => {
            const last = i === msgs.length - 1;
            const reveal = !last || m.role === "user" || streamDone;
            return (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "bot" && <Mascot size={48} state={m.answer?.state} />}
              <div className={`max-w-[80%] p-3 rounded-erp ${m.role === "user" ? "bg-surface2 border border-line2" : "border border-line"}`}>
                {m.role === "bot" && last && !streamDone ? <Stream text={m.text} onDone={() => setStreamDone(true)} /> : <p>{render(m.text)}</p>}
                {reveal && <>
                {m.answer?.conflict && (
                  <p className="mt-2 flex gap-1 text-warn text-sm"><Scale size={16} /> {l("Konflik sumber", "Source conflict")}: {m.answer.conflict.reason}</p>
                )}
                {m.answer?.idkOwner && <p className="mt-2 text-sm">{l("Pemilik topik", "Topic owner")}: <b>{m.answer.idkOwner}</b></p>}
                {m.answer?.canRequestAccess && (
                  <button className="btn btn-primary mt-2" disabled={requested} onClick={() => { setRequested(true); setState("waiting"); }}>
                    <ShieldAlert size={16} /> {requested ? l("Menunggu approver…", "Waiting for approver…") : t("requestAccess")}
                  </button>
                )}
                {!!m.answer?.citations.length && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.answer.citations.map((c, n) => (
                      <button key={c.id} className="btn !py-0.5 text-xs" onClick={() => setCite(c)}>
                        [{n + 1}] {KIND_ICON[c.kind]} {c.id}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted mt-1">{t("dataAsOf")} {m.at}</p>
                </>}
              </div>
            </motion.div>
            );
          })}
          <div className="flex-1" />
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("placeholder")} />
            <button className="btn btn-primary"><Send size={16} /> {t("send")}</button>
          </form>
        </section>

        <aside className="flex flex-col gap-4">
          <div className="card p-3">
            <h2 className="font-semibold mb-2">{t("trace")}</h2>
            <ol className="text-sm flex flex-col gap-1">
              {TRACE_STEPS.map((s) => (
                <li key={s.n} className={`flex gap-2 items-start transition-opacity ${step === 0 || step >= s.n ? "opacity-100" : "opacity-40"} ${step === s.n ? "font-semibold text-brand" : ""}`}>
                  <span className="w-3 mt-1.5 shrink-0 grid place-items-center">
                    {step === 0 ? <span className="w-1 h-1 rounded-full bg-muted" /> : step > s.n ? <span className="text-ok text-xs">✓</span>
                      : step === s.n ? <motion.span className="w-2 h-2 rounded-full bg-brand" animate={{ scale: [1, 1.5, 1] }} transition={{ duration: 0.7, repeat: Infinity }} />
                      : <span className="w-1 h-1 rounded-full bg-muted" />}
                  </span>
                  <span><code className="text-xs">[{s.kind}]</code> {s.name[lang]}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="card p-3">
            <h2 className="font-semibold mb-2">{t("sources")}</h2>
            {cite ? (
              <div className="text-sm">
                <p className="font-mono">{cite.id}</p>
                <p>{cite.label}</p>
                {cite.note && <span className="text-warn">({cite.note})</span>}
                <a className="btn mt-2" href={`/sources/${encodeURIComponent(cite.id)}`}>{l("Buka sumber", "Open source")}</a>
                <p className="text-muted mt-2">{l("Izin dicek ulang saat sumber dibuka.", "Permissions are re-checked when a source is opened.")}</p>
              </div>
            ) : <p className="text-sm text-muted">{l("Klik sitasi untuk melihat sumber.", "Click a citation to view its source.")}</p>}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
