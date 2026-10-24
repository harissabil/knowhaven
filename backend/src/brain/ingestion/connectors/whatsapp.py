"""WhatsApp group export (.txt) parser (design doc 15.4).

Handles Android and iOS line formats, Indonesian and English locales:
    23/10/26 09.15 - Rina: stok belum datang
    23/10/2026, 09:15 - Rina: stok belum datang
    [23/10/26 09.15.32] Rina: stok belum datang
    [10/23/26, 9:15:32 AM] Rina: ...            (US order is detected when day > 12 is impossible)
Multiline messages, system lines ("... bergabung", encryption notice) and media placeholders.
Times are WIB (Asia/Jakarta) unless told otherwise.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from brain.ingestion.chunking import slugify
from brain.ingestion.types import IngestItem

WIB = timezone(timedelta(hours=7))

_LINE = re.compile(
    r"^‎?\[?(\d{1,2})/(\d{1,2})/(\d{2,4}),?\s+(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?"
    r"(?:\s?([AaPp])\.?[Mm]\.?)?\]?\s*(?:-\s+)?(.*)$"
)
_MEDIA = re.compile(
    r"^‎?<?(?:media tidak disertakan|media omitted|gambar tidak disertakan|"
    r"image omitted|video omitted|audio omitted|sticker omitted|stiker tidak disertakan|"
    r"dokumen tidak disertakan|document omitted|pesan ini telah dihapus|"
    r"this message was deleted)>?$",
    re.IGNORECASE,
)


@dataclass
class WaMessage:
    ts: datetime
    sender: str
    text: str


def _parse_dt(d, m, y, hh, mm, ss, ampm, month_first: bool) -> datetime:
    day, month = (int(m), int(d)) if month_first else (int(d), int(m))
    year = int(y) + (2000 if len(y) == 2 else 0)
    hour = int(hh)
    if ampm:
        hour = hour % 12 + (12 if ampm.lower() == "p" else 0)
    return datetime(year, month, day, hour, int(mm), int(ss or 0), tzinfo=WIB)


def parse(text: str) -> list[WaMessage]:
    lines = text.replace("\r\n", "\n").split("\n")
    headers = [_LINE.match(line) for line in lines]
    # Locale: if any first field is > 12 it's day-first; if any second field is > 12, month-first.
    month_first = any(h and int(h.group(2)) > 12 for h in headers) and not any(
        h and int(h.group(1)) > 12 for h in headers
    )
    out: list[WaMessage] = []
    current: WaMessage | None = None
    for line, h in zip(lines, headers, strict=True):
        if h is None:
            if current is not None:
                current.text += "\n" + line
            continue
        rest = h.group(8)
        sender, sep, body = rest.partition(": ")
        current = None
        if not sep:
            continue  # system line: "Budi bergabung", encryption notice, group renamed, ...
        ts = _parse_dt(*h.groups()[:7], month_first=month_first)
        current = WaMessage(ts, sender.strip().lstrip("‎"), body)
        out.append(current)
    return [m for m in out if m.text.strip() and not _MEDIA.match(m.text.strip())]


def to_items(text: str, group_key: str, group_name: str) -> list[IngestItem]:
    """One export file = one `whatsapp_group` container (default-deny until mapped)."""
    items = []
    for m in parse(text):
        ref = f"{group_key}:{m.ts.isoformat()}:{slugify(m.sender, 24)}"
        items.append(
            IngestItem(
                source="whatsapp",
                container_external_id=group_key,
                container_name=group_name,
                external_ref=ref,
                type="chat",
                text=m.text.strip(),
                created_at=m.ts,
                updated_at=m.ts,
                author_external_id=m.sender,
                author_display=m.sender,
                thread_key=group_key,
            )
        )
    # Same sender + same minute can collide: disambiguate deterministically.
    seen: dict[str, int] = {}
    for it in items:
        n = seen.get(it.external_ref, 0)
        seen[it.external_ref] = n + 1
        if n:
            it.external_ref = f"{it.external_ref}:{n}"
    return items
