"use client";
import { motion } from "framer-motion";
import { Check, Eye, EyeOff, Lock, TriangleAlert } from "lucide-react";
import type { Tier, Wizard } from "@/store/session";
import { useL } from "@/lib/i18n";

const TIERS: { v: Tier; icon: React.ReactNode }[] = [
  { v: "hidden", icon: <EyeOff size={14} /> },
  { v: "gated", icon: <Lock size={14} /> },
  { v: "open", icon: <Eye size={14} /> },
];

/** Containers x roles grid. Click cells to grant, segmented control sets the tier. */
export function AccessMatrix({ w, patch }: { w: Wizard; patch: (p: Partial<Wizard>) => void }) {
  const l = useL();
  const set = (i: number, fn: (c: Wizard["containers"][number]) => Wizard["containers"][number]) =>
    patch({ containers: w.containers.map((c, j) => (j === i ? fn(c) : c)) });
  const unmapped = w.containers.filter((c) => c.tier === "hidden" && c.roles.length === 0).length;
  const mapped = w.containers.length - unmapped;
  const pct = w.containers.length ? (mapped / w.containers.length) * 100 : 0;

  if (!w.containers.length)
    return <p className="text-muted">{l("Belum ada container. Upload dokumen atau hubungkan integrasi dulu.", "No containers yet. Upload documents or connect an integration first.")}</p>;

  if (!w.roles.length)
    return <p className="text-muted">{l("Tambahkan peran di langkah Peran dulu.", "Add roles in the Roles step first.")}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <div className="flex justify-between text-sm mb-1.5"><span>{l("Sudah dipetakan", "Mapped")}</span><b>{mapped}/{w.containers.length}</b></div>
          <div className="h-2 rounded-full bg-line overflow-hidden"><motion.div className="h-full" style={{ background: unmapped ? "var(--accent)" : "var(--ok)" }} animate={{ width: `${pct}%` }} /></div>
        </div>
        <button className="btn" onClick={() => patch({ containers: w.containers.map((c) => ({ ...c, tier: "open", roles: [...w.roles] })) })}>{l("Buka untuk semua peran", "Open to all roles")}</button>
        <button className="btn" onClick={() => patch({ containers: w.containers.map((c) => ({ ...c, tier: "hidden", roles: [] })) })}>{l("Kunci semua", "Lock all")}</button>
      </div>
      {unmapped > 0 && (
        <p className="flex gap-2 text-warn items-center"><TriangleAlert size={18} /> {l(`${unmapped} container masih tertutup untuk semua orang. Klik sel untuk memberi akses.`, `${unmapped} container(s) are still closed to everyone. Click a cell to grant access.`)}</p>
      )}
      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="eyebrow border-b border-line">
              <th className="text-left font-normal p-3 min-w-[170px]">Container</th>
              <th className="text-left font-normal p-3">Tier</th>
              {w.roles.map((r) => <th key={r} className="font-normal p-2 [writing-mode:vertical-rl] rotate-180 h-24 text-left">{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {w.containers.map((c, i) => (
              <motion.tr key={c.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }} className="border-t border-line">
                <td className="p-3"><span className="font-medium">{c.name}</span> <span className="eyebrow">{c.source}</span></td>
                <td className="p-3">
                  <div className="inline-flex rounded-full border border-line2 p-0.5 bg-surface2" role="group" aria-label={`Tier ${c.name}`}>
                    {TIERS.map((t) => (
                      <button key={t.v} onClick={() => set(i, (x) => ({ ...x, tier: t.v }))} aria-pressed={c.tier === t.v} title={t.v}
                        className={`relative px-2.5 py-1 rounded-full flex items-center gap-1 text-xs transition-colors ${c.tier === t.v ? "bg-brand text-brandfg" : "text-muted hover:text-fg"}`}>
                        {t.icon}<span className="hidden md:inline">{t.v}</span>
                      </button>
                    ))}
                  </div>
                </td>
                {w.roles.map((r) => {
                  const on = c.roles.includes(r);
                  return (
                    <td key={r} className="p-1 text-center">
                      <motion.button whileTap={{ scale: 0.85 }} aria-pressed={on} aria-label={`${c.name} ${r}`}
                        onClick={() => set(i, (x) => ({ ...x, roles: on ? x.roles.filter((y) => y !== r) : [...x.roles, r] }))}
                        className={`w-8 h-8 rounded-lg grid place-items-center border transition-colors ${on ? "bg-brand border-brand text-brandfg" : "border-line2 hover:border-brand hover:bg-tint"}`}>
                        {on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={15} /></motion.span>}
                      </motion.button>
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">{l("open: terlihat peran terpilih · gated: peran lain bisa mengajukan akses · hidden: seolah tidak ada.", "open: visible to chosen roles · gated: others can request access · hidden: treated as if it doesn't exist.")}</p>
    </div>
  );
}
