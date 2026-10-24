"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { Mascot } from "@/components/mascot/Mascot";
import { ACCESS_REQUESTS, SOP_DRAFT } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { Confetti } from "@/components/ui/Confetti";
import { toast } from "@/components/ui/Toast";
import { useSession } from "@/store/session";

export default function Approvals() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [req, setReq] = useState("pending");
  const [draft, setDraft] = useState("pending");
  return (
    <Shell title={t("approvals")}>
      <div className="relative">{(req === "approved" || draft === "approved") && <Confetti key={req + draft} />}</div>
      <h2 className="font-semibold mb-2">{l("Permintaan akses", "Access requests")}</h2>
      <Table head={[l("Peminta", "Requester"), l("Topik", "Topic"), l("Alasan", "Reason"), "Status", l("Aksi", "Action")]} rows={ACCESS_REQUESTS.map((r) => [
        r.who, r.topic[lang], r.reason[lang], <Badge key="b" v={req} />,
        req === "pending" ? <span key="a" className="flex gap-2">
          <button className="btn btn-primary" onClick={() => { setReq("approved"); toast(l("Akses disetujui 7 hari", "Access approved for 7 days")); }}><Check size={16} /> {t("approve")} {l("7 hari", "7 days")}</button>
          <button className="btn" onClick={() => setReq("rejected")}><X size={16} /> {t("reject")}</button></span> : <Mascot key="m" size={36} state="celebrate" />,
      ])} />
      <h2 className="font-semibold mt-6 mb-2">{l("Draf aksi", "Action draft")}: {SOP_DRAFT.target[lang]}</h2>
      <div className="card p-3 font-mono text-sm">
        {SOP_DRAFT.diff.map((d, i) => <div key={i} className={d.t === "+" ? "text-ok" : "text-bad"}>{d.t} {d.s[lang]}</div>)}
        <p className="text-muted mt-2 font-sans">
          {l("Bukti", "Evidence")}: {SOP_DRAFT.evidence[lang]}. {l("Diusulkan oleh agen; eksekusi oleh layanan HITL setelah disetujui.", "Proposed by the agent; executed by the HITL service after approval.")}
        </p>
        <div className="flex gap-2 mt-2 font-sans items-center">
          <Badge v={draft} />
          {draft === "pending" && <>
            <button className="btn btn-primary" onClick={() => { setDraft("approved"); toast(l("Draf disetujui, halaman Confluence diperbarui", "Draft approved, Confluence page updated")); }}><Check size={16} /> {t("approve")}</button>
            <button className="btn" onClick={() => setDraft("rejected")}><X size={16} /> {t("reject")}</button></>}
        </div>
      </div>
    </Shell>
  );
}
