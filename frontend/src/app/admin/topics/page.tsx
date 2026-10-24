"use client";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { Table, Badge } from "@/components/Table";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import type { ContainerOut, MemberOut, TopicOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

const TIERS = ["open", "gated", "hidden"];
const empty = (): TopicOut & { aliasText: string } => ({
  topic_key: "", display_name: "", aliases: [], owner_user_id: null, fallback_contact: "", tier: "open", container_id: null, aliasText: "",
});

export default function Topics() {
  const t = useT();
  const l = useL();
  const [topics, setTopics] = useState<TopicOut[]>([]);
  const [members, setMembers] = useState<MemberOut[]>([]);
  const [containers, setContainers] = useState<ContainerOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(empty());
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [ts, ms, cs] = await Promise.all([
        apiFetch<TopicOut[]>("/api/admin/topics"),
        apiFetch<MemberOut[]>("/api/admin/members"),
        apiFetch<ContainerOut[]>("/api/admin/containers"),
      ]);
      setTopics(ts);
      setMembers(ms.filter((m) => m.status === "active"));
      setContainers(cs);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const memberName = (id?: string | null) => (id ? members.find((m) => m.user_id === id)?.name ?? id.slice(0, 8) : "—");
  const containerName = (id?: string | null) => (id ? containers.find((c) => c.id === id)?.name ?? id.slice(0, 8) : "—");

  async function save() {
    const key = editingKey ?? form.topic_key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!key || !form.display_name.trim() || !form.fallback_contact.trim()) return;
    try {
      await apiFetch(`/api/admin/topics/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          display_name: form.display_name.trim(),
          aliases: form.aliasText.split(",").map((a) => a.trim()).filter(Boolean),
          owner_user_id: form.owner_user_id || null,
          fallback_contact: form.fallback_contact.trim(),
          tier: form.tier,
          container_id: form.container_id || null,
        }),
      });
      toast(l("Topik disimpan", "Topic saved"));
      setForm(empty());
      setEditingKey(null);
      await load();
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  async function remove(key: string) {
    try {
      await apiFetch(`/api/admin/topics/${encodeURIComponent(key)}`, { method: "DELETE" });
      setTopics((prev) => prev.filter((x) => x.topic_key !== key));
      toast(l("Topik dihapus", "Topic deleted"));
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  }

  return (
    <Shell title={t("topics")}>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted">
          {l(
            "Pemilik topik & kontak cadangan saat informasi tidak ditemukan atau perlu izin. Topik gated memunculkan tombol minta akses.",
            "Topic owners & fallback contacts when information is missing or needs permission. Gated topics offer a request-access button.",
          )}
        </span>
        <button className="btn !py-1 !px-2.5 text-xs text-muted hover:text-fg inline-flex items-center gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          {l("Segarkan", "Refresh")}
        </button>
      </div>

      <Table
        head={[l("Topik", "Topic"), l("Pemilik", "Owner"), l("Kontak cadangan", "Fallback contact"), "Tier", "Container", ""]}
        rows={topics.map((x) => [
          <span key="n">{x.display_name}<span className="block text-xs text-muted font-mono">{x.topic_key}{x.aliases?.length ? ` · ${x.aliases.join(", ")}` : ""}</span></span>,
          memberName(x.owner_user_id),
          x.fallback_contact,
          <Badge key="b" v={x.tier ?? "open"} />,
          containerName(x.container_id),
          <span key="a" className="flex gap-1.5 justify-end">
            <button className="btn !py-1 !px-2 text-xs" onClick={() => { setEditingKey(x.topic_key); setForm({ ...empty(), ...x, aliasText: (x.aliases ?? []).join(", ") }); }}>{l("Ubah", "Edit")}</button>
            <button className="btn !py-1 !px-2 text-xs" onClick={() => remove(x.topic_key)} aria-label={l("Hapus", "Delete")}><Trash2 size={13} /></button>
          </span>,
        ])}
      />

      <div className="card p-6 mt-6 flex flex-col gap-6">
        <div className="grid md:grid-cols-3 gap-5 items-end">
          <label className="field">{l("Kunci topik", "Topic key")}
            <input className="input font-mono" value={editingKey ?? form.topic_key} disabled={!!editingKey} onChange={(e) => setForm({ ...form, topic_key: e.target.value })} placeholder="reimburse_bensin" />
          </label>
          <label className="field">{l("Nama tampilan", "Display name")}
            <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </label>
          <label className="field">{l("Alias (pisahkan koma)", "Aliases (comma-separated)")}
            <input className="input" value={form.aliasText} onChange={(e) => setForm({ ...form, aliasText: e.target.value })} />
          </label>
          <label className="field">{l("Pemilik", "Owner")}
            <select className="input" value={form.owner_user_id ?? ""} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value || null })}>
              <option value="">—</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          </label>
          <label className="field">{l("Kontak cadangan", "Fallback contact")}
            <input className="input" value={form.fallback_contact} onChange={(e) => setForm({ ...form, fallback_contact: e.target.value })} placeholder="HR (hr@company.id)" />
          </label>
          <span className="grid grid-cols-2 gap-3">
            <label className="field">Tier
              <select className="input" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                {TIERS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="field">Container
              <select className="input" value={form.container_id ?? ""} onChange={(e) => setForm({ ...form, container_id: e.target.value || null })}>
                <option value="">—</option>
                {containers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </span>
        </div>
        <div className="flex justify-end gap-2 pt-5 border-t border-line">
          {editingKey && <button className="btn" onClick={() => { setEditingKey(null); setForm(empty()); }}>{l("Batal", "Cancel")}</button>}
          <button className="btn btn-primary" onClick={save} disabled={!(editingKey || form.topic_key.trim()) || !form.display_name.trim() || !form.fallback_contact.trim()}>
            {editingKey ? <Save size={14} /> : <Plus size={14} />} {editingKey ? l("Simpan", "Save") : l("Tambah topik", "Add topic")}
          </button>
        </div>
      </div>    </Shell>
  );
}
