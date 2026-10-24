import type { Role } from "@/lib/permissions";

export interface Tenant { id: string; name: string }
export interface Persona {
  id: string;
  name: string;
  title: string;
  password: string;
  memberships: { tenantId: string; roles: Role[] }[];
}

export const TENANTS: Tenant[] = [
  { id: "srn", name: "PT Sinar Rantai Nusantara" },
  { id: "klm", name: "CV Kopi Lereng Merapi" },
];

// Demo passwords are shown on the login page on purpose (doc §14.3).
export const PERSONAS: Persona[] = [
  { id: "dimas", name: "Dimas Pratama", title: "Karyawan Baru", password: "demo-dimas",
    memberships: [{ tenantId: "srn", roles: ["new_hire", "staff"] }] },
  { id: "rina", name: "Rina Wulandari", title: "Staf Ops Makassar", password: "demo-rina",
    memberships: [{ tenantId: "srn", roles: ["staff", "ops"] }] },
  { id: "andi", name: "Andi Saputra", title: "Project Manager", password: "demo-andi",
    memberships: [{ tenantId: "srn", roles: ["project_mgr"] }] },
  { id: "sari", name: "Sari Kusuma", title: "HR", password: "demo-sari",
    memberships: [{ tenantId: "srn", roles: ["hr"] }] },
  { id: "budi", name: "Budi Hartono", title: "Manajer Operasional", password: "demo-budi",
    memberships: [{ tenantId: "srn", roles: ["ops", "approver"] }] },
  { id: "lina", name: "Lina Marpaung", title: "Auditor", password: "demo-lina",
    memberships: [{ tenantId: "srn", roles: ["auditor"] }] },
  { id: "admin", name: "Admin SRN", title: "Owner", password: "demo-admin",
    memberships: [{ tenantId: "srn", roles: ["owner", "admin"] }] },
  { id: "yoga", name: "Yoga Prasetyo", title: "Konsultan", password: "demo-yoga",
    memberships: [
      { tenantId: "srn", roles: ["staff"] },
      { tenantId: "klm", roles: ["admin"] },
    ] },
  { id: "newbie", name: "Calon Anggota", title: "Menunggu persetujuan", password: "demo-pending",
    memberships: [{ tenantId: "srn", roles: ["pending"] }] },
];
