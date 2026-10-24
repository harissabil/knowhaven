"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, Edit2, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { Shell } from "@/components/Shell";
import { useL, useT } from "@/lib/i18n";
import { apiFetch, errorText } from "@/lib/api";
import { PII_TYPES, type PiiMatrix, type RoleOut } from "@/lib/contracts";
import { toast } from "@/components/ui/Toast";

const LABEL: Record<string, string> = {
  nik: "NIK",
  phone: "Phone",
  email: "Email",
  npwp: "NPWP",
  bank_account: "Bank",
};

const DETECTOR_META: Record<
  string,
  { mask: string; id: string; en: string }
> = {
  nik: {
    mask: "3201********0001",
    id: "16 digit + validasi kode provinsi (11–94) & tanggal lahir",
    en: "16 digits + province code (11–94) & birth date check",
  },
  phone: {
    mask: "0812****7890",
    id: "Nomor seluler Indonesia (+62 / 62 / 08xx)",
    en: "Indonesian mobile numbers (+62 / 62 / 08xx)",
  },
  email: {
    mask: "r***@gmail.com",
    id: "Email pribadi (domain perusahaan dikecualikan sebagai kontak kerja)",
    en: "Personal email (company domains excluded as work contacts)",
  },
  npwp: {
    mask: "12.***.***.*-***.345",
    id: "Format wajib pajak 15 digit standar Indonesia",
    en: "Standard 15-digit Indonesian tax ID format",
  },
  bank_account: {
    mask: "******1234",
    id: "10–16 digit dengan konteks kata kunci rekening/nama bank",
    en: "10–16 digits with account/bank keyword context",
  },
};

const toRoleKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 31);

const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,30}$/;

export default function Pii() {
  const t = useT();
  const l = useL();
  const [roles, setRoles] = useState<RoleOut[]>([]);
  const [m, setM] = useState<PiiMatrix>({});
  const [err, setErr] = useState("");

  // Add role state
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit / delete role state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingRole, setDeletingRole] = useState<RoleOut | null>(null);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [rs, pii] = await Promise.all([
        apiFetch<RoleOut[]>("/api/admin/roles"),
        apiFetch<PiiMatrix>("/api/admin/pii"),
      ]);
      setRoles(rs.filter((r) => !r.is_system));
      setM(pii);
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (roleId: string, p: string) => {
    const current = m[roleId] ?? [];
    const updated = current.includes(p)
      ? current.filter((x) => x !== p)
      : [...current, p];
    const prev = m;
    setM({ ...m, [roleId]: updated });
    try {
      await apiFetch(`/api/admin/pii/${roleId}`, {
        method: "PUT",
        body: JSON.stringify({ pii_types: updated }),
      });
      toast(l("Kebijakan PII diperbarui", "PII policy updated"));
    } catch (e) {
      setM(prev);
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const key = (keyTouched ? newKey : toRoleKey(name)).trim();
    if (!name) return;
    if (!ROLE_KEY_RE.test(key)) {
      toast(
        l(
          "Key peran harus diawali huruf kecil, terdiri dari a-z, 0-9, atau _, panjang 2–31 karakter.",
          "Role key must start with a lowercase letter and use a-z, 0-9, or _ (2–31 chars).",
        ),
      );
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ key, name }),
      });
      setNewName("");
      setNewKey("");
      setKeyTouched(false);
      toast(l(`Peran "${name}" berhasil ditambahkan`, `Role "${name}" created`));
      await load();
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    } finally {
      setCreating(false);
    }
  };

  const handleRenameRole = async (roleId: string) => {
    const name = editingName.trim();
    if (!name) return;
    setBusyRoleId(roleId);
    try {
      await apiFetch(`/api/admin/roles/${roleId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setRoles((prev) =>
        prev.map((r) => (r.id === roleId ? { ...r, name } : r)),
      );
      setEditingId(null);
      toast(l("Nama peran diperbarui", "Role renamed"));
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    } finally {
      setBusyRoleId(null);
    }
  };

  const handleDeleteRole = async (role: RoleOut) => {
    setBusyRoleId(role.id);
    try {
      await apiFetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      setDeletingRole(null);
      toast(l(`Peran "${role.name}" dihapus`, `Role "${role.name}" deleted`));
    } catch (e) {
      toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));
    } finally {
      setBusyRoleId(null);
    }
  };

  const effectiveKey = keyTouched ? newKey : toRoleKey(newName);

  return (
    <Shell title={t("pii")}>
      <p className="mb-4 text-sm text-muted">
        {l(
          "Detektor PII berjalan deterministik saat dokumen/pesan masuk. Peran bisnis yang dicentang di bawah boleh melihat jenis data pribadi (PII) tersebut tanpa masking, hanya pada sumber yang memang boleh dibacanya. Semua perubahan dicatat di audit log tamper-evident.",
          "PII detectors run deterministically at ingestion time. Checked business roles below can view that personal data (PII) unmasked, only in sources they can already read. All changes are logged to the tamper-evident audit log.",
        )}
      </p>
      {err && <p role="alert" className="text-bad mb-3">{err}</p>}

      {/* Built-in PII Detectors Reference */}
      <div className="mb-6">
        <div className="eyebrow mb-2">
          {l("Detektor PII Bawaan (Kode Deterministik)", "Built-in PII Detectors (Deterministic Code)")}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {PII_TYPES.map((p) => {
            const meta = DETECTOR_META[p];
            return (
              <div key={p} className="card p-3 flex flex-col gap-1 bg-surface2/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{LABEL[p]}</span>
                  <code className="text-[11px] px-1.5 py-0.5 rounded bg-tint text-brand font-mono">
                    {p}
                  </code>
                </div>
                <code className="text-xs font-mono text-fg/90">{meta.mask}</code>
                <p className="text-[11px] text-muted leading-snug mt-0.5">
                  {l(meta.id, meta.en)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Business Role Form */}
      <form
        onSubmit={handleCreateRole}
        className="card p-4 mb-5 flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-[200px]">
          <span className="font-medium">
            {l("Tambah peran bisnis baru", "Add new business role")}
          </span>
          <input
            className="input"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (!keyTouched) setNewKey(toRoleKey(e.target.value));
            }}
            placeholder={l("mis. Legal & Kepatuhan", "e.g. Legal & Compliance")}
            disabled={creating}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm w-48">
          <span className="text-xs text-muted font-mono">
            {l("Key (a-z, 0-9, _)", "Key (a-z, 0-9, _)")}
          </span>
          <input
            className="input font-mono text-sm"
            value={effectiveKey}
            onChange={(e) => {
              setKeyTouched(true);
              setNewKey(e.target.value.toLowerCase());
            }}
            placeholder="legal_compliance"
            disabled={creating}
          />
        </label>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={creating || !newName.trim() || !ROLE_KEY_RE.test(effectiveKey)}
        >
          <Plus size={15} />
          {creating ? l("Menyimpan…", "Saving…") : l("Tambah Peran", "Add Role")}
        </button>
      </form>

      {/* Role x PII Matrix */}
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface2 border-b border-line">
            <tr>
              <th className="px-4 py-3">{l("Peran Bisnis", "Business Role")}</th>
              {PII_TYPES.map((p) => (
                <th key={p} className="px-4 py-3 text-center">
                  {LABEL[p]}
                </th>
              ))}
              <th className="px-4 py-3 text-right">{l("Aksi Peran", "Role Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const isEditing = editingId === r.id;
              const isConfirmingDelete = deletingRole?.id === r.id;
              return (
                <tr key={r.id} className="border-t border-line hover:bg-surface2/40 transition-colors">
                  <td className="px-4 py-3.5">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 max-w-xs">
                        <input
                          className="input !py-1 text-sm"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameRole(r.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary !p-1.5"
                          onClick={() => handleRenameRole(r.id)}
                          disabled={busyRoleId === r.id || !editingName.trim()}
                          title={l("Simpan nama", "Save name")}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn !p-1.5"
                          onClick={() => setEditingId(null)}
                          title={l("Batal", "Cancel")}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-2.5">
                        <span className="font-semibold">{r.name}</span>
                        <span className="text-xs text-muted font-mono px-1.5 py-0.5 rounded bg-surface2 border border-line">
                          {r.key}
                        </span>
                      </span>
                    )}
                  </td>
                  {PII_TYPES.map((p) => (
                    <td key={p} className="px-4 py-3.5 text-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[var(--brand)] cursor-pointer"
                        aria-label={`${r.name} ${LABEL[p]}`}
                        checked={!!m[r.id]?.includes(p)}
                        onChange={() => toggle(r.id, p)}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3.5 text-right">
                    {isConfirmingDelete ? (
                      <div className="inline-flex items-center gap-1.5 text-xs">
                        <span className="text-bad font-medium flex items-center gap-1 mr-1">
                          <ShieldAlert size={13} />
                          {l("Hapus peran ini?", "Delete role?")}
                        </span>
                        <button
                          type="button"
                          className="btn !py-1 !px-2.5 text-xs !border-bad !text-bad hover:!bg-bad/10"
                          onClick={() => handleDeleteRole(r)}
                          disabled={busyRoleId === r.id}
                        >
                          {l("Ya, Hapus", "Yes, Delete")}
                        </button>
                        <button
                          type="button"
                          className="btn !py-1 !px-2 text-xs"
                          onClick={() => setDeletingRole(null)}
                        >
                          {l("Batal", "Cancel")}
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="btn !py-1 !px-2.5 text-xs"
                          onClick={() => {
                            setEditingId(r.id);
                            setEditingName(r.name);
                            setDeletingRole(null);
                          }}
                          title={l("Ubah nama peran", "Rename role")}
                        >
                          <Edit2 size={12} /> {l("Ubah nama", "Rename")}
                        </button>
                        <button
                          type="button"
                          className="btn !py-1 !px-2 text-xs text-muted hover:text-bad"
                          onClick={() => {
                            setDeletingRole(r);
                            setEditingId(null);
                          }}
                          title={l("Hapus peran", "Delete role")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {roles.length === 0 && (
              <tr>
                <td colSpan={PII_TYPES.length + 2} className="p-6 text-center text-muted">
                  {l("Belum ada peran bisnis.", "No business roles yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
