from dataclasses import dataclass, field
from datetime import datetime

# source_items.source values and the container kind each one lives in.
CONTAINER_KIND = {
    "slack": "slack_channel",
    "whatsapp": "whatsapp_group",
    "confluence": "confluence_space",
    "upload": "upload_folder",
    "jira": "jira_project",
}


@dataclass(frozen=True)
class Section:
    """A citable part of a document: anchor "4.2" / "p3" / "persyaratan" → DOC-x#4.2."""

    anchor: str | None
    heading: str | None
    text: str


@dataclass
class IngestItem:
    """The connector contract (backend plan Phase 5). Connectors never decide access, authority
    or IDs; the pipeline does."""

    source: str  # slack | whatsapp | confluence | upload | jira
    # Slack channel id / WA group key / space key / folder id / project key
    container_external_id: str
    container_name: str
    external_ref: str  # stable per source: "C123:1693900000.000100", page id, issue key, ...
    type: str  # chat | doc | task
    text: str
    created_at: datetime
    updated_at: datetime
    version: int = 1
    title: str | None = None
    url: str | None = None
    author_external_id: str | None = None  # Slack user id / WA sender name / email
    author_display: str | None = None
    sections: list[Section] | None = None  # docs: pre-split by the parser
    thread_key: str | None = None  # chat: messages with the same key share a context window
    structured: dict | None = None  # tasks: status, assignee, due, priority, project, ...
    id_hint: str | None = None  # DOC slug / Jira key, used to build the citation ID
    storage_key: str | None = None  # original file in object storage
    deleted: bool = False
    labels: list[str] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        """All text of the item: sections joined when a parser pre-split a document."""
        if self.text or not self.sections:
            return self.text
        return "\n\n".join(f"{s.heading}\n{s.text}" if s.heading else s.text for s in self.sections)

    @property
    def container_kind(self) -> str:
        return CONTAINER_KIND[self.source]
