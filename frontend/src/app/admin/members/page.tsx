"use client";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { MEMBERS } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";

export default function Members() {
  const t = useT();
  const l = useL();
  return (
    <Shell title={t("members")}>
      <Table head={[l("Nama", "Name"), l("Peran", "Roles"), "Status", l("Aksi", "Action")]} rows={MEMBERS.map((m) => [
        m.name, m.roles, <Badge key="b" v={m.status} />,
        m.status === "pending" ? <button key="a" className="btn btn-primary">{t("approve")}</button> : <button key="a" className="btn">{l("Ubah peran", "Change role")}</button>,
      ])} />
    </Shell>
  );
}
