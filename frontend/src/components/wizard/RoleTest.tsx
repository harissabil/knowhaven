"use client";
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, ShieldCheck } from "lucide-react";
import type { Wizard } from "@/store/session";
import { useL } from "@/lib/i18n";

type Kind = "answer" | "gated" | "idk";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask one role, or sweep every role with the same question (a mini differential test). */
export function RoleTest({ w, onTested }: { w: Wizard; onTested: () => void }) {
  const l = useL();
  const [role, setRole] = useState(w.roles[0] ?? "staff");
  const [q, setQ] = useState("");
  const [one, setOne] = useState<Kind | null>(null);
  const [rows, setRows] = useState<{ role: string; kind: Kind; n: number }[]>([]);
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const evalRole = (r: string): { kind: Kind; n: number } => {
    const readable = w.containers.filter((c) => c.tier !== "hidden" && c.roles.includes(r));
    const gated = w.containers.some((c) => c.tier === "gated" && !c.roles.includes(r));
    return readable.length ? { kind: "answer", n: readable.length } : { kind: gated ? "gated" : "idk", n: 0 };
  };
  const text = (k: Kind, n: number) =>
    k === "answer" ? l(`Havi menemukan ${n} sumber yang boleh dilihat peran ini.`, `Havi found ${n} source(s) this role may see.`)
    : k === "gated" ? l("Topik ini dibatasi. Anda bisa mengajukan akses ke manager.", "This topic is restricted. You can request access from a manager.")
    : l("Saya tidak menemukan informasi tentang itu di data yang bisa Anda akses.", "I couldn't find information about that in the data you can access.");

  function ask() {
    if (!q.trim()) return ref.current?.focus();
    setRows([]); setOne(evalRole(role).kind); onTested();
  }
  async function sweep() {
    if (!q.trim()) return ref.current?.focus();
    setOne(null); setRows([]); setRunning(true); onTested();
    for (const r of w.roles) { await sleep(280); setRows((x) => [...x, { role: r, ...evalRole(r) }]); }
    setRunning(false);
  }
  const noAccess = useMemo(() => rows.filter((r) => r.kind !== "answer"), [rows]);
  const hidden = w.containers.filter((c) => c.tier === "hidden").length;
  const done = rows.length === w.roles.length && !running;

  if (!w.roles.length) return <p className="text-muted">{l("Tambahkan peran di langkah Peran dulu.", "Add roles in the Roles step first.")}</p>;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{l("Uji sebelum mengundang siapa pun. Container hidden tidak pernah muncul, dan jawabannya sama dengan topik yang tidak ada.", "Test before inviting anyone. Hidden containers never appear, and the answer is the same as for a topic that doesn't exist.")}</p>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input ref={ref} className="input flex-1 min-w-[220px]" aria-label={l("Pertanyaan uji", "Test question")} placeholder={l("Tulis pertanyaan uji", "Write a test question")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn btn-primary" onClick={sweep} disabled={running}><Play size={16} /> {l("Uji semua peran", "Test all roles")}</button>
      </form>

      <div>
        <p className="eyebrow mb-2">{l("Atau tanya sebagai satu peran", "Or ask as a single role")}</p>
        <div className="flex flex-wrap gap-2">
          {w.roles.map((r) => (
            <button key={r} className={`btn ${role === r ? "!border-brand !bg-tint" : ""}`} aria-pressed={role === r}
              onClick={() => { setRole(r); setOne(null); setRows([]); }}>{r}</button>
          ))}
          <button className="btn btn-primary" onClick={ask}>{l("Tanya", "Ask")}</button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {one && (
          <motion.div key={role + one} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-4 items-start card p-4">
            <div><p className="eyebrow mb-1">{l("Sebagai", "As")} {role}</p><p className="text-lg">{text(one, evalRole(role).n)}</p></div>
          </motion.div>
        )}
      </AnimatePresence>

      {rows.length > 0 && (
        <div className="card overflow-hidden">
          <div className="eyebrow px-4 py-2.5 border-b border-line">{l("Hasil per peran · pertanyaan sama", "Result per role · same question")}</div>
          <ul>
            {rows.map((r) => (
              <motion.li key={r.role} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-0">
                <b className="w-28 shrink-0">{r.role}</b>
                <span className={`font-mono text-xs rounded border px-2 py-0.5 ${r.kind === "answer" ? "text-ok border-ok" : r.kind === "gated" ? "text-warn border-warn" : "text-muted border-line2"}`}>
                  {r.kind === "answer" ? l(`${r.n} sumber`, `${r.n} source(s)`) : r.kind === "gated" ? "gated" : l("tidak tahu", "don't know")}
                </span>
                <span className="text-sm text-muted truncate">{text(r.kind, r.n)}</span>
              </motion.li>
            ))}
          </ul>
          {done && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="px-4 py-3 bg-tint flex items-start gap-3 text-sm">
              <ShieldCheck size={20} className="text-ok shrink-0 mt-0.5" />
              <span>
                {l(`Uji bocor: ${hidden} container hidden tidak muncul di satu pun jawaban. ${noAccess.length} peran tanpa akses menerima respons yang sama persis.`,
                  `Leak check: ${hidden} hidden container(s) appeared in no answer. ${noAccess.length} role(s) without access got the exact same response.`)}
              </span>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
