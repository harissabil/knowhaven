"""Personal-data detection and masking (design doc 11.4).

Masking happens at ingestion: `chunks.text_masked` is what the LLM and lexical search see;
`text_raw` is only released to roles with pii_permissions when the question needs it.
"""

import re
from dataclasses import dataclass

PII_TYPES = ("nik", "phone", "email", "npwp", "bank_account")

# 16 digits, written together or in groups of four ("3171 0125 0199 0003", "3171-0125-...").
NIK_RE = re.compile(r"(?<![\d.,])(\d{4}([\s.-]?)\d{4}\2\d{4}\2\d{4})(?![\d])")
# Labelled as a NIK/KTP: masked even when the number itself is invalid (typo, 15 digits, day 32).
NIK_LABEL_RE = re.compile(
    r"(?i)\b(?:nik|ktp|nomor\s+induk\s+kependudukan)\b[^\d\n,;|]{0,15}((?:\d[\s.-]?){13,17}\d)(?!\d)"
)
# Mobile numbers: 08.., 62 8.., +62 8.., with spaces, dashes, dots or brackets
# ("(0812) 3456 7890", "+62 (812) 3456-7890"). Not a run inside an amount like "Rp1.080.000.000".
PHONE_RE = re.compile(
    r"(?<![\d+])(?<!\d[.,])"
    r"(\(?(?:\+62|62|0)\)?[\s.-]?\(?8\d{1,2}\)?(?:[\s.-]?\d){6,9})(?!\d)"
)
# After a phone label any grouping counts: "HP 08 12 34 56 78 90".
PHONE_LABEL_RE = re.compile(
    r"(?i)\b(?:hp|telp|telepon|phone|ponsel|wa|whatsapp)\b[^\d\n,;|]{0,10}"
    r"(\(?(?:\+62|62|0)(?:[\s.\-()]{0,2}\d){8,12})(?!\d)"
)
EMAIL_RE = re.compile(r"(?<![\w.+-])([A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}))")
# Spelled-out addresses: "rina[at]gmail.com", "rina (at) gmail (dot) com", "rina at gmail dot com".
_DOT = r"(?:\s*(?:\.|\[dot\]|\(dot\))\s*|\s+dot\s+)"
EMAIL_OBF_RE = re.compile(
    rf"(?i)(?<![\w.+-])([A-Za-z0-9._%+-]+(?:\s*[\[({{]\s*at\s*[\])}}]\s*|\s+at\s+)"
    rf"((?:[A-Za-z0-9-]+{_DOT})+[A-Za-z]{{2,}}))\b"
)
NPWP_RE = re.compile(
    r"(?i)(?:(?<!\d)(\d{2}[.-]\d{3}[.-]\d{3}[.-]\d[.-]\d{3}[.-]\d{3})(?!\d)"
    r"|\bnpwp\b[^\d\n,;|]{0,15}((?:\d[\s.-]?){14,15}\d)(?!\d))"
)
BANK_RE = re.compile(
    r"(?i)\b(?:no\.?\s*rek(?:ening)?|rekening|rek|account|acc|bca|bni|bri|mandiri|bsi|cimb|btn)\b"
    r"(?:(?![,\n;|]|\b(?:nik|npwp|hp|telp|telepon|phone)\b)[^\d]){0,25}((?:\d[\s-]?){9,15}\d)(?!\d)"
)
# No bank name, but clearly an account: "transfer ke 1234567890", "norek ...", "... a.n. Rina".
BANK_CTX_RE = re.compile(
    r"(?i)(?:\b(?:transfer|tf|kirim)\s+(?:ke\s+)?|\bnorek\b\W{0,3}|\b(?:va|virtual\s+account)\b\W{0,3})"
    r"((?:\d[\s-]?){9,15}\d)(?!\d)"
    r"|(?<![\d.,])((?:\d[\s-]?){9,15}\d)(?=\s*(?:a\.\s?n\b|a/n\b|atas\s+nama\b))"
)


@dataclass(frozen=True)
class PiiSpan:
    type: str
    start: int
    end: int

    def as_dict(self) -> dict:
        return {"type": self.type, "start": self.start, "end": self.end}


def _valid_nik(s: str) -> bool:
    """Province code 11-94, birth day 1-31 (+40 for women), month 1-12."""
    province, day, month = int(s[:2]), int(s[6:8]), int(s[8:10])
    if day > 40:
        day -= 40
    return 11 <= province <= 94 and 1 <= day <= 31 and 1 <= month <= 12


def _email_domain(spelled: str) -> str:
    """ "gmail dot com" / "gmail[dot]com" / "gmail . com" -> "gmail.com"."""
    return re.sub(_DOT, ".", spelled, flags=re.IGNORECASE).lower()


def detect(text: str, company_domains: frozenset[str] = frozenset()) -> list[PiiSpan]:
    """Non-overlapping spans. Priority when they overlap: NPWP, labelled NIK, bank (keyword
    context), NIK, phone, email. Emails on a company domain are work contacts, not personal data."""
    found: list[PiiSpan] = []
    for m in NPWP_RE.finditer(text):
        g = 1 if m.group(1) else 2
        found.append(PiiSpan("npwp", m.start(g), m.end(g)))
    for m in NIK_LABEL_RE.finditer(text):
        found.append(PiiSpan("nik", m.start(1), m.end(1)))
    for m in BANK_RE.finditer(text):
        found.append(PiiSpan("bank_account", m.start(1), m.end(1)))
    for m in BANK_CTX_RE.finditer(text):
        g = 1 if m.group(1) else 2
        found.append(PiiSpan("bank_account", m.start(g), m.end(g)))
    for m in NIK_RE.finditer(text):
        if _valid_nik(re.sub(r"\D", "", m.group(1))):
            found.append(PiiSpan("nik", m.start(1), m.end(1)))
    for rx in (PHONE_RE, PHONE_LABEL_RE):
        for m in rx.finditer(text):
            found.append(PiiSpan("phone", m.start(1), m.end(1)))
    for m in EMAIL_RE.finditer(text):
        if m.group(2).lower() not in company_domains:
            found.append(PiiSpan("email", m.start(1), m.end(1)))
    for m in EMAIL_OBF_RE.finditer(text):
        if _email_domain(m.group(2)) not in company_domains:
            found.append(PiiSpan("email", m.start(1), m.end(1)))

    taken: list[PiiSpan] = []
    for span in found:  # already in priority order
        if all(span.end <= t.start or span.start >= t.end for t in taken):
            taken.append(span)
    return sorted(taken, key=lambda s: s.start)


def _mask_digits(value: str, keep_start: int, keep_end: int) -> str:
    digits = [c for c in value if c.isdigit()]
    n = len(digits)
    return (
        "".join(digits[:keep_start])
        + "*" * max(n - keep_start - keep_end, 0)
        + "".join(digits[n - keep_end :] if keep_end else [])
    )


def _mask_keep_format(value: str, keep_start: int, keep_end: int) -> str:
    idx = [i for i, c in enumerate(value) if c.isdigit()]
    keep = set(idx[:keep_start] + idx[len(idx) - keep_end :])
    return "".join(c if not c.isdigit() or i in keep else "*" for i, c in enumerate(value))


def mask_value(pii_type: str, value: str) -> str:
    if pii_type == "nik":
        return _mask_digits(value, 4, 4)  # 3201********0001
    if pii_type == "phone":
        # One shape whatever the input: "+62 812-3456-7890" and "(0812) 3456 7890" -> 0812****7890
        digits = re.sub(r"\D", "", value)
        if digits.startswith("62"):
            digits = "0" + digits[2:]
        return _mask_digits(digits, 4, 4)
    if pii_type == "email":
        local, at, domain = value.partition("@")
        if not at:  # spelled out: "rina at gmail dot com"
            m = EMAIL_OBF_RE.match(value)
            local, domain = (value.split()[0], _email_domain(m.group(2))) if m else (value, "")
            local = re.split(r"\s*[\[({]", local)[0]
        return f"{local[:1]}***@{domain}"  # r***@gmail.com
    if pii_type == "npwp":
        return _mask_keep_format(value, 2, 3)  # 12.***.***.*-***.345
    if pii_type == "bank_account":
        return _mask_digits(value, 0, 4)  # ******1234
    raise ValueError(pii_type)


def mask(text: str, spans: list[PiiSpan]) -> str:
    out, pos = [], 0
    for s in spans:
        out.append(text[pos : s.start])
        out.append(mask_value(s.type, text[s.start : s.end]))
        pos = s.end
    out.append(text[pos:])
    return "".join(out)


def mask_text(
    text: str, company_domains: frozenset[str] = frozenset()
) -> tuple[str, list[PiiSpan]]:
    spans = detect(text, company_domains)
    return mask(text, spans), spans


def mask_except(
    text: str, allowed: frozenset[str], company_domains: frozenset[str] = frozenset()
) -> tuple[str, bool]:
    """Raw text with only the `allowed` PII types left visible (design doc 11.4: release raw data
    only to roles with pii_permissions for that type). Returns (text, revealed_anything)."""
    spans = detect(text, company_domains)
    hidden = [s for s in spans if s.type not in allowed]
    return mask(text, hidden), len(hidden) < len(spans)
