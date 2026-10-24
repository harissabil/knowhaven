"""Structured outputs for the LLM steps (design doc 10.3: JSON schema for steps 2 and 5)."""

from typing import Literal

from pydantic import BaseModel, Field


class TaskFilters(BaseModel):
    project: str | None = None
    status: str | None = None  # e.g. "open", "done", or a status name
    assignee: str | None = None
    entity: str | None = None


class Understanding(BaseModel):
    """Step 2."""

    language: Literal["id", "en", "mixed"]
    intent: str = Field(
        description="short snake_case label, e.g. policy_lookup, project_history, task_status"
    )
    category: Literal["question", "smalltalk", "person_compensation", "action_request"] = Field(
        description="person_compensation = asks the salary/pay of a specific person; "
        "action_request = asks to change/send/delete something"
    )
    topic_phrase: str = Field(
        description="the topic exactly as written in the question, copied verbatim"
    )
    entities: list[str] = Field(
        default_factory=list, description="people, places, projects, products"
    )
    search_queries: list[str] = Field(
        default_factory=list,
        description="1-3 standalone search queries; add an Indonesian or English variant",
    )
    source_types: list[Literal["chat", "doc", "task"]] = Field(default_factory=list)
    task_filters: TaskFilters | None = None
    needs_pii: bool = Field(
        description="true only if answering requires personal data such as NIK or phone numbers"
    )


class ExtractedClaim(BaseModel):
    topic: str = Field(
        description="snake_case key; the SAME key for claims about the same fact or quantity"
    )
    value: str = Field(description="the value as written in the source, e.g. Rp750.000 or 12 hari")
    citation_id: str = Field(description="the id attribute of exactly one <source>")
    statement: str = Field(description="one short sentence stating the claim")


class Evidence(BaseModel):
    """Step 5 (extraction only; code decides sufficiency and conflicts)."""

    answerable: bool
    claims: list[ExtractedClaim] = Field(default_factory=list)
