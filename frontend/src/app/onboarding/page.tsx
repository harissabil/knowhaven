"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Building2, Check, Eye, EyeOff, KeyRound } from "lucide-react";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { KnowhavenLogo } from "@/components/BrandLogos";
import { Confetti } from "@/components/ui/Confetti";
import { Spot } from "@/components/ui/Spot";
import { usePersona, useSession } from "@/store/session";
import { useL } from "@/lib/i18n";
import { ApiError, errorText } from "@/lib/api";

type Stage = "account" | "choose" | "company" | "join" | "building";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const HUES = [14, 28, 160, 200, 262, 330];
const hueOf = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const strengthOf = (p: string) =>
  [p.length >= 8, /[a-z]/.test(p) && /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;

export default function Onboarding() {
  const router = useRouter();
  const { register, createCompany, joinByCode, lang, set } = useSession();
  const { persona } = usePersona();
  const l = useL();
  const [stage, setStage] = useState<Stage>("account");
  const [f, setF] = useState({ name: "", email: "", pw: "", company: "", code: "" });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [shake, setShake] = useState(0);
  const [focus, setFocus] = useState(false);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { if (persona && stage === "account") setStage("choose"); }, [persona, stage]);

  const strength = strengthOf(f.pw);
  const STRENGTH = [l("Terlalu pendek", "Too short"), l("Lemah", "Weak"), l("Cukup", "Okay"), l("Kuat", "Strong"), l("Sangat kuat", "Excellent")];
  const company = f.company.trim();

  const BUILD = useMemo(() => [
    l("Membuat workspace", "Creating your workspace"),
    l("Menerapkan template peran", "Applying role templates"),
    l("Mengunci semua data secara default", "Locking everything by default"),
    l("Membuat kode perusahaan", "Generating your company code"),
    l("Membangunkan Havi", "Waking up Havi"),
  ], [l]);

  async function build() {
    setStage("building"); setTick(0); setErr("");
    const created = createCompany(company);
    for (let i = 1; i <= BUILD.length; i++) { await sleep(450); setTick(i); }
    try {
      await created;
    } catch (e) {
      setErr(errorText(e)); setStage("company"); setShake((x) => x + 1);
      return;
    }
    await sleep(700);
    router.push("/admin/setup");
  }

  const mood: MascotState =
    stage === "building" ? (tick >= BUILD.length ? "celebrate" : "thinking")
    : stage === "company" ? (company.length >= 3 ? "celebrate" : "listening")
    : stage === "join" ? (err ? "idk" : "waiting")
    : stage === "choose" ? "answering"
    : focus ? "listening" : "idle";

  const first = (persona?.name ?? f.name).split(" ")[0];
  const say: Record<Stage, string> = {
    account: l("Halo! Saya Havi. Buat akun dulu, setelah itu kita siapkan rumah pengetahuan perusahaan Anda.", "Hi! I'm Havi. Let's create your account, then we'll build your company's knowledge haven."),
    choose: l(`Senang bertemu, ${first || "kawan"}! Mau mulai dari nol atau bergabung ke tim yang sudah ada?`, `Nice to meet you, ${first || "friend"}! Start fresh, or join a team that's already here?`),
    company: company.length >= 3 ? l(`"${company}" nama yang bagus! Siap membangun?`, `"${company}" is a great name! Ready to build?`) : l("Beri nama perusahaan Anda. Boleh diubah nanti.", "Name your company. You can change it later."),
    join: err ? l("Hmm, kode itu tidak saya kenal. Coba lagi?", "Hmm, I don't know that code. Try again?") : l("Masukkan kode dari admin Anda. Anda akan menunggu persetujuan.", "Enter the code from your admin. You'll wait for approval."),
    building: tick >= BUILD.length ? l("Selesai! Mari kita atur pengetahuannya.", "All set! Let's set up your knowledge.") : l("Sebentar ya, saya menyiapkan semuanya…", "One moment, getting everything ready…"),
  };
  // const dots = [l("Akun", "Account"), l("Perusahaan", "Company"), l("Luncurkan", "Launch")];
  // const dot = stage === "account" ? 0 : stage === "building" ? 2 : 1;

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1.1fr] relative">
      {/* scene */}
      <div className="relative hidden lg:flex flex-col items-center justify-center gap-7 p-10 text-center overflow-hidden border-r border-line bg-tint"
        style={{ backgroundImage: "radial-gradient(var(--border-strong) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
        <Link href="/" className="absolute top-6 left-6 flex items-center gap-2.5 font-semibold text-lg tracking-tight"><KnowhavenLogo size={26} /> Knowhaven</Link>
        <div className="relative">
          {stage === "building" && tick >= BUILD.length && <Confetti count={48} />}
          <motion.div animate={{ y: [0, -14, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
            <div className="rounded-full bg-surface border border-line2 w-64 h-64 grid place-items-center">
              <Mascot size={210} state={mood} />
            </div>
          </motion.div>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={say[stage]} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="card px-5 py-3 max-w-sm text-[1.02rem]">{say[stage]}</motion.div>
        </AnimatePresence>
        {/*<ol className="flex gap-6 absolute bottom-8">
          {dots.map((d, i) => (
            <li key={d} className="flex items-center gap-2 eyebrow">
              <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] ${i < dot ? "bg-ok text-brandfg" : i === dot ? "bg-brand text-brandfg" : "border border-line2"}`}>
                {i < dot ? <Check size={11} /> : i + 1}
              </span>
              <span className={i === dot ? "text-fg" : ""}>{d}</span>
            </li>
          ))}
        </ol>*/}
      </div>

      {/* form side */}
      <div className="flex flex-col p-6 md:p-12">
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="text-sm underline text-muted hover:text-fg flex-1">← {l("Beranda", "Home")}</Link>
          <button className="btn" onClick={() => set({ lang: lang === "id" ? "en" : "id" })}>{lang === "id" ? "EN" : "ID"}</button>
        </div>
        <div className="lg:hidden flex justify-center mb-4"><Mascot size={110} state={mood} /></div>

        <div className="w-full max-w-md mx-auto my-auto">
          <AnimatePresence mode="wait">
            {stage === "account" && (
              <motion.form key="account" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex flex-col gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (f.pw.length < 8) { setErr(l("Kata sandi minimal 8 karakter.", "The password needs at least 8 characters.")); setShake((x) => x + 1); return; }
                  setBusy(true);
                  try {
                    await register(f.name, f.email, f.pw);
                    const next = new URLSearchParams(window.location.search).get("next");
                    if (next?.startsWith("/join/")) { router.push(next); return; } // came from an invite link
                    setErr(""); setStage("choose");
                  } catch (x) {
                    setErr(x instanceof ApiError && x.status === 409 ? l("Email sudah terdaftar. Silakan masuk.", "That email is already registered. Please sign in.")
                      : x instanceof ApiError && x.status === 422 ? l("Periksa nama, email, dan kata sandi (min. 8).", "Check the name, email and password (min. 8).")
                      : errorText(x));
                    setShake((n) => n + 1);
                  } finally { setBusy(false); }
                }}>
                <h1 className="text-4xl">{l("Buat akun Anda", "Create your account")}</h1>
                <p className="text-muted">{l("Kurang dari satu menit.", "Takes under a minute.")}</p>
                <label className="flex flex-col gap-1.5">{l("Nama lengkap", "Full name")}
                  <input className="input" value={f.name} onChange={up("name")} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} required autoFocus /></label>
                <label className="flex flex-col gap-1.5">Email
                  <input className="input" type="email" value={f.email} onChange={up("email")} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} required /></label>
                <label className="flex flex-col gap-1.5">{l("Kata sandi (min. 8)", "Password (min. 8)")}
                  <span className="relative">
                    <input className="input pr-11" type={show ? "text" : "password"} value={f.pw} onChange={up("pw")} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} required />
                    <button type="button" aria-label={show ? "hide" : "show"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg" onClick={() => setShow(!show)}>
                      {show ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </span>
                </label>
                <div aria-live="polite">
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4].map((i) => (
                      <motion.span key={i} className="h-1.5 flex-1 rounded-full" animate={{ backgroundColor: f.pw && strength >= i ? (strength >= 3 ? "var(--ok)" : "var(--accent)") : "var(--border)" }} />
                    ))}
                  </div>
                  <p className="text-xs text-muted mt-1.5 h-4">{f.pw ? STRENGTH[strength] : ""}</p>
                </div>
                {err && <motion.p key={shake} initial={{ x: -8 }} animate={{ x: [0, -8, 8, -4, 4, 0] }} role="alert" className="text-bad">{err}</motion.p>}
                <button className="btn btn-primary btn-lg" disabled={busy}>{l("Lanjut", "Continue")} <ArrowRight size={18} /></button>
                <p className="text-sm text-muted text-center">{l("Sudah punya akun?", "Already have an account?")} <Link className="underline text-fg" href="/login">{l("Masuk", "Sign in")}</Link></p>
              </motion.form>
            )}

            {stage === "choose" && (
              <motion.div key="choose" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex flex-col gap-4">
                <h1 className="text-4xl">{l("Dari mana kita mulai?", "Where do we start?")}</h1>
                {[
                  { k: "company" as Stage, icon: <Building2 size={26} />, t: l("Buat perusahaan", "Create a company"), d: l("Anda jadi Owner dan Admin, lalu kami pandu setup-nya.", "You become Owner and Admin, and we guide the setup.") },
                  { k: "join" as Stage, icon: <KeyRound size={26} />, t: l("Gabung dengan kode", "Join with a code"), d: l("Punya kode dari admin? Masuk ke tim yang sudah ada.", "Got a code from your admin? Join an existing team.") },
                ].map((c, i) => (
                  <motion.button key={c.k} type="button" onClick={() => { setErr(""); setStage(c.k); }}
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.1 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} className="text-left">
                    <Spot className="card">
                      <div className="p-5 flex items-center gap-4">
                        <span className="w-12 h-12 rounded-xl bg-tint text-brand grid place-items-center">{c.icon}</span>
                        <span className="flex-1"><b className="text-lg block">{c.t}</b><span className="text-muted">{c.d}</span></span>
                        <ArrowRight className="text-muted" />
                      </div>
                    </Spot>
                  </motion.button>
                ))}
              </motion.div>
            )}

            {stage === "company" && (
              <motion.form key="company" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex flex-col gap-5"
                onSubmit={(e) => { e.preventDefault(); if (company.length >= 2) build(); }}>
                <h1 className="text-4xl">{l("Beri nama perusahaan Anda", "Name your company")}</h1>
                {err && <motion.p key={shake} initial={{ x: -8 }} animate={{ x: [0, -8, 8, -4, 4, 0] }} role="alert" className="text-bad">{err}</motion.p>}
                <input className="input !text-xl !py-3" autoFocus value={f.company} onChange={up("company")} aria-label={l("Nama perusahaan", "Company name")} placeholder={l("mis. PT Sinar Rantai Nusantara", "e.g. Acme Logistics")} />
                <div className="card p-4 flex items-center gap-4 overflow-hidden">
                  <motion.span key={company} initial={{ scale: 0.7, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}
                    className="w-14 h-14 rounded-2xl grid place-items-center text-xl font-semibold text-white shrink-0"
                    style={{ background: `hsl(${hueOf(company || "x")} 70% 45%)` }}>
                    {(company.match(/\b\w/g)?.join("").slice(0, 2) || "?").toUpperCase()}
                  </motion.span>
                  <div className="min-w-0">
                    <p className="font-semibold text-lg truncate">{company || l("Perusahaan Anda", "Your company")}</p>
                    <p className="eyebrow truncate">knowhaven.app/{slugOf(company) || "..."}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button type="button" className="btn" onClick={() => setStage("choose")}>{l("Kembali", "Back")}</button>
                  <button className="btn btn-primary btn-lg flex-1" disabled={company.length < 2}>{l("Bangun rumah pengetahuan saya", "Build my haven")} <ArrowRight size={18} /></button>
                </div>
              </motion.form>
            )}

            {stage === "join" && (
              <motion.form key="join" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} className="flex flex-col gap-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    const r = await joinByCode(f.code.trim().toUpperCase());
                    router.push(r.status === "pending" ? "/pending" : "/chat");
                  } catch (x) {
                    setErr(x instanceof ApiError && x.status === 404 ? l("Kode perusahaan tidak dikenal.", "Unknown company code.") : errorText(x));
                    setShake((n) => n + 1);
                  } finally { setBusy(false); }
                }}>
                <h1 className="text-4xl">{l("Masukkan kode perusahaan", "Enter your company code")}</h1>
                <motion.input key={shake} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}} className="input !text-2xl !py-3 font-mono tracking-widest text-center" autoFocus
                  value={f.code} onChange={(e) => { setF({ ...f, code: e.target.value.toUpperCase() }); setErr(""); }} aria-label={l("Kode perusahaan", "Company code")} placeholder="XXX-0000" />
                {err && <p role="alert" className="text-bad text-center">{err}</p>}
                <p className="text-sm text-muted text-center">{l("Kode ada di halaman Undangan milik admin.", "Your admin finds the code on the Invites page.")}</p>
                <div className="flex gap-3">
                  <button type="button" className="btn" onClick={() => { setErr(""); setStage("choose"); }}>{l("Kembali", "Back")}</button>
                  <button className="btn btn-primary btn-lg flex-1" disabled={!f.code.trim() || busy}>{l("Gabung", "Join")} <ArrowRight size={18} /></button>
                </div>
              </motion.form>
            )}

            {stage === "building" && (
              <motion.div key="building" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col gap-6">
                <h1 className="text-4xl">{tick >= BUILD.length ? l("Rumah Anda siap!", "Your haven is ready!") : l("Membangun rumah Anda…", "Building your haven…")}</h1>
                <div className="h-2 rounded-full bg-line overflow-hidden">
                  <motion.div className="h-full bg-brand" animate={{ width: `${(tick / BUILD.length) * 100}%` }} transition={{ duration: 0.5 }} />
                </div>
                <ul className="flex flex-col gap-3">
                  {BUILD.map((b, i) => (
                    <motion.li key={b} initial={{ opacity: 0.3 }} animate={{ opacity: tick > i || tick === i ? 1 : 0.3 }} className="flex items-center gap-3">
                      <span className="w-6 h-6 grid place-items-center">
                        {tick > i ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-6 h-6 rounded-full bg-ok text-brandfg grid place-items-center"><Check size={14} /></motion.span>
                          : tick === i ? <motion.span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
                          : <span className="w-2 h-2 rounded-full bg-line2" />}
                      </span>
                      {b}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
