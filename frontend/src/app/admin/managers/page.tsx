"use client";
import { Shell } from "@/components/Shell";
import { Table } from "@/components/Table";
import { MANAGERS } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";

export default function Managers() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  return (
    <Shell title={t("managers")}>
      <Table head={[l("Lingkup", "Scope"), l("Target", "Target"), "Approver"]} rows={MANAGERS.map((m) => [m.scope, m.target[lang], m.manager])} />
      <button className="btn btn-primary mt-3">{l("Tambah penugasan", "Add assignment")}</button>
    </Shell>
  );
}
