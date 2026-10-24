"use client";
import { motion } from "framer-motion";
import { LOGOS } from "@/components/BrandLogos";
import { Mascot } from "@/components/mascot/Mascot";
import { FileText } from "lucide-react";

const SOURCES = [
  { name: "Slack", logo: "Slack" },
  { name: "Confluence", logo: "Confluence" },
  { name: "Jira", logo: "Jira" },
  { name: "WhatsApp", logo: "WhatsApp" },
  { name: "PDF / DOCX", logo: "" },
];
const W = 900, H = 340;
const ys = [44, 108, 170, 232, 296];
const path = (i: number) => `M 196 ${ys[i]} C 330 ${ys[i]}, 330 170, 420 170`;

/** Sources flow into Havi, Havi emits a cited answer. Pure SVG paths + CSS dashes + SMIL dots. */
export function FlowScene({ lang }: { lang: "id" | "en" }) {
  return (
    <div className="relative w-full max-w-[900px] mx-auto aspect-[900/340] select-none" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full">
        {SOURCES.map((_, i) => (
          <g key={i}>
            <path id={`fp${i}`} d={path(i)} fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
            <path d={path(i)} fill="none" stroke="var(--brand)" strokeWidth="1.5" className="flow-line" opacity=".7" />
            <circle r="4" fill="var(--brand)">
              <animateMotion dur="2.8s" begin={`${i * 0.45}s`} repeatCount="indefinite"><mpath href={`#fp${i}`} /></animateMotion>
            </circle>
          </g>
        ))}
        <path id="fout" d="M 500 170 L 640 170" stroke="var(--border-strong)" strokeWidth="1.5" fill="none" />
        <path d="M 500 170 L 640 170" stroke="var(--brand)" strokeWidth="1.5" className="flow-line" fill="none" />
        <circle r="5" fill="var(--accent)">
          <animateMotion dur="1.8s" repeatCount="indefinite"><mpath href="#fout" /></animateMotion>
        </circle>
      </svg>

      {SOURCES.map((s, i) => {
        const L = s.logo ? LOGOS[s.logo] : null;
        return (
          <motion.div key={s.name} className="card absolute flex items-center gap-2 px-3 py-1.5 !rounded-full shadow-sm"
            style={{ left: 0, top: `${(ys[i] / H) * 100}%`, transform: "translateY(-50%)" }}
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i, duration: 0.5 }}>
            <span className="w-5 h-5 grid place-items-center shrink-0">{L ? <L size={18} /> : <FileText size={18} />}</span>
            <span className="text-sm font-medium hidden sm:inline">{s.name}</span>
          </motion.div>
        );
      })}

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center">
        <motion.span className="absolute w-44 h-44 rounded-full border border-brand/40"
          animate={{ scale: [1, 1.25], opacity: [0.6, 0] }} transition={{ duration: 2.4, repeat: Infinity }} />
        <motion.span className="absolute w-44 h-44 rounded-full border border-brand/40"
          animate={{ scale: [1, 1.25], opacity: [0.6, 0] }} transition={{ duration: 2.4, repeat: Infinity, delay: 1.2 }} />
        <div className="relative rounded-full bg-tint border border-line2 w-36 h-36 grid place-items-center"><Mascot size={110} state="thinking" /></div>
      </div>

      <motion.div className="card absolute right-0 top-1/2 -translate-y-1/2 w-[27%] min-w-[150px] p-3 text-left shadow-sm"
        initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8, duration: 0.6 }}>
        <p className="eyebrow mb-1">{lang === "id" ? "Jawaban" : "Answer"}</p>
        <p className="text-sm leading-snug">{lang === "id" ? "Rp750.000 per bulan." : "Rp750,000 per month."}</p>
        <div className="flex gap-1 mt-2 flex-wrap">
          <code className="text-[10px] border border-line2 rounded px-1">[1]</code>
          <code className="text-[10px] border border-line2 rounded px-1">[2]</code>
          <code className="text-[10px] text-ok border border-line2 rounded px-1">✓ cited</code>
        </div>
      </motion.div>
    </div>
  );
}
