"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sun, Moon, ZoomIn, ZoomOut, RotateCcw, Type, Globe, KeyRound, Check } from "lucide-react";
import { Shell } from "@/components/Shell";
import { usePersona, useSession } from "@/store/session";
import { can } from "@/lib/permissions";
import { CompanyProfileCard } from "@/components/CompanyProfile";
import { useL, useT } from "@/lib/i18n";

export default function SettingsPage() {
  const t = useT();
  const l = useL();
  const s = useSession();
  const { roles } = usePersona();

  const currentPercent = Math.round(s.fontScale * 100);

  const zoomOut = () => {
    s.set({ fontScale: Math.max(0.85, Math.round((s.fontScale - 0.1) * 100) / 100) });
  };

  const zoomIn = () => {
    s.set({ fontScale: Math.min(1.5, Math.round((s.fontScale + 0.1) * 100) / 100) });
  };

  const resetZoom = () => {
    s.set({ fontScale: 1 });
  };

  return (
    <Shell title={t("settings")}>
      <div className="flex flex-col gap-6 max-w-4xl">
        {/* Header intro */}
        <div>
          <p className="text-muted">
            {l(
              "Sesuaikan preferensi tampilan dan aksesibilitas akun Anda di Knowhaven.",
              "Customize your display and accessibility preferences across Knowhaven."
            )}
          </p>
        </div>

        {/* 1. Theme / Dark Mode Section */}
        {can(roles, "admin") && <CompanyProfileCard />}

        <section className="card p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {s.theme === "dark" ? <Moon size={20} className="text-brand" /> : <Sun size={20} className="text-brand" />}
              {l("Mode Tampilan (Theme)", "Appearance & Theme")}
            </h2>
            <p className="text-sm text-muted mt-1">
              {l(
                "Pilih mode terang atau gelap sesuai kenyamanan mata Anda saat bekerja.",
                "Choose light or dark mode for optimal comfort during your work."
              )}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mt-1">
            {/* Light Mode Card */}
            <button
              type="button"
              onClick={() => s.set({ theme: "light" })}
              className={`p-4 rounded-erp border text-left transition-all relative flex flex-col gap-2 ${
                s.theme === "light"
                  ? "border-brand bg-brand-tint/60 shadow-sm ring-2 ring-brand/30"
                  : "border-line bg-surface hover:border-line2 hover:bg-surface2"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 font-medium">
                  <span className="w-9 h-9 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300 grid place-items-center">
                    <Sun size={18} />
                  </span>
                  <span>{l("Mode Terang", "Light Mode")}</span>
                </div>
                {s.theme === "light" && (
                  <span className="w-6 h-6 rounded-full bg-brand text-brandfg grid place-items-center">
                    <Check size={14} />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted pl-11">
                {l("Tampilan bersih dan kontras tinggi untuk siang hari.", "Clean, high-contrast look suitable for well-lit environments.")}
              </p>
            </button>

            {/* Dark Mode Card */}
            <button
              type="button"
              onClick={() => s.set({ theme: "dark" })}
              className={`p-4 rounded-erp border text-left transition-all relative flex flex-col gap-2 ${
                s.theme === "dark"
                  ? "border-brand bg-brand-tint/60 shadow-sm ring-2 ring-brand/30"
                  : "border-line bg-surface hover:border-line2 hover:bg-surface2"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 font-medium">
                  <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300 grid place-items-center">
                    <Moon size={18} />
                  </span>
                  <span>{l("Mode Gelap", "Dark Mode")}</span>
                </div>
                {s.theme === "dark" && (
                  <span className="w-6 h-6 rounded-full bg-brand text-brandfg grid place-items-center">
                    <Check size={14} />
                  </span>
                )}
              </div>
              <p className="text-xs text-muted pl-11">
                {l("Lebih ramah di mata untuk kondisi pencahayaan redup.", "Easy on the eyes for low-light work sessions.")}
              </p>
            </button>
          </div>
        </section>

        {/* 2. Zoom & Font Size Section */}
        <section className="card p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Type size={20} className="text-brand" />
              {l("Ukuran Teks & Zoom Tampilan", "Text Size & Display Zoom")}
            </h2>
            <p className="text-sm text-muted mt-1">
              {l(
                "Perbesar atau perkecil skala seluruh antarmuka agar nyaman dibaca di layar Anda.",
                "Scale the interface up or down for comfortable reading on your display."
              )}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-erp bg-surface2 border border-line">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold font-mono tracking-tight text-brand">
                {currentPercent}%
              </span>
              <span className="text-sm text-muted">
                {currentPercent === 100
                  ? l("(Ukuran Normal)", "(Default Size)")
                  : currentPercent > 100
                  ? l("(Diperbesar)", "(Zoomed In)")
                  : l("(Diperkecil)", "(Zoomed Out)")}
              </span>
            </div>

            {/* Quick action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn"
                onClick={zoomOut}
                disabled={s.fontScale <= 0.85}
                title={l("Perkecil font", "Zoom out")}
              >
                <ZoomOut size={16} /> A−
              </button>
              <button
                type="button"
                className="btn"
                onClick={resetZoom}
                disabled={s.fontScale === 1}
                title={l("Kembalikan ke 100%", "Reset to 100%")}
              >
                <RotateCcw size={14} /> 100%
              </button>
              <button
                type="button"
                className="btn"
                onClick={zoomIn}
                disabled={s.fontScale >= 1.5}
                title={l("Perbesar font", "Zoom in")}
              >
                <ZoomIn size={16} /> A+
              </button>
            </div>
          </div>

          {/* Slider for smooth adjustment */}
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex justify-between text-xs text-muted font-mono">
              <span>85%</span>
              <span>100%</span>
              <span>115%</span>
              <span>130%</span>
              <span>150%</span>
            </div>
            <input
              type="range"
              min="0.85"
              max="1.5"
              step="0.05"
              value={s.fontScale}
              onChange={(e) => s.set({ fontScale: parseFloat(e.target.value) })}
              className="w-full accent-brand cursor-pointer h-2 bg-line rounded-lg"
              aria-label={l("Penggeser zoom teks", "Text zoom slider")}
            />
          </div>

          {/* Live Preview Box */}
          <div className="p-4 rounded-erp border border-line bg-surface mt-2 flex flex-col gap-1.5">
            <span className="eyebrow">{l("Pratinjau Teks", "Text Preview")}</span>
            <p className="font-semibold text-base">
              {l("Pratinjau skala teks Knowhaven", "Knowhaven Live Text Scaling Preview")}
            </p>
            <p className="text-sm text-muted">
              {l(
                "Semua menu, dialog chat Havi, dan tabel dokumen otomatis menyesuaikan dengan skala ini secara instan.",
                "All menus, Havi chat dialogs, and document matrices instantly scale to match this setting."
              )}
            </p>
          </div>
        </section>

        {/* 3. Language Preference Section */}
        <section className="card p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Globe size={20} className="text-brand" />
              {l("Bahasa Antarmuka (Language)", "Interface Language")}
            </h2>
            <p className="text-sm text-muted mt-1">
              {l(
                "Pilih bahasa yang digunakan di navigasi dan pesan asisten Havi.",
                "Choose the preferred language for navigation and Havi assistant responses."
              )}
            </p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              className={`btn px-5 py-2.5 ${s.lang === "id" ? "btn-primary" : ""}`}
              onClick={() => s.set({ lang: "id" })}
            >
              🇮🇩 Bahasa Indonesia (ID)
            </button>
            <button
              type="button"
              className={`btn px-5 py-2.5 ${s.lang === "en" ? "btn-primary" : ""}`}
              onClick={() => s.set({ lang: "en" })}
            >
              🇬🇧 English (EN)
            </button>
          </div>
        </section>

        {/* 4. External Integrations / WorkBuddy Shortcut */}
        <section className="card p-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5">
            <span className="w-10 h-10 rounded-full bg-brand-tint text-brand grid place-items-center shrink-0">
              <KeyRound size={20} />
            </span>
            <div>
              <p className="font-semibold">{t("workbuddy")}</p>
              <p className="text-sm text-muted">
                {l(
                  "Hubungkan Knowhaven ke WorkBuddy IDE Anda via Model Context Protocol (MCP).",
                  "Connect Knowhaven into your WorkBuddy IDE via Model Context Protocol (MCP)."
                )}
              </p>
            </div>
          </div>
          <Link href="/settings/workbuddy" className="btn hover:border-brand">
            {l("Buka Konfigurasi", "Open Configuration")} →
          </Link>
        </section>
      </div>
    </Shell>
  );
}
