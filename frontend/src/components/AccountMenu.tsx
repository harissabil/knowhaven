"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, KeyRound, LogOut, Plus, Repeat } from "lucide-react";
import { useSession, type CurrentUser } from "@/store/session";
import { useL, useT } from "@/lib/i18n";

const ITEM = "flex items-center gap-2.5 px-3 py-2 rounded-full text-[0.95rem] text-muted hover:bg-surface2 hover:text-fg transition-colors text-left";

/** Signed-in user on the public pages: who they are, plus joining or creating a company. */
export function AccountMenu({ user }: { user: CurrentUser }) {
  const logout = useSession((s) => s.logout);
  const router = useRouter();
  const l = useL();
  const t = useT();
  const [open, setOpen] = useState(false);
  const company = user.active_tenant?.tenant_name;

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden className="w-6 h-6 -ml-1 rounded-full bg-tint text-brand grid place-items-center text-xs font-semibold">
          {user.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="hidden xl:inline max-w-28 truncate">{user.name.split(" ")[0]}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full pt-2 z-30 min-w-64">
          <div role="menu" className="rounded-xl border border-line bg-surface shadow-lg p-2 flex flex-col gap-1">
            <div className="px-3 pt-2 pb-3 border-b border-line mb-1.5">
              <div className="font-medium truncate">{user.name}</div>
              <div className="text-sm text-muted truncate">{user.email}</div>
              {company && <div className="text-sm text-muted truncate mt-1">{company}</div>}
            </div>
            <Link role="menuitem" className={ITEM} href="/onboarding?step=join"><KeyRound size={16} /> {l("Gabung dengan kode", "Join with a code")}</Link>
            <Link role="menuitem" className={ITEM} href="/onboarding?step=company"><Plus size={16} /> {l("Buat perusahaan baru", "Create a new company")}</Link>
            <div className="border-t border-line my-1" />
            <button role="menuitem" className={ITEM} onClick={async () => { await logout(); router.push("/login"); }}>
              <Repeat size={16} /> {l("Ganti akun", "Switch account")}
            </button>
            <button role="menuitem" className={ITEM} onClick={() => { setOpen(false); logout(); }}>
              <LogOut size={16} /> {t("logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
