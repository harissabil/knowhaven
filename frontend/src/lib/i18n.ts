"use client";
import { useSession } from "@/store/session";

const D = {
  id: {
    chat: "Tanya Havi", approvals: "Persetujuan", members: "Anggota", containers: "Container & Izin",
    integrations: "Integrasi", managers: "Approver", topics: "Pemilik Topik", pii: "Izin Data Pribadi", invites: "Undangan", upload: "Upload Data", audit: "Audit Log", tests: "Uji Sistem",
    workbuddy: "Hubungkan WorkBuddy", logout: "Keluar", send: "Kirim", placeholder: "Tulis pertanyaan… (ID / EN / campur)",
    dataAsOf: "Data per", sources: "Sumber", trace: "Jejak proses", approve: "Setujui", reject: "Tolak",
    requestAccess: "Ajukan akses", login: "Masuk", demoAccounts: "Akun demo (untuk juri)",
    dark: "Gelap", light: "Terang", tenant: "Perusahaan",
    welcome: "Halo! Saya Havi, asisten pengetahuan kantor. Mau tanya apa hari ini?",
    suggestions: "Coba tanyakan",
  },
  en: {
    chat: "Ask Havi", approvals: "Approvals", members: "Members", containers: "Containers & Access",
    integrations: "Integrations", managers: "Approvers", topics: "Topic Owners", pii: "PII Access", invites: "Invites", upload: "Upload Data", audit: "Audit Log", tests: "System Tests",
    workbuddy: "Connect WorkBuddy", logout: "Log out", send: "Send", placeholder: "Type a question… (ID / EN / mixed)",
    dataAsOf: "Data as of", sources: "Sources", trace: "Process trace", approve: "Approve", reject: "Reject",
    requestAccess: "Request access", login: "Sign in", demoAccounts: "Demo accounts (for judges)",
    dark: "Dark", light: "Light", tenant: "Company",
    welcome: "Hi! I'm Havi, your office knowledge assistant. What would you like to know?",
    suggestions: "Try asking",
  },
} as const;

export type Key = keyof (typeof D)["id"];
export function useT() {
  const lang = useSession((s) => s.lang);
  return (k: Key) => D[lang][k];
}

/** Inline bilingual helper: l("teks", "text"). */
export function useL() {
  const lang = useSession((s) => s.lang);
  return (id: string, en: string) => (lang === "id" ? id : en);
}
