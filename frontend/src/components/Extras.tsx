"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Mascot } from "@/components/mascot/Mascot";
import { NAV, can } from "@/lib/permissions";
import { useL, useT, type Key } from "@/lib/i18n";
import { usePersona } from "@/store/session";

/** Floating assistant launcher (bottom-right) that jumps to chat. */
export function Launcher() {
  const t = useT();
  return (
    <Link href="/chat" aria-label={t("chat")} className="fixed bottom-4 right-4 card flex items-center gap-2 pr-3 hover:brightness-95">
      <Mascot size={52} /> <span className="font-semibold">{t("chat")}</span>
    </Link>
  );
}

/** Ctrl+K command palette over role-visible pages. */
export function Palette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const t = useT();
  const l = useL();
  const router = useRouter();
  const { roles, canApprove } = usePersona();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const items = NAV.filter((n) => (!n.cap || can(roles, n.cap, canApprove)) && t(n.id as Key).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}><Search size={16} /> {l("Cari", "Search")} <kbd className="text-xs">Ctrl+K</kbd></button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-start pt-24 justify-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label="Command palette" className="card w-[min(32rem,92vw)] p-2" onClick={(e) => e.stopPropagation()}>
            <input autoFocus className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={l("Ke halaman…", "Go to page…")} />
            <ul className="mt-2">
              {items.map((n) => (
                <li key={n.id}><button className="w-full text-left px-3 py-2 hover:bg-surface2 rounded-erp" onClick={() => { setOpen(false); router.push(n.href); }}>{t(n.id as Key)}</button></li>
              ))}
              {!items.length && <li className="px-3 py-2 text-muted">{l("Tidak ada hasil", "No results")}</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
