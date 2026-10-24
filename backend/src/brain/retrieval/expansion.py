"""Query normalization and expansion for lexical search (design doc 11.6).

Embeddings are multilingual already; this helps the keyword and trigram legs: informal Indonesian
abbreviations ("brp", "yg", "blm") and Indonesian <-> English phrasing ("fuel allowance" also
searches "uang bensin").
"""

import re

ABBREVIATIONS = {
    "brp": "berapa", "brapa": "berapa", "yg": "yang", "gpp": "tidak apa-apa", "tdk": "tidak",
    "gak": "tidak", "ga": "tidak", "gk": "tidak", "nggak": "tidak", "utk": "untuk",
    "dgn": "dengan", "blm": "belum", "sdh": "sudah", "udh": "sudah", "krn": "karena",
    "karna": "karena", "dr": "dari",
    "tgl": "tanggal", "bs": "bisa", "knp": "kenapa", "gmn": "bagaimana", "gimana": "bagaimana",
    "dtg": "datang", "jg": "juga", "sy": "saya", "aja": "saja", "skrg": "sekarang", "bln": "bulan",
    "thn": "tahun", "org": "orang", "kpn": "kapan", "dmn": "dimana", "lg": "lagi",
    "sm": "sama", "trs": "terus", "tp": "tapi", "ttg": "tentang",
}  # fmt: skip

# Phrases that mean the same thing; any phrase present adds the others' words.
SYNONYMS: list[tuple[str, ...]] = [
    ("uang bensin", "tunjangan transport", "fuel allowance", "transport allowance", "bensin"),
    ("cuti", "leave", "annual leave", "cuti tahunan", "time off"),
    ("gaji", "salary", "pay", "upah"),
    ("grade gaji", "salary grade", "pay grade", "level gaji"),
    ("lembur", "overtime"),
    ("uang makan", "meal allowance"),
    ("stok", "stock", "inventory", "persediaan"),
    ("telat", "terlambat", "delay", "late", "keterlambatan"),
    ("proyek", "project"),
    ("pelatihan", "training", "kursus"),
    ("beasiswa", "scholarship"),
    ("reimburse", "reimbursement", "klaim", "claim", "penggantian biaya"),
    ("karyawan baru", "new hire", "new employee", "onboarding"),
    ("probation", "masa percobaan", "masa probation"),
    ("approve", "approval", "persetujuan", "menyetujui", "kewenangan"),
    ("kapal", "ship", "vessel"),
    ("tiket", "ticket", "task", "issue"),
]

# Postgres' `indonesian` config has no stopword list, and English stopwords leak through it too
# because both configs are OR-ed; drop question/function words so they don't dominate ranking.
STOPWORDS = frozenset(
    "yang di ke dari dan atau untuk dengan apa apakah siapa kenapa mengapa bagaimana berapa kapan "
    "dimana mana ini itu ada adalah saya aku kamu anda kita kami mereka dia ya tidak belum sudah "
    "akan bisa harus juga saja lagi sih dong kah nya per oleh pada dalam tentang sama jadi kalau "
    "kalo tapi tolong mohon hal bapak ibu pak bu mas mbak deh kok nih tuh loh "
    "the is are was were be a an of to in for on at by with what which who whom how when where "
    "why do does did i me my we our you your it its this that these those and or not can could "
    "should would will please tell about any".split()
)
_TOKEN = re.compile(r"[0-9A-Za-zÀ-ÿ]+")
# Generic words that don't identify a name/project/place, so trigram matching skips them.
_COMMON = STOPWORDS | set(
    "have there their they bulan month tahun year hari project proyek kebijakan policy berlaku "
    "karyawan employee sekarang masih open task tiket".split()
)


def normalize(query: str) -> str:
    return " ".join(ABBREVIATIONS.get(t, t) for t in _TOKEN.findall(query.lower()))


def lexical_terms(query: str, extra: tuple[str, ...] | list[str] = ()) -> list[str]:
    """Distinct lowercase words for an OR-tsquery: query words + entity words + synonyms."""
    text = " ".join([normalize(query), *(normalize(e) for e in extra)])
    words = set(text.split())
    for group in SYNONYMS:
        if any(re.search(rf"\b{re.escape(p)}\b", text) for p in group):
            for phrase in group:
                words.update(phrase.split())
    return sorted(w for w in words if len(w) >= 2 and w not in STOPWORDS)


def name_terms(query: str, extra: tuple[str, ...] | list[str] = ()) -> list[str]:
    """Candidates for fuzzy (trigram) matching: names, projects, places, typos ("Kenary")."""
    out: list[str] = []
    for t in [*extra, *_TOKEN.findall(query)]:
        low = t.lower()
        if len(low) >= 4 and low not in _COMMON and low not in ABBREVIATIONS and low not in out:
            out.append(low)
    return out[:6]


def tsquery(terms: list[str]) -> str:
    """Safe `to_tsquery` input: alphanumerics only, OR-joined."""
    clean = [re.sub(r"[^0-9a-z]", "", t) for t in terms]
    return " | ".join(t for t in clean if t)
