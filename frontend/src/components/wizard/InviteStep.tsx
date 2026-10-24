"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Mail, Send, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import type { Wizard } from "@/store/session";
import { useL } from "@/lib/i18n";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function InviteStep({ w, patch }: { w: Wizard; patch: (p: Partial<Wizard>) => void }) {
  const l = useL();
  const [role, setRole] = useState(w.roles[0] ?? "staff");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const addInvitee = () => {
    const e = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(e) || w.invitees.some((x) => x.email === e)) return;
    patch({ invitees: [...w.invitees, { email: e, role, sent: false }] });
    setEmail("");
  };
  async function sendAll() {
    setSending(true);
    let list = w.invitees.map((x) => ({ ...x }));
    for (let i = 0; i < list.length; i++) {
      if (list[i].sent) continue;
      await sleep(550);
      list = list.map((x, j) => (j === i ? { ...x, sent: true } : x));
      patch({ invitees: list });
    }
    setSending(false);
    toast(l("Undangan terkirim", "Invitations sent"));
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
    toast(l("Link disalin", "Link copied"));
  };
  const pending = w.invitees.filter((x) => !x.sent).length;

  if (!w.roles.length) return <p className="text-muted">{l("Tambahkan peran di langkah Peran dulu.", "Add roles in the Roles step first.")}</p>;
  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="flex flex-col gap-3">
        <p className="eyebrow">{l("Undang lewat email", "Invite by email")}</p>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); addInvitee(); }}>
          <input className="input flex-1 min-w-[180px]" type="email" aria-label="Email" placeholder="nama@perusahaan.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="input !w-auto" aria-label={l("Peran awal", "Starting role")} value={role} onChange={(e) => setRole(e.target.value)}>{w.roles.map((r) => <option key={r}>{r}</option>)}</select>
          <button className="btn">{l("Tambah", "Add")}</button>
        </form>
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {w.invitees.map((x) => (
              <motion.li key={x.email} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: 20 }} className="card p-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-tint text-brand grid place-items-center"><Mail size={16} /></span>
                <span className="flex-1 min-w-0"><span className="block truncate font-medium">{x.email}</span><span className="eyebrow">{x.role}</span></span>
                {x.sent
                  ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-ok flex items-center gap-1 text-sm"><Check size={16} /> {l("Terkirim", "Sent")}</motion.span>
                  : <button aria-label={l("Hapus", "Remove")} className="text-muted hover:text-fg" onClick={() => patch({ invitees: w.invitees.filter((y) => y.email !== x.email) })}><X size={16} /></button>}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <button className="btn btn-primary w-fit" disabled={!pending || sending} onClick={sendAll}><Send size={16} /> {sending ? l("Mengirim…", "Sending…") : l(`Kirim ${pending || ""} undangan`, `Send ${pending || ""} invitation(s)`)}</button>
      </div>

      <div className="flex flex-col gap-3">
        <p className="eyebrow">{l("Atau bagikan link", "Or share a link")}</p>
        <button className="btn btn-primary w-fit" onClick={() => patch({ invites: [{ code: "INV-" + Math.random().toString(36).slice(2, 6).toUpperCase(), role }, ...w.invites] })}>{l("Buat link undangan", "Create invite link")}</button>
        <AnimatePresence initial={false}>
          {w.invites.map((i) => (
            <motion.div key={i.code} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <div className="card">
                <div className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm truncate">{origin}/join/{i.code}</p>
                    <p className="eyebrow mt-0.5">{l("peran awal", "starting role")}: {i.role}</p>
                    <button className="btn !py-1 mt-2" onClick={() => copy(`${origin}/join/${i.code}`)}><Copy size={14} /> {l("Salin", "Copy")}</button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {!w.invites.length && <p className="text-sm text-muted">{l("Link bisa dipakai banyak orang dan bisa dicabut kapan saja.", "A link works for many people and can be revoked anytime.")}</p>}
      </div>
    </div>
  );
}
