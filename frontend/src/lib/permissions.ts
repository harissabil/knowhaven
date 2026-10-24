export type Role =
  | "owner" | "admin" | "auditor" | "hr"
  | "staff" | "new_hire" | "ops" | "project_mgr" | "pending" | (string & {});

export type Cap =
  | "chat" | "admin" | "upload" | "approve" | "audit" | "pii" | "request_access";

const has = (roles: Role[], ...r: Role[]) => r.some((x) => roles.includes(x));

/** Role matrix from design doc §4.3. `canApprove` is computed by the backend (/api/me
 * active_tenant.can_approve: admin, manager, topic owner or container owner). The server
 * enforces every rule again; this only decides what the UI shows. */
export function can(roles: Role[], cap: Cap, canApprove = false): boolean {
  if (roles.length === 0 || (has(roles, "pending") && roles.length === 1)) return false;
  switch (cap) {
    case "chat":
    case "request_access":
      return true;
    case "admin":
      return has(roles, "owner", "admin");
    case "upload":
      return has(roles, "owner", "admin", "hr") || canApprove;
    case "approve":
      return canApprove;
    case "audit":
      return has(roles, "auditor");
    case "pii":
      return has(roles, "hr");
  }
}

export type NavSection = "daily" | "manage" | "monitor" | "account";
export interface NavItem { href: string; id: string; cap?: Cap; section: NavSection }

/** Sidebar order = urgency. Sections run from "needs action now" to "set once and forget";
 * inside a section, items are ordered by how often/urgently they are needed. */
export const NAV_SECTIONS: NavSection[] = ["daily", "manage", "monitor", "account"];
export const NAV: NavItem[] = [
  // Daily work: Ask Havi is the main entry point, then approvals (someone is waiting), then documents.
  { href: "/chat", id: "chat", cap: "chat", section: "daily" },
  { href: "/approvals", id: "approvals", cap: "approve", section: "daily" },
  { href: "/documents", id: "documents", cap: "chat", section: "daily" },
  // Manage the company: people first (pending members / invites), then rules, then data.
  { href: "/admin/members", id: "members", cap: "admin", section: "manage" },
  { href: "/admin/invites", id: "invites", cap: "admin", section: "manage" },
  { href: "/admin/upload", id: "upload", cap: "upload", section: "manage" },
  { href: "/admin/containers", id: "containers", cap: "admin", section: "manage" },
  { href: "/admin/managers", id: "managers", cap: "admin", section: "manage" },
  { href: "/admin/topics", id: "topics", cap: "admin", section: "manage" },
  { href: "/admin/pii", id: "pii", cap: "admin", section: "manage" },
  { href: "/admin/integrations", id: "integrations", cap: "admin", section: "manage" },
  // Monitoring
  { href: "/audit", id: "audit", cap: "audit", section: "monitor" },
  // Account: set once
  { href: "/settings", id: "settings", section: "account" },
  { href: "/settings/workbuddy", id: "workbuddy", cap: "chat", section: "account" },
];