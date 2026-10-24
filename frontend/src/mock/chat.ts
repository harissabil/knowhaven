// Static UI copy: landing-page pipeline steps and chat starter questions.
export type Lang = "id" | "en";
export const TRACE_STEPS = [
  { n: 1, kind: "CODE", name: { id: "Identifikasi user & tenant", en: "Identify user & tenant" } },
  { n: 2, kind: "LLM", name: { id: "Pahami pertanyaan", en: "Understand the question" } },
  { n: 3, kind: "CODE", name: { id: "Gerbang kebijakan", en: "Policy gate" } },
  { n: 4, kind: "LLM+CODE", name: { id: "Retrieval agentik (filter izin di SQL)", en: "Agentic retrieval (permission filter in SQL)" } },
  { n: 5, kind: "LLM+CODE", name: { id: "Nilai bukti & konflik", en: "Assess evidence & conflicts" } },
  { n: 6, kind: "LLM", name: { id: "Susun jawaban", en: "Compose answer" } },
  { n: 7, kind: "CODE", name: { id: "Validasi sitasi", en: "Validate citations" } },
  { n: 8, kind: "CODE", name: { id: "Catat ke audit log", en: "Write audit log" } },
] as const;

// Starter questions that fit any company: no tenant data (projects, branches, names) in them.
export const SUGGESTIONS: Record<Lang, string[]> = {
  id: [
    "Bagaimana cara mengajukan cuti?",
    "Bagaimana prosedur klaim reimbursement?",
    "Apa pengumuman terbaru dari HR?",
    "Saya karyawan baru, apa yang perlu saya ketahui?",
    "Tugas apa yang masih terbuka?",
  ],
  en: [
    "How do I request leave?",
    "How do I claim a reimbursement?",
    "What's the latest announcement from HR?",
    "I'm new here, what should I know?",
    "Which tasks are still open?",
  ],
};
