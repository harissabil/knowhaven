"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Save } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { ContainerOut, RoleOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

const TIERS = ["hidden", "gated", "open"];
const AUTHORITIES = ["official_doc", "official_announcement", "team_discussion", "personal"];

interface Draft { tier: string; mapped: boolean; role_ids: string[]; authority_default: string | null }

export default function Containers() {
  const t = useT();
  const l = useL();
  const [containers, setContainers] = useState<ContainerOut[]>([]);
  const [roles, setRoles] = useState<RoleOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState("upload_folder");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [cs, rs] = await Promise.all([
        apiFetch<ContainerOut[]>("/api/admin/containers"),
        apiFetch<RoleOut[]>("/api/admin/roles"),
      ]);
      setContainers(cs);
      setRoles(rs);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id.slice(0, 8);
  // System roles (owner/admin/auditor) grant no content (doc §8); only content roles are offered.
  const contentRoles = roles.filter((r) => !r.is_system);

  function edit(c: ContainerOut) {
    setEditing(c.id);
    // Editing is how an admin maps a container, so the form starts as mapped.
    setDraft({ tier: c.tier, mapped: true, role_ids: c.role_ids, authority_default: c.authority_default });
  }

  async function save(id: string) {
    if (!draft) return;
    try {
      await apiFetch(`/api/admin/containers/${id}`, { method: "PATCH", body: JSON.stringify(draft) });
      toast(l("Container disimpan; izin berlaku seketika", "Container saved; permissions apply immediately"));
      setEditing(null);
      await load();
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  async function create() {
    if (!newName.trim()) return;
    try {
      await apiFetch("/api/admin/containers", { method: "POST", body: JSON.stringify({ source: newSource, name: newName.trim() }) });
      setNewName("");
      toast(l("Container dibuat (belum dipetakan: tidak terlihat siapa pun)", "Container created (unmapped: visible to nobody)"));
      await load();
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  const unmapped = containers.filter((c) => !c.mapped);

  return (
    <Shell title={t("containers")}>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}
      {unmapped.length > 0 && (
        <div className="card p-4 mb-5">
          <b className="text-sm">
            {l(
              "Belum dipetakan (default-deny, tidak terlihat siapa pun sampai diberi izin):",
              "Not yet mapped (default-deny, invisible to everyone until permissions are assigned):",
            )}
          </b>
          <ul className="list-disc ml-5 mt-2 text-sm flex flex-col gap-1.5">
            {unmapped.map((u) => (
              <li key={u.id}>
                <span className="font-mono">{u.name}</span> <span className="text-muted">({u.source}, {u.item_count} item)</span>
                <button className="btn !py-0.5 !px-2 text-xs ml-2" onClick={() => edit(u)}>{l("Petakan", "Map")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <span className="text-sm text-muted">
          {l("Container data & tingkat visibilitas (System Design §8 RBAC).", "Data containers & visibility tiers (System Design §8 RBAC).")}
        </span>
        <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={["Container", l("Sumber", "Source"), "Tier", l("Peran yang boleh", "Allowed roles"), l("Item", "Items"), ""]}
        rows={containers.map((c) =>
          editing === c.id && draft
            ? [
                <b key="n">{c.name}</b>,
                c.source,
                <span key="t" className="flex flex-col gap-1">
                  <select className="input !py-1" value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                    {TIERS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={draft.mapped} onChange={(e) => setDraft({ ...draft, mapped: e.target.checked })} /> {l("dipetakan", "mapped")}
                  </label>
                  <select className="input !py-1 text-xs" value={draft.authority_default ?? ""} onChange={(e) => setDraft({ ...draft, authority_default: e.target.value || null })}>
                    <option value="">{l("otoritas: default", "authority: default")}</option>
                    {AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </span>,
                <span key="r" className="flex flex-wrap gap-x-3 gap-y-1">
                  {contentRoles.map((r) => (
                    <label key={r.id} className="text-xs flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={draft.role_ids.includes(r.id)}
                        onChange={(e) => setDraft({ ...draft, role_ids: e.target.checked ? [...draft.role_ids, r.id] : draft.role_ids.filter((x) => x !== r.id) })}
                      />
                      {r.name}
                    </label>
                  ))}
                </span>,
                c.item_count,
                <span key="a" className="flex gap-1">
                  <button className="btn btn-primary !py-1" onClick={() => save(c.id)}><Save size={14} /> {l("Simpan", "Save")}</button>
                  <button className="btn !py-1" onClick={() => setEditing(null)}>{l("Batal", "Cancel")}</button>
                </span>,
              ]
            : [
                c.name,
                c.source,
                <span key="b" className="flex items-center gap-1"><Badge v={c.tier} />{!c.mapped && <Badge v="unmapped" />}</span>,
                // Access comes only from the role list; the tier just shapes "I don't know" answers.
                c.mapped && c.role_ids.length ? c.role_ids.map(roleName).join(", ") : <span key="n" className="text-bad">{l("Tidak ada (tak terlihat siapa pun)", "None (visible to nobody)")}</span>,
                c.item_count,
                <button key="e" className="btn !py-1 !px-2 text-xs" onClick={() => edit(c)}>{l("Ubah", "Edit")}</button>,
              ],
        )}
      />

      <div className="card p-4 mt-5 flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-sm">{l("Container baru", "New container")}
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={l("mis. SOP Gudang", "e.g. Warehouse SOPs")} />
        </label>
        <select className="input !w-auto" value={newSource} onChange={(e) => setNewSource(e.target.value)}>
          <option value="upload_folder">{l("Folder unggahan", "Upload folder")}</option>
          <option value="whatsapp_group">{l("Grup WhatsApp", "WhatsApp group")}</option>
        </select>
        <button className="btn" onClick={create} disabled={!newName.trim()}><Plus size={14} /> {l("Buat", "Create")}</button>
        <p className="text-xs text-muted w-full">{l("Container Slack/Confluence/Jira dibuat otomatis oleh integrasi.", "Slack/Confluence/Jira containers are created by the integrations.")}</p>
      </div>
    </Shell>
  );
}
