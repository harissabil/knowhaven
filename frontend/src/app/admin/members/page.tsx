"use client";
import { useState, useEffect } from "react";
import { apiFetch, errorText } from "@/lib/api";
import type { MemberOut, RoleOut } from "@/lib/contracts";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  UserCheck,
  UserX,
  Search,
  Check,
  X,
  Edit2,
  AlertTriangle,
  UserPlus,
  Shield,
  Mail,
  Plus,
  Trash2,
  Settings2,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { RoleChip, StatusChip } from "@/components/Chip";
import { toast } from "@/components/ui/Toast";
import { useL, useT } from "@/lib/i18n";
import { useSession } from "@/store/session";

export interface MemberItem {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
  roles: string[];
  status: "active" | "pending" | "removed";
  joinedAt: string;
  slackUser?: string;
}

// Default seed names from backend/src/brain/tenancy/service.py ROLE_TEMPLATES
const SEED_NAME: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  auditor: "Auditor",
  new_hire: "Karyawan Baru",
  staff: "Staf",
  ops: "Operasional",
  hr: "HR",
  project_mgr: "Project Manager",
  finance: "Keuangan",
  direksi: "Direksi",
};

// Available roles categorized according to System Design Doc §4.1
// Friendly labels for the default role keys; any other or renamed role shows its own name (doc §4.1).
const ROLE_INFO: Record<string, { label: { id: string; en: string }; desc: { id: string; en: string } }> = Object.fromEntries([
  { key: "staff", label: { id: "Staf", en: "Staff" }, desc: { id: "Akses informasi umum perusahaan", en: "General company access" } },
  { key: "new_hire", label: { id: "Karyawan Baru", en: "New Hire" }, desc: { id: "Akses panduan onboarding & fasilitas", en: "Onboarding and benefits access" } },
  { key: "ops", label: { id: "Operasional & Gudang", en: "Operations" }, desc: { id: "Akses logistik, cabang, dan distribusi", en: "Logistics and branch distribution" } },
  { key: "hr", label: { id: "HR & Personalia", en: "HR" }, desc: { id: "Akses kebijakan internal & data pribadi (PII)", en: "Internal policies and PII access" } },
  { key: "project_mgr", label: { id: "Project Manager", en: "Project Manager" }, desc: { id: "Akses riwayat proyek & inisiatif khusus", en: "Project history and confidential initiatives" } },
  { key: "finance", label: { id: "Keuangan", en: "Finance" }, desc: { id: "Akses grade gaji & anggaran cabang", en: "Salary grades and branch budgets" } },
  { key: "direksi", label: { id: "Direksi", en: "Director" }, desc: { id: "Akses strategis menyeluruh", en: "Broad executive access" } },
  { key: "director", label: { id: "Direksi", en: "Director" }, desc: { id: "Akses strategis menyeluruh", en: "Broad executive access" } },
  { key: "owner", label: { id: "Owner", en: "Owner" }, desc: { id: "Pemilik tenant (akses kontrol penuh)", en: "Tenant owner (full admin rights)" } },
  { key: "admin", label: { id: "Admin", en: "Admin" }, desc: { id: "Konfigurasi RBAC, container & integrasi; tidak memberi akses konten", en: "RBAC, containers & integrations config; grants no content" } },
  { key: "auditor", label: { id: "Auditor", en: "Auditor" }, desc: { id: "Hak melihat audit log & trace penuh", en: "View full audit log & execution traces" } },
].map(({ key, ...v }) => [key, v]));

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const hueOf = (s: string) => [14, 28, 160, 200, 262, 330][hash(s) % 6];

const toRoleKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 31);

const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,30}$/;

export default function Members() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [roles, setRoles] = useState<RoleOut[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "removed">("all");
  const [search, setSearch] = useState("");

  async function loadMembers() {
    try {
      const [res, rs] = await Promise.all([apiFetch<MemberOut[]>("/api/admin/members"), apiFetch<RoleOut[]>("/api/admin/roles")]);
      setRoles(rs);
      setMembers(
        res.map((m) => ({
          id: m.user_id,
          name: m.name,
          email: m.email,
          department: m.department || "—",
          title: m.title || "",
          roles: m.roles,
          status: m.status === "pending" ? "pending" : "active",
          joinedAt: m.joined_at.split("T")[0],
        })),
      );
    } catch (e) {
      setLoadErr(errorText(e));
    }
  }
  useEffect(() => { loadMembers(); }, []);

  const roleOpt = (r: RoleOut) => {
    const isDefaultName = SEED_NAME[r.key] === r.name;
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      label: isDefaultName && ROLE_INFO[r.key] ? ROLE_INFO[r.key].label : { id: r.name, en: r.name },
      desc: ROLE_INFO[r.key]?.desc ?? { id: `Key: ${r.key}`, en: `Key: ${r.key}` },
    };
  };
  const BUSINESS_ROLES = roles.filter((r) => !r.is_system).map(roleOpt);
  const SYSTEM_ROLES = roles.filter((r) => r.is_system).map(roleOpt);
  const roleIds = (keys: string[]) => keys.map((k) => roles.find((r) => r.key === k)?.id).filter(Boolean) as string[];
  const fail = (e: unknown) => toast(l(`Gagal: ${errorText(e)}`, `Failed: ${errorText(e)}`));

  // Modals state
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);
  const [modalMode, setModalMode] = useState<"approve" | "editRoles" | "remove" | "manageRoles" | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [deptDraft, setDeptDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");

  const existingDepartments = Array.from(
    new Set(members.map((m) => m.department).filter((d) => d && d !== "—"))
  ).sort();

  // Role CRUD state inside Manage Roles modal
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleKey, setNewRoleKey] = useState("");
  const [roleKeyTouched, setRoleKeyTouched] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState("");
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);

  // Filtered members list
  const filteredMembers = members.filter((m) => {
    if (filter !== "all" && m.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q) ||
        m.roles.some((r) => r.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const countActive = members.filter((m) => m.status === "active").length;
  const countPending = members.filter((m) => m.status === "pending").length;
  const countRemoved = members.filter((m) => m.status === "removed").length;

  // Open modal handlers
  const handleOpenApprove = (m: MemberItem) => {
    setSelectedMember(m);
    setSelectedRoles(["staff"]); // default suggested role (a key that does not exist is ignored)
    setDeptDraft(m.department === "—" ? "" : m.department);
    setTitleDraft(m.title || "");
    setModalMode("approve");
  };

  const handleOpenEditRoles = (m: MemberItem) => {
    setSelectedMember(m);
    setSelectedRoles([...m.roles]);
    setDeptDraft(m.department === "—" ? "" : m.department);
    setTitleDraft(m.title || "");
    setModalMode("editRoles");
  };

  const handleOpenRemove = (m: MemberItem) => {
    setSelectedMember(m);
    setModalMode("remove");
  };

  const handleOpenManageRoles = () => {
    setEditingRoleId(null);
    setDeletingRoleId(null);
    setModalMode("manageRoles");
  };

  const closeModal = () => {
    setSelectedMember(null);
    setModalMode(null);
    setSelectedRoles([]);
    setDeptDraft("");
    setTitleDraft("");
    setEditingRoleId(null);
    setDeletingRoleId(null);
  };

  // Role CRUD handlers
  const effectiveNewKey = roleKeyTouched ? newRoleKey : toRoleKey(newRoleName);

  const handleCreateBusinessRole = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newRoleName.trim();
    const key = effectiveNewKey.trim();
    if (!name) return;
    if (!ROLE_KEY_RE.test(key)) {
      toast(
        l(
          "Key peran harus diawali huruf kecil, menggunakan a-z, 0-9, atau _, panjang 2–31 karakter.",
          "Role key must start with a lowercase letter and use a-z, 0-9, or _ (2–31 chars).",
        ),
      );
      return;
    }
    setCreatingRole(true);
    try {
      await apiFetch("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ key, name }),
      });
      setNewRoleName("");
      setNewRoleKey("");
      setRoleKeyTouched(false);
      toast(l(`Peran "${name}" berhasil dibuat.`, `Role "${name}" created.`));
      await loadMembers();
    } catch (e) {
      fail(e);
    } finally {
      setCreatingRole(false);
    }
  };

  const handleRenameBusinessRole = async (roleId: string) => {
    const name = editingRoleName.trim();
    if (!name) return;
    setBusyRoleId(roleId);
    try {
      await apiFetch(`/api/admin/roles/${roleId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setEditingRoleId(null);
      toast(l("Nama peran diperbarui.", "Role renamed."));
      await loadMembers();
    } catch (e) {
      fail(e);
    } finally {
      setBusyRoleId(null);
    }
  };

  const handleDeleteBusinessRole = async (role: RoleOut) => {
    setBusyRoleId(role.id);
    try {
      await apiFetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      setDeletingRoleId(null);
      toast(l(`Peran "${role.name}" dihapus.`, `Role "${role.name}" deleted.`));
      await loadMembers();
    } catch (e) {
      fail(e);
    } finally {
      setBusyRoleId(null);
    }
  };

  // Action submit handlers
  const handleApproveConfirm = async () => {
    if (!selectedMember) return;
    if (selectedRoles.length === 0) {
      toast(l("Pilih minimal satu peran untuk anggota baru", "Select at least one role for the new member"));
      return;
    }

    const cleanDept = deptDraft.trim();
    const cleanTitle = titleDraft.trim();

    try {
      await apiFetch(`/api/admin/members/${selectedMember.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ role_ids: roleIds(selectedRoles) }),
      });
      if (cleanDept || cleanTitle) {
        await apiFetch(`/api/admin/members/${selectedMember.id}/profile`, {
          method: "PATCH",
          body: JSON.stringify({
            department: cleanDept || null,
            title: cleanTitle || null,
          }),
        });
      }
    } catch (e) {
      return fail(e);
    }

    setMembers((prev) =>
      prev.map((m) =>
        m.id === selectedMember.id
          ? {
              ...m,
              status: "active",
              roles: selectedRoles,
              department: cleanDept || "—",
              title: cleanTitle,
            }
          : m
      )
    );
    toast(
      l(
        `${selectedMember.name} disetujui sebagai anggota aktif.`,
        `${selectedMember.name} was approved as an active member.`
      )
    );
    closeModal();
  };

  const handleReject = async (m: MemberItem) => {
    try {
      await apiFetch(`/api/admin/members/${m.id}/reject`, { method: "POST" });
    } catch (e) {
      return fail(e);
    }
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: "removed" } : x)));
    toast(l(`Pendaftaran ${m.name} ditolak.`, `Application for ${m.name} was rejected.`));
  };

  const handleSaveRoles = async () => {
    if (!selectedMember) return;
    if (selectedRoles.length === 0) {
      toast(l("Anggota harus memiliki minimal satu peran", "Member must have at least one role"));
      return;
    }

    const cleanDept = deptDraft.trim();
    const cleanTitle = titleDraft.trim();
    const origDept = selectedMember.department === "—" ? "" : selectedMember.department;
    const origTitle = selectedMember.title || "";
    const profileChanged = cleanDept !== origDept || cleanTitle !== origTitle;

    try {
      await apiFetch(`/api/admin/members/${selectedMember.id}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roles: roleIds(selectedRoles).map((role_id) => ({ role_id })) }),
      });
      if (profileChanged) {
        await apiFetch(`/api/admin/members/${selectedMember.id}/profile`, {
          method: "PATCH",
          body: JSON.stringify({
            department: cleanDept || null,
            title: cleanTitle || null,
          }),
        });
      }
    } catch (e) {
      return fail(e);
    }

    setMembers((prev) =>
      prev.map((m) =>
        m.id === selectedMember.id
          ? {
              ...m,
              roles: selectedRoles,
              department: cleanDept || "—",
              title: cleanTitle,
            }
          : m
      )
    );
    toast(
      l(
        `Profil & peran untuk ${selectedMember.name} berhasil diperbarui.`,
        `Profile & roles for ${selectedMember.name} successfully updated.`
      )
    );
    closeModal();
  };

  const handleRemoveConfirm = async () => {
    if (!selectedMember) return;

    try {
      await apiFetch(`/api/admin/members/${selectedMember.id}`, { method: "DELETE" });
    } catch (e) {
      return fail(e);
    }

    setMembers((prev) =>
      prev.map((m) => (m.id === selectedMember.id ? { ...m, status: "removed" } : m))
    );
    toast(
      l(
        `${selectedMember.name} dikeluarkan. Token MCP dan akses dicabut.`,
        `${selectedMember.name} removed. MCP tokens and access revoked.`
      )
    );
    closeModal();
  };

  // Removal deletes the membership server-side; coming back means a fresh invite (doc §4.4).
  const handleRestore = (m: MemberItem) => {
    toast(l(`Kirim undangan baru ke ${m.email} dari halaman Undangan.`, `Send ${m.email} a new invite from the Invites page.`));
  };

  const toggleRole = (r: string) => {
    setSelectedRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  };

  return (
    <Shell title={t("members")}>
      <div className="flex flex-col gap-6 max-w-6xl">
        {loadErr && <p role="alert" className="text-bad">{loadErr}</p>}

        {/* Action Header & Tabs */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 rounded-full bg-surface2 border border-line w-fit">
            <button
              onClick={() => setFilter("all")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === "all" ? "bg-brand text-brandfg shadow-xs" : "text-muted hover:text-fg"
                }`}
            >
              {l("Semua", "All")} ({members.length})
            </button>
            <button
              onClick={() => setFilter("active")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === "active" ? "bg-brand text-brandfg shadow-xs" : "text-muted hover:text-fg"
                }`}
            >
              {l("Aktif", "Active")} ({countActive})
            </button>
            <button
              onClick={() => setFilter("pending")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === "pending" ? "bg-brand text-brandfg shadow-xs" : "text-muted hover:text-fg"
                }`}
            >
              {l("Pending", "Pending")} ({countPending})
            </button>
            <button
              onClick={() => setFilter("removed")}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === "removed" ? "bg-brand text-brandfg shadow-xs" : "text-muted hover:text-fg"
                }`}
            >
              {l("Dikeluarkan", "Removed")} ({countRemoved})
            </button>
          </div>

          {/* Search, Manage Roles & Invite Action */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="input !py-1.5 !pl-9 !text-sm w-56 md:w-64"
                placeholder={l("Cari nama, email, peran…", "Search name, email, role…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={handleOpenManageRoles}
              className="btn !py-1.5 text-sm inline-flex items-center gap-1.5"
            >
              <Settings2 size={15} />
              <span>{l("Kelola Peran", "Manage Roles")}</span>
            </button>
            <Link href="/admin/invites" className="btn btn-primary !py-1.5 text-sm inline-flex items-center gap-1.5">
              <UserPlus size={15} />
              <span>{l("Undang Anggota", "Invite Members")}</span>
            </Link>
          </div>
        </div>

        {/* Members Table */}
        <div className="card overflow-x-auto shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="eyebrow border-b border-line bg-surface2/50">
              <tr>
                <th className="px-5 py-3 font-medium">{l("Anggota", "Member")}</th>
                <th className="px-5 py-3 font-medium">{l("Departemen & Jabatan", "Department & Title")}</th>
                <th className="px-5 py-3 font-medium">{l("Peran (RBAC)", "Roles (RBAC)")}</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">{l("Bergabung", "Joined")}</th>
                <th className="px-5 py-3 font-medium text-right">{l("Aksi", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredMembers.map((m) => {
                const initials = m.name
                  .match(/\b\w/g)
                  ?.join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <tr key={m.id} className="hover:bg-surface2/50 transition-colors">
                    {/* Name & Email */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span
                          className="w-9 h-9 rounded-full grid place-items-center text-xs font-bold text-white shrink-0"
                          style={{ background: `hsl(${hueOf(m.name)} 70% 45%)` }}
                        >
                          {initials}
                        </span>
                        <div className="flex flex-col">
                          <span className="font-semibold">{m.name}</span>
                          <span className="text-xs text-muted flex items-center gap-1">
                            <Mail size={11} /> {m.email}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Department & Slack */}
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-medium text-fg">{m.department}</span>
                        <span className="text-xs text-muted flex items-center gap-1">
                          {m.title}
                          {m.slackUser && (
                            <span className="text-muted/70">· {m.slackUser}</span>
                          )}
                        </span>
                      </div>
                    </td>

                    {/* Roles Badges */}
                    <td className="px-5 py-3.5">
                      {m.roles.length === 0 ? (
                        <span className="text-xs text-muted italic">
                          {m.status === "pending"
                            ? l("Akses data nol (Pending)", "Zero data access (Pending)")
                            : l("Tidak ada peran", "No roles")}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {m.roles.map((r) => <RoleChip key={r} role={r} system={["owner", "admin", "auditor"].includes(r)} />)}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5">
                      {m.status === "active" && <StatusChip tone="ok">{l("Aktif", "Active")}</StatusChip>}
                      {m.status === "pending" && <StatusChip tone="warn">{l("Menunggu Persetujuan", "Pending")}</StatusChip>}
                      {m.status === "removed" && <StatusChip tone="muted">{l("Dikeluarkan", "Removed")}</StatusChip>}
                    </td>

                    {/* Joined Date */}
                    <td className="px-5 py-3.5 text-xs text-muted font-mono">{m.joinedAt}</td>

                    {/* Actions */}
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {m.status === "pending" && (
                          <>
                            <button
                              className="btn btn-primary !py-1 !px-2.5 text-xs inline-flex items-center gap-1"
                              onClick={() => handleOpenApprove(m)}
                              title={l("Setujui dan berikan peran", "Approve and assign roles")}
                            >
                              <Check size={13} />
                              <span>{t("approve")}</span>
                            </button>
                            <button
                              className="btn !py-1 !px-2.5 text-xs hover:text-bad"
                              onClick={() => handleReject(m)}
                              title={l("Tolak pendaftaran", "Reject application")}
                            >
                              {t("reject")}
                            </button>
                          </>
                        )}
                        {m.status === "active" && (
                          <>
                            <button
                              className="btn !py-1 !px-2.5 text-xs inline-flex items-center gap-1 hover:border-brand"
                              onClick={() => handleOpenEditRoles(m)}
                              title={l("Ubah departemen, jabatan, dan peran", "Edit department, title, and roles")}
                            >
                              <Edit2 size={12} />
                              <span>{l("Ubah", "Edit")}</span>
                            </button>
                            <button
                              className="btn !py-1 !px-2.5 text-xs text-muted hover:text-bad"
                              onClick={() => handleOpenRemove(m)}
                              title={l("Keluarkan anggota", "Remove member")}
                            >
                              <UserX size={13} />
                            </button>
                          </>
                        )}
                        {m.status === "removed" && (
                          <button
                            className="btn !py-1 !px-2.5 text-xs inline-flex items-center gap-1"
                            onClick={() => handleRestore(m)}
                          >
                            <UserCheck size={13} />
                            <span>{l("Pulihkan", "Restore")}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredMembers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    {l("Tidak ada anggota yang cocok dengan filter.", "No members match the current filter.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: APPROVE PENDING MEMBER */}
      <AnimatePresence>
        {modalMode === "approve" && selectedMember && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs grid place-items-center p-4 overflow-y-auto"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="card p-6 w-full max-w-lg shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <UserCheck size={20} className="text-ok" />
                    {l("Setujui Calon Anggota", "Approve Pending Member")}
                  </h3>
                  <p className="text-sm text-muted mt-1">
                    {l(
                      `Berikan peran bisnis awal untuk ${selectedMember.name}.`,
                      `Assign initial business roles for ${selectedMember.name}.`
                    )}
                  </p>
                </div>
                <button className="btn !p-1.5 rounded-full" onClick={closeModal}>
                  <X size={16} />
                </button>
              </div>

              {/* Applicant Info Box */}
              <div className="p-3 rounded-erp bg-surface2 border border-line mb-4 text-sm flex flex-col gap-1">
                <p>
                  <span className="text-muted">{l("Nama", "Name")}:</span> <b>{selectedMember.name}</b>
                </p>
                <p>
                  <span className="text-muted">Email:</span> {selectedMember.email}
                </p>
              </div>

              {/* Department & Title fields */}
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold text-fg">{l("Departemen", "Department")}</span>
                  <input
                    className="input !py-1.5 text-sm font-normal"
                    list="member-departments-list"
                    value={deptDraft}
                    onChange={(e) => setDeptDraft(e.target.value)}
                    placeholder={l("mis. Operasional, HR, Keuangan", "e.g. Operations, HR, Finance")}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold text-fg">{l("Jabatan", "Job Title")}</span>
                  <input
                    className="input !py-1.5 text-sm font-normal"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    placeholder={l("mis. Manajer Gudang", "e.g. Warehouse Manager")}
                  />
                </label>
              </div>

              {/* Roles selection */}
              <div className="flex flex-col gap-2 mb-6">
                <span className="font-semibold text-sm">
                  {l("Pilih Peran Bisnis Awal", "Select Starting Business Roles")}
                </span>
                <p className="text-xs text-muted mb-1">
                  {l(
                    "Peran menentukan channel, dokumen, dan task yang bisa diakses user.",
                    "Roles determine which channels, documents, and tasks the user can access."
                  )}
                </p>

                <div className="grid gap-2 max-h-56 overflow-y-auto pr-1">
                  {BUSINESS_ROLES.map((r) => {
                    const active = selectedRoles.includes(r.key);
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => toggleRole(r.key)}
                        className={`p-2.5 rounded-erp border text-left flex items-start justify-between transition-colors ${active
                          ? "border-brand bg-brand-tint/60 text-fg ring-1 ring-brand/40"
                          : "border-line bg-surface hover:bg-surface2"
                          }`}
                      >
                        <div>
                          <p className="font-medium text-sm">{r.label[lang]}</p>
                          <p className="text-xs text-muted">{r.desc[lang]}</p>
                        </div>
                        <div
                          className={`w-5 h-5 rounded border mt-0.5 grid place-items-center ${active ? "bg-brand border-brand text-brandfg" : "border-line2 bg-surface"
                            }`}
                        >
                          {active && <Check size={13} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
                <button className="btn" onClick={closeModal}>
                  {l("Batal", "Cancel")}
                </button>
                <button className="btn btn-primary" onClick={handleApproveConfirm}>
                  <Check size={16} /> {l("Setujui & Berikan Akses", "Approve & Grant Access")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: EDIT ROLES */}
      <AnimatePresence>
        {modalMode === "editRoles" && selectedMember && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs grid place-items-center p-4 overflow-y-auto"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="card p-6 w-full max-w-xl shadow-xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3 shrink-0">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Edit2 size={18} className="text-brand" />
                    {l("Kelola Profil & Peran Anggota", "Manage Member Profile & Roles")}
                  </h3>
                  <p className="text-sm text-muted mt-0.5">
                    {selectedMember.name} ({selectedMember.email})
                  </p>
                </div>
                <button className="btn !p-1.5 rounded-full" onClick={closeModal}>
                  <X size={16} />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 pr-1 flex flex-col gap-5 py-2">
                {/* Department & Title Group */}
                <div className="p-3.5 rounded-erp bg-surface2/60 border border-line flex flex-col gap-3">
                  <div>
                    <p className="font-semibold text-sm">{l("Departemen & Jabatan", "Department & Job Title")}</p>
                    <p className="text-xs text-muted">
                      {l(
                        "Departemen digunakan untuk menentukan jalur persetujuan (Approver) saat anggota mengajukan akses ke topik terbatas.",
                        "Department routes access requests to the corresponding Department Approver."
                      )}
                    </p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-medium text-fg">{l("Departemen", "Department")}</span>
                      <input
                        className="input !py-1.5 text-sm font-normal bg-surface"
                        list="member-departments-list"
                        value={deptDraft}
                        onChange={(e) => setDeptDraft(e.target.value)}
                        placeholder={l("mis. Operasional, HR, Keuangan", "e.g. Operations, HR, Finance")}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-medium text-fg">{l("Jabatan", "Job Title")}</span>
                      <input
                        className="input !py-1.5 text-sm font-normal bg-surface"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        placeholder={l("mis. Staf Logistik, Kepala Cabang", "e.g. Logistics Staff, Branch Head")}
                      />
                    </label>
                  </div>
                </div>

                {/* Business Roles Group */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{l("Peran Bisnis (Akses Data)", "Business Roles (Data Access)")}</p>
                      <p className="text-xs text-muted">
                        {l(
                          "Menentukan akses ke channel Slack, dokumen Confluence, dan task Jira.",
                          "Governs access to Slack channels, Confluence spaces, and Jira projects."
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn !py-1 !px-2.5 text-xs shrink-0"
                      onClick={handleOpenManageRoles}
                    >
                      <Settings2 size={13} /> {l("Tambah / Edit Peran", "Add / Edit Roles")}
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {BUSINESS_ROLES.map((r) => {
                      const active = selectedRoles.includes(r.key);
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => toggleRole(r.key)}
                          className={`p-2.5 rounded-erp border text-left flex items-start justify-between transition-colors ${active
                            ? "border-brand bg-brand-tint/60 text-fg ring-1 ring-brand/40"
                            : "border-line bg-surface hover:bg-surface2"
                            }`}
                        >
                          <div>
                            <p className="font-medium text-xs sm:text-sm">{r.label[lang]}</p>
                            <p className="text-[11px] text-muted line-clamp-1">{r.desc[lang]}</p>
                          </div>
                          <div
                            className={`w-4 h-4 rounded border mt-0.5 grid place-items-center shrink-0 ${active ? "bg-brand border-brand text-brandfg" : "border-line2 bg-surface"
                              }`}
                          >
                            {active && <Check size={11} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* System Roles Group */}
                <div>
                  <div className="mb-2">
                    <p className="font-semibold text-sm flex items-center gap-1.5">
                      <Shield size={14} className="text-purple-600 dark:text-purple-400" />
                      {l("Peran Sistem & Fungsi Khusus", "System Roles & Functions")}
                    </p>
                    <p className="text-xs text-muted">
                      {l(
                        "Memberikan hak administratif atau fungsi approval.",
                        "Grants administrative configuration or approval workflow capabilities."
                      )}
                    </p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {SYSTEM_ROLES.map((r) => {
                      const active = selectedRoles.includes(r.key);
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => toggleRole(r.key)}
                          className={`p-2.5 rounded-erp border text-left flex items-start justify-between transition-colors ${active
                            ? "border-purple-500 bg-purple-500/10 text-fg ring-1 ring-purple-500/30"
                            : "border-line bg-surface hover:bg-surface2"
                            }`}
                        >
                          <div>
                            <p className="font-medium text-xs sm:text-sm">{r.label[lang]}</p>
                            <p className="text-[11px] text-muted line-clamp-1">{r.desc[lang]}</p>
                          </div>
                          <div
                            className={`w-4 h-4 rounded border mt-0.5 grid place-items-center shrink-0 ${active ? "bg-purple-600 border-purple-600 text-white" : "border-line2 bg-surface"
                              }`}
                          >
                            {active && <Check size={11} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex justify-between items-center pt-3 border-t border-line mt-3 shrink-0">
                <span className="text-xs text-muted">
                  {selectedRoles.length} {l("peran terpilih", "role(s) selected")}
                </span>
                <div className="flex gap-2">
                  <button className="btn" onClick={closeModal}>
                    {l("Batal", "Cancel")}
                  </button>
                  <button className="btn btn-primary" onClick={handleSaveRoles}>
                    {l("Simpan Perubahan", "Save Changes")}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: REMOVE MEMBER CONFIRMATION */}
      <AnimatePresence>
        {modalMode === "remove" && selectedMember && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs grid place-items-center p-4 overflow-y-auto"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="card p-6 w-full max-w-md shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 text-bad mb-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 grid place-items-center shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{l("Keluarkan Anggota?", "Remove Member?")}</h3>
                  <p className="text-xs text-muted">{selectedMember.name}</p>
                </div>
              </div>

              <p className="text-sm text-muted leading-relaxed mb-4">
                {l(
                  `Apakah Anda yakin ingin mengeluarkan ${selectedMember.name}? Sesuai aturan sistem (Doc §6.3), semua token WorkBuddy (MCP) dan grant akses pengguna di perusahaan ini akan langsung dicabut.`,
                  `Are you sure you want to remove ${selectedMember.name}? Per system policy (Doc §6.3), all WorkBuddy MCP tokens and access grants in this company will be immediately revoked.`
                )}
              </p>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
                <button className="btn" onClick={closeModal}>
                  {l("Batal", "Cancel")}
                </button>
                <button className="btn bg-red-600 hover:bg-red-700 text-white border-red-600" onClick={handleRemoveConfirm}>
                  <UserX size={15} /> {l("Ya, Keluarkan", "Yes, Remove")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 4: MANAGE BUSINESS ROLES (CREATE / RENAME / DELETE) */}
      <AnimatePresence>
        {modalMode === "manageRoles" && (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs grid place-items-center p-4 overflow-y-auto"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="card p-6 w-full max-w-xl shadow-xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3 shrink-0">
                <div>
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Settings2 size={19} className="text-brand" />
                    {l("Kelola Peran Perusahaan", "Manage Company Roles")}
                  </h3>
                  <p className="text-xs text-muted mt-0.5">
                    {l(
                      "Tambah, ubah nama, atau hapus peran bisnis. Setiap perubahan dicatat di audit log.",
                      "Add, rename, or delete business roles. Every change is recorded in the audit log.",
                    )}
                  </p>
                </div>
                <button className="btn !p-1.5 rounded-full" onClick={closeModal}>
                  <X size={16} />
                </button>
              </div>

              {/* Create Role Form */}
              <form
                onSubmit={handleCreateBusinessRole}
                className="p-3 rounded-erp bg-surface2 border border-line mb-4 flex flex-wrap items-end gap-2 shrink-0"
              >
                <label className="flex flex-col gap-1 text-xs flex-1 min-w-[160px]">
                  <span className="font-medium">{l("Nama Peran Baru", "New Role Name")}</span>
                  <input
                    className="input !py-1.5 text-sm"
                    value={newRoleName}
                    onChange={(e) => {
                      setNewRoleName(e.target.value);
                      if (!roleKeyTouched) setNewRoleKey(toRoleKey(e.target.value));
                    }}
                    placeholder={l("mis. Legal & Kepatuhan", "e.g. Legal & Compliance")}
                    disabled={creatingRole}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs w-40">
                  <span className="text-muted font-mono">Key (a-z, 0-9, _)</span>
                  <input
                    className="input !py-1.5 font-mono text-xs"
                    value={effectiveNewKey}
                    onChange={(e) => {
                      setRoleKeyTouched(true);
                      setNewRoleKey(e.target.value.toLowerCase());
                    }}
                    placeholder="legal_compliance"
                    disabled={creatingRole}
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-primary !py-1.5 text-xs"
                  disabled={creatingRole || !newRoleName.trim() || !ROLE_KEY_RE.test(effectiveNewKey)}
                >
                  <Plus size={14} /> {creatingRole ? l("Menambah…", "Adding…") : l("Tambah", "Add")}
                </button>
              </form>

              {/* Roles List */}
              <div className="overflow-y-auto flex-1 pr-1 flex flex-col gap-4">
                <div>
                  <div className="eyebrow mb-2">
                    {l("Peran Bisnis", "Business Roles")} ({BUSINESS_ROLES.length})
                  </div>
                  <div className="divide-y divide-line border border-line rounded-erp overflow-hidden">
                    {roles.filter((r) => !r.is_system).map((r) => {
                      const isEditing = editingRoleId === r.id;
                      const isDeleting = deletingRoleId === r.id;
                      return (
                        <div key={r.id} className="p-2.5 bg-surface flex items-center justify-between gap-2 text-sm">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5 flex-1">
                              <input
                                className="input !py-1 text-sm"
                                value={editingRoleName}
                                onChange={(e) => setEditingRoleName(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRenameBusinessRole(r.id);
                                  if (e.key === "Escape") setEditingRoleId(null);
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-primary !p-1.5"
                                onClick={() => handleRenameBusinessRole(r.id)}
                                disabled={busyRoleId === r.id || !editingRoleName.trim()}
                              >
                                <Check size={14} />
                              </button>
                              <button
                                type="button"
                                className="btn !p-1.5"
                                onClick={() => setEditingRoleId(null)}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold truncate">{r.name}</span>
                              <code className="text-xs px-1.5 py-0.5 rounded bg-surface2 text-muted font-mono">
                                {r.key}
                              </code>
                            </div>
                          )}

                          {!isEditing && (
                            isDeleting ? (
                              <div className="flex items-center gap-1.5 text-xs shrink-0">
                                <span className="text-bad font-medium">{l("Hapus?", "Delete?")}</span>
                                <button
                                  type="button"
                                  className="btn !py-1 !px-2 text-xs !border-bad !text-bad hover:!bg-bad/10"
                                  onClick={() => handleDeleteBusinessRole(r)}
                                  disabled={busyRoleId === r.id}
                                >
                                  {l("Ya", "Yes")}
                                </button>
                                <button
                                  type="button"
                                  className="btn !py-1 !px-2 text-xs"
                                  onClick={() => setDeletingRoleId(null)}
                                >
                                  {l("Batal", "No")}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  className="btn !py-1 !px-2 text-xs"
                                  onClick={() => {
                                    setEditingRoleId(r.id);
                                    setEditingRoleName(r.name);
                                    setDeletingRoleId(null);
                                  }}
                                >
                                  <Edit2 size={12} /> {l("Ubah nama", "Rename")}
                                </button>
                                <button
                                  type="button"
                                  className="btn !py-1 !px-2 text-xs text-muted hover:text-bad"
                                  onClick={() => {
                                    setDeletingRoleId(r.id);
                                    setEditingRoleId(null);
                                  }}
                                  title={l("Hapus peran", "Delete role")}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="eyebrow mb-2">
                    {l("Peran Sistem (Tetap / Tidak Bisa Dihapus)", "System Roles (Immutable)")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SYSTEM_ROLES.map((r) => (
                      <span
                        key={r.key}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30 font-medium"
                      >
                        <Shield size={12} /> {r.name} <code className="opacity-75 font-mono">({r.key})</code>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-line mt-4 shrink-0">
                <button className="btn" onClick={closeModal}>
                  {l("Tutup", "Close")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <datalist id="member-departments-list">
        {existingDepartments.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </Shell>
  );
}
