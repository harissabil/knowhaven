"""Schema (design doc 6.1, 7). Every table except `users` and `sessions` is tenant-scoped,
protected by RLS (see the initial migration), and every foreign key into another tenant table
includes `tenant_id`, so a row can never reference another tenant's data.

Citation IDs: `source_items.id` is the stable human-readable ID (CHAT-..., DOC-..., TASK-...);
a citation is `<item_id>` or `<item_id>#<chunk anchor>`.
"""

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    MetaData,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

EMBEDDING_DIM = 768

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def _tenant_id() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
    )


def _in(col: str, *values: str) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


def _tfk(cols: list[str], target: str, target_cols: list[str], ondelete: str = "CASCADE"):
    """Composite FK that always carries tenant_id."""
    return ForeignKeyConstraint(
        ["tenant_id", *cols],
        [f"{target}.tenant_id", *(f"{target}.{c}" for c in target_cols)],
        ondelete=ondelete,
    )


# --- global (no RLS)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (Index("uq_users_email_lower", func.lower(text("email")), unique=True),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class Session(Base):
    """Login session. `id` is sha256(cookie token); the raw token only lives in the cookie."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    active_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL")
    )
    csrf_token: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    last_seen_at: Mapped[datetime] = _created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


# --- tenancy (6.1)


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = (CheckConstraint(_in("status", "active", "suspended"), name="status"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(Text)
    slug: Mapped[str] = mapped_column(Text, unique=True)
    join_code_hash: Mapped[str | None] = mapped_column(Text, unique=True)  # lookup
    join_code_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)  # admin can view it
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(Text, server_default="active")
    created_at: Mapped[datetime] = _created_at()


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "user_id"),
        CheckConstraint(_in("status", "pending", "active", "removed"), name="status"),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(Text)
    joined_at: Mapped[datetime] = _created_at()
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("tenant_id", "id"), UniqueConstraint("tenant_id", "key"))

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    key: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[datetime] = _created_at()


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        _tfk(["default_role_id"], "roles", ["id"]),
        CheckConstraint("used_count <= max_uses", name="uses"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    default_role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    max_uses: Mapped[int] = mapped_column(Integer, server_default="1")
    used_count: Mapped[int] = mapped_column(Integer, server_default="0")
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = _created_at()
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Integration(Base):
    __tablename__ = "integrations"
    __table_args__ = (
        # One external workspace/site maps to exactly one tenant (Slack team_id routing).
        UniqueConstraint("type", "external_workspace_id"),
        CheckConstraint(_in("type", "slack", "confluence", "jira"), name="type"),
        CheckConstraint(_in("status", "active", "error", "disconnected"), name="status"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    type: Mapped[str] = mapped_column(Text)
    external_workspace_id: Mapped[str] = mapped_column(Text)
    config_encrypted: Mapped[bytes] = mapped_column(LargeBinary)
    status: Mapped[str] = mapped_column(Text, server_default="active")
    connected_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


# --- identity & permissions (7.1)


class MemberProfile(Base):
    __tablename__ = "member_profiles"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "user_id"),
        _tfk(["user_id"], "memberships", ["user_id"]),
        UniqueConstraint("tenant_id", "slack_user_id"),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    department: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    branch_office: Mapped[str | None] = mapped_column(Text)
    slack_user_id: Mapped[str | None] = mapped_column(Text)
    display_aliases: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "user_id", "role_id"),
        _tfk(["user_id"], "memberships", ["user_id"]),
        _tfk(["role_id"], "roles", ["id"]),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    granted_at: Mapped[datetime] = _created_at()
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Manager(Base):
    """Approver assignment. Lookup order: topic -> container -> department -> admin (12.3)."""

    __tablename__ = "managers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "scope_type", "scope_id", "manager_user_id"),
        _tfk(["manager_user_id"], "memberships", ["user_id"]),
        CheckConstraint(_in("scope_type", "department", "container", "topic"), name="scope_type"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    scope_type: Mapped[str] = mapped_column(Text)
    scope_id: Mapped[str] = mapped_column(Text)
    manager_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))


class Container(Base):
    __tablename__ = "containers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "source", "external_id"),
        CheckConstraint(
            _in(
                "source",
                "slack_channel",
                "whatsapp_group",
                "confluence_space",
                "jira_project",
                "upload_folder",
            ),
            name="source",
        ),
        CheckConstraint(_in("tier", "hidden", "gated", "open"), name="tier"),
        CheckConstraint(
            "authority_default IS NULL OR "
            + _in(
                "authority_default",
                "official_doc",
                "official_announcement",
                "team_discussion",
                "personal",
            ),
            name="authority_default",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    source: Mapped[str] = mapped_column(Text)
    external_id: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    # Default-deny (8.3): new containers are hidden and unmapped until an admin maps them.
    tier: Mapped[str] = mapped_column(Text, server_default="hidden")
    mapped: Mapped[bool] = mapped_column(Boolean, server_default="false")
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # e.g. #pengumuman-hr -> official_announcement (7.4)
    authority_default: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class ContainerAcl(Base):
    __tablename__ = "container_acl"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "container_id", "role_id"),
        _tfk(["container_id"], "containers", ["id"]),
        _tfk(["role_id"], "roles", ["id"]),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    container_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))


class ItemAclOverride(Base):
    __tablename__ = "item_acl_override"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "item_id", "role_id"),
        _tfk(["item_id"], "source_items", ["id"]),
        _tfk(["role_id"], "roles", ["id"]),
        CheckConstraint(_in("effect", "allow", "deny"), name="effect"),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    item_id: Mapped[str] = mapped_column(Text)
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    effect: Mapped[str] = mapped_column(Text)


class TempGrant(Base):
    __tablename__ = "temp_grants"
    __table_args__ = (
        _tfk(["user_id"], "memberships", ["user_id"]),
        _tfk(["container_id"], "containers", ["id"]),
        Index("ix_temp_grants_user", "tenant_id", "user_id", "expires_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    container_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    granted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    access_request_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class PiiPermission(Base):
    __tablename__ = "pii_permissions"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "role_id", "pii_type"),
        _tfk(["role_id"], "roles", ["id"]),
        CheckConstraint(
            _in("pii_type", "nik", "phone", "email", "npwp", "bank_account"), name="type"
        ),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    pii_type: Mapped[str] = mapped_column(Text)


class McpToken(Base):
    __tablename__ = "mcp_tokens"
    __table_args__ = (_tfk(["user_id"], "memberships", ["user_id"]),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    label: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PermissionState(Base):
    """Bumped in the same transaction as every permission change (8.5)."""

    __tablename__ = "permission_state"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(BigInteger, server_default="1")
    updated_at: Mapped[datetime] = _created_at()


# --- content (7.2)


class SourceItem(Base):
    __tablename__ = "source_items"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "id"),
        UniqueConstraint("tenant_id", "source", "external_ref"),
        _tfk(["container_id"], "containers", ["id"]),
        CheckConstraint(_in("type", "chat", "doc", "task"), name="type"),
        CheckConstraint(
            _in(
                "authority", "official_doc", "official_announcement", "team_discussion", "personal"
            ),
            name="authority",
        ),
        Index("ix_source_items_container", "tenant_id", "container_id"),
        Index("ix_source_items_entities", "entities", postgresql_using="gin"),
        Index("ix_source_items_topics", "topic_keys", postgresql_using="gin"),
        Index(
            "ix_source_items_structured",
            "structured",
            postgresql_using="gin",
            postgresql_ops={"structured": "jsonb_path_ops"},
        ),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    id: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    container_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    external_ref: Mapped[str] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    author_display: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, server_default="1")
    supersedes_id: Mapped[str | None] = mapped_column(Text)
    topic_keys: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    entities: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    authority: Mapped[str] = mapped_column(Text, server_default="personal")
    injection_flag: Mapped[bool] = mapped_column(Boolean, server_default="false")
    pii_spans: Mapped[list] = mapped_column(JSONB, server_default="[]")
    structured: Mapped[dict | None] = mapped_column(JSONB)
    raw_text: Mapped[str] = mapped_column(Text)
    storage_key: Mapped[str | None] = mapped_column(Text)  # original upload in object storage
    ingested_at: Mapped[datetime] = _created_at()


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (
        _tfk(["item_id"], "source_items", ["id"]),
        UniqueConstraint("tenant_id", "item_id", "ord"),
        Index(
            "ix_chunks_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("ix_chunks_tsv", "tsv", postgresql_using="gin"),
        Index(
            "ix_chunks_trgm",
            "text_masked",
            postgresql_using="gin",
            postgresql_ops={"text_masked": "gin_trgm_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    item_id: Mapped[str] = mapped_column(Text)
    ord: Mapped[int] = mapped_column(Integer)
    anchor: Mapped[str | None] = mapped_column(Text)  # "4.2" / "p3"; citation = item_id#anchor
    text_masked: Mapped[str] = mapped_column(Text)  # default text sent to the LLM
    text_raw: Mapped[str] = mapped_column(Text)  # only for roles with pii_permissions
    context_text: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    embedding_model: Mapped[str | None] = mapped_column(Text)
    # Lexical search runs over masked text only, so a PII string can't be found by keyword.
    tsv: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('indonesian', coalesce(context_text, '') || ' ' || text_masked) || "
            "to_tsvector('english', coalesce(context_text, '') || ' ' || text_masked)",
            persisted=True,
        ),
    )


class TopicOwner(Base):
    __tablename__ = "topic_owners"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "topic_key"),
        CheckConstraint(_in("tier", "hidden", "gated", "open"), name="tier"),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    topic_key: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(Text)
    aliases: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    fallback_contact: Mapped[str] = mapped_column(Text)
    tier: Mapped[str] = mapped_column(Text, server_default="open")
    # For gated topics: the container a temp grant opens (12.1).
    container_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


# --- operational (7.3)


class AccessRequest(Base):
    __tablename__ = "access_requests"
    __table_args__ = (
        _tfk(["requester_id"], "memberships", ["user_id"]),
        CheckConstraint(_in("status", "pending", "approved", "rejected", "expired"), name="status"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    requester_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    topic_key: Mapped[str] = mapped_column(Text)
    container_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    approver_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class ActionDraft(Base):
    __tablename__ = "action_drafts"
    __table_args__ = (
        CheckConstraint(
            _in("status", "pending", "approved", "rejected", "executed", "failed"), name="status"
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    kind: Mapped[str] = mapped_column(Text)  # e.g. update_sop
    target_system: Mapped[str] = mapped_column(Text)  # confluence | internal
    target_ref: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSONB)
    diff: Mapped[str] = mapped_column(Text)
    evidence_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    created_by_query_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    approver_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    exec_result: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()


class IngestionEvent(Base):
    __tablename__ = "ingestion_events"
    __table_args__ = (Index("ix_ingestion_events_recent", "tenant_id", "received_at"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    source: Mapped[str] = mapped_column(Text)
    external_ref: Mapped[str] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(Text)
    received_at: Mapped[datetime] = _created_at()
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text, server_default="received")
    error: Mapped[str | None] = mapped_column(Text)


class AuditLog(Base):
    """Append-only (UPDATE/DELETE revoked from brain_app), hash-chained per tenant by `seq`."""

    __tablename__ = "audit_log"
    __table_args__ = (
        PrimaryKeyConstraint("tenant_id", "seq"),
        UniqueConstraint("tenant_id", "query_id"),
        CheckConstraint(
            "decision_path IS NULL OR "
            + _in("decision_path", "answer", "conflict", "idk", "policy_refusal", "error"),
            name="decision_path",
        ),
    )

    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    seq: Mapped[int] = mapped_column(BigInteger)
    query_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    ts: Mapped[datetime] = _created_at()
    event_type: Mapped[str] = mapped_column(
        Text, server_default="query"
    )  # query | admin | approval
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    channel: Mapped[str | None] = mapped_column(Text)  # web | mcp | system
    query_text: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str | None] = mapped_column(Text)
    intent: Mapped[str | None] = mapped_column(Text)
    permission_version: Mapped[int | None] = mapped_column(BigInteger)
    roles_snapshot: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    retrieved_item_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    filtered_count: Mapped[int | None] = mapped_column(Integer)  # auditor-only
    decision_path: Mapped[str | None] = mapped_column(Text)
    response_text: Mapped[str | None] = mapped_column(Text)  # masked
    citations: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    model_ids: Mapped[dict | None] = mapped_column(JSONB)
    prompt_version: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[dict | None] = mapped_column(JSONB)
    prev_hash: Mapped[str] = mapped_column(Text)
    row_hash: Mapped[str] = mapped_column(Text)


class TraceEvent(Base):
    __tablename__ = "trace_events"
    __table_args__ = (Index("ix_trace_events_query", "tenant_id", "query_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    query_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    step: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(Text)  # CODE | LLM
    name: Mapped[str] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary_user: Mapped[str | None] = mapped_column(Text)
    detail_auditor: Mapped[dict | None] = mapped_column(JSONB)


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id"),
        _tfk(["user_id"], "memberships", ["user_id"]),
        CheckConstraint(_in("channel", "web", "mcp"), name="channel"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    channel: Mapped[str] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class Message(Base):
    """Only final questions/answers are stored and replayed to the LLM (10.5)."""

    __tablename__ = "messages"
    __table_args__ = (
        _tfk(["conversation_id"], "conversations", ["id"]),
        CheckConstraint(_in("role", "user", "assistant"), name="role"),
        Index("ix_messages_conversation", "tenant_id", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    tenant_id: Mapped[uuid.UUID] = _tenant_id()
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    role: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    citations: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    permission_version: Mapped[int] = mapped_column(BigInteger)
    query_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _created_at()


GLOBAL_TABLES = {"users", "sessions"}
