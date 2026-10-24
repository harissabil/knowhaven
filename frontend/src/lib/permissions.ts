export type Role =
  | "owner" | "admin" | "auditor" | "hr"
  | "staff" | "new_hire" | "ops" | "project_mgr" | "pending" | (string & {});

export type Cap =
  | "chat" | "admin" | "upload" | "approve" | "audit" | "tests" | "pii" | "request_access";

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
    case "tests":
      return has(roles, "owner", "admin", "auditor");
    case "pii":
      return has(roles, "hr");
  }
}

export interface NavItem { href: string; id: string; cap?: Cap }
export const NAV: NavItem[] = [
  { href: "/chat", id: "chat", cap: "chat" },
  { href: "/approvals", id: "approvals", cap: "approve" },
  { href: "/admin/members", id: "members", cap: "admin" },
  { href: "/admin/containers", id: "containers", cap: "admin" },
  { href: "/admin/integrations", id: "integrations", cap: "admin" },
  { href: "/admin/invites", id: "invites", cap: "admin" },
  { href: "/admin/managers", id: "managers", cap: "admin" },
  { href: "/admin/topics", id: "topics", cap: "admin" },
  { href: "/admin/pii", id: "pii", cap: "admin" },
  { href: "/admin/upload", id: "upload", cap: "upload" },
  { href: "/audit", id: "audit", cap: "audit" },
  { href: "/tests", id: "tests", cap: "tests" },
  { href: "/settings", id: "settings" },
  { href: "/settings/workbuddy", id: "workbuddy", cap: "chat" },
];
