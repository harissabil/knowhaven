"""Document mentions inside a question: "Ringkas @[SOP Cuti](DOC-kebijakan-cuti)".

The web app sends tags inline so they stay in the stored message (history shows them as chips).
The model sees only "@SOP Cuti"; the ids are fetched with the normal permission check, so a tag on a
document the user can't read finds nothing, exactly like an unknown id (T24). The title in the
markup is display text only.
"""

import re

MARKUP = re.compile(r"@\[([^\]\n]{1,200})\]\(([A-Za-z0-9#._:-]{1,200})\)")
MAX_TAGS = 10


def split_mentions(question: str) -> tuple[str, list[str]]:
    """(question with "@Title" instead of markup, mentioned ids in order, deduplicated)."""
    ids: list[str] = []
    for m in MARKUP.finditer(question):
        if m.group(2) not in ids:
            ids.append(m.group(2))
    return MARKUP.sub(lambda m: f"@{m.group(1)}", question), ids[:MAX_TAGS]
