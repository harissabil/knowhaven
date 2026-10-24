"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePersonas, useSession, type CurrentUser } from "@/store/session";
import { PERSONAS as DEMO } from "@/mock/users";
import { useL, useT } from "@/lib/i18n";
import { Mascot, SpeechBubble } from "@/components/mascot/Mascot";
import { apiFetch, ApiError } from "@/lib/api";

const TITLES: Record<string, string> = {
  "Karyawan Baru": "New Hire", "Staf Ops Makassar": "Makassar Ops Staff", "Project Manager": "Project Manager", HR: "HR",
  "Manajer Operasional": "Operations Manager", Auditor: "Auditor", Owner: "Owner", Konsultan: "Consultant",
  "Menunggu persetujuan": "Awaiting approval",
};

export default function Login() {
  const router = useRouter();
  const { login, lang, set, syncMe } = useSession();
  const PERSONAS = usePersonas();
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

    const inputAccount = email.trim().toLowerCase();

    try {
      // 1. Try real backend login
      const res = await apiFetch<{
        session_token?: string;
        user_id?: string;
        active_tenant_id?: string;
        roles?: string[];
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: inputAccount, password: pw }),
      });

      if (res?.session_token) {
        set({ sessionToken: res.session_token });
      }

      // Fetch full profile from /api/me
      const me = await syncMe();
      if (me) {
        login(inputAccount, res.session_token, me as CurrentUser);
        const roles = me.roles || [];
        if (roles.length === 1 && roles[0] === "pending") {
          router.push("/pending");
        } else if (!me.tenants || me.tenants.length === 0) {
          router.push("/onboarding");
        } else {
          router.push("/chat");
        }
        return;
      }
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) {
        setErr(l("Akun atau kata sandi salah.", "Wrong account or password."));
        setLoading(false);
        return;
      }
      // If backend is unreachable or returned another error, try fallback mock check
      console.warn("Backend login failed, checking local personas fallback...", e);
    }

    // Fallback for mock/offline testing
    const p = PERSONAS.find((x) => x.id === inputAccount && x.password === pw);
    if (!p) {
      setErr(l("Akun atau kata sandi salah.", "Wrong account or password."));
      setLoading(false);
      return;
    }

    login(p.id);
    router.push(!p.memberships.length ? "/onboarding" : p.memberships[0].roles.includes("pending") ? "/pending" : "/chat");
    setLoading(false);
  }

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="relative hidden md:flex flex-col items-center justify-center gap-6 p-10 text-center overflow-hidden border-r border-line bg-tint"
        style={{ backgroundImage: "radial-gradient(var(--border-strong) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
        <Link href="/" className="absolute top-6 left-6 font-semibold text-lg tracking-tight">Knowhaven</Link>
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
          <label className="flex flex-col gap-1">{l("Akun", "Account")}
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={l("mis. dimas", "e.g. dimas")} disabled={loading} /></label>
          <label className="flex flex-col gap-1">{l("Kata sandi", "Password")}
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={loading} /></label>
          {err && <p role="alert" className="text-bad">{err}</p>}
          <button className="btn btn-primary btn-lg justify-center" disabled={loading}>
            {loading ? l("Memverifikasi…", "Verifying…") : t("login")}
          </button>
        </form>
        <div className="card p-5">
          <h2 className="eyebrow mb-2">{t("demoAccounts")}</h2>
          <table className="w-full text-sm">
            <tbody>
              {DEMO.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1"><b>{p.id}</b> <span className="text-muted">{lang === "id" ? p.title : TITLES[p.title] ?? p.title}</span></td>
                  <td className="font-mono">{p.password}</td>
                  <td><button className="btn" onClick={() => { setEmail(p.id); setPw(p.password); }} disabled={loading}>{l("Isi", "Fill")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
