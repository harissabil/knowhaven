import type { MascotState } from "@/components/mascot/Mascot";

export type Lang = "id" | "en";
export interface Citation { id: string; label: string; kind: "chat" | "doc" | "task"; note?: string }
export interface Answer {
  text: string;
  state: MascotState;
  citations: Citation[];
  conflict?: { used: string; outdated: string; reason: string };
  idkOwner?: string;
  canRequestAccess?: boolean;
  injectionIgnored?: boolean;
}

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

// Identical on purpose for hidden and nonexistent topics (doc §2.3 test 1).
const IDK = (owner: string, lang: Lang): Answer => ({
  text: lang === "id"
    ? "Saya tidak menemukan informasi tentang itu di data yang bisa Anda akses. Silakan hubungi pemilik topiknya."
    : "I couldn't find information about that in the data you can access. Please contact the topic owner.",
  state: "idk", citations: [], idkOwner: owner,
});

export function answerFor(q: string, lang: Lang): Answer {
  const s = q.toLowerCase();
  const id = lang === "id";
  if (/bensin|reimburse|fuel/.test(s))
    return {
      text: id
        ? "Uang bensin per bulan adalah **Rp750.000** [1][2]. SOP Reimbursement masih menulis Rp500.000, tetapi pengumuman HR yang lebih baru dan berwenang menggantikannya."
        : "The monthly fuel allowance is **Rp750,000** [1][2]. The Reimbursement SOP still says Rp500,000, but the newer, authoritative HR announcement replaces it.",
      state: "conflict",
      citations: [
        { id: "CHAT-pengumuman-hr-0031", label: id ? "#pengumuman-hr, Sari Kusuma, 14 Okt 2026" : "#pengumuman-hr, Sari Kusuma, 14 Oct 2026", kind: "chat" },
        { id: "DOC-sop-reimbursement#3", label: id ? "SOP Reimbursement v2 (usang)" : "Reimbursement SOP v2 (outdated)", kind: "doc", note: id ? "usang" : "outdated" },
      ],
      conflict: { used: "CHAT-pengumuman-hr-0031", outdated: "DOC-sop-reimbursement#3",
        reason: id ? "Pengumuman resmi HR lebih baru dan berwenang daripada SOP." : "The official HR announcement is newer and more authoritative than the SOP." },
    };
  if (/makassar|stok|stock/.test(s))
    return {
      text: id
        ? "Stok telat karena **kapal tertunda cuaca** [1]. Prosedur eskalasi mengikuti SOP Distribusi bagian 4.2 [2]. Yang masih open: TASK-OPS-118, TASK-OPS-121, TASK-OPS-125 [3][4][5]."
        : "Stock is late because the **ship was delayed by weather** [1]. Escalation follows Distribution SOP section 4.2 [2]. Still open: TASK-OPS-118, TASK-OPS-121, TASK-OPS-125 [3][4][5].",
      state: "answering",
      citations: [
        { id: "CHAT-ops-makassar-0142", label: "#ops-makassar", kind: "chat" },
        { id: "DOC-sop-distribusi#4.2", label: id ? "SOP Distribusi Antar-Gudang" : "Inter-Warehouse Distribution SOP", kind: "doc" },
        { id: "TASK-OPS-118", label: id ? "Jira OPS-118, open" : "Jira OPS-118, open", kind: "task" },
        { id: "TASK-OPS-121", label: "Jira OPS-121, open", kind: "task" },
        { id: "TASK-OPS-125", label: "Jira OPS-125, open", kind: "task" },
      ],
    };
  if (/kenari|merpati/.test(s)) return IDK(id ? "HR (people@srn.example)" : "HR (people@srn.example)", lang);
  if (/gaji|grade|salary/.test(s))
    return {
      ...IDK("Keuangan", lang),
      text: id ? "Topik ini dibatasi. Anda bisa mengajukan akses ke manager." : "This topic is restricted. You can request access from a manager.",
      state: "refusing", canRequestAccess: true, idkOwner: id ? "Keuangan" : "Finance",
    };
  if (/cuti|leave/.test(s))
    return {
      text: id
        ? "Cuti tahunan **12 hari** per tahun, sisa maksimal 5 hari bisa dibawa ke tahun berikutnya [1]."
        : "Annual leave is **12 days** per year; up to 5 unused days can carry over to next year [1].",
      state: "answering",
      citations: [{ id: "DOC-kebijakan-cuti#2", label: id ? "Kebijakan Cuti" : "Leave Policy", kind: "doc" }],
    };
  if (/abaikan|ignore|instruction/.test(s)) return { ...IDK("HR", lang), injectionIgnored: true };
  return IDK("HR (people@srn.example)", lang);
}
