"""Havi's system sources about Knowhaven itself (not company data):

- HELP-<slug>: how-to articles for the app, in `articles/*.md`, shipped with the code. Each has an
  audience; code hands an article only to members whose role can do what it describes.
- ME-access: the asker's own roles and what they can do, built per request.

A question that matches an article outside the asker's role gets one line in ME-access saying that
feature isn't available to them (and whom to contact), never the article itself. Only the feature
asked about is named, so a member is not shown everything their role can't do.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from brain.rbac.capabilities import AUDIENCES, Caps

ACCESS_ID = "ME-access"
HELP_PREFIX = "HELP-"
MAX_ARTICLES = 2
MAX_FOLDERS = 12
_DIR = Path(__file__).parent / "articles"
# Articles change only with a deploy; the code's own date is a fair "updated" stamp.
STAMP = datetime(2026, 11, 22, tzinfo=UTC)


@dataclass(frozen=True)
class Article:
    id: str
    title: str
    audience: str
    page: str | None
    aliases: tuple[str, ...]
    body: str


def _parse(path: Path) -> Article:
    raw = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n(.*)", raw, flags=re.DOTALL)
    if not m:
        raise ValueError(f"{path.name}: missing front matter")
    meta = dict(line.split(":", 1) for line in m.group(1).splitlines() if ":" in line)
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    art = Article(
        id=meta["id"],
        title=meta["title"],
        audience=meta["audience"],
        page=meta.get("page") or None,
        aliases=tuple(a.strip() for a in meta.get("aliases", "").split(",") if a.strip()),
        body=m.group(2).strip(),
    )
    if not art.id.startswith(HELP_PREFIX) or art.audience not in AUDIENCES:
        raise ValueError(f"{path.name}: bad id or audience")
    return art


ARTICLES: dict[str, Article] = {a.id: a for a in (_parse(p) for p in sorted(_DIR.glob("*.md")))}


def is_system_id(citation_id: str) -> bool:
    """Citable ids that are not source items (no folder, no item-level permission)."""
    base = citation_id.split("#")[0]
    return base == ACCESS_ID or base in ARTICLES or base == "COMPANY-profile"


# Common Indonesian affixes, so "undang karyawan" also finds "mengundang karyawan" and "upload"
# finds "mengupload". Nasal-mutating forms ("tambah" -> "menambah") are listed as aliases instead.
_PREFIX = r"(?:meng|meny|mem|men|me|di|ber|ter|peng|pen|pem|pe)?"
_SUFFIX = r"(?:kan|an|nya|i)?"


def _word(w: str) -> str:
    return rf"\b{_PREFIX}{re.escape(w)}{_SUFFIX}\b"


def _alias_in(alias: str, text: str) -> bool:
    """Like policy.idk.term_in (whole alias, or all its words in any order), affix-tolerant."""
    words = alias.split()
    if re.search(r"\s+".join(_word(w) for w in words), text):
        return True
    return len(words) > 1 and all(re.search(_word(w), text) for w in words)


def _score(a: Article, texts: list[str]) -> int:
    """Longest matching alias over the question and its search queries (0 = no match)."""
    best = 0
    for alias in a.aliases:
        if any(_alias_in(alias, t) for t in texts):
            best = max(best, len(alias))
    return best


def match(texts: list[str], caps: Caps) -> tuple[list[Article], list[Article]]:
    """(articles for this member, best article they asked about but may not use).

    The second list has at most one entry, and only when no article the member may use matches at
    least as well: an admin-only feature named in passing doesn't produce a "not available" note.
    """
    scored = sorted(
        ((s, a) for a in ARTICLES.values() if (s := _score(a, texts))),
        key=lambda x: (-x[0], x[1].id),
    )
    allowed = [a for _, a in scored if caps.allows(a.audience)][:MAX_ARTICLES]
    top_allowed = next((s for s, a in scored if caps.allows(a.audience)), 0)
    denied = [a for s, a in scored if not caps.allows(a.audience) and s > top_allowed][:1]
    return allowed, denied


def readable(article_id: str, caps: Caps) -> Article | None:
    a = ARTICLES.get(article_id.split("#")[0])
    return a if a and caps.allows(a.audience) else None


# --- ME-access ---------------------------------------------------------------------------------

_LINES: list[tuple[str, str, str]] = [
    # (capability, Indonesian, English). Menu names match the app's sidebar.
    ("everyone", "Bertanya ke Havi dan membuka sumber setiap jawaban (menu Tanya Havi)",
     "Ask Havi and open the source of every answer (Ask Havi menu)"),
    ("everyone", "Membaca dokumen di folder yang terbuka untuk peran Anda (menu Dokumen)",
     "Read documents in the folders open to your roles (Documents menu)"),
    ("everyone", "Mengajukan akses ke topik yang memerlukan izin, lewat tombol Ajukan akses di jawaban Havi",
     "Request access to a restricted topic with the Request access button in Havi's answer"),
    ("everyone", "Menghubungkan WorkBuddy dengan token pribadi (menu Hubungkan WorkBuddy)",
     "Connect WorkBuddy with a personal token (Connect WorkBuddy menu)"),
    ("everyone", "Mengatur tema, bahasa, dan ukuran teks (menu Pengaturan)",
     "Change theme, language and text size (Settings menu)"),
    ("everyone", "Bergabung ke perusahaan lain dengan kode, atau membuat perusahaan baru, dari pemilih perusahaan",
     "Join another company with a code, or create a new company, from the company switcher"),
    ("uploader", "Mengunggah dokumen (PDF, DOCX, TXT, Markdown) ke folder (menu Upload Data)",
     "Upload documents (PDF, DOCX, TXT, Markdown) to a folder (Upload Data menu)"),
    ("approver", "Menyetujui atau menolak permintaan akses dan draf perubahan dokumen (menu Persetujuan)",
     "Approve or reject access requests and document change drafts (Approvals menu)"),
    ("auditor", "Memeriksa pertanyaan, sumber, keputusan, dan integritas log (menu Audit Log)",
     "Review questions, sources, decisions and log integrity (Audit Log menu)"),
    ("admin", "Mengubah profil perusahaan, bidang usaha, dan domain email (menu Pengaturan Perusahaan)",
     "Edit the company profile, industry and email domains (Company Settings menu)"),
    ("admin", "Menyetujui calon anggota, mengatur peran, dan mengeluarkan anggota (menu Anggota)",
     "Approve new members, set roles and remove members (Members menu)"),
    ("admin", "Membagikan kode perusahaan dan membuat tautan undangan (menu Undangan)",
     "Share the company code and create invite links (Invites menu)"),
    ("admin", "Mengatur siapa boleh melihat tiap folder (menu Container & Izin), approver (menu Approver), "
     "dan pemilik topik (menu Pemilik Topik)",
     "Set who may see each folder (Containers & Access), approvers (Approvers) and topic owners (Topic Owners)"),
    ("admin", "Mengatur jenis data pribadi yang boleh dilihat tiap peran (menu Izin Data Pribadi)",
     "Set which personal-data types each role may see (PII Access menu)"),
    ("admin", "Menghubungkan Slack, Jira, dan Confluence (menu Integrasi)",
     "Connect Slack, Jira and Confluence (Integrations menu)"),
]  # fmt: skip
_PII_NAMES = {"nik": "NIK", "phone": "nomor HP / phone", "email": "email pribadi / personal email",
              "npwp": "NPWP", "bank_account": "rekening bank / bank account"}  # fmt: skip


def access_text(
    *,
    name: str | None,
    company: str,
    roles: list[str],
    caps: Caps,
    folders: list[str],
    folder_total: int,
    contact: str,
    denied: list[Article] = (),
) -> str:
    lines = []
    if name:
        lines.append(f"Nama / Name: {name}")
    lines.append(f"Perusahaan / Company: {company}")
    lines.append(f"Peran Anda / Your roles: {', '.join(roles) or '-'}")
    lines.append("Yang bisa Anda lakukan di Knowhaven / What you can do in Knowhaven:")
    lines += [f"- {i} / {e}" for cap, i, e in _LINES if caps.allows(cap)]
    if caps.pii:
        kinds = ", ".join(_PII_NAMES[k] for k in sorted(caps.pii))
        lines.append(
            f"- Melihat data pribadi asli saat tugas memerlukannya: {kinds} / "
            f"See unmasked personal data when a task needs it: {kinds}"
        )
    if folders:
        more = f" (+{folder_total - len(folders)})" if folder_total > len(folders) else ""
        lines.append(
            f"Folder yang bisa Anda baca / Folders you can read: {', '.join(folders)}{more}"
        )
    else:
        lines.append("Folder yang bisa Anda baca / Folders you can read: belum ada / none yet")
    for a in denied:
        lines.append(
            f"Tidak tersedia untuk peran Anda / Not available for your role: {a.title}. "
            f"Hubungi / Contact: {contact}"
        )
    return "\n".join(lines)
