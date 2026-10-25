"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/store/session";
import { useL, useT } from "@/lib/i18n";
import { Mascot, SpeechBubble } from "@/components/mascot/Mascot";
import { KnowhavenLogo } from "@/components/BrandLogos";
import { ApiError, errorText } from "@/lib/api";

// Seeded demo accounts (backend/seed/*/manifest.json). Shown on purpose (doc §14.3); these are
// ordinary per-user passwords, there is no shared master password.
const DEMO: { email: string; password: string; id: string; en: string }[] = [
  { email: "dimas@srn-demo.id", password: "Demo-SRN-2026!", id: "Karyawan baru · gudang Jakarta", en: "New hire · Jakarta warehouse" },
  { email: "rina@srn-demo.id", password: "Demo-SRN-2026!", id: "Staf operasional · cabang Makassar", en: "Operations staff · Makassar branch" },
  { email: "sari@srn-demo.id", password: "Demo-SRN-2026!", id: "HR Manager · akses data pribadi", en: "HR Manager · personal-data access" },
  { email: "bambang@srn-demo.id", password: "Demo-SRN-2026!", id: "Direktur Utama · owner, admin, auditor", en: "CEO · owner, admin, auditor" },
  { email: "yoga@konsultan-demo.id", password: "Demo-Konsultan-2026!", id: "Konsultan eksternal · 2 perusahaan", en: "External consultant · 2 companies" },
];

export default function Login() {
  const router = useRouter();
  const { login, lang, set } = useSession();
  const t = useT();
  const l = useL();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const me = await login(email, pw);
      const active = me.active_tenant;
      const next = new URLSearchParams(window.location.search).get("next");
      if (next?.startsWith("/join/")) return router.push(next); // only same-site invite links
      router.push(!me.memberships.length || !active ? "/onboarding" : active.status === "pending" ? "/pending" : "/chat");
    } catch (x) {
      setErr(x instanceof ApiError && (x.status === 401 || x.status === 422)
        ? l("Email atau kata sandi salah.", "Wrong email or password.")
        : l(`Server tidak bisa dihubungi: ${errorText(x)}`, `Could not reach the server: ${errorText(x)}`));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="relative hidden md:flex flex-col items-center justify-center gap-6 p-10 text-center overflow-hidden border-r border-line bg-tint"
        style={{ backgroundImage: "radial-gradient(var(--border-strong) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
        <Link href="/" className="absolute top-6 left-6 flex items-center gap-2.5 font-semibold text-lg tracking-tight"><KnowhavenLogo size={26} /> Knowhaven</Link>
        <motion.div animate={{ y: [0, -12, 0] }} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}><Mascot size={220} state="idle" /></motion.div>
        <SpeechBubble>
          {l("Halo! Saya ", "Hi! I'm ")}<b>Havi</b>
          {l(". Saya menjawab dari chat, dokumen, dan task, dan selalu patuh pada batas akses Anda.",
            ". I answer from chats, documents, and tasks, and always respect your access limits.")}
        </SpeechBubble>
      </div>
      <motion.div className="flex flex-col gap-4 p-6 md:p-12 justify-center max-w-xl w-full mx-auto" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <form onSubmit={submit} className="card p-6 flex flex-col gap-3">
          <div className="flex items-center">
            <h1 className="text-3xl flex-1">{l("Masuk ke Knowhaven", "Sign in to Knowhaven")}</h1>
            <button type="button" className="btn" onClick={() => set({ lang: lang === "id" ? "en" : "id" })}>{lang === "id" ? "EN" : "ID"}</button>
          </div>
          <label className="flex flex-col gap-1">Email
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dimas@srn-demo.id" disabled={loading} required /></label>
          <label className="flex flex-col gap-1">{l("Kata sandi", "Password")}
            <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={loading} required /></label>
          {err && <p role="alert" className="text-bad">{err}</p>}
          <button className="btn btn-primary btn-lg justify-center" disabled={loading}>
            {loading ? l("Memverifikasi…", "Verifying…") : t("login")}
          </button>
          <p className="text-sm text-muted text-center">{l("Belum punya akun?", "No account yet?")} <Link className="underline text-fg" href="/onboarding">{l("Daftar", "Sign up")}</Link></p>
        </form>
        <div className="card p-5">
          <h2 className="eyebrow mb-2">{t("demoAccounts")}</h2>
          <table className="w-full text-sm">
            <tbody>
              {DEMO.map((p) => (
                <tr key={p.email} className="border-t border-line">
                  <td className="py-1"><b>{p.email}</b> <span className="text-muted block">{lang === "id" ? p.id : p.en}</span></td>
                  <td className="font-mono">{p.password}</td>
                  <td><button type="button" className="btn" onClick={() => { setEmail(p.email); setPw(p.password); }} disabled={loading}>{l("Isi", "Fill")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
