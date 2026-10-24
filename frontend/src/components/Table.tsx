"use client";
import { motion } from "framer-motion";

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left">
        <thead className="eyebrow border-b border-line">
          <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <motion.tr key={i} className="border-t border-line hover:bg-surface2" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.04, 0.5) }}>
              {r.map((c, j) => <td key={j} className="px-4 py-3">{c}</td>)}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONE: Record<string, string> = {
  open: "text-ok", gated: "text-warn", hidden: "text-bad", pass: "text-ok", fail: "text-bad",
  pending: "text-warn", ok: "text-ok", error: "text-bad",
  passed: "text-ok", failed: "text-bad", not_run: "text-muted", skipped: "text-muted",
  active: "text-ok", approved: "text-ok", executed: "text-ok", rejected: "text-bad", revoked: "text-bad",
  expired: "text-muted", unmapped: "text-bad",
};
export function Badge({ v }: { v: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded border border-line2 px-2 py-0.5 font-mono text-xs ${TONE[v] ?? ""}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{v}</span>;
}
