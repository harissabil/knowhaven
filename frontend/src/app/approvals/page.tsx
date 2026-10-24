"use client";
import { useEffect, useState } from "react";
import { Check, X, RefreshCw } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { Mascot } from "@/components/mascot/Mascot";
import { ACCESS_REQUESTS as MOCK_REQUESTS, SOP_DRAFT as MOCK_DRAFT } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { Confetti } from "@/components/ui/Confetti";
import { toast } from "@/components/ui/Toast";
import { useSession } from "@/store/session";
import { apiFetch } from "@/lib/api";

interface AccessReq {
  id: string;
  who: string;
  topic: string;
  reason: string;
  status: string;
}

interface DraftItem {
  id: string;
  target: string;
  diff: { t: string; s: string }[];
  evidence: string;
  status: string;
}

export default function Approvals() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [requests, setRequests] = useState<AccessReq[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [celebrate, setCelebrate] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    let loadedReqs = false;
    let loadedDrafts = false;

    try {
      const data = await apiFetch<
        {
          id: string;
          requester_name?: string;
          requester_email?: string;
          topic_name?: string;
          container_name?: string;
          reason: string;
          status: string;
        }[]
      >("/api/approvals/access-requests");

      if (data && data.length > 0) {
        setRequests(
          data.map((r) => ({
            id: r.id,
            who: r.requester_name || r.requester_email || "User",
            topic: r.topic_name || r.container_name || "General",
            reason: r.reason,
            status: r.status,
          })),
        );
        loadedReqs = true;
      }
    } catch {
      // ignore, fallback below
    }

    try {
      const draftData = await apiFetch<
        {
          id: string;
          target_title?: string;
          action_type: string;
          diff: Record<string, unknown>;
          evidence_query_id: string;
          status: string;
        }[]
      >("/api/approvals/drafts");

      if (draftData && draftData.length > 0) {
        setDrafts(
          draftData.map((d) => {
            const diffList: { t: string; s: string }[] = [];
            if (d.diff && typeof d.diff === "object") {
              const oldVal = (d.diff as { old?: string }).old;
              const newVal = (d.diff as { new?: string }).new;
              if (oldVal) diffList.push({ t: "-", s: `Biaya: ${oldVal}` });
              if (newVal) diffList.push({ t: "+", s: `Biaya: ${newVal}` });
            }
            if (diffList.length === 0) {
              diffList.push({ t: "-", s: "SOP Reimbursement: Rp500.000 / bln" });
              diffList.push({ t: "+", s: "SOP Reimbursement: Rp750.000 / bln" });
            }
            return {
              id: d.id,
              target: d.target_title || d.action_type,
              diff: diffList,
              evidence: `Query ID ${d.evidence_query_id.slice(0, 8)}…`,
              status: d.status,
            };
          }),
        );
        loadedDrafts = true;
      }
    } catch {
      // ignore
    }

    if (!loadedReqs) {
      setRequests(
        MOCK_REQUESTS.map((r, i) => ({
          id: `req-${i + 1}`,
          who: r.who,
          topic: r.topic[lang],
          reason: r.reason[lang],
          status: "pending",
        })),
      );
    }

    if (!loadedDrafts) {
      setDrafts([
        {
          id: "draft-1",
          target: MOCK_DRAFT.target[lang],
          diff: MOCK_DRAFT.diff.map((d) => ({ t: d.t, s: d.s[lang] })),
          evidence: MOCK_DRAFT.evidence[lang],
          status: "pending",
        },
      ]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [lang]);

  async function decideRequest(reqId: string, decision: "approved" | "rejected") {
    try {
      await apiFetch(`/api/approvals/access-requests/${reqId}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, duration_days: 7 }),
      });
    } catch {
      // mock update
    }

    setRequests((prev) =>
      prev.map((r) => (r.id === reqId ? { ...r, status: decision } : r)),
    );

    if (decision === "approved") {
      setCelebrate(true);
      toast(l("Akses disetujui 7 hari", "Access approved for 7 days"));
    } else {
      toast(l("Permintaan ditolak", "Request rejected"));
    }
  }

  async function decideDraft(draftId: string, decision: "approved" | "rejected") {
    try {
      await apiFetch(`/api/approvals/drafts/${draftId}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
    } catch {
      // mock update
    }

    setDrafts((prev) =>
      prev.map((d) => (d.id === draftId ? { ...d, status: decision } : d)),
    );

    if (decision === "approved") {
      setCelebrate(true);
      toast(l("Draf disetujui, target diperbarui", "Draft approved, target updated"));
    } else {
      toast(l("Draf ditolak", "Draft rejected"));
    }
  }

  return (
    <Shell title={t("approvals")}>
      <div className="relative">{celebrate && <Confetti key={Date.now()} />}</div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{l("Permintaan akses", "Access requests")}</h2>
        <button
          className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5"
          onClick={loadData}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={[
          l("Peminta", "Requester"),
          l("Topik", "Topic"),
          l("Alasan", "Reason"),
          "Status",
          l("Aksi", "Action"),
        ]}
        rows={requests.map((r) => [
          r.who,
          r.topic,
          r.reason,
          <Badge key="b" v={r.status} />,
          r.status === "pending" ? (
            <span key="a" className="flex gap-2">
              <button
                className="btn btn-primary"
                onClick={() => decideRequest(r.id, "approved")}
              >
                <Check size={16} /> {t("approve")} {l("7 hari", "7 days")}
              </button>
              <button className="btn" onClick={() => decideRequest(r.id, "rejected")}>
                <X size={16} /> {t("reject")}
              </button>
            </span>
          ) : (
            <Mascot key="m" size={36} state="celebrate" />
          ),
        ])}
      />

      <h2 className="font-semibold mt-8 mb-3">{l("Draf aksi", "Action drafts")}</h2>
      <div className="flex flex-col gap-4">
        {drafts.map((d) => (
          <div key={d.id} className="card p-4 font-mono text-sm">
            <div className="font-sans font-semibold mb-2">{d.target}</div>
            {d.diff.map((item, idx) => (
              <div key={idx} className={item.t === "+" ? "text-ok" : "text-bad"}>
                {item.t} {item.s}
              </div>
            ))}
            <p className="text-muted mt-3 font-sans text-xs">
              {l("Bukti", "Evidence")}: {d.evidence}.{" "}
              {l(
                "Diusulkan oleh agen; eksekusi otomatis oleh layanan HITL setelah disetujui.",
                "Proposed by agent; automatically executed by HITL service upon approval.",
              )}
            </p>
            <div className="flex gap-2 mt-3 font-sans items-center">
              <Badge v={d.status} />
              {d.status === "pending" && (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => decideDraft(d.id, "approved")}
                  >
                    <Check size={16} /> {t("approve")}
                  </button>
                  <button className="btn" onClick={() => decideDraft(d.id, "rejected")}>
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
