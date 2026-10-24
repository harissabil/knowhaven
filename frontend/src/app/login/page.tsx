"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePersonas, useSession } from "@/store/session";
import { PERSONAS as DEMO } from "@/mock/users";
import { useL, useT } from "@/lib/i18n";
import { Mascot, SpeechBubble } from "@/components/mascot/Mascot";

const TITLES: Record<string, string> = {
  "Karyawan Baru": "New Hire", "Staf Ops Makassar": "Makassar Ops Staff", "Project Manager": "Project Manager", HR: "HR",
  "Manajer Operasional": "Operations Manager", Auditor: "Auditor", Owner: "Owner", Konsultan: "Consultant",
  "Menunggu persetujuan": "Awaiting approval",
};

export default function Login() {
  const router = useRouter();
  const { login, lang, set } = useSession();
  const PERSONAS = usePersonas();
  const t = useT();
  const l = useL();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = PERSONAS.find((x) => x.id === email.trim().toLowerCase() && x.password === pw);
    if (!p) return setErr(l("Akun atau kata sandi salah.", "Wrong account or password."));
    login(p.id);
    router.push(!p.memberships.length ? "/onboarding" : p.memberships[0].roles.includes("pending") ? "/pending" : "/chat");
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
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={l("mis. dimas", "e.g. dimas")} /></label>
          <label className="flex flex-col gap-1">{l("Kata sandi", "Password")}
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {err && <p role="alert" className="text-bad">{err}</p>}
          <button className="btn btn-primary btn-lg justify-center">{t("login")}</button>
        </form>
        <div className="card p-5">
          <h2 className="eyebrow mb-2">{t("demoAccounts")}</h2>
          <table className="w-full text-sm">
            <tbody>
              {DEMO.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1"><b>{p.id}</b> <span className="text-muted">{lang === "id" ? p.title : TITLES[p.title] ?? p.title}</span></td>
                  <td className="font-mono">{p.password}</td>
                  <td><button className="btn" onClick={() => { setEmail(p.id); setPw(p.password); }}>{l("Isi", "Fill")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
