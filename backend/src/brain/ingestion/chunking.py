"""Chunking (design doc 9.1, 7.4): chat = one chunk per message (+ context window), documents =
per section/page, tasks = one chunk. Long sections are split on paragraph boundaries."""

import re
import unicodedata

from brain.ingestion.types import Section

MAX_CHARS = 1500

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_NUMBERED = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+")
_LIST_LINE = re.compile(r"^\s*(?:(?:\d+(?:\.\d+)*|[a-zA-Z])[.)]|[-*•])\s+")
# Split sentences on . ! ? + space, except after a standalone number/initial ("1.", "A.").
_SENTENCE_SPLIT = re.compile(r"(?<!\b\d)(?<!\b\d\d)(?<!\b[A-Za-z])(?<=[.!?])\s+")


def slugify(value: str, max_len: int = 48) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:max_len].strip("-") or "x"


def heading_anchor(heading: str) -> str:
    """'4.2 Prosedur Eskalasi' → '4.2'; 'Persyaratan Umum' → 'persyaratan-umum'."""
    m = _NUMBERED.match(heading)
    return m.group(1) if m else slugify(heading, 32)


def _split_oversized_para(para: str, max_chars: int) -> list[tuple[str, str]]:
    """Returns (piece, separator_after) for a paragraph that exceeds max_chars."""
    lines = para.splitlines()
    if len(lines) > 1 and any(_LIST_LINE.match(ln) for ln in lines):
        out: list[tuple[str, str]] = []
        for ln in lines:
            if len(ln) <= max_chars:
                out.append((ln, "\n"))
            else:
                sents = _SENTENCE_SPLIT.split(ln)
                for idx, s in enumerate(sents):
                    out.append((s, "\n" if idx == len(sents) - 1 else " "))
        return out
    sents = _SENTENCE_SPLIT.split(para)
    return [(s, "\n\n" if idx == len(sents) - 1 else " ") for idx, s in enumerate(sents)]


def split_long(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []
    parts, buf = [], ""
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        pieces = (
            [(para, "\n\n")] if len(para) <= max_chars else _split_oversized_para(para, max_chars)
        )
        for piece, sep in pieces:
            while len(piece) > max_chars:  # one enormous sentence
                if buf.strip():
                    parts.append(buf.strip())
                    buf = ""
                parts.append(piece[:max_chars])
                piece = piece[max_chars:]
            if len(buf) + len(piece) > max_chars and buf.strip():
                parts.append(buf.strip())
                buf = ""
            buf += piece + sep
    if buf.strip():
        parts.append(buf.strip())
    return parts


def markdown_sections(md: str) -> tuple[str | None, list[Section]]:
    """(title, sections). The first H1 is the title; every heading starts a section."""
    title: str | None = None
    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append(Section(heading_anchor(heading) if heading else None, heading, body))

    for line in md.splitlines():
        m = _HEADING.match(line)
        if m:
            level, text = len(m.group(1)), m.group(2).strip()
            if level == 1 and title is None and not sections and not "".join(buf).strip():
                title = text
                continue
            flush()
            heading, buf = text, []
        else:
            buf.append(line)
    flush()
    return title, sections


def section_chunks(sections: list[Section]) -> list[tuple[str | None, str | None, str]]:
    """(anchor, heading, text) per chunk; a long section keeps its anchor on every part."""
    out = []
    for sec in sections:
        for part in split_long(sec.text):
            out.append((sec.anchor, sec.heading, part))
    return out
