"use client";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Mascot } from "@/components/mascot/Mascot";
import { usePersona, useSession } from "@/store/session";
import { can } from "@/lib/permissions";
import { SOURCES } from "@/mock/admin";
import { useL } from "@/lib/i18n";

const maskPii = (s: string) => s.replace(/\b\d{4}-\d{4}-\d{4}\b/g, "••••-••••-••••");

export default function SourcePage() {
  const { id } = useParams<{ id: string }>();
  const { roles } = usePersona();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const src = SOURCES.find((s) => s.id === decodeURIComponent(id));
  const pii = can(roles, "pii");
  return (
    <Shell title={l("Sumber", "Source")}>
      {!src ? (
        <div className="flex items-center gap-3"><Mascot state="idk" size={64} /><p>{l("Sumber tidak ditemukan.", "Source not found.")}</p></div>
      ) : (
        <article className="card p-4 max-w-2xl flex flex-col gap-2">
          <p className="font-mono text-sm">{src.id}</p>
          <h2 className="text-xl font-bold">{src.title[lang]}</h2>
          <p className="text-sm text-muted">{src.kind} · {src.container} · {src.author} · {src.date[lang]}</p>
          <p>{pii ? src.text[lang] : maskPii(src.text[lang])}</p>
          {!pii && src.piiText && <p className="text-sm text-warn">{l("Data pribadi dimasking untuk peran Anda.", "Personal data is masked for your role.")}</p>}
          <p className="text-xs text-muted">{l("Izin dicek ulang saat sumber dibuka.", "Permissions are re-checked when a source is opened.")}</p>
        </article>
      )}
    </Shell>
  );
}
