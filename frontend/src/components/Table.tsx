"use client";
import { motion } from "framer-motion";
import { StatusChip, type Tone } from "@/components/Chip";

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

const TONE: Record<string, Tone> = {
  open: "ok", gated: "warn", hidden: "bad", pass: "ok", fail: "bad",
  pending: "warn", ok: "ok", error: "bad",
  passed: "ok", failed: "bad", not_run: "muted", skipped: "muted",
  active: "ok", approved: "ok", executed: "ok", rejected: "bad", revoked: "bad",
  expired: "muted", unmapped: "bad",
};
export function Badge({ v }: { v: string }) {
  return <StatusChip tone={TONE[v] ?? "muted"}>{v.replace(/_/g, " ")}</StatusChip>;
}