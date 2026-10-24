"use client";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { INVITES } from "@/mock/admin";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";

export default function Invites() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [list, setList] = useState(INVITES);
  const add = () => setList((x) => [{ code: "INV-" + Math.random().toString(36).slice(2, 6).toUpperCase(), role: "new_hire", expires: { id: "7 hari lagi", en: "in 7 days" }, uses: "0/10", active: true }, ...x]);
  return (
    <Shell title={t("invites")}>
      <p className="mb-2">{l("Kode perusahaan", "Company code")}: <b className="font-mono">SRN-4821</b> <button className="btn ml-2">{l("Rotasi kode", "Rotate code")}</button></p>
      <button className="btn btn-primary mb-3" onClick={add}>{l("Buat undangan", "Create invite")}</button>
      <Table head={[l("Kode", "Code"), l("Peran awal", "Starting role"), l("Berlaku sampai", "Valid until"), l("Dipakai", "Used"), "Status", l("Aksi", "Action")]} rows={list.map((i, n) => [
        <a key="c" className="underline font-mono" href={`/join/${i.code}`}>{i.code}</a>, i.role, i.expires[lang], i.uses,
        <Badge key="b" v={i.active ? "open" : "hidden"} />,
        i.active ? <button key="r" className="btn" onClick={() => setList((x) => x.map((y, j) => j === n ? { ...y, active: false } : y))}>{l("Cabut", "Revoke")}</button> : "-",
      ])} />
    </Shell>
  );
}
