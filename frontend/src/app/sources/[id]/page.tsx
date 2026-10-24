"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Mascot } from "@/components/mascot/Mascot";
import { usePersona, useSession } from "@/store/session";
import { can } from "@/lib/permissions";
import { SOURCES as MOCK_SOURCES } from "@/mock/admin";
import { useL } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { Lock, FileText, Calendar, User, ShieldCheck } from "lucide-react";

interface SourceDetail {
  id: string;
  title: string;
  kind: string;
  container: string;
  author: string;
  date: string;
  content: string;
  piiMasked: boolean;
  chunksCount?: number;
}

const maskPii = (s: string) => s.replace(/\b\d{4}-\d{4}-\d{4}\b/g, "••••-••••-••••");

export default function SourcePage() {
  const { id } = useParams<{ id: string }>();
  const decodedId = decodeURIComponent(id || "");
  const { roles } = usePersona();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const piiAllowed = can(roles, "pii");

  const [source, setSource] = useState<SourceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSource() {
      setLoading(true);
      setNotFound(false);

      try {
        const res = await apiFetch<{
          id: string;
          container: string;
          type: string;
          title: string | null;
          author: string | null;
          created_at: string;
          updated_at: string;
          content: string;
          chunks: unknown[];
          pii_masked: boolean;
        }>(`/api/sources/${encodeURIComponent(decodedId)}`);

        if (res) {
          const formattedDate = new Date(res.updated_at || res.created_at).toLocaleDateString(
            lang === "id" ? "id-ID" : "en-US",
            { year: "numeric", month: "short", day: "numeric" },
          );

          setSource({
            id: res.id,
            title: res.title || res.id,
            kind: res.type,
            container: res.container,
            author: res.author || "System",
            date: formattedDate,
            content: res.content,
            piiMasked: res.pii_masked,
            chunksCount: res.chunks?.length || 1,
          });
          setLoading(false);
          return;
        }
      } catch {
        // ignore and fallback
      }

      // Check mock sources
      const mock = MOCK_SOURCES.find((s) => s.id === decodedId);
      if (mock) {
        setSource({
          id: mock.id,
          title: mock.title[lang],
          kind: mock.kind,
          container: mock.container,
          author: mock.author,
          date: mock.date[lang],
          content: piiAllowed ? mock.text[lang] : maskPii(mock.text[lang]),
          piiMasked: !piiAllowed && Boolean(mock.piiText),
        });
        setLoading(false);
        return;
      }

      setNotFound(true);
      setLoading(false);
    }

    if (decodedId) {
      fetchSource();
    }
  }, [decodedId, lang, piiAllowed]);

  return (
    <Shell title={l("Sumber", "Source")}>
      {loading ? (
        <div className="flex items-center gap-3 text-muted py-8">
          <Mascot state="thinking" size={48} />
          <p className="animate-pulse">{l("Memeriksa izin dan memuat sumber…", "Checking permissions and loading source…")}</p>
        </div>
      ) : notFound || !source ? (
        <div className="flex items-center gap-4 py-8">
          <Mascot state="idk" size={64} />
          <div>
            <p className="font-semibold text-lg">{l("Sumber tidak ditemukan.", "Source not found.")}</p>
            <p className="text-sm text-muted">
              {l(
                "Sumber mungkin tidak ada atau dibatasi oleh kebijakan akses peran Anda.",
                "The source may not exist or is restricted by your role's access policy.",
              )}
            </p>
          </div>
        </div>
      ) : (
        <article className="card p-6 max-w-3xl flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <span className="font-mono text-xs px-2 py-1 rounded bg-surface2 border border-line">
              {source.id}
            </span>
            <span className="text-xs text-muted flex items-center gap-1">
              <ShieldCheck size={13} className="text-brand" />
              {l("Akses terverifikasi saat runtime", "Access verified at runtime")}
            </span>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight mb-2">{source.title}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span className="flex items-center gap-1">
                <FileText size={13} /> {source.kind}
              </span>
              <span>•</span>
              <span>{source.container}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <User size={13} /> {source.author}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Calendar size={13} /> {source.date}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-erp bg-surface2/60 border border-line leading-relaxed text-[0.95rem] whitespace-pre-wrap">
            {source.content}
          </div>

          {source.piiMasked && (
            <div className="flex items-center gap-2 text-xs text-warn bg-warn/10 p-2.5 rounded-erp border border-warn/30">
              <Lock size={14} className="shrink-0" />
              <span>
                {l(
                  "Data pribadi (PII) telah disamarkan karena peran Anda tidak memiliki hak akses data sensitif.",
                  "Personally identifiable information (PII) has been masked for your role.",
                )}
              </span>
            </div>
          )}

          <p className="text-xs text-muted">
            {l(
              "Izin akses dicek ulang setiap kali sumber dibuka (System Design §10.5).",
              "Permissions are re-verified every time a source is accessed (System Design §10.5).",
            )}
          </p>
        </article>
      )}
    </Shell>
  );
}
