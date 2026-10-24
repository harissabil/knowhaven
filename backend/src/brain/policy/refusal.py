"""Category refusals (design doc 11.2): decided from the question's category and the user's
roles only, never from data, so a refusal can't hint that data exists. The list is explicit here
and is reproduced in the accountability sheet.

  personal_compensation  salary/pay of a specific person, for anyone without the HR role (T15, T19)
  write_action           requests to change/send/delete something (the agent only reads; changes
                         go through human approval, 12.2)

Identity claims in the question ("saya HRD") are ignored: roles come from the session only.
"""

import re
from dataclasses import dataclass

# "gaji Budi", "gaji Pak Budi", "salary of Sari", "berapa take home pay bu Sari"
_PAY = (
    r"(?:[Gg]aji|[Ss]alary|[Pp]enghasilan|[Tt]ake[- ][Hh]ome(?: [Pp]ay)?|[Ss]lip [Gg]aji|[Uu]pah)"
)
_HONORIFIC = r"(?:(?:[Pp]ak|[Bb]u|[Bb]apak|[Ii]bu|[Mm]as|[Mm]bak|[Ss]i|[Mm]r\.?|[Mm]s\.?)\s+)?"
_NAME = r"([A-Z][a-z]{2,})"
_PERSON_PAY = re.compile(
    rf"{_PAY}\s+(?:(?:of|dari|milik|si)\s+)?{_HONORIFIC}{_NAME}|{_NAME}(?:'s)?\s+{_PAY}"
)
_NOT_A_PERSON = {"Level", "Pokok", "Karyawan", "Bulanan", "Tahunan", "Grade", "Minimum", "Rata", "Standar",
                 "Staf", "Staff", "Manager", "Direksi", "Tabel", "Per", "Saya", "Kami", "The", "Ump", "Umr"}  # fmt: skip
_WRITE = re.compile(
    r"(?i)\b(?:ubah|ganti|edit|hapus|delete|update|perbarui|kirim(?:kan)?|send|post(?:kan)?|buat(?:kan)? tiket|"
    r"approve|setujui|tolak|reject|transfer)\b.{0,60}\b(?:sop|halaman|page|confluence|jira|tiket|ticket|email|"
    r"pesan|message|slack|data|dokumen|document|akses|access|permintaan|request)\b"
)

PERSONAL_COMPENSATION = "personal_compensation"
WRITE_ACTION = "write_action"

TEXT = {
    PERSONAL_COMPENSATION: {
        "id": "Saya tidak bisa memberikan informasi gaji atau kompensasi individu. Untuk pertanyaan seperti ini, "
              "silakan hubungi {contact}.",
        "en": "I can't share individual salary or compensation information. For questions like this, please "
              "contact {contact}.",
    },
    WRITE_ACTION: {
        "id": "Saya hanya bisa membaca dan menjawab, tidak bisa mengubah atau mengirim apa pun. Perubahan dokumen "
              "diajukan sebagai draf dan harus disetujui manusia.",
        "en": "I can only read and answer; I can't change or send anything. Document changes are proposed as "
              "drafts and need human approval.",
    },
}  # fmt: skip


@dataclass(frozen=True)
class Refusal:
    category: str


def _names(question: str) -> list[str]:
    out = []
    for m in _PERSON_PAY.finditer(question):
        name = m.group(1) or m.group(2)
        if name and name not in _NOT_A_PERSON:
            out.append(name)
    return out


def check(
    question: str, role_keys: frozenset[str], llm_says_person_pay: bool = False
) -> Refusal | None:
    if (llm_says_person_pay or _names(question)) and "hr" not in role_keys:
        return Refusal(PERSONAL_COMPENSATION)
    if _WRITE.search(question):
        return Refusal(WRITE_ACTION)
    return None


def refusal_text(r: Refusal, lang: str, contact: str) -> str:
    return TEXT[r.category]["en" if lang == "en" else "id"].format(contact=contact)
