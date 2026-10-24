"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { motion, useScroll, useSpring } from "framer-motion";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";
import { KnowhavenLogo, LOGOS } from "@/components/BrandLogos";
import { FlowScene } from "@/components/landing/FlowScene";
import { RoleDemo } from "@/components/landing/RoleDemo";
import { ProductTabs } from "@/components/landing/ProductTabs";
import { Reveal } from "@/components/ui/Reveal";
import { Spot } from "@/components/ui/Spot";
import { CountUp } from "@/components/ui/CountUp";
import { TRACE_STEPS } from "@/mock/chat";
import { useSession } from "@/store/session";

const C = {
  id: {
    nav: ["Fitur", "Coba sendiri", "Cara kerja", "Keamanan"],
    login: "Masuk", start: "Mulai Sekarang", demo: "Lihat demo",
    // pill: "Tencent Cloud Hackathon Indonesia 2026",
    h1a: "Kami menyederhanakan pencarian informasi kantor.",
    h1b: "Tanya sekali, semua terjawab.",
    sub: "Tanya dalam Bahasa Indonesia, Inggris, atau campur. Havi menjawab dari chat, dokumen, dan task perusahaan Anda, lengkap dengan sumber, dan hanya dari data yang boleh Anda lihat.",
    stats: [[8, "", "langkah pipeline, tiap langkah dicatat"], [0, "", "kebocoran pada uji diferensial"], [10, "<", "detik sampai pesan baru bisa dicari"], [5, "", "jenis sumber dalam satu jawaban"]],
    tryTitle: "Pertanyaan sama. Jawaban berbeda, sesuai siapa yang bertanya.",
    trySub: "Ganti peran dan lihat Havi menegakkan batas akses secara langsung. Topik rahasia tidak pernah bocor, bahkan lewat petunjuk.",
    prodTitle: "Satu tempat untuk bertanya, menyetujui, dan memeriksa.",
    q: "Uang bensin per bulan berapa?",
    a: "Rp750.000. Pengumuman HR terbaru menggantikan SOP lama yang masih menulis Rp500.000.",
    frame: "chat · PT Sinar Rantai Nusantara", trace: "jejak proses",
    srcTitle: "Terhubung ke alat yang sudah Anda pakai", soon: "Segera hadir",
    featuresTitle: "Jawaban yang bisa dipercaya",
    features: [
      ["Selalu bersumber", "Setiap jawaban menyertakan sitasi ke pesan, dokumen, atau task asalnya. Klik untuk melihat aslinya."],
      ["Patuh batas akses", "Havi hanya mencari di data yang boleh Anda lihat. Topik rahasia tidak pernah bocor, bahkan lewat petunjuk."],
      ["Menandai konflik", "Dua sumber berbeda? Havi menjelaskan mana yang dipakai dan kenapa, lalu menandai dokumen yang usang."],
      ["Jujur saat tidak tahu", "Tidak ada jawabannya? Havi bilang tidak tahu dan mengarahkan ke pemilik topik, bukan mengarang."],
      ["Manusia tetap memutuskan", "Akses topik sensitif dan perubahan dokumen harus disetujui manager. Havi tidak bertindak sendiri."],
      ["Jejak audit lengkap", "Setiap pertanyaan, sumber, dan jawaban tercatat dan bisa diperiksa auditor."],
    ],
    howTitle: "Siap dalam empat langkah",
    how: [
      ["Buat perusahaan", "Daftar dan beri nama perusahaan Anda."],
      ["Hubungkan pengetahuan", "Upload dokumen, sambungkan Slack, Confluence, dan Jira."],
      ["Atur akses", "Tentukan siapa boleh melihat apa. Data baru tertutup secara default."],
      ["Undang tim", "Karyawan langsung bisa bertanya, di web atau lewat WorkBuddy."],
    ],
    trustTitle: "Kode memutuskan. AI menjelaskan.",
    trust: "Izin, masking data pribadi, dan validasi sitasi dikerjakan kode yang bisa diuji, bukan model. AI hanya memahami pertanyaan dan menyusun kalimat dari data yang sudah difilter.",
    ctaTitle: "Berhenti mencari. Mulai bertanya.", ctaSub: "Siap dalam beberapa menit. Tanpa kartu kredit.",
    foot: "Knowhaven. Dibuat oleh Hokulele Software.",
  },
  en: {
    nav: ["Features", "Try it", "How it works", "Security"],
    login: "Sign in", start: "Start Now", demo: "See demo",
    // pill: "Tencent Cloud Hackathon Indonesia 2026",
    h1a: "We simplify finding information at work.",
    h1b: "Ask once, get the answer.",
    sub: "Ask in Indonesian, English, or both. Havi answers from your company's chats, documents, and tasks, with sources, and only from data you're allowed to see.",
    stats: [[8, "", "pipeline steps, every one logged"], [0, "", "leaks in the differential test"], [10, "<", "seconds until a new message is searchable"], [5, "", "source types in a single answer"]],
    tryTitle: "Same question. Different answer, depending on who asks.",
    trySub: "Switch roles and watch Havi enforce access limits live. Restricted topics never leak, not even through hints.",
    prodTitle: "One place to ask, approve, and audit.",
    q: "How much is the monthly fuel allowance?",
    a: "Rp750,000. The latest HR announcement replaces the old SOP that still says Rp500,000.",
    frame: "chat · PT Sinar Rantai Nusantara", trace: "process trace",
    srcTitle: "Connects to the tools you already use", soon: "Coming soon",
    featuresTitle: "Answers you can trust",
    features: [
      ["Always sourced", "Every answer cites the message, document, or task it came from. Click to open the original."],
      ["Respects access", "Havi only searches what you may see. Restricted topics never leak, not even through hints."],
      ["Flags conflicts", "Two sources disagree? Havi explains which one it used and why, and marks the outdated document."],
      ["Honest about gaps", "No answer in the data? Havi says so and points to the topic owner instead of guessing."],
      ["Humans decide", "Sensitive access and document changes need manager approval. Havi never acts on its own."],
      ["Full audit trail", "Every question, source, and answer is logged and reviewable by auditors."],
    ],
    howTitle: "Ready in four steps",
    how: [
      ["Create your company", "Sign up and name your company."],
      ["Connect knowledge", "Upload documents, connect Slack, Confluence, and Jira."],
      ["Set access", "Decide who sees what. New data is closed by default."],
      ["Invite your team", "People can ask right away, on the web or through WorkBuddy."],
    ],
    trustTitle: "Code decides. AI explains.",
    trust: "Permissions, personal-data masking, and citation checks are done by testable code, not the model. AI only understands the question and words the answer from already-filtered data.",
    ctaTitle: "Stop searching. Start asking.", ctaSub: "Ready in minutes. No credit card.",
    foot: "Knowhaven. Developed by Hokulele Software.",
  },
};

const MARQUEE = [
  { name: "Slack", logo: "Slack", on: true }, { name: "Confluence", logo: "Atlassian", on: true },
  { name: "Jira", logo: "Atlassian", on: true }, { name: "WhatsApp", logo: "WhatsApp", on: false },
  { name: "Telegram", logo: "Telegram", on: false },
];

export default function Landing() {
  const { lang, theme, set, currentUser } = useSession();
  const c = C[lang];
  const href = ["#features", "#try", "#how", "#trust"];
  const [ctaHover, setCtaHover] = useState(false);
  const howRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: howRef, offset: ["start 80%", "end 60%"] });
  const line = useSpring(scrollYProgress, { stiffness: 90, damping: 22 });
  const heroMood: MascotState = ctaHover ? "celebrate" : "answering";

  return (
    <div className="min-h-screen overflow-x-clip">
      <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-md border-b border-line">
        <div className="max-w-6xl mx-auto flex items-center gap-5 px-5 h-16">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-lg"><KnowhavenLogo size={28} /> Knowhaven</Link>
          <nav className="hidden lg:flex gap-1 ml-4 text-sm">
            {c.nav.map((n, i) => <a key={n} href={href[i]} className="px-3 py-1.5 rounded-full text-muted hover:text-fg hover:bg-surface2 transition-colors">{n}</a>)}
          </nav>
          <div className="flex-1" />
          <button className="btn !px-3" aria-label="theme" onClick={() => set({ theme: theme === "light" ? "dark" : "light" })}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
          <button className="btn" onClick={() => set({ lang: lang === "id" ? "en" : "id" })}>{lang === "id" ? "EN" : "ID"}</button>
          <Link href={currentUser ? "/chat" : "/login"} className="btn hidden sm:inline-flex">{c.login}</Link>
          <Link href="/onboarding" className="btn btn-primary">{c.start}</Link>
        </div>
      </header>

      {/* HERO */}
      <section className="relative">
        <div aria-hidden className="absolute inset-x-0 top-0 h-[560px] -z-10"
          style={{ background: "radial-gradient(60% 70% at 50% 0%, var(--brand-tint), transparent 70%)" }} />
        <div className="max-w-5xl mx-auto px-5 pt-16 pb-6 flex flex-col items-center text-center gap-7">
          {/* <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="btn !py-1 !px-3 text-sm !border-line cursor-default">
            <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" /> {c.pill}
          </motion.span> */}
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.6 }}
            className="halo text-5xl md:text-7xl leading-[1.02] max-w-[1000px]">
            {c.h1a} <span className="text-brand">{c.h1b}</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6 }}
            className="text-lg md:text-xl text-muted max-w-2xl">{c.sub}</motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32, duration: 0.6 }}
            className="flex flex-wrap gap-3 justify-center">
            <Link href="/onboarding" className="btn btn-primary btn-lg" onMouseEnter={() => setCtaHover(true)} onMouseLeave={() => setCtaHover(false)}>
              {c.start} <ArrowRight size={18} />
            </Link>
            <Link href="/login" className="btn btn-lg">{c.demo}</Link>
          </motion.div>
        </div>
        <div className="max-w-5xl mx-auto px-5 pt-6 pb-14">
          <div className="hidden sm:block"><FlowScene lang={lang} /></div>
          <div className="sm:hidden flex justify-center"><Mascot size={160} state={heroMood} /></div>
        </div>
      </section>

      {/* STATS (dark) */}
      <section data-theme="dark" className="bg-bg text-fg">
        <div className="max-w-6xl mx-auto px-5 py-14 grid grid-cols-2 md:grid-cols-4 gap-8">
          {c.stats.map(([n, pre, label], i) => (
            <Reveal key={i} delay={i * 0.08}>
              <p className="text-5xl md:text-6xl font-semibold tracking-tight text-brand"><CountUp to={n as number} prefix={pre as string} /></p>
              <p className="text-muted mt-2 text-sm">{label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ROLE DEMO */}
      <section id="try" className="max-w-6xl mx-auto px-5 py-24">
        <Reveal><h2 className="text-3xl md:text-5xl max-w-3xl">{c.tryTitle}</h2></Reveal>
        <Reveal delay={0.08}><p className="text-lg text-muted mt-4 mb-10 max-w-2xl">{c.trySub}</p></Reveal>
        <Reveal delay={0.12}><RoleDemo lang={lang} /></Reveal>
      </section>

      {/* PRODUCT */}
      <section className="border-y border-line bg-surface2">
        <div className="max-w-5xl mx-auto px-5 py-24">
          <Reveal><h2 className="text-3xl md:text-5xl text-center mb-10">{c.prodTitle}</h2></Reveal>
          <Reveal delay={0.1}><ProductTabs lang={lang} question={c.q} answer={c.a} traceLabel={c.trace} frame={c.frame} /></Reveal>
        </div>
      </section>

      {/* MARQUEE */}
      <section className="py-10 border-b border-line">
        <p className="eyebrow text-center mb-6">{c.srcTitle}</p>
        <div className="marquee overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
          <div className="marquee-track gap-14 pr-14">
            {[...MARQUEE, ...MARQUEE, ...MARQUEE, ...MARQUEE].map((m, i) => {
              const L = LOGOS[m.logo];
              return (
                <div key={i} className={`flex items-center gap-3 text-xl font-medium whitespace-nowrap ${m.on ? "" : "opacity-40 grayscale"}`}>
                  <L /> {m.name} {!m.on && <span className="eyebrow">{c.soon}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-5 py-24">
        <Reveal><h2 className="text-3xl md:text-5xl mb-12 max-w-2xl">{c.featuresTitle}</h2></Reveal>
        <div className="grid md:grid-cols-3 gap-4">
          {c.features.map(([t, d], i) => (
            <Reveal key={t} delay={(i % 3) * 0.08}>
              <Spot className="card h-full">
                <div className="p-6 flex flex-col gap-3 min-h-48">
                  <span className="eyebrow text-brand">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="text-xl">{t}</h3>
                  <p className="text-muted">{d}</p>
                </div>
              </Spot>
            </Reveal>
          ))}
        </div>
      </section>

      {/* HOW */}
      <section id="how" className="border-t border-line bg-surface2">
        <div className="max-w-6xl mx-auto px-5 py-24" ref={howRef}>
          <Reveal><h2 className="text-3xl md:text-5xl mb-14 max-w-2xl">{c.howTitle}</h2></Reveal>
          <div className="relative">
            <div className="hidden md:block absolute top-[18px] left-0 right-0 h-0.5 bg-line2" />
            <motion.div className="hidden md:block absolute top-[18px] left-0 right-0 h-0.5 bg-brand origin-left" style={{ scaleX: line }} />
            <ol className="grid md:grid-cols-4 gap-8 relative">
              {c.how.map(([t, d], i) => (
                <Reveal key={t} delay={i * 0.1}>
                  <li className="flex flex-col gap-3">
                    <span className="w-9 h-9 rounded-full bg-brand text-brandfg grid place-items-center font-semibold ring-8 ring-[var(--surface-2)]">{i + 1}</span>
                    <h3 className="text-xl">{t}</h3>
                    <p className="text-muted">{d}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* TRUST (dark) */}
      <section id="trust" data-theme="dark" className="bg-bg text-fg">
        <div className="max-w-6xl mx-auto px-5 py-24 grid md:grid-cols-2 gap-12 items-center">
          <Reveal>
            <div className="flex flex-col gap-5">
              <h2 className="text-3xl md:text-5xl">{c.trustTitle}</h2>
              <p className="text-lg text-muted">{c.trust}</p>
              <div className="flex gap-4 eyebrow"><span className="text-brand">[CODE] {lang === "id" ? "deterministik" : "deterministic"}</span><span className="text-accent">[LLM] {lang === "id" ? "menjelaskan" : "explains"}</span></div>
            </div>
          </Reveal>
          <div className="card p-5 font-mono text-sm leading-8">
            {TRACE_STEPS.map((s, i) => (
              <motion.div key={s.n} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }}>
                <span className="text-muted">{String(s.n).padStart(2, "0")} </span>
                <span className={s.kind === "CODE" ? "text-brand" : s.kind === "LLM" ? "text-accent" : "text-muted"}>[{s.kind}]</span>{" "}
                {s.name[lang]}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden" style={{ background: "var(--brand)" }}>
        <div aria-hidden className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        <div className="relative max-w-6xl mx-auto px-5 py-24 flex flex-col md:flex-row md:items-center gap-8">
          <div className="flex-1 text-white">
            <h2 className="text-4xl md:text-6xl">{c.ctaTitle}</h2>
            <p className="mt-3 text-lg opacity-90">{c.ctaSub}</p>
          </div>
          <div className="flex items-center gap-6">
            <Mascot size={120} state={ctaHover ? "celebrate" : "answering"} />
            <Link href="/onboarding" onMouseEnter={() => setCtaHover(true)} onMouseLeave={() => setCtaHover(false)}
              className="btn btn-lg !bg-white !text-[#1d1d1f] !border-white hover:!brightness-95">{c.start} <ArrowRight size={18} /></Link>
          </div>
        </div>
      </section>
      <footer className="eyebrow max-w-6xl mx-auto px-5 py-8">{c.foot}</footer>
    </div>
  );
}
