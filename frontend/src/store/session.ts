"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role } from "@/lib/permissions";
import { apiFetch, setCsrfToken } from "@/lib/api";

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
export const newWizard = (): Wizard => ({
  step: 0, skipped: [], done: [], industry: "", industryOther: "", roles: [], docs: [], integ: {},
  containers: [], approver: "", topicOwner: "", fallback: "", pii: [], invites: [], invitees: [], tested: false,
  integMeta: {}, ingestLog: [],
});

/** GET /api/me (backend api/auth.py MeOut). The CSRF token is kept in memory only, never persisted. */
export interface MeOut {
  user_id: string;
  email: string;
  name: string;
  csrf_token: string;
  active_tenant: {
    tenant_id: string;
    tenant_name: string;
    status: "active" | "pending" | string;
    roles: string[];
    permission_version: number;
    can_approve: boolean;
  } | null;
  memberships: { tenant_id: string; tenant_name: string; status: string }[];
}
export type CurrentUser = Omit<MeOut, "csrf_token">;

export interface Tenant { id: string; name: string; status: string }
export interface Persona {
  id: string;
  name: string;
  email: string;
  memberships: { tenantId: string; status: string }[];
}

interface State {
  currentUser: CurrentUser | null;
  tenantId: string | null;
  theme: "light" | "dark";
  lang: "id" | "en";
  fontScale: number;
  /** Main sidebar shows icons only. */
  navCollapsed: boolean;
  wizards: Record<string, Wizard>;
  /** Active chat conversation per tenant during this session ("new" = fresh chat, null/undefined = latest). */
  activeConversations: Record<string, string | null>;
  /** Store a MeOut from any endpoint that returns one (login, register, switch, create company). */
  applyMe: (me: MeOut) => CurrentUser;
  syncMe: () => Promise<CurrentUser | null>;
  login: (email: string, password: string) => Promise<CurrentUser>;
  register: (name: string, email: string, password: string) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  setTenant: (id: string) => Promise<void>;
  /** POST /api/tenants: the creator becomes Owner + Admin. Returns the company join code. */
  createCompany: (name: string, industry?: string, industryKey?: string, industryOther?: string) => Promise<{ tenantId: string; joinCode: string }>;
  /** POST /api/tenants/join-code: membership starts pending until an admin approves. */
  joinByCode: (code: string) => Promise<{ tenantId: string; status: string }>;
  set: (p: Partial<Pick<State, "theme" | "lang" | "fontScale" | "navCollapsed">>) => void;
  patchWizard: (tenantId: string, p: Partial<Wizard>) => void;
  setActiveConversation: (tenantId: string, convId: string | null) => void;
}

export const useSession = create<State>()(
  persist(
    (set, get) => ({
      currentUser: null,
      tenantId: null,
      theme: "light",
      lang: "id",
      fontScale: 1,
      navCollapsed: false,
      wizards: {},
      activeConversations: {},
      applyMe: (me) => {
        const { csrf_token, ...user } = me;
        setCsrfToken(csrf_token);
        set({ currentUser: user, tenantId: user.active_tenant?.tenant_id ?? null });
        return user;
      },
      syncMe: async () => {
        try {
          return get().applyMe(await apiFetch<MeOut>("/api/me"));
        } catch {
          setCsrfToken(null);
          set({ currentUser: null, tenantId: null });
          return null;
        }
      },
      login: async (email, password) => {
        set({ activeConversations: {} });
        return get().applyMe(await apiFetch<MeOut>("/api/auth/login", {
          method: "POST", body: JSON.stringify({ email: email.trim(), password }),
        }));
      },
      register: async (name, email, password) => {
        set({ activeConversations: {} });
        return get().applyMe(await apiFetch<MeOut>("/api/auth/register", {
          method: "POST", body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
        }));
      },
      logout: async () => {
        try {
          await apiFetch("/api/auth/logout", { method: "POST" });
        } catch {
          // the session may already be gone; clear local state regardless
        } finally {
          setCsrfToken(null);
          set({ currentUser: null, tenantId: null, activeConversations: {} });
        }
      },
      setTenant: async (tenantId) => {
        get().applyMe(await apiFetch<MeOut>("/api/tenants/switch", {
          method: "POST", body: JSON.stringify({ tenant_id: tenantId }),
        }));
      },
      createCompany: async (name, industry, industryKey, industryOther) => {
        const res = await apiFetch<{ tenant_id: string; join_code: string; me: MeOut }>("/api/tenants", {
          method: "POST", body: JSON.stringify({ name: name.trim(), industry: industry?.trim() || undefined }),
        });
        get().applyMe(res.me);
        const w = newWizard();
        if (industryKey) {
          w.industry = industryKey;
          w.industryOther = industryOther ?? "";
          w.done = [0];
        }
        set((s) => ({ wizards: { ...s.wizards, [res.tenant_id]: w } }));
        return { tenantId: res.tenant_id, joinCode: res.join_code };
      },
      joinByCode: async (code) => {
        const res = await apiFetch<{ tenant_id: string; status: string }>("/api/tenants/join-code", {
          method: "POST", body: JSON.stringify({ code: code.trim() }),
        });
        await get().syncMe();
        return { tenantId: res.tenant_id, status: res.status };
      },
      set: (p) => set(p),
      patchWizard: (tenantId, p) =>
        set((s) => ({ wizards: { ...s.wizards, [tenantId]: { ...(s.wizards[tenantId] ?? newWizard()), ...p } } })),
      setActiveConversation: (tenantId, convId) =>
        set((s) => ({ activeConversations: { ...s.activeConversations, [tenantId]: convId } })),
    }),
    {
      name: "wb-session",
      version: 2, // v1 stored mock personas and a bearer token; drop it
      migrate: () => ({}) as State,
      partialize: (s) => ({
        currentUser: s.currentUser, tenantId: s.tenantId, theme: s.theme, lang: s.lang,
        fontScale: s.fontScale, navCollapsed: s.navCollapsed, wizards: s.wizards, activeConversations: s.activeConversations,
      }),
    },
  ),
);

/** Roles in the active tenant; a pending membership has only the "pending" pseudo-role. */
export function usePersona(): { persona: Persona | null; roles: Role[]; canApprove: boolean } {
  const currentUser = useSession((s) => s.currentUser);
  if (!currentUser) return { persona: null, roles: [], canApprove: false };
  const active = currentUser.active_tenant;
  const roles = (!active ? [] : active.status === "pending" ? ["pending"] : active.roles) as Role[];
  const persona: Persona = {
    id: currentUser.user_id,
    name: currentUser.name,
    email: currentUser.email,
    memberships: currentUser.memberships.map((m) => ({ tenantId: m.tenant_id, status: m.status })),
  };
  return { persona, roles, canApprove: !!active?.can_approve };
}

export function useTenants(): Tenant[] {
  const currentUser = useSession((s) => s.currentUser);
  return (currentUser?.memberships ?? []).map((m) => ({ id: m.tenant_id, name: m.tenant_name, status: m.status }));
}
