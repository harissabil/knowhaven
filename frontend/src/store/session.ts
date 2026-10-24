"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PERSONAS, TENANTS, type Persona, type Tenant } from "@/mock/users";
import type { Role } from "@/lib/permissions";

export type Tier = "hidden" | "gated" | "open";
export interface WContainer { name: string; source: string; tier: Tier; roles: string[] }
export interface Wizard {
  step: number;
  skipped: number[];
  done: number[];
  industry: string;
  industryOther: string;
  roles: string[];
  docs: { name: string; status: "ingesting" | "ready"; at?: number }[];
  integ: Record<string, boolean>;
  containers: WContainer[];
  approver: string;
  topicOwner: string;
  fallback: string;
  pii: string[];
  invites: { code: string; role: string }[];
  invitees: { email: string; role: string; sent: boolean }[];
  tested: boolean;
  integMeta: Record<string, { workspace?: string; lastEvent?: string; lastSync?: string }>;
  ingestLog: { ts: string; src: string; msg: string; ok: boolean }[];
}
export const DEFAULT_ROLES = ["new_hire", "staff", "ops", "hr", "project_mgr", "finance", "director"];
export const newWizard = (tid?: string): Wizard => ({
  step: 0, skipped: [], done: [], industry: "", industryOther: "", roles: tid === "srn" ? [...DEFAULT_ROLES] : [], docs: [], integ: {},
  containers: [], approver: "", topicOwner: "", fallback: "", pii: tid === "srn" ? ["hr"] : [], invites: [], invitees: [], tested: false,
  integMeta: {}, ingestLog: [],
  // demo tenant ships with integrations already connected
  ...(tid === "srn" ? {
    integ: { Slack: true, Atlassian: true },
    integMeta: {
      Slack: { workspace: "srn-nusantara.slack.com", lastEvent: "2 detik lalu" },
      Atlassian: { workspace: "srn.atlassian.net", lastSync: "1 menit lalu" },
    },
    ingestLog: [
      { ts: "09:12:04", src: "Slack", msg: "message #ops-makassar diproses||message #ops-makassar processed", ok: true },
      { ts: "09:11:00", src: "Confluence", msg: "15 halaman disinkronkan||15 pages synced", ok: true },
      { ts: "09:11:00", src: "Jira", msg: "58 issue disinkronkan||58 issues synced", ok: true },
    ],
  } : {}),
});

interface State {
  personaId: string | null;
  tenantId: string | null;
  theme: "light" | "dark";
  lang: "id" | "en";
  fontScale: number;
  customPersonas: Persona[];
  customTenants: (Tenant & { code: string })[];
  wizards: Record<string, Wizard>;
  login: (id: string) => void;
  logout: () => void;
  setTenant: (id: string) => void;
  set: (p: Partial<Pick<State, "theme" | "lang" | "fontScale">>) => void;
  signUp: (name: string, email: string, pw: string) => string | null;
  createCompany: (name: string) => string;
  joinByCode: (code: string) => string | null;
  patchWizard: (tenantId: string, p: Partial<Wizard>) => void;
}

const allPersonas = (custom: Persona[]) => [...PERSONAS, ...custom];

export const useSession = create<State>()(
  persist(
    (set, get) => ({
      personaId: null,
      tenantId: null,
      theme: "light",
      lang: "id",
      fontScale: 1,
      customPersonas: [],
      customTenants: [],
      wizards: {},
      login: (id) => {
        const p = allPersonas(get().customPersonas).find((x) => x.id === id);
        set({ personaId: id, tenantId: p?.memberships[0]?.tenantId ?? null });
      },
      logout: () => set({ personaId: null, tenantId: null }),
      setTenant: (tenantId) => set({ tenantId }),
      set: (p) => set(p),
      signUp: (name, email, pw) => {
        const id = email.trim().toLowerCase();
        if (!id || pw.length < 6) return "Email wajib diisi dan kata sandi minimal 6 karakter.";
        if (allPersonas(get().customPersonas).some((p) => p.id === id)) return "Akun sudah terdaftar.";
        const p: Persona = { id, name, title: "Pengguna baru", password: pw, memberships: [] };
        set({ customPersonas: [...get().customPersonas, p], personaId: id, tenantId: null });
        return null;
      },
      createCompany: (name) => {
        const s = get();
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Math.random().toString(36).slice(2, 5);
        const code = "CMP-" + Math.random().toString(10).slice(2, 6);
        const ownerRoles: Role[] = ["owner", "admin"];
        set({
          customTenants: [...s.customTenants, { id, name, code }],
          customPersonas: s.customPersonas.map((p) =>
            p.id === s.personaId ? { ...p, title: "Owner", memberships: [...p.memberships, { tenantId: id, roles: ownerRoles }] } : p),
          tenantId: id,
          wizards: { ...s.wizards, [id]: newWizard() },
        });
        return id;
      },
      joinByCode: (code) => {
        const s = get();
        const c = code.trim().toUpperCase();
        const target = c === "SRN-4821" ? "srn" : s.customTenants.find((t) => t.code === c)?.id;
        if (!target) return "Kode perusahaan tidak dikenal.";
        set({
          customPersonas: s.customPersonas.map((p) =>
            p.id === s.personaId ? { ...p, memberships: [...p.memberships, { tenantId: target, roles: ["pending" as Role] }] } : p),
          tenantId: target,
        });
        return null;
      },
      patchWizard: (tenantId, p) =>
        set((s) => ({ wizards: { ...s.wizards, [tenantId]: { ...(s.wizards[tenantId] ?? newWizard(tenantId)), ...p } } })),
    }),
    { name: "wb-session" },
  ),
);

export function usePersona(): { persona: Persona | null; roles: Role[] } {
  const { personaId, tenantId, customPersonas } = useSession();
  const persona = allPersonas(customPersonas).find((p) => p.id === personaId) ?? null;
  const roles = persona?.memberships.find((m) => m.tenantId === tenantId)?.roles ?? [];
  return { persona, roles };
}

export function useTenants(): Tenant[] {
  const custom = useSession((s) => s.customTenants);
  return [...TENANTS, ...custom];
}
export function usePersonas(): Persona[] {
  return allPersonas(useSession((s) => s.customPersonas));
}
