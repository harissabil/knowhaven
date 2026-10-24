"use client";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { CONTAINERS, UNMAPPED } from "@/mock/ops";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";

export default function Containers() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  return (
    <Shell title={t("containers")}>
      <div className="card p-3 mb-4">
        <b>{l("Belum dipetakan (default-deny, tidak terlihat siapa pun):", "Not yet mapped (default-deny, invisible to everyone):")}</b>
        <ul className="list-disc ml-5">{UNMAPPED.map((u) => <li key={u}>{u} <button className="btn ml-2">{l("Petakan", "Map")}</button></li>)}</ul>
      </div>
      <Table head={["Container", l("Sumber", "Source"), "Tier", l("Peran yang boleh", "Allowed roles")]} rows={CONTAINERS.map((c) => [c.name, c.source, <Badge key="b" v={c.tier} />, c.roles[lang]])} />
    </Shell>
  );
}
