"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";

type L2 = { id: string; en: string };
type Kind = "answer" | "conflict" | "idk" | "gated";
interface Cell { kind: Kind; text: L2; cites?: string[]; visible: number; filtered?: number }

const ROLES = [
  { key: "dimas", name: "Dimas", role: { id: "Karyawan Baru", en: "New hire" } },
  { key: "andi", name: "Andi", role: { id: "Project Manager", en: "Project Manager" } },
  { key: "sari", name: "Sari", role: { id: "HR", en: "HR" } },
  { key: "lina", name: "Lina", role: { id: "Auditor", en: "Auditor" } },
  { key: "yoga", name: "Yoga", role: { id: "Perusahaan lain", en: "Other company" } },
] as const;

const QUESTIONS: { key: string; q: L2 }[] = [
  { key: "fuel", q: { id: "Uang bensin per bulan berapa?", en: "How much is the monthly fuel allowance?" } },
  { key: "kenari", q: { id: "Ceritakan tentang Proyek Kenari", en: "Tell me about Project Kenari" } },
  { key: "grade", q: { id: "Grade gaji level 3 berapa?", en: "What is the level 3 salary grade?" } },
];

const IDK: L2 = {
  id: "Saya tidak menemukan informasi tentang itu di data yang bisa Anda akses. Silakan hubungi HR Helpdesk.",
  en: "I couldn't find information about that in the data you can access. Please contact the HR Helpdesk.",
};
const FUEL: Cell = {
  kind: "conflict", visible: 2, filtered: 0,
  text: { id: "Rp750.000 per bulan. Pengumuman HR terbaru menggantikan SOP lama (Rp500.000), yang ditandai usang.", en: "Rp750,000 per month. The newer HR announcement replaces the old SOP (Rp500,000), which is flagged outdated." },
  cites: ["CHAT-pengumuman-hr-0031", "DOC-sop-reimbursement#3"],
};
const GATED: Cell = {
  kind: "gated", visible: 0,
  text: { id: "Topik ini dibatasi. Anda bisa mengajukan akses ke manager.", en: "This topic is restricted. You can request access from a manager." },
};

const MATRIX: Record<string, Record<string, Cell>> = {
  fuel: { dimas: FUEL, andi: FUEL, sari: FUEL, lina: FUEL, yoga: { kind: "idk", text: IDK, visible: 0 } },
  kenari: {
    dimas: { kind: "idk", text: IDK, visible: 0 },
    andi: { kind: "answer", visible: 3, text: { id: "Proyek Kenari: target rilis 14 Nov 2026, 3 task open. (data demo)", en: "Project Kenari: release target 14 Nov 2026, 3 open tasks. (demo data)" }, cites: ["DOC-charter-kenari#1", "TASK-KNR-12"] },
    sari: { kind: "idk", text: IDK, visible: 0 },
    lina: { kind: "idk", text: IDK, visible: 0, filtered: 9 },
    yoga: { kind: "idk", text: IDK, visible: 0 },
  },
  grade: {
    dimas: GATED, andi: GATED,
    sari: { kind: "answer", visible: 1, text: { id: "Level 3: Rp9.5 sampai 12 juta per bulan.", en: "Level 3: Rp9.5 to 12 million per month." }, cites: ["DOC-grade-gaji#L3"] },
    lina: GATED,
    yoga: { kind: "idk", text: IDK, visible: 0 },
  },
};
const MOOD: Record<Kind, MascotState> = { answer: "answering", conflict: "conflict", idk: "idk", gated: "refusing" };

export function RoleDemo({ lang }: { lang: "id" | "en" }) {
  const [role, setRole] = useState<string>("dimas");
  const [q, setQ] = useState("fuel");
  const cell = MATRIX[q][role];
  const l = (a: string, b: string) => (lang === "id" ? a : b);
  const isAuditor = role === "lina";
  const key = role + q;

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-6">
      <div className="flex flex-col gap-5">
        <div>
          <p className="eyebrow mb-2">{l("1. Pilih siapa yang bertanya", "1. Pick who is asking")}</p>
          <div className="flex lg:flex-col gap-2 flex-wrap">
            {ROLES.map((r) => (
              <button key={r.key} onClick={() => setRole(r.key)} aria-pressed={role === r.key}
                className={`btn !justify-start !rounded-xl text-left ${role === r.key ? "!border-brand !bg-tint" : ""}`}>
                <span className="flex flex-col leading-tight"><b>{r.name}</b><span className="text-xs text-muted font-normal">{r.role[lang]}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow mb-2">{l("2. Tanyakan hal yang sama", "2. Ask the same thing")}</p>
          <div className="flex flex-col gap-2">
            {QUESTIONS.map((x) => (
              <button key={x.key} onClick={() => setQ(x.key)} aria-pressed={q === x.key}
                className={`btn !justify-start !rounded-xl !whitespace-normal text-left ${q === x.key ? "!border-brand !bg-tint" : ""}`}>{x.q[lang]}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5 flex flex-col gap-4 min-h-[320px]">
        <div className="eyebrow flex items-center gap-2"><ShieldCheck size={14} /> {l("Jawaban untuk", "Answer for")} {ROLES.find((r) => r.key === role)?.name}</div>
        <AnimatePresence mode="wait">
          <motion.div key={key} className="flex gap-4 items-start"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            <Mascot size={64} state={MOOD[cell.kind]} />
            <div className="flex flex-col gap-3 flex-1">
              <div className="border border-line rounded-xl px-4 py-3 text-[1.02rem]">{cell.text[lang]}</div>
              {cell.cites && (
                <div className="flex flex-wrap gap-2">
                  {cell.cites.map((c, i) => (
                    <motion.code key={c} className="text-xs border border-line2 rounded-full px-2.5 py-1 bg-surface2"
                      initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 + i * 0.12 }}>[{i + 1}] {c}</motion.code>
                  ))}
                </div>
              )}
              {cell.kind === "gated" && (
                <button className="btn btn-primary w-fit"><Lock size={14} /> {l("Ajukan akses", "Request access")}</button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-auto grid sm:grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-ok" />
            <span>{l("Sumber yang boleh dilihat peran ini", "Sources this role may see")}: <b>{cell.visible}</b></span>
          </div>
          <div className="flex items-center gap-2 text-muted">
            <EyeOff size={16} />
            {isAuditor
              ? <span>{l("Auditor melihat jumlah terfilter", "Auditor sees the filtered count")}: <b className="text-fg">{cell.filtered ?? 0}</b> {l("(hanya ID, bukan isi)", "(IDs only, never content)")}</span>
              : <span>{l("Jumlah terfilter disembunyikan dari peran ini", "Filtered count is hidden from this role")}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
