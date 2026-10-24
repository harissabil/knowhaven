"use client";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import type { Wizard } from "@/store/session";
import { useL } from "@/lib/i18n";

// admin page that owns each step (index matches the wizard steps)
const ADMIN: Record<number, string> = { 0: "/admin/setup", 1: "/admin/members", 2: "/admin/upload", 3: "/admin/integrations", 4: "/admin/containers", 5: "/admin/topics", 7: "/admin/invites" };

export function DoneStep({ w, names, goto }: { w: Wizard; names: string[]; goto: (i: number) => void }) {
  const l = useL();
  const ready = w.docs.filter((d) => Date.now() - (d.at ?? 0) > 3200 || d.status === "ready").length;
  const mapped = w.containers.filter((c) => !(c.tier === "hidden" && c.roles.length === 0)).length;
  const stats: [number, string][] = [
    [ready, l("dokumen siap", "documents ready")],
    [Object.keys(w.integ).length, l("integrasi", "integrations")],
    [mapped, l("container dipetakan", "containers mapped")],
    [w.invitees.filter((x) => x.sent).length + w.invites.length, l("undangan", "invitations")],
  ];
  return (
    <div className="relative flex flex-col gap-6">
      <div>
        <h3 className="text-2xl md:text-3xl">{l("Setup selesai.", "Setup complete.")}</h3>
        <p className="text-muted mt-1">{l("Langkah yang dilewati bisa diatur kapan saja dari halaman admin.", "Anything you skipped can be set up anytime from the admin pages.")}</p>
      </div>
      {/* <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(([n, label]) => (
          <div key={label} className="card p-4">
            <p className="text-3xl font-semibold">{n}</p>
            <p className="eyebrow mt-1">{label}</p>
          </div>
        ))}
      </div> */}
      {/* <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {names.slice(0, 8).map((s, i) => (
          <li key={s} className="flex gap-2 items-center">
            {w.done.includes(i) ? <Check size={16} className="text-ok" /> : <Circle size={16} className="text-warn" />}
            {s}{!w.done.includes(i) && (
              <span className="text-sm text-muted">
                <button className="underline" onClick={() => goto(i)}>{l("kerjakan sekarang", "do it now")}</button>
                {ADMIN[i] && <> · <Link className="underline" href={ADMIN[i]}>{l("atau atur nanti", "or set up later")}</Link></>}
              </span>
            )}
          </li>
        ))}
      </ul> */}
      <div className="flex gap-3 flex-wrap">
        <Link href="/chat" className="btn btn-primary btn-lg">{l("Selesaikan Setup", "Complete Setup")}</Link>
        <Link href="/settings/workbuddy" className="btn btn-lg">{l("Hubungkan WorkBuddy (opsional)", "Connect WorkBuddy (optional)")}</Link>
      </div>
    </div>
  );
}
