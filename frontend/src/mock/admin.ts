type L2 = { id: string; en: string };

export const MANAGERS: { scope: string; target: L2; manager: string }[] = [
  { scope: "department", target: { id: "Operasional & Gudang", en: "Operations & Warehouse" }, manager: "Budi Hartono" },
  { scope: "container", target: { id: "Space FIN: Grade Gaji", en: "Space FIN: Salary Grades" }, manager: "Budi Hartono" },
  { scope: "topic", target: { id: "grade_gaji", en: "salary_grades" }, manager: "Sari Kusuma" },
];
export const TOPICS = [
  { key: "uang_bensin", owner: "Sari Kusuma (HR)", fallback: "people@srn.example", tier: "open" },
  { key: "cuti", owner: "Sari Kusuma (HR)", fallback: "people@srn.example", tier: "open" },
  { key: "pelatihan", owner: "Sari Kusuma (HR)", fallback: "people@srn.example", tier: "open" },
  { key: "grade_gaji", owner: "Sari Kusuma (HR)", fallback: "finance@srn.example", tier: "gated" },
];
export const PII_TYPES = ["NIK", "Phone", "Email", "NPWP", "Bank"];
export const PII_ROLES = ["hr", "staff", "ops", "project_mgr", "auditor"];
export const PII_DEFAULT: Record<string, string[]> = { hr: PII_TYPES };
export const INVITES: { code: string; role: string; expires: L2; uses: string; active: boolean }[] = [
  { code: "INV-8F2K", role: "new_hire", expires: { id: "31 Okt 2026", en: "31 Oct 2026" }, uses: "2/10", active: true },
  { code: "INV-QX91", role: "staff", expires: { id: "15 Okt 2026", en: "15 Oct 2026" }, uses: "5/5", active: false },
];

export interface Source { id: string; title: L2; kind: string; container: string; author: string; date: L2; text: L2; piiText?: string }
export const SOURCES: Source[] = [
  { id: "CHAT-pengumuman-hr-0031", title: { id: "Pengumuman HR: uang bensin", en: "HR announcement: fuel allowance" }, kind: "chat", container: "#pengumuman-hr",
    author: "Sari Kusuma", date: { id: "14 Okt 2026", en: "14 Oct 2026" },
    text: { id: "Mulai bulan ini uang bensin naik jadi Rp750.000 per bulan. Berlaku untuk semua karyawan operasional.",
      en: "Starting this month the fuel allowance rises to Rp750,000 per month. Applies to all operations staff." } },
  { id: "DOC-sop-reimbursement#3", title: { id: "SOP Reimbursement v2", en: "Reimbursement SOP v2" }, kind: "doc", container: "Space HR",
    author: "HR", date: { id: "02 Agu 2026", en: "02 Aug 2026" },
    text: { id: "Uang bensin: Rp500.000 per bulan. Klaim diajukan sebelum tanggal 25.", en: "Fuel allowance: Rp500,000 per month. Claims must be filed before the 25th." } },
  { id: "DOC-sop-distribusi#4.2", title: { id: "SOP Distribusi Antar-Gudang 4.2", en: "Inter-Warehouse Distribution SOP 4.2" }, kind: "doc", container: "Space OPS",
    author: "Ops", date: { id: "10 Sep 2026", en: "10 Sep 2026" },
    text: { id: "Keterlambatan lebih dari 24 jam dieskalasi ke manager operasional dan dicatat di Jira.",
      en: "Delays over 24 hours are escalated to the operations manager and logged in Jira." } },
  { id: "CHAT-ops-makassar-0142", title: { id: "Pesan #ops-makassar", en: "Message in #ops-makassar" }, kind: "chat", container: "#ops-makassar",
    author: "Rina Wulandari", date: { id: "20 Okt 2026", en: "20 Oct 2026" },
    text: { id: "Kapal dari Surabaya ketahan cuaca, estimasi tiba lusa. Hubungi Pak Budi di 0812-3456-7890.",
      en: "The ship from Surabaya is held up by weather, ETA the day after tomorrow. Call Mr. Budi at 0812-3456-7890." },
    piiText: "0812-3456-7890" },
  { id: "DOC-kebijakan-cuti#2", title: { id: "Kebijakan Cuti 2", en: "Leave Policy 2" }, kind: "doc", container: "Space HR",
    author: "HR", date: { id: "05 Agu 2026", en: "05 Aug 2026" },
    text: { id: "Cuti tahunan 12 hari. Maksimal 5 hari bisa dibawa ke tahun berikutnya.", en: "Annual leave is 12 days. Up to 5 days can carry over to next year." } },
  { id: "TASK-OPS-118", title: { id: "OPS-118 Konfirmasi jadwal kapal", en: "OPS-118 Confirm ship schedule" }, kind: "task", container: "Jira OPS",
    author: "Rina Wulandari", date: { id: "18 Okt 2026", en: "18 Oct 2026" },
    text: { id: "Status: open. Assignee: Rina. Prioritas: tinggi.", en: "Status: open. Assignee: Rina. Priority: high." } },
  { id: "TASK-OPS-121", title: { id: "OPS-121 Re-route stok Makassar", en: "OPS-121 Re-route Makassar stock" }, kind: "task", container: "Jira OPS",
    author: "Budi Hartono", date: { id: "19 Okt 2026", en: "19 Oct 2026" },
    text: { id: "Status: open. Assignee: Budi.", en: "Status: open. Assignee: Budi." } },
  { id: "TASK-OPS-125", title: { id: "OPS-125 Update ETA ke cabang", en: "OPS-125 Update ETA to branch" }, kind: "task", container: "Jira OPS",
    author: "Rina Wulandari", date: { id: "21 Okt 2026", en: "21 Oct 2026" },
    text: { id: "Status: open. Assignee: Rina.", en: "Status: open. Assignee: Rina." } },
];

export const INDUSTRIES: { value: string; id: string; en: string }[] = [
  { value: "distribution", id: "Distribusi & Perdagangan", en: "Distribution & Trading" },
  { value: "manufacturing", id: "Manufaktur", en: "Manufacturing" },
  { value: "it", id: "Teknologi Informasi", en: "Information Technology" },
  { value: "finance", id: "Keuangan & Perbankan", en: "Finance & Banking" },
  { value: "healthcare", id: "Kesehatan", en: "Healthcare" },
  { value: "education", id: "Pendidikan", en: "Education" },
  { value: "construction", id: "Konstruksi & Properti", en: "Construction & Property" },
  { value: "logistics", id: "Logistik & Transportasi", en: "Logistics & Transportation" },
  { value: "retail", id: "Ritel & E-commerce", en: "Retail & E-commerce" },
  { value: "fnb", id: "Makanan & Minuman", en: "Food & Beverage" },
  { value: "agri", id: "Pertanian & Perkebunan", en: "Agriculture & Plantation" },
  { value: "energy", id: "Energi & Pertambangan", en: "Energy & Mining" },
  { value: "hospitality", id: "Pariwisata & Perhotelan", en: "Tourism & Hospitality" },
  { value: "telecom", id: "Telekomunikasi", en: "Telecommunications" },
  { value: "media", id: "Media & Kreatif", en: "Media & Creative" },
  { value: "services", id: "Jasa Profesional & Konsultan", en: "Professional Services & Consulting" },
  { value: "public", id: "Pemerintahan & Nirlaba", en: "Government & Non-profit" },
  { value: "other", id: "Lainnya (Other)", en: "Other" },
];
