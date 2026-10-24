"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { MessageSquare, CheckSquare, Users, Shield, Plug, Upload, ScrollText, FlaskConical, KeyRound, LogOut, Sun, Moon } from "lucide-react";
import { useSession, usePersona } from "@/store/session";
import { can, NAV } from "@/lib/permissions";
import { motion } from "framer-motion";
import { useL, useT, type Key } from "@/lib/i18n";
import { useTenants } from "@/store/session";
import { Mascot } from "@/components/mascot/Mascot";
import { Launcher, Palette } from "@/components/Extras";

const ICON: Record<string, React.ReactNode> = {
  chat: <MessageSquare size={18} />, approvals: <CheckSquare size={18} />, members: <Users size={18} />,
  containers: <Shield size={18} />, integrations: <Plug size={18} />, upload: <Upload size={18} />,
  audit: <ScrollText size={18} />, tests: <FlaskConical size={18} />, workbuddy: <KeyRound size={18} />,
};

export function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  const s = useSession();
  const { persona, roles } = usePersona();
  const t = useT();
  const l = useL();
  const allTenants = useTenants();
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!persona) router.replace("/login");
    else if (persona.memberships.length === 0) router.replace("/onboarding");
    else if (roles.length === 1 && roles[0] === "pending" && path !== "/pending") router.replace("/pending");
  }, [persona, roles, path, router]);

  if (!persona) return null;
  const items = NAV.filter((n) => !n.cap || can(roles, n.cap));
  const myTenants = allTenants.filter((x) => persona.memberships.some((m) => m.tenantId === x.id));
  const sel = "input !w-auto";
  const wizard = path.startsWith("/admin/setup");
  const guard = NAV.find((n) => path.startsWith(n.href));
  const allowed = !guard?.cap || can(roles, guard.cap);

  return (
    <div className="flex min-h-screen">
      {!wizard && <aside className="w-64 shrink-0 border-r border-line bg-surface p-4 hidden md:flex flex-col gap-1 sticky top-0 h-screen overflow-y-auto">
        <Link href="/" className="flex items-center gap-2 mb-5 font-semibold text-lg tracking-tight">
          <Mascot size={44} /> Knowhaven
        </Link>
        {items.map((n) => (
          <Link key={n.id} href={n.href}
            className={`flex items-center gap-2.5 px-3.5 py-2 rounded-full text-[0.95rem] transition-colors ${path.startsWith(n.href) ? "bg-tint text-brand font-medium" : "text-muted hover:bg-surface2 hover:text-fg"}`}>
            {ICON[n.id]} {t(n.id as Key)}
          </Link>
        ))}
      </aside>}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-bg/80 backdrop-blur-md px-5 py-3">
          {wizard ? <span className="flex items-center gap-2 font-bold"><Mascot size={36} /> Knowhaven</span> : (
          <select className={sel} aria-label={t("tenant")} value={s.tenantId ?? ""} onChange={(e) => s.setTenant(e.target.value)}>
              {myTenants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <div className="flex-1" />
          {!wizard && <Palette />}
          <button className="btn" onClick={() => s.set({ theme: s.theme === "light" ? "dark" : "light" })}>
            {s.theme === "light" ? <Moon size={16} /> : <Sun size={16} />} {s.theme === "light" ? t("dark") : t("light")}
          </button>
          <button className="btn" onClick={() => s.set({ fontScale: Math.max(0.85, s.fontScale - 0.1) })}>A−</button>
          <button className="btn" onClick={() => s.set({ fontScale: Math.min(1.5, s.fontScale + 0.1) })}>A+</button>
          <button className="btn" onClick={() => s.set({ lang: s.lang === "id" ? "en" : "id" })}>{s.lang === "id" ? "EN" : "ID"}</button>
          <span className="text-sm text-muted">{persona.name} · {roles.join(", ")}</span>
          <button className="btn" onClick={() => { s.logout(); router.push("/login"); }}><LogOut size={16} /> {t("logout")}</button>
        </header>
        <motion.main className="p-6 md:p-8 flex-1 w-full max-w-6xl mx-auto" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}>
          <nav aria-label="breadcrumb" className="text-xs text-muted mb-1">{s.tenantId?.toUpperCase()} / {title}</nav>
          {title && <h1 className="text-3xl md:text-4xl font-semibold mb-7">{title}</h1>}
          {allowed ? children : <p role="alert" className="text-bad">{l("Anda tidak punya akses ke halaman ini.", "You do not have access to this page.")}</p>}
        </motion.main>
        {!path.startsWith("/chat") && <Launcher />}
      </div>
    </div>
  );
}
