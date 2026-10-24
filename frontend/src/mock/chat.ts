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

export const SUGGESTIONS: Record<Lang, string[]> = {
  id: [
    "Uang bensin per bulan berapa?",
    "Kenapa stok telat di Makassar, apa yang masih open?",
    "Ceritakan tentang Proyek Kenari",
    "Grade gaji level 3 berapa?",
    "Cuti tahunan gimana, bisa carry over gak?",
  ],
  en: [
    "How much is the monthly fuel allowance?",
    "Why is stock late in Makassar, what's still open?",
    "Tell me about Project Kenari",
    "What is the salary grade for level 3?",
    "How does annual leave work, can it carry over?",
  ],
};
