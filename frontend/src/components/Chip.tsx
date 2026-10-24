import { Shield } from "lucide-react";

/** Shared chips. Two kinds, kept visually distinct on purpose:
 * - StatusChip: a state the system computed. Colour carries meaning (dot + tinted fill).
 * - RoleChip: a label describing a person. Neutral, so colour stays reserved for status. */

export type Tone = "ok" | "warn" | "bad" | "muted";

// Full class strings so Tailwind can see them. Fill is a ~12% tint of the semantic colour.
const TONE_CLASS: Record<Tone, { box: string; dot: string }> = {
  ok: { box: "bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] text-ok", dot: "bg-ok" },
  warn: { box: "bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-warn", dot: "bg-warn" },
  bad: { box: "bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] text-bad", dot: "bg-bad" },
  muted: { box: "bg-surface2 text-muted", dot: "bg-muted/60" },
};

const BASE = "inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-xs font-medium leading-none whitespace-nowrap select-none";

export function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONE_CLASS[tone];
  return (
    <span className={`${BASE} ${t.box}`}>
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.dot}`} />
      {children}
    </span>
  );
}

export function RoleChip({ role, system }: { role: string; system?: boolean }) {
  return (
    <span className={`${BASE} bg-surface2 text-fg/80 ring-1 ring-inset ring-line`}>
      {system && <Shield size={11} aria-hidden className="text-muted shrink-0" />}
      {role}
    </span>
  );
}

/** Neutral label for a category (e.g. a scope type). Same look as RoleChip, no icon. */
export function NeutralChip({ children }: { children: React.ReactNode }) {
  return <span className={`${BASE} bg-surface2 text-fg/80 ring-1 ring-inset ring-line`}>{children}</span>;
}