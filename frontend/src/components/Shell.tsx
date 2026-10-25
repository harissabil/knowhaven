"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageSquare, CheckSquare, Users, Shield, Plug, Upload, ScrollText, FlaskConical, LogOut, Settings, FolderOpen, UserPlus, UserCog, User, ChevronDown, BookOpen, EyeOff, Building2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSession, usePersona, useTenants } from "@/store/session";
import { can, NAV, NAV_SECTIONS } from "@/lib/permissions";
import { motion } from "framer-motion";
import { useL, useT, type Key } from "@/lib/i18n";
import { RoleChip } from "@/components/Chip";
import { KnowhavenLogo, WorkBuddyLogo } from "@/components/BrandLogos";
import { Launcher, Palette } from "@/components/Extras";

const ICON: Record<string, React.ReactNode> = {
  chat: <MessageSquare size={18} />, approvals: <CheckSquare size={18} />, company: <Building2 size={18} />, members: <Users size={18} />,
  containers: <Shield size={18} />, integrations: <Plug size={18} />, upload: <Upload size={18} />,
  audit: <ScrollText size={18} />, tests: <FlaskConical size={18} />, workbuddy: <WorkBuddyLogo size={18} />,
  settings: <Settings size={18} />, documents: <FolderOpen size={18} />,
  invites: <UserPlus size={18} />, managers: <UserCog size={18} />, topics: <BookOpen size={18} />, pii: <EyeOff size={18} />,
};

export function Shell({ children, title, fullBleed }: { children: React.ReactNode; title?: string; fullBleed?: boolean }) {
  const s = useSession();
  const { persona, roles, canApprove } = usePersona();
  const t = useT();
  const l = useL();
  const allTenants = useTenants();
  const path = usePathname();
  const router = useRouter();

  const syncMe = s.syncMe;
  const [checked, setChecked] = useState(false);
  const [switchErr, setSwitchErr] = useState("");
  const [menu, setMenu] = useState(false);
  // The persisted user is only a hint: confirm the cookie session (and get a CSRF token) on load.
  useEffect(() => { syncMe().finally(() => setChecked(true)); }, [syncMe]);

  const pending = roles.length === 1 && roles[0] === "pending";
  useEffect(() => {
    if (!checked) return;
    if (!persona) router.replace("/login");
    else if (persona.memberships.length === 0 || !s.currentUser?.active_tenant) router.replace("/onboarding");
    else if (pending && path !== "/pending") router.replace("/pending");
  }, [checked, persona, pending, path, router, s.currentUser]);

  if (!persona) return null;
  const items = NAV.filter((n) => !n.cap || can(roles, n.cap, canApprove));
  const myTenants = allTenants;
  const tenantName = s.currentUser?.active_tenant?.tenant_name ?? "";
  const sel = "input !w-auto";
  const SECTION_LABEL = { daily: l("Pekerjaan harian", "Daily work"), manage: l("Kelola perusahaan", "Manage company"), monitor: l("Pemantauan", "Monitoring"), account: l("Akun saya", "My account") };
  const wizard = path.startsWith("/admin/setup");
  const collapsed = s.navCollapsed;
  const guard = NAV.find((n) => path.startsWith(n.href));
  const allowed = !guard?.cap || can(roles, guard.cap, canApprove);

  return (
    <div className={`flex ${fullBleed ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      {!wizard && <aside className={`${collapsed ? "w-[4.5rem] px-2.5" : "w-64 px-4"} py-4 shrink-0 border-r border-line bg-surface hidden md:flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto overflow-x-hidden transition-[width] duration-200`}>
        <div className={`flex items-center mb-5 ${collapsed ? "flex-col gap-3" : "gap-2"}`}>
          <Link href="/" className="flex items-center gap-2.5 font-semibold text-lg tracking-tight flex-1 min-w-0" title="Knowhaven" aria-label="Knowhaven">
            <KnowhavenLogo size={28} /> {!collapsed && "Knowhaven"}
          </Link>
          <button className="p-1.5 rounded-lg text-muted hover:bg-surface2 hover:text-fg transition-colors"
            onClick={() => s.set({ navCollapsed: !collapsed })}
            aria-label={collapsed ? l("Buka sidebar", "Expand sidebar") : l("Ciutkan sidebar", "Collapse sidebar")}
            title={collapsed ? l("Buka sidebar", "Expand sidebar") : l("Ciutkan sidebar", "Collapse sidebar")}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        {NAV_SECTIONS.map((sec, i) => {
          const group = items.filter((n) => n.section === sec);
          if (!group.length) return null;
          return (
            <div key={sec} className="mt-3 first:mt-0 flex flex-col gap-1" role="group" aria-label={SECTION_LABEL[sec]}>
              {collapsed
                ? i > 0 && <div className="mx-2 mb-1 border-t border-line" aria-hidden />
                : <div className="px-3.5 pb-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted/70">{SECTION_LABEL[sec]}</div>}
              {group.map((n) => {
                const active = n.href === "/settings" ? path === "/settings" : path.startsWith(n.href);
                const label = t(n.id as Key);
                return (
                  <Link key={n.id} href={n.href} aria-current={active ? "page" : undefined}
                    title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}
                    className={`flex items-center gap-2.5 py-2 rounded-full text-[0.95rem] transition-colors ${collapsed ? "justify-center px-0" : "px-3.5"} ${active ? "bg-tint text-brand font-medium" : "text-muted hover:bg-surface2 hover:text-fg"}`}>
                    {ICON[n.id]} {!collapsed && label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </aside>}
      <div className={`flex-1 flex flex-col min-w-0 ${fullBleed ? "h-full overflow-hidden" : ""}`}>
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-bg/80 backdrop-blur-md px-5 py-3 shrink-0">
          {wizard ? <span className="flex items-center gap-2.5 font-bold"><KnowhavenLogo size={28} /> Knowhaven</span> : (
            <select className={sel} aria-label={t("tenant")} value={s.tenantId ?? ""} onChange={(e) => { setSwitchErr(""); s.setTenant(e.target.value).catch((x) => setSwitchErr(String(x?.message ?? x))); }}>
              {myTenants.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status === "pending" ? ` (${l("menunggu", "pending")})` : ""}</option>)}
            </select>
          )}
          {switchErr && <span role="alert" className="text-sm text-bad">{switchErr}</span>}
          <div className="flex-1" />
          {!wizard && <Palette />}
          <button className="btn" onClick={() => s.set({ lang: s.lang === "id" ? "en" : "id" })}>{s.lang === "id" ? "EN" : "ID"}</button>
          <div className="relative group" onMouseEnter={() => setMenu(true)} onMouseLeave={() => setMenu(false)}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setMenu(false); }}>
            <button className="btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              <User size={16} /> {persona.name} <ChevronDown size={14} className={`transition-transform ${menu ? "rotate-180" : ""}`} />
            </button>
            {menu && (
              <div className="absolute right-0 top-full pt-2 z-20 min-w-56">
                <div role="menu" className="rounded-xl border border-line bg-surface shadow-lg p-2 flex flex-col gap-1">
                  <div className="px-3 pt-3 pb-3.5 border-b border-line mb-1.5">
                    <div className="text-xs text-muted">{l("Peran Anda", "Your role")}</div>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {roles.map((r) => <RoleChip key={r} role={r} system={["owner", "admin", "auditor"].includes(r)} />)}
                    </div>
                  </div>
                  <button role="menuitem" className="flex items-center gap-2.5 px-3 py-2 rounded-full text-[0.95rem] text-muted hover:bg-surface2 hover:text-fg transition-colors text-left"
                    onClick={async () => { await s.logout(); router.push("/login"); }}>
                    <LogOut size={16} /> {t("logout")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </header>
        <motion.main
          className={fullBleed ? "flex-1 flex flex-col min-h-0 w-full overflow-hidden" : "p-6 md:p-8 flex-1 w-full max-w-6xl mx-auto"}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {!fullBleed && <nav aria-label="breadcrumb" className="text-xs text-muted mb-1">{tenantName} / {title}</nav>}
          {!fullBleed && title && <h1 className="text-3xl md:text-4xl font-semibold mb-7">{title}</h1>}
          {allowed ? children : <p role="alert" className="text-bad">{l("Anda tidak punya akses ke halaman ini.", "You do not have access to this page.")}</p>}
        </motion.main>
        {!path.startsWith("/chat") && <Launcher />}
      </div>
    </div>
  );
}
