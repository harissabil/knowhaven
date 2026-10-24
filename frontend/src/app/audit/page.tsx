"use client";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, AlertTriangle, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiFetch, errorText } from "@/lib/api";
import type { AuditRowOut, QueryDetailOut, SummaryOut, VerifyOut } from "@/lib/contracts";

const PATHS = ["", "answer", "conflict", "idk", "policy_refusal", "error"];
const PAGE = 50;

export default function Audit() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [rows, setRows] = useState<AuditRowOut[]>([]);
  const [summary, setSummary] = useState<SummaryOut | null>(null);
  const [path, setPath] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyOut | null>(null);
  const [detail, setDetail] = useState<QueryDetailOut | null>(null);

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-US");

  const load = useCallback(async (beforeSeq?: number) => {
    setLoading(true);
    setErr("");
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (path) params.set("decision_path", path);
    if (q.trim()) params.set("q", q.trim());
    if (beforeSeq) params.set("before_seq", String(beforeSeq));
    try {
      const [data, sum] = await Promise.all([
        apiFetch<AuditRowOut[]>(`/api/audit/log?${params}`),
        beforeSeq ? Promise.resolve(null) : apiFetch<SummaryOut>("/api/audit/summary?days=7"),
      ]);
      setRows((prev) => (beforeSeq ? [...prev, ...data] : data));
      if (sum) setSummary(sum);
      setMore(data.length === PAGE);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [path, q]);

  useEffect(() => { load(); }, [load]);

  async function verify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      setVerifyResult(await apiFetch<VerifyOut>("/api/audit/verify", { method: "POST" }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setVerifying(false);
    }
  }

  async function open(row: AuditRowOut) {
    if (!row.query_id) return;
    try {
      setDetail(await apiFetch<QueryDetailOut>(`/api/audit/queries/${row.query_id}`));
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <Shell title={t("audit")}>
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="card p-3"><p className="eyebrow">{l("Pertanyaan (7 hari)", "Queries (7 days)")}</p><p className="text-2xl font-semibold">{summary.queries}</p></div>
          <div className="card p-3"><p className="eyebrow">{l("Latensi p50 / p95", "Latency p50 / p95")}</p><p className="text-2xl font-semibold">{summary.p50_latency_ms ?? "–"} / {summary.p95_latency_ms ?? "–"} ms</p></div>
          <div className="card p-3"><p className="eyebrow">{l("Jalur keputusan", "Decision paths")}</p><p className="text-sm">{Object.entries(summary.by_decision).map(([k, v]) => `${k}: ${v}`).join(" · ") || "–"}</p></div>
          <div className="card p-3"><p className="eyebrow">{l("Item terfilter / event admin", "Filtered items / admin events")}</p><p className="text-2xl font-semibold">{summary.total_filtered} / {summary.admin_events}</p></div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <button className="btn btn-primary" onClick={verify} disabled={verifying}>
          <ShieldCheck size={16} />
          {verifying ? l("Memverifikasi rantai hash…", "Verifying hash chain…") : l("Verifikasi hash chain", "Verify hash chain")}
        </button>
        <select className="input !w-auto" value={path} onChange={(e) => setPath(e.target.value)} aria-label={l("Jalur", "Path")}>
          {PATHS.map((p) => <option key={p} value={p}>{p || l("Semua jalur", "All paths")}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); load(); }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={l("Cari pertanyaan…", "Search questions…")} />
        </form>
        <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5" onClick={() => load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>

        {verifyResult?.ok && (
          <span className="text-ok text-sm font-medium flex items-center gap-1.5">
            <ShieldCheck size={16} />
            {l(`Rantai utuh: ${verifyResult.rows} entri terverifikasi.`, `Chain intact: ${verifyResult.rows} entries verified.`)}
          </span>
        )}
        {verifyResult && !verifyResult.ok && (
          <span className="text-bad text-sm font-medium flex items-center gap-1.5">
            <AlertTriangle size={16} />
            {l(`Rantai rusak mulai seq #${verifyResult.first_bad_seq}`, `Chain broken from seq #${verifyResult.first_bad_seq}`)}
          </span>
        )}
      </div>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}

      <Table
        head={["#", l("Waktu", "Time"), l("Event", "Event"), "User", l("Peran", "Roles"), l("Pertanyaan", "Question"), l("Jalur", "Path"), l("Terfilter", "Filtered"), l("Izin v", "Perm v"), "ms"]}
        rows={rows.map((a) => [
          a.seq,
          fmt(a.ts),
          <span key="e" className="font-mono text-xs">{a.event_type}{a.channel ? ` · ${a.channel}` : ""}</span>,
          a.actor_name ?? (a.actor_user_id ? a.actor_user_id.slice(0, 8) : "system"),
          a.roles_snapshot.join(", "),
          a.query_id ? <button key="q" className="underline text-left" onClick={() => open(a)}>{a.query_text}</button> : (a.query_text ?? (a.details ? JSON.stringify(a.details).slice(0, 80) : "")),
          a.decision_path ?? "",
          a.filtered_count ?? "",
          a.permission_version ?? "",
          a.latency_ms ?? "",
        ])}
      />
      {more && (
        <button className="btn mt-3" disabled={loading} onClick={() => load(rows[rows.length - 1]?.seq)}>{l("Muat lebih banyak", "Load more")}</button>
      )}

      <p className="text-sm text-muted mt-3">
        {l(
          "Jumlah item terfilter hanya terlihat oleh auditor. Setiap baris menyimpan hash SHA-256 dari baris sebelumnya, jadi perubahan apa pun memutus rantai.",
          "Filtered item counts are visible to auditors only. Each row stores a SHA-256 hash over the previous row, so any edit breaks the chain.",
        )}
      </p>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setDetail(null)}>
          <div className="card p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-1">
                <p className="eyebrow">#{detail.audit.seq} · {fmt(detail.audit.ts)} · {detail.audit.decision_path}</p>
                <h2 className="font-semibold">{detail.audit.query_text}</h2>
              </div>
              <button className="btn !p-1.5" onClick={() => setDetail(null)} aria-label="close"><X size={16} /></button>
            </div>
            <p className="text-sm whitespace-pre-wrap mb-3">{detail.audit.response_text}</p>
            <p className="text-xs text-muted mb-3">
              {l("Item diambil", "Retrieved items")}: {detail.audit.retrieved_item_ids.length} · {l("terfilter", "filtered")}: {detail.audit.filtered_count ?? 0} ·
              {" "}{l("sitasi", "citations")}: {detail.audit.citations.join(", ") || "–"} · {l("model", "models")}: {detail.audit.model_ids ? Object.values(detail.audit.model_ids).join(", ") : "–"}
            </p>
            <div className="flex flex-col gap-1 bg-surface2/60 p-2.5 rounded-erp font-mono text-[0.75rem]">
              {detail.trace.map((s) => (
                <div key={s.step} className="flex gap-2">
                  <span className="w-4 text-center">{s.step}</span>
                  <span className="px-1.5 rounded bg-surface border border-line text-[0.65rem] font-semibold">{s.label}</span>
                  <span className="flex-1">{s.name}{s.summary ? ` · ${s.summary}` : ""}</span>
                  <span>{s.ms ?? ""}ms</span>
                </div>
              ))}
            </div>
            <p className="text-[0.7rem] text-muted font-mono mt-3 break-all">row_hash {detail.audit.row_hash}</p>
          </div>
        </div>
      )}
    </Shell>
  );
}
