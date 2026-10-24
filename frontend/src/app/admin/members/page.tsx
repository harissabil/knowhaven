"use client";
import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  Users,
  UserCheck,
  Clock,
  UserX,
  Search,
  Check,
  X,
  Edit2,
  AlertTriangle,
  UserPlus,
  Shield,
  Building2,
  Mail,
} from "lucide-react";
import { Shell } from "@/components/Shell";
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

// Initial mock data based on System Design Doc §4.1, §6.1, and §21.2 (SRN tenant)
const INITIAL_MEMBERS: MemberItem[] = [
  {
    id: "admin",
    name: "Admin SRN",
    email: "admin@srn-nusantara.co.id",
    department: "Direksi & IT",
    title: "Owner & System Admin",
    roles: ["owner", "admin"],
    status: "active",
    joinedAt: "2026-08-01",
    slackUser: "@admin",
  },
  {
    id: "dimas",
    name: "Dimas Pratama",
    email: "dimas.pratama@srn-nusantara.co.id",
    department: "Operasional & Gudang",
    title: "Karyawan Baru",
    roles: ["new_hire", "staff"],
    status: "active",
    joinedAt: "2026-10-15",
    slackUser: "@dimas",
  },
  {
    id: "rina",
    name: "Rina Wulandari",
    email: "rina.w@srn-nusantara.co.id",
    department: "Operasional & Gudang",
    title: "Staf Ops Makassar",
    roles: ["staff", "ops"],
    status: "active",
    joinedAt: "2026-08-10",
    slackUser: "@rina",
  },
  {
    id: "andi",
    name: "Andi Saputra",
    email: "andi.saputra@srn-nusantara.co.id",
    department: "Proyek & IT",
    title: "Project Manager",
    roles: ["project_mgr"],
    status: "active",
    joinedAt: "2026-08-05",
    slackUser: "@andi",
  },
  {
    id: "sari",
    name: "Sari Kusuma",
    email: "sari.kusuma@srn-nusantara.co.id",
    department: "HR & People",
    title: "HR Specialist & Policy Owner",
    roles: ["hr"],
    status: "active",
    joinedAt: "2026-08-01",
    slackUser: "@sari",
  },
  {
    id: "budi",
    name: "Budi Hartono",
    email: "budi.hartono@srn-nusantara.co.id",
    department: "Operasional & Gudang",
    title: "Manajer Operasional & Approver",
    roles: ["ops", "approver"],
    status: "active",
    joinedAt: "2026-08-01",
    slackUser: "@budi.ops",
  },
  {
    id: "lina",
    name: "Lina Marpaung",
    email: "lina.marpaung@srn-nusantara.co.id",
    department: "Audit & Kepatuhan",
    title: "Auditor Kepatuhan Internal",
    roles: ["auditor"],
    status: "active",
    joinedAt: "2026-08-12",
    slackUser: "@lina",
  },
  {
    id: "yoga",
    name: "Yoga Prasetyo",
    email: "yoga.consulting@gmail.com",
    department: "Konsultan Eksternal",
    title: "Konsultan Rantai Pasok",
    roles: ["staff"],
    status: "active",
    joinedAt: "2026-09-01",
    slackUser: "@yoga",
  },
  {
    id: "pending-1",
    name: "Eko Kurniawan",
    email: "eko.k@srn-nusantara.co.id",
    department: "Gudang Surabaya",
    title: "Calon Staf Gudang (via Kode SRN-4821)",
    roles: [],
    status: "pending",
    joinedAt: "2026-10-24",
    slackUser: "@eko",
  },
  {
    id: "pending-2",
    name: "Dewi Anggraini",
    email: "dewi.finance@srn-nusantara.co.id",
    department: "Keuangan & Akuntansi",
    title: "Analis Keuangan (via Kode SRN-4821)",
    roles: [],
    status: "pending",
    joinedAt: "2026-10-24",
    slackUser: "@dewi",
  },
];

// Available roles categorized according to System Design Doc §4.1
const BUSINESS_ROLES = [
  { key: "staff", label: { id: "Staf", en: "Staff" }, desc: { id: "Akses informasi umum perusahaan", en: "General company access" } },
  { key: "new_hire", label: { id: "Karyawan Baru", en: "New Hire" }, desc: { id: "Akses panduan onboarding & fasilitas", en: "Onboarding and benefits access" } },
  { key: "ops", label: { id: "Operasional & Gudang", en: "Operations" }, desc: { id: "Akses logistik, cabang, dan distribusi", en: "Logistics and branch distribution" } },
  { key: "hr", label: { id: "HR & Personalia", en: "HR" }, desc: { id: "Akses kebijakan internal & data pribadi (PII)", en: "Internal policies and PII access" } },
  { key: "project_mgr", label: { id: "Project Manager", en: "Project Manager" }, desc: { id: "Akses riwayat proyek & inisiatif khusus", en: "Project history and confidential initiatives" } },
  { key: "finance", label: { id: "Keuangan", en: "Finance" }, desc: { id: "Akses grade gaji & anggaran cabang", en: "Salary grades and branch budgets" } },
  { key: "director", label: { id: "Direksi", en: "Director" }, desc: { id: "Akses strategis menyeluruh", en: "Broad executive access" } },
];

const SYSTEM_ROLES = [
  { key: "owner", label: { id: "Owner", en: "Owner" }, desc: { id: "Pemilik tenant (akses kontrol penuh)", en: "Tenant owner (full admin rights)" } },
  { key: "admin", label: { id: "Admin", en: "Admin" }, desc: { id: "Konfigurasi RBAC, container & integrasi", en: "RBAC, containers & integrations config" } },
  { key: "auditor", label: { id: "Auditor", en: "Auditor" }, desc: { id: "Hak melihat audit log & trace penuh", en: "View full audit log & execution traces" } },
  { key: "approver", label: { id: "Approver (Fungsi)", en: "Approver" }, desc: { id: "Menyetujui permintaan akses & draf aksi", en: "Approve access requests & action drafts" } },
];

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const hueOf = (s: string) => [14, 28, 160, 200, 262, 330][hash(s) % 6];

export default function Members() {
  const t = useT();
  const l = useL();
  const lang = useSession((s) => s.lang);
  const [members, setMembers] = useState<MemberItem[]>(INITIAL_MEMBERS);
  const [filter, setFilter] = useState<"all" | "active" | "pending" | "removed">("all");
  const [search, setSearch] = useState("");

  // Modals state
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);
  const [modalMode, setModalMode] = useState<"approve" | "editRoles" | "remove" | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

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
    setSelectedRoles(["staff"]); // default suggested role
    setModalMode("approve");
  };

  const handleOpenEditRoles = (m: MemberItem) => {
    setSelectedMember(m);
    setSelectedRoles([...m.roles]);
    setModalMode("editRoles");
  };

  const handleOpenRemove = (m: MemberItem) => {
    setSelectedMember(m);
    setModalMode("remove");
  };

  const closeModal = () => {
    setSelectedMember(null);
    setModalMode(null);
    setSelectedRoles([]);
  };

  // Action submit handlers
  const handleApproveConfirm = () => {
    if (!selectedMember) return;
    if (selectedRoles.length === 0) {
      toast(l("Pilih minimal satu peran untuk anggota baru", "Select at least one role for the new member"));
      return;
    }
    setMembers((prev) =>
      prev.map((m) =>
        m.id === selectedMember.id ? { ...m, status: "active", roles: selectedRoles } : m
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

  const handleReject = (m: MemberItem) => {
    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, status: "removed" } : x)));
    toast(l(`Pendaftaran ${m.name} ditolak.`, `Application for ${m.name} was rejected.`));
  };

  const handleSaveRoles = () => {
    if (!selectedMember) return;
    if (selectedRoles.length === 0) {
      toast(l("Anggota harus memiliki minimal satu peran", "Member must have at least one role"));
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.id === selectedMember.id ? { ...m, roles: selectedRoles } : m))
    );
    toast(
      l(
        `Peran untuk ${selectedMember.name} berhasil diperbarui.`,
        `Roles for ${selectedMember.name} successfully updated.`
      )
    );
    closeModal();
  };

  const handleRemoveConfirm = () => {
    if (!selectedMember) return;
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

  const handleRestore = (m: MemberItem) => {
    setMembers((prev) =>
      prev.map((x) =>
        x.id === m.id ? { ...x, status: "active", roles: x.roles.length ? x.roles : ["staff"] } : x
      )
    );
    toast(l(`${m.name} diaktifkan kembali.`, `${m.name} was restored.`));
  };

  const toggleRole = (r: string) => {
    setSelectedRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  };

  return (
    <Shell title={t("members")}>
      <div className="flex flex-col gap-6 max-w-6xl">
        {/* Top Summary Cards
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4 flex flex-col gap-1">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs uppercase font-medium">{l("Total Anggota", "Total Members")}</span>
              <Users size={16} />
            </div>
            <p className="text-2xl font-bold">{members.length}</p>
          </div>
          <div className="card p-4 flex flex-col gap-1">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs uppercase font-medium">{l("Anggota Aktif", "Active Members")}</span>
              <UserCheck size={16} className="text-ok" />
            </div>
            <p className="text-2xl font-bold text-ok">{countActive}</p>
          </div>
          <div
            className={`card p-4 flex flex-col gap-1 transition-colors ${countPending > 0 ? "border-amber-500/50 bg-amber-500/5" : ""
              }`}
          >
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs uppercase font-medium">{l("Menunggu Persetujuan", "Pending Approval")}</span>
              <Clock size={16} className={countPending > 0 ? "text-warn animate-pulse" : ""} />
            </div>
            <div className="flex items-baseline gap-2">
              <p className={`text-2xl font-bold ${countPending > 0 ? "text-warn" : ""}`}>{countPending}</p>
              {countPending > 0 && (
                <span className="text-xs text-warn font-medium">{l("Butuh tindakan", "Action needed")}</span>
              )}
            </div>
          </div>
          <div className="card p-4 flex flex-col gap-1">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs uppercase font-medium">{l("Dikeluarkan", "Removed")}</span>
              <UserX size={16} />
            </div>
            <p className="text-2xl font-bold text-muted">{countRemoved}</p>
          </div>
        </div> */}

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

          {/* Search & Invite Action */}
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="input !py-1.5 !pl-9 !text-sm w-56 md:w-64"
                placeholder={l("Cari nama, email, peran…", "Search name, email, role…")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
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
                          {m.roles.map((r) => {
                            const isSystem = ["owner", "admin", "auditor"].includes(r);
                            return (
                              <span
                                key={r}
                                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border ${isSystem
                                  ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30"
                                  : "bg-brand/10 text-brand border-brand/20"
                                  }`}
                              >
                                {isSystem && <Shield size={10} />}
                                {r}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5">
                      {m.status === "active" && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {l("Aktif", "Active")}
                        </span>
                      )}
                      {m.status === "pending" && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          {l("Menunggu Persetujuan", "Pending")}
                        </span>
                      )}
                      {m.status === "removed" && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                          {l("Dikeluarkan", "Removed")}
                        </span>
                      )}
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
                              title={l("Ubah peran bisnis dan sistem", "Edit business & system roles")}
                            >
                              <Edit2 size={12} />
                              <span>{l("Ubah peran", "Edit roles")}</span>
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

        {/* Explanatory notes from doc §4.1
        <div className="card p-4 bg-surface2/60 border-line text-xs text-muted flex flex-col gap-1.5">
          <p className="font-semibold text-fg flex items-center gap-1.5">
            <Shield size={14} className="text-brand" />
            {l("Prinsip Pemisahan Peran (Doc §4.1)", "Role Separation Principles (Doc §4.1)")}
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <b>{l("Peran Bisnis", "Business Roles")}</b> (Karyawan Baru, Staf, Ops, HR, Project Manager, Keuangan, Direksi) menentukan container, dokumen, dan pesan yang boleh dilihat di web dan WorkBuddy.
            </li>
            <li>
              <b>{l("Peran Sistem", "System Roles")}</b> (Owner, Admin, Auditor) memberi hak konfigurasi, bukan hak membaca konten bisnis. Admin tidak otomatis membaca seluruh dokumen tersembunyi.
            </li>
            <li>
              <b>{l("Anggota Pending", "Pending Members")}</b> yang bergabung via kode perusahaan memiliki akses data nol sampai disetujui oleh Owner/Admin.
            </li>
          </ul>
        </div> */}
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
                <p>
                  <span className="text-muted">{l("Departemen", "Department")}:</span> {selectedMember.department}
                </p>
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
                    {l("Kelola Peran Anggota", "Manage Member Roles")}
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
                {/* Business Roles Group */}
                <div>
                  <div className="mb-2">
                    <p className="font-semibold text-sm">{l("Peran Bisnis (Akses Data)", "Business Roles (Data Access)")}</p>
                    <p className="text-xs text-muted">
                      {l(
                        "Menentukan akses ke channel Slack, dokumen Confluence, dan task Jira.",
                        "Governs access to Slack channels, Confluence spaces, and Jira projects."
                      )}
                    </p>
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
    </Shell>
  );
}
