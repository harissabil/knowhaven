"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, RefreshCw, Save } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { RoleChip } from "@/components/Chip";
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
  const panelRef = useRef<HTMLDivElement>(null);

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
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
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
          {l("Atur siapa yang boleh melihat data di tiap container.", "Choose who can see the data in each container.")}
        </span>
        <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      {editing && draft && (() => {
        const c = containers.find((x) => x.id === editing);
        if (!c) return null;
        const field = "field";
        return (
          <div ref={panelRef} className="card p-5 mb-5 flex flex-col gap-5 border-brand/40">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold leading-tight">{c.name}</h2>
                <p className="text-xs text-muted mt-0.5">{c.source} · {c.item_count} item</p>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" className="accent-[var(--brand)] w-4 h-4" checked={draft.mapped} onChange={(e) => setDraft({ ...draft, mapped: e.target.checked })} />
                {l("dipetakan", "mapped")}
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className={field}>Tier
                <select className="input" value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                  {TIERS.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
              <label className={field}>{l("Otoritas", "Authority")}
                <select className="input" value={draft.authority_default ?? ""} onChange={(e) => setDraft({ ...draft, authority_default: e.target.value || null })}>
                  <option value="">{l("otoritas: default", "authority: default")}</option>
                  {AUTHORITIES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium mb-2">{l("Peran yang boleh", "Allowed roles")}</legend>
              <div className="flex flex-wrap gap-2">
                {contentRoles.map((r) => {
                  const on = draft.role_ids.includes(r.id);
                  return (
                    <label key={r.id} className={`inline-flex items-center gap-2 h-8 px-3 rounded-md text-sm cursor-pointer select-none ring-1 ring-inset transition-colors ${on ? "bg-tint text-brand ring-brand/40 font-medium" : "bg-surface2 text-muted ring-line hover:text-fg"}`}>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={(e) => setDraft({ ...draft, role_ids: e.target.checked ? [...draft.role_ids, r.id] : draft.role_ids.filter((x) => x !== r.id) })}
                      />
                      {on && <Check size={13} aria-hidden />}
                      {r.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <button className="btn" onClick={() => setEditing(null)}>{l("Batal", "Cancel")}</button>
              <button className="btn btn-primary" onClick={() => save(c.id)}><Save size={14} /> {l("Simpan", "Save")}</button>
            </div>
          </div>
        );
      })()}
      <Table
        head={["Container", l("Sumber", "Source"), "Tier", l("Peran yang boleh", "Allowed roles"), l("Item", "Items"), ""]}
        rows={containers.map((c) =>
          [
                c.name,
                c.source,
                <span key="b" className="flex items-center gap-1"><Badge v={c.tier} />{!c.mapped && <Badge v="unmapped" />}</span>,
                // Access comes only from the role list; the tier just shapes "I don't know" answers.
                c.mapped && c.role_ids.length ? <span key="rl" className="flex flex-wrap gap-1.5">{c.role_ids.map((id) => <RoleChip key={id} role={roleName(id)} />)}</span> : <span key="n" className="text-bad">{l("Tidak ada (tak terlihat siapa pun)", "None (visible to nobody)")}</span>,
                c.item_count,
                <button key="e" className="btn !py-1 !px-2 text-xs ml-auto flex" onClick={() => edit(c)} disabled={editing === c.id}>{l("Ubah", "Edit")}</button>,
              ],
        )}
      />

      <div className="card p-6 mt-6 flex flex-col gap-5">
        <div className="grid sm:grid-cols-2 gap-5 items-end">
          <label className="field">{l("Container baru", "New container")}
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={l("mis. SOP Gudang", "e.g. Warehouse SOPs")} />
          </label>
          <label className="field">{l("Sumber", "Source")}
            <select className="input" value={newSource} onChange={(e) => setNewSource(e.target.value)}>
              <option value="upload_folder">{l("Folder unggahan", "Upload folder")}</option>
              <option value="whatsapp_group">{l("Grup WhatsApp", "WhatsApp group")}</option>
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap pt-4 border-t border-line">
          <p className="text-xs text-muted">{l("Container Slack/Confluence/Jira dibuat otomatis oleh integrasi.", "Slack/Confluence/Jira containers are created by the integrations.")}</p>
          <button className="btn btn-primary ml-auto" onClick={create} disabled={!newName.trim()}><Plus size={14} /> {l("Buat", "Create")}</button>
        </div>
      </div>    </Shell>
  );
}
