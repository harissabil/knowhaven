"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageSquare, CheckSquare, Users, Shield, Plug, Upload, ScrollText, FlaskConical, KeyRound, LogOut, Settings, FolderOpen } from "lucide-react";
import { useSession, usePersona, useTenants } from "@/store/session";
import { can, NAV } from "@/lib/permissions";
import { motion } from "framer-motion";
import { useL, useT, type Key } from "@/lib/i18n";
import { Mascot } from "@/components/mascot/Mascot";
import { Launcher, Palette } from "@/components/Extras";

const ICON: Record<string, React.ReactNode> = {
  chat: <MessageSquare size={18} />, approvals: <CheckSquare size={18} />, members: <Users size={18} />,
  containers: <Shield size={18} />, integrations: <Plug size={18} />, upload: <Upload size={18} />,
  audit: <ScrollText size={18} />, tests: <FlaskConical size={18} />, workbuddy: <KeyRound size={18} />,
  settings: <Settings size={18} />, documents: <FolderOpen size={18} />,
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
  const wizard = path.startsWith("/admin/setup");
  const guard = NAV.find((n) => path.startsWith(n.href));
  const allowed = !guard?.cap || can(roles, guard.cap, canApprove);

  return (
    <div className={`flex ${fullBleed ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      {!wizard && <aside className="w-64 shrink-0 border-r border-line bg-surface p-4 hidden md:flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto">
        <Link href="/" className="flex items-center gap-2 mb-5 font-semibold text-lg tracking-tight">
          <Mascot size={44} /> Knowhaven
        </Link>
        {items.map((n) => {
          const active = n.href === "/settings" ? path === "/settings" : path.startsWith(n.href);
          return (
            <Link key={n.id} href={n.href}
              className={`flex items-center gap-2.5 px-3.5 py-2 rounded-full text-[0.95rem] transition-colors ${active ? "bg-tint text-brand font-medium" : "text-muted hover:bg-surface2 hover:text-fg"}`}>
              {ICON[n.id]} {t(n.id as Key)}
            </Link>
          );
        })}
      </aside>}
      <div className={`flex-1 flex flex-col min-w-0 ${fullBleed ? "h-full overflow-hidden" : ""}`}>
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-bg/80 backdrop-blur-md px-5 py-3 shrink-0">
          {wizard ? <span className="flex items-center gap-2 font-bold"><Mascot size={36} /> Knowhaven</span> : (
            <select className={sel} aria-label={t("tenant")} value={s.tenantId ?? ""} onChange={(e) => { setSwitchErr(""); s.setTenant(e.target.value).catch((x) => setSwitchErr(String(x?.message ?? x))); }}>
              {myTenants.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status === "pending" ? ` (${l("menunggu", "pending")})` : ""}</option>)}
            </select>
          )}
          {switchErr && <span role="alert" className="text-sm text-bad">{switchErr}</span>}
          <div className="flex-1" />
          {!wizard && <Palette />}
          <button className="btn" onClick={() => s.set({ lang: s.lang === "id" ? "en" : "id" })}>{s.lang === "id" ? "EN" : "ID"}</button>
          <span className="text-sm text-muted">{persona.name} · {roles.join(", ")}</span>
          <button className="btn" onClick={async () => { await s.logout(); router.push("/login"); }}><LogOut size={16} /> {t("logout")}</button>
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
