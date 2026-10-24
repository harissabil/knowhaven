"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, X, RefreshCw } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { Confetti } from "@/components/ui/Confetti";
import { toast } from "@/components/ui/Toast";
import { useSession } from "@/store/session";
import { apiFetch, errorText } from "@/lib/api";
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

  async function decideRequest(id: string, approve: boolean) {
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
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  async function decideDraft(id: string, approve: boolean) {
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
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang === "id" ? "id-ID" : "en-US") : "");

  return (
    <Shell title={t("approvals")}>
      <div className="relative">{celebrate > 0 && <Confetti key={celebrate} />}</div>

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-semibold">{l("Permintaan akses", "Access requests")}</h2>
        <span className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">{l("Durasi akses", "Grant duration")}
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
                <button className="btn btn-primary" onClick={() => decideRequest(r.id, true)}>
                  <Check size={16} /> {t("approve")} {days} {l("hari", "days")}
                </button>
                <button className="btn" onClick={() => decideRequest(r.id, false)}>
                  <X size={16} /> {t("reject")}
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
            {d.exec_result && <p className="text-xs text-muted mt-1 font-sans">{l("Hasil eksekusi", "Execution result")}: {JSON.stringify(d.exec_result)}</p>}
            <div className="flex gap-2 mt-3 font-sans items-center">
              <Badge v={d.status} />
              {d.status === "pending" && (
                <>
                  <button className="btn btn-primary" onClick={() => decideDraft(d.id, true)}>
                    <Check size={16} /> {t("approve")}
                  </button>
                  <button className="btn" onClick={() => decideDraft(d.id, false)}>
                    <X size={16} /> {t("reject")}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
