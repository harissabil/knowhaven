"""The "I don't know" template (design doc 11.1) and the gated-topic access offer (8.2, 12.1).

The text depends only on (1) the topic phrase the user typed, (2) public topic_owners entries
(hidden topics are never in that table), and (3) the tenant's default contact. So a question
about a hidden project and one about a project that doesn't exist get the same text, apart from
the name the user typed.
"""

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import Container, Tenant, TopicOwner
from brain.rbac.context import RequestContext
from brain.rbac.visibility import visible_container_clause

TEMPLATE = {
    "id": 'Saya tidak menemukan informasi tentang "{topic}" di data yang bisa saya akses. '
          "Untuk pertanyaan ini, silakan hubungi {contact}.",
    "en": 'I couldn\'t find information about "{topic}" in the data I can access. '
          "For this question, please contact {contact}.",
}  # fmt: skip
GATED_NOTE = {
    "id": "Topik ini memerlukan akses khusus; Anda dapat mengajukan akses ke manager.",
    "en": "This topic requires special access; you can request access from a manager.",
}
GENERIC_CONTACT = "Admin perusahaan"


@dataclass(frozen=True)
class TopicMatch:
    topic_key: str
    display_name: str
    contact: str
    tier: str
    container_id: object | None


def topic_phrase(question: str, llm_topic: str | None) -> str:
    """The topic as the user typed it. The model may suggest a phrase, but only if it is literally
    in the question; otherwise we fall back to the question itself (never to data)."""
    q = " ".join(question.split())
    if llm_topic:
        t = " ".join(llm_topic.split()).strip(" ?.!\"'")
        m = re.search(re.escape(t), q, flags=re.IGNORECASE)
        if t and m:
            return q[m.start() : m.end()]
    q = q.rstrip(" ?!.")
    return q if len(q) <= 80 else q[:77].rstrip() + "..."


def term_in(term: str, question: str) -> bool:
    """An alias matches verbatim, or, for multi-word aliases, when all its words appear in any order
    ("gaji level" matches "rentang gaji pokok level 3"): people rarely use the exact phrase."""
    term, low = term.lower().strip(), question.lower()
    if not term:
        return False
    if re.search(rf"\b{re.escape(term)}\b", low):
        return True
    words = term.split()
    return len(words) > 1 and all(re.search(rf"\b{re.escape(w)}\b", low) for w in words)


async def match_topic(s: AsyncSession, question: str) -> TopicMatch | None:
    """A public topic (open/gated) whose name or alias appears in the question."""
    best: tuple[int, TopicOwner] | None = None
    for t in await s.scalars(select(TopicOwner).where(TopicOwner.tier.in_(("open", "gated")))):
        for term in (t.display_name, *t.aliases):
            if term_in(term, question) and (best is None or len(term) > best[0]):
                best = (len(term), t)
    if best is None:
        return None
    t = best[1]
    return TopicMatch(t.topic_key, t.display_name, t.fallback_contact, t.tier, t.container_id)


async def default_contact(s: AsyncSession) -> str:
    return await s.scalar(select(Tenant.default_contact)) or GENERIC_CONTACT


async def build(
    s: AsyncSession, ctx: RequestContext, question: str, lang: str, llm_topic: str | None
):
    """Returns (text, access_offer | None, contact)."""
    topic = topic_phrase(question, llm_topic)
    match = await match_topic(s, question)
    contact = match.contact if match else await default_contact(s)
    text = TEMPLATE["en" if lang == "en" else "id"].format(topic=topic, contact=contact)
    offer = None
    if match and match.tier == "gated" and match.container_id is not None:
        can_see = await s.scalar(
            select(Container.id).where(
                Container.id == match.container_id, visible_container_clause(ctx)
            )
        )
        if can_see is None:  # offer only what the user can't already read (8.2)
            text += " " + GATED_NOTE["en" if lang == "en" else "id"]
            offer = {"topic_key": match.topic_key, "display_name": match.display_name}
    return text, offer, contact
