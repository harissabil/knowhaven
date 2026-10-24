"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { ContainerOut, ManagerOut, MemberOut, TopicOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

type Scope = "department" | "container" | "topic";

export default function Managers() {
  const t = useT();
  const l = useL();
  const [managers, setManagers] = useState<ManagerOut[]>([]);
  const [members, setMembers] = useState<MemberOut[]>([]);
  const [containers, setContainers] = useState<ContainerOut[]>([]);
  const [topics, setTopics] = useState<TopicOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [scope, setScope] = useState<Scope>("container");
  const [scopeId, setScopeId] = useState("");
  const [managerId, setManagerId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [ms, mem, cs, ts] = await Promise.all([
        apiFetch<ManagerOut[]>("/api/admin/managers"),
        apiFetch<MemberOut[]>("/api/admin/members"),
        apiFetch<ContainerOut[]>("/api/admin/containers"),
        apiFetch<TopicOut[]>("/api/admin/topics"),
      ]);
      setManagers(ms);
      setMembers(mem.filter((m) => m.status === "active"));
      setContainers(cs);
      setTopics(ts);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const departments = [...new Set(members.map((m) => m.department).filter(Boolean))] as string[];
  const options: { id: string; name: string }[] =
    scope === "container" ? containers.map((c) => ({ id: c.id, name: c.name }))
    : scope === "topic" ? topics.map((x) => ({ id: x.topic_key, name: x.display_name }))
    : departments.map((d) => ({ id: d, name: d }));

  const targetName = (m: ManagerOut) =>
    m.scope_type === "container" ? containers.find((c) => c.id === m.scope_id)?.name ?? m.scope_id
    : m.scope_type === "topic" ? topics.find((x) => x.topic_key === m.scope_id)?.display_name ?? m.scope_id
    : m.scope_id;
  const memberName = (id: string) => members.find((m) => m.user_id === id)?.name ?? id.slice(0, 8);
  const scopeLabel = (s: string) =>
    s === "container" ? "Container" : s === "topic" ? l("Topik", "Topic") : l("Departemen", "Department");

  async function add() {
    if (!scopeId || !managerId) return;
    try {
      await apiFetch("/api/admin/managers", { method: "POST", body: JSON.stringify({ scope_type: scope, scope_id: scopeId, manager_user_id: managerId }) });
      toast(l("Manager ditambahkan", "Manager added"));
      setScopeId("");
      await load();
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/admin/managers/${id}`, { method: "DELETE" });
      setManagers((prev) => prev.filter((m) => m.id !== id));
      toast(l("Manager dihapus", "Manager removed"));
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  return (
    <Shell title={t("managers")}>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">
          {l("Manager menyetujui permintaan akses dan draf aksi untuk lingkupnya.", "Managers approve access requests and action drafts for their scope.")}
        </span>
        <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={[l("Lingkup", "Scope"), l("Target", "Target"), "Manager", ""]}
        rows={managers.map((m) => [
          scopeLabel(m.scope_type),
          targetName(m),
          memberName(m.manager_user_id),
          <button key="d" className="btn !py-1 !px-2 text-xs" onClick={() => remove(m.id)} aria-label={l("Hapus", "Remove")}><Trash2 size={13} /></button>,
        ])}
      />

      <div className="card p-4 mt-5 flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-sm">{l("Lingkup", "Scope")}
          <select className="input !w-auto" value={scope} onChange={(e) => { setScope(e.target.value as Scope); setScopeId(""); }}>
            <option value="container">Container</option>
            <option value="topic">{l("Topik", "Topic")}</option>
            <option value="department">{l("Departemen", "Department")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{l("Target", "Target")}
          {scope === "department" ? (
            <input className="input" list="depts" value={scopeId} onChange={(e) => setScopeId(e.target.value)} />
          ) : (
            <select className="input !w-auto" value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="">—</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <datalist id="depts">{departments.map((d) => <option key={d} value={d} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm">Manager
          <select className="input !w-auto" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">—</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" onClick={add} disabled={!scopeId || !managerId}><Plus size={14} /> {l("Tambah", "Add")}</button>
      </div>
    </Shell>
  );
}
