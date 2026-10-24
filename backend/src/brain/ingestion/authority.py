"""Authority (design doc 7.4, 11.3): set once at ingestion from the container kind/default and
the author's position. The conflict rules in Phase 7 rely on it, so it is deterministic code."""

from dataclasses import dataclass, field
from uuid import UUID

# Roles whose posts in an announcement channel count as official.
AUTHORITATIVE_ROLES = frozenset({"hr", "direksi"})


@dataclass(frozen=True)
class Author:
    user_id: UUID
    name: str
    title: str | None = None
    role_keys: frozenset[str] = field(default_factory=frozenset)


def decide(item_type: str, container_default: str | None, container_owner: UUID | None,
           author: Author | None) -> str:  # fmt: skip
    if item_type == "doc":
        # Docs are official unless the folder/space says otherwise (e.g. meeting notes).
        return container_default or "official_doc"
    if item_type == "task":
        return container_default or "team_discussion"
    # chat
    if author is None:
        return "personal"  # unmapped Slack user / unknown WhatsApp sender (15.1, 15.4)
    if container_default == "official_announcement":
        is_official = author.user_id == container_owner or bool(
            author.role_keys & AUTHORITATIVE_ROLES
        )
        return "official_announcement" if is_official else "team_discussion"
    return container_default or "team_discussion"
