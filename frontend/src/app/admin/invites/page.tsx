"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { apiFetch, errorText } from "@/lib/api";
import type { InviteOut, RoleOut } from "@/lib/contracts";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/components/ui/Toast";
import { Copy, RefreshCw, KeyRound, UserPlus } from "lucide-react";

export default function Invites() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [list, setList] = useState<InviteOut[]>([]);
  const [roles, setRoles] = useState<RoleOut[]>([]);
  const [companyCode, setCompanyCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [roleId, setRoleId] = useState("");
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState(1);
  const [newLink, setNewLink] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [code, invites, rs] = await Promise.all([
        apiFetch<{ join_code: string }>("/api/admin/join-code"),
        apiFetch<InviteOut[]>("/api/admin/invites"),
        apiFetch<RoleOut[]>("/api/admin/roles"),
      ]);
      setCompanyCode(code.join_code);
      setList(invites);
      const content = rs.filter((r) => !r.is_system);
      setRoles(content);
      setRoleId((cur) => cur || content.find((r) => r.key === "new_hire")?.id || content[0]?.id || "");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const copy = async (text: string) => {
    toast((await copyText(text)) ? l("Disalin", "Copied") : l("Gagal menyalin. Salin manual ya.", "Could not copy. Please copy it manually."));
  };

  async function rotateCode() {
    try {
      const res = await apiFetch<{ join_code: string }>("/api/admin/join-code/rotate", { method: "POST" });
      setCompanyCode(res.join_code);
      toast(l("Kode perusahaan dirotasi; kode lama tidak berlaku lagi", "Company code rotated; the old code no longer works"));
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  async function addInvite() {
    if (!roleId) return;
    try {
      const res = await apiFetch<InviteOut>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ role_id: roleId, expires_in_days: days, max_uses: maxUses }),
      });
      setNewLink(res.link ? new URL(res.link, window.location.origin).toString() : null);
      toast(l("Undangan baru dibuat", "New invite created"));
      await loadData();
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  async function revokeInvite(inv: InviteOut) {
    try {
      await apiFetch(`/api/admin/invites/${inv.id}`, { method: "DELETE" });
      toast(l("Undangan dicabut", "Invite revoked"));
      setList((prev) => prev.map((x) => (x.id === inv.id ? { ...x, revoked: true } : x)));
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  const expired = (i: InviteOut) => new Date(i.expires_at) < new Date() || i.used_count >= i.max_uses;

  return (
    <Shell title={t("invites")}>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}
      <div className="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {l("Kode perusahaan aktif (pendaftaran mandiri, status Pending sampai disetujui)", "Active company code (self-signup, Pending until approved)")}:{" "}
          <b className="font-mono text-base px-2 py-0.5 rounded bg-surface2 border border-line ml-1.5">{companyCode || "…"}</b>
          {companyCode && <button className="btn !py-0.5 !px-2 ml-2 text-xs" onClick={() => copy(companyCode)}><Copy size={12} /></button>}
        </p>
        <button className="btn" onClick={rotateCode}>
          <KeyRound size={15} /> {l("Rotasi kode", "Rotate code")}
        </button>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">{l("Peran awal", "Starting role")}
          <select className="input !w-auto" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{l("Berlaku (hari)", "Valid (days)")}
          <input className="input !w-24" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">{l("Maks. pemakaian", "Max uses")}
          <input className="input !w-24" type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <button className="btn btn-primary" onClick={addInvite} disabled={!roleId}>
          <UserPlus size={16} /> {l("Buat tautan undangan", "Create invite link")}
        </button>
        <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5 ml-auto" onClick={loadData} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
        {newLink && (
          <div className="w-full text-sm p-3 rounded-erp bg-surface2 border border-line flex items-center gap-2 flex-wrap">
            <span>{l("Tautan hanya ditampilkan sekali:", "The link is shown only once:")}</span>
            <code className="break-all">{newLink}</code>
            <button className="btn !py-0.5 !px-2 text-xs" onClick={() => copy(newLink)}><Copy size={12} /> {l("Salin", "Copy")}</button>
          </div>
        )}
      </div>

      <Table
        head={[l("Peran awal", "Starting role"), l("Berlaku sampai", "Valid until"), l("Pemakaian", "Uses"), "Status", l("Aksi", "Action")]}
        rows={list.map((i) => [
          i.role_key,
          new Date(i.expires_at).toLocaleString(lang === "id" ? "id-ID" : "en-US"),
          `${i.used_count}/${i.max_uses}`,
          <Badge key="b" v={i.revoked ? "revoked" : expired(i) ? "expired" : "active"} />,
          !i.revoked && !expired(i) ? (
            <button key="r" className="btn" onClick={() => revokeInvite(i)}>{l("Cabut", "Revoke")}</button>
          ) : (
            "-"
          ),
        ])}
      />
    </Shell>
  );
}
