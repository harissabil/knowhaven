"""Document parsers (design doc 15.5): Markdown and DOCX per heading, PDF per page.
Also used for Confluence pages (converted to Markdown) so citations look the same."""

import io
import re

from brain.ingestion.chunking import heading_anchor, markdown_sections
from brain.ingestion.types import Section


def parse_markdown(text: str) -> tuple[str | None, list[Section]]:
    return markdown_sections(text)


def parse_docx(data: bytes) -> tuple[str | None, list[Section]]:
    from docx import Document

    doc = Document(io.BytesIO(data))
    title = (doc.core_properties.title or "").strip() or None
    sections: list[Section] = []
    heading: str | None = None
    buf: list[str] = []

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append(Section(heading_anchor(heading) if heading else None, heading, body))

    for p in doc.paragraphs:
        style = (p.style.name or "").lower() if p.style is not None else ""
        text = p.text.strip()
        if style == "title" and text:
            title = title or text
        elif style.startswith("heading") and text:
            if title is None and style == "heading 1" and not sections and not buf:
                title = text
                continue
            flush()
            heading, buf = text, []
        elif text:
            buf.append(text)
    flush()
    for table in doc.tables:  # tables (e.g. grade gaji) become one section each
        rows = [" | ".join(c.text.strip() for c in row.cells) for row in table.rows]
        if rows:
            sections.append(Section(f"tabel-{len(sections) + 1}", "Tabel", "\n".join(rows)))
    return title, sections


def parse_pdf(data: bytes) -> tuple[str | None, list[Section]]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    title = None
    if reader.metadata and reader.metadata.title:
        title = str(reader.metadata.title).strip() or None
    sections = []
    for i, page in enumerate(reader.pages, start=1):
        text = re.sub(r"[ \t]+\n", "\n", page.extract_text() or "").strip()
        if text:
            sections.append(Section(f"p{i}", f"Halaman {i}", text))
    return title, sections


def parse_document(filename: str, data: bytes) -> tuple[str | None, list[Section]]:
    name = filename.lower()
    if name.endswith((".md", ".markdown", ".txt")):
        return parse_markdown(data.decode("utf-8", errors="replace"))
    if name.endswith(".docx"):
        return parse_docx(data)
    if name.endswith(".pdf"):
        return parse_pdf(data)
    raise ValueError("unsupported_file_type")
