"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Mascot } from "@/components/mascot/Mascot";
import { useSession } from "@/store/session";
import { useL } from "@/lib/i18n";
import { ApiError, apiFetch, errorText } from "@/lib/api";
import type { SourceOut } from "@/lib/contracts";
import { AlertTriangle, Calendar, Download, ExternalLink, FileText, ShieldCheck, User } from "lucide-react";

export default function SourcePage() {
  const { id } = useParams<{ id: string }>();
  const decodedId = decodeURIComponent(id || "");
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [source, setSource] = useState<SourceOut | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!decodedId) return;
    setLoading(true);
    setNotFound(false);
    setErr("");
    apiFetch<SourceOut>(`/api/sources/${encodeURIComponent(decodedId)}`)
      .then(setSource)
      // Forbidden and missing look the same on purpose (doc §10.5): both are a 404.
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setNotFound(true) : setErr(errorText(e))))
      .finally(() => setLoading(false));
  }, [decodedId]);

  useEffect(() => {
    document.getElementById(`chunk-${decodedId}`)?.scrollIntoView({ block: "center" });
  }, [source, decodedId]);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(lang === "id" ? "id-ID" : "en-US", { year: "numeric", month: "short", day: "numeric" });

  return (
    <Shell title={l("Sumber", "Source")}>
      {loading ? (
        <div className="flex items-center gap-3 text-muted py-8">
          <Mascot state="thinking" size={48} />
          <p className="animate-pulse">{l("Memeriksa izin dan memuat sumber…", "Checking permissions and loading source…")}</p>
        </div>
      ) : err ? (
        <p role="alert" className="text-bad">{err}</p>
      ) : notFound || !source ? (
        <div className="flex items-center gap-4 py-8">
          <Mascot state="idk" size={64} />
          <div>
            <p className="font-semibold text-lg">{l("Sumber tidak ditemukan.", "Source not found.")}</p>
            <p className="text-sm text-muted">
              {l("Sumber mungkin tidak ada atau dibatasi oleh kebijakan akses peran Anda.", "The source may not exist or is restricted by your role's access policy.")}
            </p>
          </div>
        </div>
      ) : (
        <article className="card p-6 max-w-3xl flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <span className="font-mono text-xs px-2 py-1 rounded bg-surface2 border border-line">{decodedId}</span>
            <span className="text-xs text-muted flex items-center gap-1">
              <ShieldCheck size={13} className="text-brand" />
              {l("Akses terverifikasi saat runtime", "Access verified at runtime")}
            </span>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight mb-2">{source.title || source.id}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span className="flex items-center gap-1"><FileText size={13} /> {source.type} · {source.source}</span>
              <span>•</span>
              <span>{source.container}</span>
              <span>•</span>
              <span className="flex items-center gap-1"><User size={13} /> {source.author || "—"}</span>
              <span>•</span>
              <span className="flex items-center gap-1"><Calendar size={13} /> {fmt(source.updated_at || source.created_at)}</span>
              <span>•</span>
              <span>{source.authority}</span>
            </div>
          </div>

          {source.injection_flag && (
            <div className="flex items-center gap-2 text-xs text-warn bg-warn/10 p-2.5 rounded-erp border border-warn/30">
              <AlertTriangle size={14} className="shrink-0" />
              {l("Sumber ini berisi pola mirip instruksi (prompt injection). Isinya diperlakukan sebagai data, tidak pernah dijalankan.",
                "This source contains instruction-like text (prompt injection). It is treated as data and never followed.")}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {source.chunks.map((c) => (
              <div key={c.citation_id} id={`chunk-${c.citation_id}`}
                className={`p-4 rounded-erp border leading-relaxed text-[0.95rem] whitespace-pre-wrap ${c.citation_id === decodedId ? "bg-tint border-brand" : "bg-surface2/60 border-line"}`}>
                {c.anchor && <p className="eyebrow mb-1">{c.anchor}</p>}
                {c.text}
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            {source.url && <a className="btn" href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {l("Buka di sumber asli", "Open original")}</a>}
            {source.download_url && <a className="btn" href={source.download_url}><Download size={14} /> {l("Unduh file asli", "Download original")}</a>}
          </div>

          <p className="text-xs text-muted">
            {l(
              "Izin akses dicek ulang setiap kali sumber dibuka, dan data pribadi disamarkan sesuai peran Anda (System Design §10.5).",
              "Permissions are re-checked every time a source is opened, and personal data is masked per your role (System Design §10.5).",
            )}
          </p>
        </article>
      )}
    </Shell>
  );
}
