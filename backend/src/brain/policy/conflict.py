"""Conflict resolution (design doc 11.3). The LLM extracts claims; this code decides.

Rules, in order:
  1. Authority over the topic: official documents / authoritative announcements beat discussion.
  2. Among authoritative sources, the newer one wins.
  3. Official doc vs. newer authoritative announcement: the announcement wins and the doc is
     marked stale (feeds the SOP update draft, 12.2).
  4. Non-authoritative claims never beat policy; they're reported as unverified.
  5. Tie (same authority level, same day, different values): don't pick; show both, refer to owner.

Authority and dates come from `source_items` metadata, never from the model.

Scope (disclosed limitation): only *quantitative* claims (amounts, counts) from *different* items can
conflict. Textual claims are treated as complementary (paraphrases like "cuaca buruk" / "ombak
tinggi" aren't contradictions), and several values inside one item are separate facts (e.g. approval
thresholds in one matrix).
"""

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))
AUTHORITATIVE = frozenset({"official_doc", "official_announcement"})

_MULT = {"rb": 1_000, "ribu": 1_000, "k": 1_000, "jt": 1_000_000, "juta": 1_000_000,
         "m": 1_000_000_000, "miliar": 1_000_000_000, "milyar": 1_000_000_000}  # fmt: skip
_AMOUNT = re.compile(
    r"(?i)(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d{1,2}))?\s*(rb|ribu|k|jt|juta|miliar|milyar|m)?\b"
)


def amounts(text: str) -> list[int]:
    """Every number in `text` as an integer: 'Rp750.000' → 750000, '750rb' → 750000,
    '4,2 M' → 4200000000, '12 hari' → 12."""
    out = []
    for m in _AMOUNT.finditer(text):
        whole, frac, mult = m.group(1), m.group(2), (m.group(3) or "").lower()
        n = int(re.sub(r"[.,]", "", whole))
        if mult:
            n = int((n + (int(frac) / 10 ** len(frac) if frac else 0)) * _MULT[mult])
        out.append(n)
    return out


def normalize_value(value: str) -> str:
    nums = amounts(value)
    if nums:
        return "#" + ",".join(str(n) for n in nums)
    return re.sub(r"\s+", " ", value.strip().casefold())


@dataclass
class Claim:
    topic: str
    value: str
    citation_id: str
    item_id: str
    statement: str
    authority: str  # from source_items
    date: datetime  # from source_items (updated_at)
    author: str | None
    container: str
    title: str | None
    type: str

    @property
    def norm(self) -> str:
        return normalize_value(self.value)

    @property
    def authoritative(self) -> bool:
        return self.authority in AUTHORITATIVE

    @property
    def day(self):
        return self.date.astimezone(WIB).date()


@dataclass
class Resolution:
    topic: str
    chosen: Claim | None
    reason: str  # single | authority | newer | announcement_newer_than_doc | doc_newer_than_announcement | tie
    competing: list[Claim] = field(default_factory=list)  # other values considered (cited too)
    unverified: list[Claim] = field(default_factory=list)  # non-authoritative, different value
    stale_doc_ids: list[str] = field(default_factory=list)

    @property
    def is_conflict(self) -> bool:
        return self.reason != "single"

    @property
    def tie(self) -> bool:
        return self.reason == "tie"

    def as_dict(self) -> dict:
        def c(x: Claim | None):
            return None if x is None else {
                "value": x.value, "citation_id": x.citation_id, "authority": x.authority,
                "date": x.day.isoformat(), "source": x.title or x.container,
            }  # fmt: skip

        return {
            "topic": self.topic,
            "reason": self.reason,
            "chosen": c(self.chosen),
            "competing": [c(x) for x in self.competing],
            "unverified": [c(x) for x in self.unverified],
            "stale_doc_ids": self.stale_doc_ids,
        }


def _pick(claims: list[Claim]) -> Claim:
    """Representative claim for one value: most authoritative, then newest."""
    return max(
        claims, key=lambda c: (c.authoritative, c.authority == "official_announcement", c.date)
    )


def resolve_topic(topic: str, claims: list[Claim]) -> Resolution:
    numeric = all(c.norm.startswith("#") for c in claims)
    if not numeric or len({c.item_id for c in claims}) == 1:
        return Resolution(topic, _pick(claims), "single")
    by_value: dict[str, list[Claim]] = {}
    for c in claims:
        by_value.setdefault(c.norm, []).append(c)
    reps = [_pick(v) for v in by_value.values()]
    if len(reps) == 1:
        return Resolution(topic, reps[0], "single")

    auth = [c for c in reps if c.authoritative]
    non = [c for c in reps if not c.authoritative]
    if not auth:
        return Resolution(
            topic, None, "tie", competing=sorted(non, key=lambda c: c.date, reverse=True)
        )

    newest = max(c.day for c in auth)
    top = [c for c in auth if c.day == newest]
    if len(top) > 1:  # rule 5: same authority level, same day, different values
        return Resolution(topic, None, "tie", competing=top, unverified=non)

    chosen = top[0]
    # Other values from the chosen item itself are separate facts, not competitors.
    auth = [c for c in auth if c is chosen or c.item_id != chosen.item_id]
    non = [c for c in non if c.item_id != chosen.item_id]
    older = [c for c in auth if c is not chosen]
    if not older:
        return Resolution(topic, chosen, "authority", unverified=non)
    stale = [c.item_id for c in older if c.type == "doc"] if chosen.type != "doc" else []
    if chosen.authority == "official_announcement" and stale:
        reason = "announcement_newer_than_doc"
    elif chosen.type == "doc" and any(c.authority == "official_announcement" for c in older):
        reason = "doc_newer_than_announcement"
    else:
        reason = "newer"
    return Resolution(
        topic, chosen, reason, competing=older, unverified=non, stale_doc_ids=sorted(set(stale))
    )


def resolve(claims: list[Claim]) -> list[Resolution]:
    topics: dict[str, list[Claim]] = {}
    for c in claims:
        topics.setdefault(c.topic, []).append(c)
    return [resolve_topic(t, cs) for t, cs in topics.items()]


def reason_sentence(r: Resolution, lang: str) -> str | None:
    """One-sentence explanation of the decision (11.3), written by code; the composer must use it."""
    if not r.is_conflict:
        return None
    en = lang == "en"
    if r.tie:
        vals = " vs ".join(
            f"{c.value} ({c.title or c.container}, {c.day.isoformat()})" for c in r.competing
        )
        return (f"Sources of equal standing from the same date disagree ({vals}); I can't pick one."
                if en else f"Sumber dengan kedudukan setara pada tanggal yang sama berbeda ({vals}); saya tidak bisa memilih salah satunya.")  # fmt: skip
    c = r.chosen
    src = c.title or f"#{c.container}"
    if r.reason == "announcement_newer_than_doc":
        old = next(x for x in r.competing if x.type == "doc")
        return (f"I used the authoritative announcement in {src} ({c.day.isoformat()}) because it is newer than "
                f"{old.title} ({old.day.isoformat()}), which is now outdated."
                if en else f"Saya memakai pengumuman resmi di {src} ({c.day.isoformat()}) karena lebih baru dari "
                f"{old.title} ({old.day.isoformat()}), sehingga dokumen tersebut sudah usang.")  # fmt: skip
    if r.reason in ("newer", "doc_newer_than_announcement"):
        return (f"I used {src} ({c.day.isoformat()}) because it is the most recent authoritative source."
                if en else f"Saya memakai {src} ({c.day.isoformat()}) karena merupakan sumber resmi yang paling baru.")  # fmt: skip
    return (f"I used {src} because it is an official source; other mentions are unverified."
            if en else f"Saya memakai {src} karena merupakan sumber resmi; informasi lain belum terverifikasi.")  # fmt: skip
