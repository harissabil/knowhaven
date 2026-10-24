"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { TRACE_STEPS } from "@/mock/chat";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const COLOR = { CODE: "text-brand", LLM: "text-accent", "LLM+CODE": "text-muted" } as const;

/** Looping landing demo: question types in, trace steps run, cited answer lands. */
export function ProductDemo({ lang, question, answer, traceLabel, frame, bare = false }: {
  lang: "id" | "en"; question: string; answer: string; traceLabel: string; frame: string; bare?: boolean;
}) {
  const [typed, setTyped] = useState(question.length);
  const [step, setStep] = useState(TRACE_STEPS.length + 1); // > length = all done
  const [shown, setShown] = useState(true);
  const [mood, setMood] = useState<MascotState>("conflict");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let dead = false;
    (async () => {
      while (!dead) {
        setShown(false); setStep(0); setTyped(0); setMood("idle");
        await sleep(700);
        for (let i = 1; i <= question.length && !dead; i++) { setTyped(i); await sleep(28); }
        if (dead) return;
        setMood("thinking"); await sleep(350);
        for (let n = 1; n <= TRACE_STEPS.length && !dead; n++) { setStep(n); await sleep(420); }
        if (dead) return;
        setStep(TRACE_STEPS.length + 1); setMood("conflict"); setShown(true);
        await sleep(5200);
      }
    })();
    return () => { dead = true; };
  }, [question]);

  return (
    <div className={bare ? "" : "border border-line rounded-lg bg-surface overflow-hidden"}>
      {!bare && <div className="eyebrow border-b border-line px-4 py-2.5">{frame}</div>}
      <div className="grid md:grid-cols-[1fr_320px]">
        <div className="p-5 flex flex-col gap-4 md:border-r border-line min-h-[220px]">
          <div className="self-end max-w-[85%] border border-line2 bg-surface2 rounded-md px-3 py-2">
            {question.slice(0, typed)}
            {typed < question.length && <span className="inline-block w-[2px] h-4 bg-fg align-middle ml-0.5 animate-pulse" />}
          </div>
          <AnimatePresence>
            {(shown || step > 0) && (
              <motion.div key="bot" className="flex gap-3 items-start"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                <Mascot size={44} state={mood} />
                <div className="border border-line rounded-md px-3 py-2 min-w-[200px]">
                  {shown ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                      {answer}
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {["[1] CHAT-pengumuman-hr-0031", "[2] DOC-sop-reimbursement#3"].map((c, i) => (
                          <motion.code key={c} className="text-xs border border-line2 rounded px-1.5 py-0.5"
                            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.15 }}>{c}</motion.code>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <span className="flex gap-1 items-center text-muted py-1" aria-label="thinking">
                      {[0, 1, 2].map((d) => (
                        <motion.span key={d} className="w-1.5 h-1.5 rounded-full bg-muted"
                          animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.18 }} />
                      ))}
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-5 border-t md:border-t-0 border-line">
          <div className="eyebrow mb-3">{traceLabel}</div>
          <ol className="flex flex-col gap-1.5 text-xs font-mono">
            {TRACE_STEPS.map((s) => {
              const done = step > s.n, active = step === s.n;
              return (
                <li key={s.n} className={`flex gap-2 items-center transition-opacity duration-200 ${done || active ? "opacity-100" : "opacity-40"}`}>
                  <span className="w-3 grid place-items-center">
                    {done ? <Check size={12} className="text-ok" />
                      : active ? <motion.span className="w-1.5 h-1.5 rounded-full bg-brand" animate={{ scale: [1, 1.6, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
                      : <span className="w-1 h-1 rounded-full bg-muted" />}
                  </span>
                  <span className={COLOR[s.kind]}>[{s.kind}]</span>
                  <span className={active ? "text-fg" : "text-muted"}>{s.name[lang]}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
