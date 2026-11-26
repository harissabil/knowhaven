"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, X, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { Confetti } from "@/components/ui/Confetti";
import { toast } from "@/components/ui/Toast";
import { useSession } from "@/store/session";
import { ApiError, apiFetch, errorText } from "@/lib/api";
import type { AccessRequestOut, ActionDraftOut } from "@/lib/contracts";

export default function Approvals() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [requests, setRequests] = useState<AccessRequestOut[]>([]);
  const [drafts, setDrafts] = useState<ActionDraftOut[]>([]);
  const [days, setDays] = useState(7);
  const [celebrate, setCelebrate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // The decision in flight, per row: its buttons stay disabled (and the clicked one spins) until the
  // server answers. Approving a draft writes to Confluence and re-reads the page, which takes seconds.
  const [busy, setBusy] = useState<Record<string, "approve" | "reject">>({});
  const start = (id: string, approve: boolean) => setBusy((b) => ({ ...b, [id]: approve ? "approve" : "reject" }));
  const done = (id: string) => setBusy((b) => {
    const rest = { ...b };
    delete rest[id];
    return rest;
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [reqs, ds] = await Promise.all([
        apiFetch<AccessRequestOut[]>("/api/approvals/access-requests"),
        apiFetch<ActionDraftOut[]>("/api/approvals/drafts"),
      ]);
      setRequests(reqs);
      setDrafts(ds);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /** A decision someone (or an earlier click) already made is not an error: show the current state. */
  function failed(e: unknown) {
    if (e instanceof ApiError && e.status === 409 && e.message === "already_decided") {
      toast(l("Sudah diputuskan sebelumnya", "Already decided"));
      loadData();
      return;
    }
    const code = e instanceof ApiError ? e.message : "";
    const known: Record<string, string> = {
      target_changed_since_draft: l("Dokumen sudah berubah sejak draf dibuat; minta Havi membuat draf baru", "The document changed since this draft; ask Havi for a new draft"),
      text_not_found_in_page: l("Bagian yang diubah tidak ditemukan lagi di halaman Confluence", "The changed part is no longer on the Confluence page"),
    };
    toast(l(`Gagal: ${known[code] ?? errorText(e)}`, `Failed: ${known[code] ?? errorText(e)}`));
  }

  async function decideRequest(id: string, approve: boolean) {
    if (busy[id]) return;
    start(id, approve);
    try {
      const updated = await apiFetch<AccessRequestOut>(`/api/approvals/access-requests/${id}/${approve ? "approve" : "reject"}`, {
        method: "POST",
        body: JSON.stringify(approve ? { days } : { note: null }),
      });
      setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (approve) {
        setCelebrate((n) => n + 1);
        toast(l(`Akses disetujui ${days} hari`, `Access approved for ${days} days`));
      } else {
        toast(l("Permintaan ditolak", "Request rejected"));
      }
    } catch (e) {
      failed(e);
    } finally {
      done(id);
    }
  }

  async function decideDraft(id: string, approve: boolean) {
    if (busy[id]) return;
    start(id, approve);
    try {
      const updated = await apiFetch<ActionDraftOut>(`/api/approvals/drafts/${id}/${approve ? "approve" : "reject"}`, {
        method: "POST",
        ...(approve ? {} : { body: JSON.stringify({ note: null }) }),
      });
      setDrafts((prev) => prev.map((d) => (d.id === id ? updated : d)));
      if (approve) {
        setCelebrate((n) => n + 1);
        toast(updated.status === "executed"
          ? l("Draf disetujui dan dijalankan", "Draft approved and executed")
          : l(`Draf disetujui (status: ${updated.status})`, `Draft approved (status: ${updated.status})`));
      } else {
        toast(l("Draf ditolak", "Draft rejected"));
      }
    } catch (e) {
      failed(e);
    } finally {
      done(id);
    }
  }

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-US") : "");

  return (
    <Shell title={t("approvals")}>
      <div className="relative">{celebrate > 0 && <Confetti key={celebrate} />}</div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-semibold">{l("Permintaan akses", "Access requests")}</h2>
        <span className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-3 font-medium">{l("Durasi akses", "Grant duration")}
            <select className="input !w-auto !py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} {l("hari", "days")}</option>)}
            </select>
          </label>
          <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5" onClick={loadData} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {l("Segarkan", "Refresh")}
          </button>
        </span>
      </div>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}

      {requests.length === 0 && !loading ? (
        <p className="text-muted text-sm">{l("Tidak ada permintaan akses.", "No access requests.")}</p>
      ) : (
        <Table
          head={[l("Peminta", "Requester"), l("Topik", "Topic"), l("Alasan", "Reason"), "Status", l("Aksi", "Action")]}
          rows={requests.map((r) => [
            <span key="w">{r.requester_name || r.requester_email || r.requester_id}<span className="block text-xs text-muted">{fmt(r.created_at)}</span></span>,
            <span key="t">{r.topic_name || r.topic_key}{r.container_name && <span className="block text-xs text-muted">{r.container_name}</span>}</span>,
            r.reason,
            <span key="s"><Badge v={r.status} />{r.expires_at && <span className="block text-xs text-muted">{l("s.d.", "until")} {fmt(r.expires_at)}</span>}</span>,
            r.status === "pending" ? (
              <span key="a" className="flex gap-2">
                <button className="btn btn-primary" onClick={() => decideRequest(r.id, true)} disabled={!!busy[r.id]} aria-busy={busy[r.id] === "approve"}>
                  {busy[r.id] === "approve" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t("approve")} {days} {l("hari", "days")}
                </button>
                <button className="btn" onClick={() => decideRequest(r.id, false)} disabled={!!busy[r.id]} aria-busy={busy[r.id] === "reject"}>
                  {busy[r.id] === "reject" ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} {t("reject")}
                </button>
              </span>
            ) : (
              <span key="a" className="text-xs text-muted">{r.approver_name ? `${r.approver_name} · ${fmt(r.decided_at)}` : ""}</span>
            ),
          ])}
        />
      )}

      <h2 className="font-semibold mt-8 mb-3">{l("Draf aksi", "Action drafts")}</h2>
      {drafts.length === 0 && !loading && <p className="text-muted text-sm">{l("Tidak ada draf aksi.", "No action drafts.")}</p>}
      <div className="flex flex-col gap-4">
        {drafts.map((d) => (
          <div key={d.id} className="card p-4 font-mono text-sm">
            <div className="font-sans font-semibold mb-1">{d.target_title || d.target_ref}</div>
            <div className="font-sans text-xs text-muted mb-2">{d.kind} · {d.target_system} · {d.target_ref} · {fmt(d.created_at)}</div>
            <pre className="whitespace-pre-wrap">
              {d.diff.split("\n").map((line, idx) => (
                <div key={idx} className={line.startsWith("+") ? "text-ok" : line.startsWith("-") ? "text-bad" : "text-muted"}>{line}</div>
              ))}
            </pre>
            <p className="text-muted mt-3 font-sans text-xs">
              {l("Bukti", "Evidence")}:{" "}
              {d.evidence_ids.map((id, i) => (
                <span key={id}>{i > 0 && ", "}<Link className="underline" href={`/sources/${encodeURIComponent(id)}`}>{id}</Link></span>
              ))}
              {". "}
              {l("Diusulkan oleh agen; dijalankan oleh layanan HITL hanya setelah disetujui.", "Proposed by the agent; the HITL service executes it only after approval.")}
            </p>
            {d.exec_result && <ExecResult r={d.exec_result} />}
            <div className="flex gap-2 mt-3 font-sans items-center">
              <Badge v={d.status} />
              {d.status === "pending" && (
                <>
                  <button className="btn btn-primary" onClick={() => decideDraft(d.id, true)} disabled={!!busy[d.id]} aria-busy={busy[d.id] === "approve"}>
                    {busy[d.id] === "approve" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {t("approve")}
                  </button>
                  <button className="btn" onClick={() => decideDraft(d.id, false)} disabled={!!busy[d.id]} aria-busy={busy[d.id] === "reject"}>
                    {busy[d.id] === "reject" ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} {t("reject")}
                  </button>
                  {busy[d.id] === "approve" && (
                    <span role="status" className="text-xs text-muted">
                      {d.target_system === "confluence"
                        ? l("Memperbarui halaman Confluence…", "Updating the Confluence page…")
                        : l("Memperbarui dokumen…", "Updating the document…")}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** What the HITL service did: where the change went, or why it failed. */
function ExecResult({ r }: { r: Record<string, unknown> }) {
  const l = useL();
  const url = typeof r.url === "string" ? r.url : null;
  if (typeof r.error === "string") {
    return <p className="text-xs text-bad mt-1 font-sans">{l("Gagal dijalankan", "Execution failed")}: {r.error}</p>;
  }
  return (
    <p className="text-xs text-muted mt-1 font-sans flex items-center gap-2 flex-wrap">
      {r.mode === "confluence"
        ? l(`Halaman Confluence diperbarui ke versi ${r.new_version}`, `Confluence page updated to version ${r.new_version}`)
        : l(`Dokumen diperbarui ke versi ${r.new_version}`, `Document updated to version ${r.new_version}`)}
      {url && (
        <a className="underline inline-flex items-center gap-1" href={url} target="_blank" rel="noreferrer">
          {l("Buka di Confluence", "Open in Confluence")} <ExternalLink size={12} />
        </a>
      )}
    </p>
  );
}
