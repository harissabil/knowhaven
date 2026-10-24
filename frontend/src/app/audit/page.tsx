"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table } from "@/components/Table";
import { AUDIT } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";

export default function Audit() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [ok, setOk] = useState(false);
  const [n, setN] = useState(0);
  function verify() {
    setOk(false); setN(0);
    AUDIT.forEach((_, i) => setTimeout(() => { setN(i + 1); if (i === AUDIT.length - 1) setOk(true); }, 450 * (i + 1)));
  }
  return (
    <Shell title={t("audit")}>
      <div className="flex gap-3 items-center mb-3">
        <button className="btn btn-primary" onClick={verify}><ShieldCheck size={16} /> {l("Verifikasi hash chain", "Verify hash chain")}</button>
        {n > 0 && !ok && <span className="text-muted">{l(`Memeriksa entri ${n} dari ${AUDIT.length}…`, `Checking entry ${n} of ${AUDIT.length}…`)}</span>}
        {ok && <span className="text-ok">{l(`Rantai utuh: ${AUDIT.length} entri, tidak ada perubahan.`, `Chain intact: ${AUDIT.length} entries, no tampering.`)}</span>}
      </div>
      <Table head={["#", l("Waktu", "Time"), "User", l("Peran", "Roles"), l("Pertanyaan", "Question"), l("Jalur", "Path"), l("Terfilter", "Filtered"), l("Izin v", "Perm v")]}
        rows={AUDIT.map((a) => [a.id, a.ts, a.user, a.roles, a.q[lang], a.path, a.filtered, a.ver])} />
      <p className="text-sm text-muted mt-2">{l("Jumlah terfilter hanya terlihat oleh auditor. Pertanyaan Kenari (9 terfilter) dan Merpati (0) menghasilkan jawaban identik.",
        "The filtered count is only visible to auditors. The Kenari (9 filtered) and Merpati (0) questions produce identical answers.")}</p>
    </Shell>
  );
}
