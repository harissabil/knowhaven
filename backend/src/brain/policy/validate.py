"""Step 7 validation (design doc 10.1, 18 "Sitasi palsu", "Halusinasi angka", 11.4).

- every cited ID was actually retrieved for this user (allowed set)
- every substantive sentence carries a citation
- every number in the answer appears in the sources it cites (or in the question)
- PII output guard: PII-shaped strings the user may not see unmasked are masked
"""

import re
from dataclasses import dataclass, field

from brain.ingestion import pii
from brain.policy.conflict import amounts

_BRACKET = re.compile(r"\[([^\[\]]{3,200})\]")
_ID = re.compile(r"^(?:CHAT|DOC|TASK)-[A-Za-z0-9][\w.#-]*$")
# A citation right after the sentence end belongs to that sentence: "… per bulan. [X]" → "… per bulan [X]."
_TRAILING_CITE = re.compile(r"([.!?])(\s*)((?:\[[^\[\]]+\]\s*)+)")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_DIGIT_RUN = re.compile(r"\d+")


@dataclass
class Validation:
    ok: bool
    text: str  # with the PII guard applied
    citations: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    pii_masked: int = 0


def citations_in(text: str) -> list[str]:
    out: list[str] = []
    for group in _BRACKET.findall(text):
        for tok in re.split(r"[,;\s]+", group):
            tok = tok.strip().rstrip(".")
            if _ID.match(tok) and tok not in out:
                out.append(tok)
    return out


def _sentences(text: str) -> list[str]:
    moved = _TRAILING_CITE.sub(lambda m: f" {m.group(3).strip()}{m.group(1)}{m.group(2)}", text)
    return [s.strip() for s in _SENTENCE_SPLIT.split(moved) if s.strip()]


def _needs_citation(sentence: str) -> bool:
    if sentence.rstrip().endswith(":"):
        return False  # a list intro ("Hal yang masih open yaitu:"); the bullets carry citations
    bare = _BRACKET.sub("", sentence).strip(" -*•:")
    if not bare or bare.lower().startswith(("catatan:", "note:")):
        return False
    return bool(re.search(r"\d", bare)) or len(bare.split()) >= 6


def _base(citation: str) -> str:
    return citation.split("#", 1)[0]


def _pii_numbers(text: str, company_domains: frozenset[str]) -> set[int]:
    """Extract numeric tokens and full digit sequences from PII spans so formatted NPWPs,
    phones, and bank accounts in cited sources never trigger false unsupported_number errors."""
    nums: set[int] = set()
    for s in pii.detect(text, company_domains):
        raw = text[s.start : s.end]
        digits = "".join(c for c in raw if c.isdigit())
        if digits:
            nums.add(int(digits))
        for m in _DIGIT_RUN.finditer(raw):
            nums.add(int(m.group(0)))
    return nums


def validate(
    answer: str,
    allowed: dict[str, str],
    question: str,
    pii_allowed: frozenset[str] = frozenset(),
    company_domains: frozenset[str] = frozenset(),
) -> Validation:
    """`allowed`: citation_id or item_id -> source text the user may see (retrieved this turn)."""
    problems: list[str] = []
    cites = citations_in(answer)
    allowed_bases = {_base(k) for k in allowed}
    unknown = [c for c in cites if c not in allowed and _base(c) not in allowed_bases]
    if unknown:
        problems.append(f"unknown_citations:{','.join(unknown)}")
    if not cites:
        problems.append("no_citations")

    # PII guard: mask any PII-shaped span of a type this user may not see (deterministic).
    spans = [s for s in pii.detect(answer, company_domains) if s.type not in pii_allowed]
    text = pii.mask(answer, spans)

    for s in _sentences(text):
        if _needs_citation(s) and not citations_in(s):
            problems.append(f"uncited_sentence:{s[:60]}")

    cited_text = " ".join(
        src_text
        for key, src_text in allowed.items()
        if key in cites or _base(key) in {_base(c) for c in cites}
    )
    known = (
        set(amounts(cited_text))
        | set(amounts(question))
        | _pii_numbers(cited_text, company_domains)
        | {int(m.group(0)) for m in _DIGIT_RUN.finditer(cited_text)}
    )
    answer_pii_nums = _pii_numbers(text, company_domains)
    for n in amounts(_BRACKET.sub(" ", text)):
        if n >= 10 and n not in known and n not in answer_pii_nums:
            problems.append(f"unsupported_number:{n}")

    return Validation(not problems, text, cites, problems, len(spans))
