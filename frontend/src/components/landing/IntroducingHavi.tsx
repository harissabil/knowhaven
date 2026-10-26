"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mascot, type MascotState } from "@/components/mascot/Mascot";

interface Trait {
  id: MascotState;
  label: { id: string; en: string };
  tagline: { id: string; en: string };
  bubble: { id: string; en: string };
  badge: { id: string; en: string };
  detail: { id: string; en: string };
}

const TRAITS: Trait[] = [
  {
    id: "answering",
    label: { id: "Selalu bersumber", en: "Always sourced" },
    tagline: { id: "Kutipan terverifikasi", en: "Verified citations" },
    badge: { id: "LED emerald · Jawaban valid", en: "LED emerald · Valid answer" },
    bubble: {
      id: "Uang bensin Rp750.000 per bulan sesuai pengumuman HR resmi.",
      en: "Monthly fuel allowance is Rp750,000 as stated in the HR memo.",
    },
    detail: {
      id: "Havi menyertakan tautan langsung ke pesan Slack, dokumen Confluence, atau tiket Jira pada setiap angka dan klaim penting.",
      en: "Havi attaches direct citations to Slack messages, Confluence pages, or Jira tickets on every key number and statement.",
    },
  },
  {
    id: "conflict",
    label: { id: "Penengah perbedaan", en: "Conflict resolver" },
    tagline: { id: "Aturan prioritas jelas", en: "Clear precedence rules" },
    badge: { id: "LED amber · Menimbang sumber", en: "LED amber · Weighing sources" },
    bubble: {
      id: "SOP lama mencatat Rp500.000, pengumuman HR baru menetapkan Rp750.000. Pengumuman baru yang dipakai.",
      en: "Old SOP states Rp500,000, new HR memo says Rp750,000. The newer memo wins.",
    },
    detail: {
      id: "Jika ada dua data bertentangan, Havi membandingkan otoritas dan tanggal pembaruan, lalu membuat draf revisi untuk manajer.",
      en: "When two sources contradict, Havi evaluates authority and recency, then submits an update draft for manager approval.",
    },
  },
  {
    id: "refusing",
    label: { id: "Penjaga rahasia", en: "Zero leak guard" },
    tagline: { id: "Tanpa konfirmasi eksistensi", en: "Zero existence leak" },
    badge: { id: "LED guarded · Batas akses aktif", en: "LED guarded · Access boundary" },
    bubble: {
      id: "Informasi topik tersebut tidak ditemukan di data yang boleh Anda akses.",
      en: "Information on that topic was not found in your accessible data.",
    },
    detail: {
      id: "Menanyakan inisiatif rahasia menghasilkan respons dan waktu henti yang persis sama dengan topik fiktif, tanpa membocorkan eksistensinya.",
      en: "Probing confidential projects gives byte identical responses to fictitious topics, preventing indirect hints or leaks.",
    },
  },
  {
    id: "idk",
    label: { id: "Jujur saat kosong", en: "Honest gap routing" },
    tagline: { id: "Rute ke pemilik topik", en: "Routes to topic owner" },
    badge: { id: "LED slate · Data tidak tersedia", en: "LED slate · Data unavailable" },
    bubble: {
      id: "Ketentuan beasiswa S2 belum tercatat di sistem. Silakan hubungi tim HR.",
      en: "Scholarship policies are not in the system yet. Please contact the HR team.",
    },
    detail: {
      id: "Havi tidak mengarang saat data perusahaan tidak tersedia. Pertanyaan diarahkan langsung ke pemilik topik yang berwenang.",
      en: "Havi never hallucinates missing company knowledge. Queries are routed directly to the verified topic owner.",
    },
  },
];

const EASE_BASE = [0.22, 1, 0.36, 1] as const;

export function IntroducingHavi({ lang }: { lang: "id" | "en" }) {
  const [activeTrait, setActiveTrait] = useState<MascotState>("answering");
  const selected = TRAITS.find((t) => t.id === activeTrait) ?? TRAITS[0];

  return (
    <section id="havi" className="relative border-t border-line bg-surface py-24 overflow-hidden">
      <div className="max-w-6xl mx-auto px-5">
        {/* Section Header */}
        <div className="flex flex-col items-center text-center max-w-[680px] mx-auto mb-16">
          <p className="eyebrow text-brand mb-2">
            {lang === "id" ? "Rekan kerja AI Anda" : "Your workplace companion"}
          </p>
          <h2
            className="text-4xl md:text-5xl font-semibold tracking-tight text-balance"
            style={{
              backgroundImage: "linear-gradient(to right, var(--fg), var(--muted))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {lang === "id" ? "Kenalkan Havi" : "Introducing Havi"}
          </h2>
          <p className="text-muted text-base md:text-lg mt-4 text-pretty leading-relaxed">
            {lang === "id"
              ? "Bukan sekadar asisten tanya jawab biasa. Havi dirancang dengan visor ekspresif untuk menegakkan hak akses, menimbang perbedaan dokumen, dan menjawab berdasarkan data nyata."
              : "Not just another chatbot. Havi is an expressive companion built to protect access boundaries, resolve conflicting records, and answer strictly from verifiable sources."}
          </p>
        </div>

        {/* Interactive Showcase Card */}
        {/* Outer card rounded-3xl (24px) with gap 32px or 24px */}
        <div className="rounded-3xl border border-line bg-surface2 p-6 md:p-8">
          <div className="grid lg:grid-cols-12 gap-6 items-center">
            
            {/* Visor & Live Response Box: inner card rounded-2xl (16px) */}
            <div className="lg:col-span-5 flex flex-col items-center justify-center p-6 rounded-2xl bg-surface border border-line">
              <div className="py-4 flex flex-col items-center select-none">
                <Mascot size={144} state={activeTrait} />
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: EASE_BASE }}
                  className="mt-3 flex flex-col items-center text-center w-full"
                >
                  <span className="text-xs font-mono px-3 py-1 rounded-full bg-surface2 border border-line text-muted">
                    {selected.badge[lang]}
                  </span>

                  {/* Speech Bubble: nested card rounded-xl (12px) */}
                  <div className="mt-4 p-4 rounded-xl bg-surface2 border border-line text-sm leading-relaxed text-fg text-center w-full">
                    <p className="text-xs font-medium text-brand uppercase tracking-wider mb-1">
                      Havi
                    </p>
                    <p className="text-pretty">&ldquo;{selected.bubble[lang]}&rdquo;</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Trait Selectors & Details */}
            <div className="lg:col-span-7 flex flex-col gap-4">
              <div className="grid sm:grid-cols-2 gap-3">
                {TRAITS.map((trait) => {
                  const isSelected = activeTrait === trait.id;
                  return (
                    <button
                      key={trait.id}
                      type="button"
                      onClick={() => setActiveTrait(trait.id)}
                      className={`text-left p-3.5 rounded-xl border transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] flex flex-col gap-1 focus:outline-none focus:ring-2 focus:ring-brand active:scale-[0.98] ${
                        isSelected
                          ? "bg-surface border-brand shadow-sm"
                          : "bg-surface/60 hover:bg-surface border-line text-muted hover:text-fg"
                      }`}
                    >
                      <span className={`text-sm font-semibold ${isSelected ? "text-fg" : ""}`}>
                        {trait.label[lang]}
                      </span>
                      <span className="text-xs text-muted">
                        {trait.tagline[lang]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Detail explainer box */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.35, ease: EASE_BASE }}
                  className="p-5 rounded-2xl bg-surface border border-line"
                >
                  <p className="font-semibold text-base text-fg mb-1">
                    {selected.label[lang]}
                  </p>
                  <p className="text-muted text-sm leading-relaxed text-pretty">
                    {selected.detail[lang]}
                  </p>
                </motion.div>
              </AnimatePresence>

              {/* Architectural rule */}
              <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-muted pt-2 border-t border-line">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-brand" />
                  {lang === "id" ? "Kode menentukan izin" : "Code enforces permissions"}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-accent" />
                  {lang === "id" ? "Havi merangkum temuan" : "Havi explains findings"}
                </span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
