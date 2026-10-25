"""The ingestion pipeline (design doc 9.1).

    resolve tenant (caller) → read state → idempotency → container (new = hidden + unmapped)
    → authority → PII spans → injection flag → masked chunks + context windows
    → topic/entity extraction (masked text) → embeddings (masked text) → write → ingestion_events

Network calls (LLM, embeddings) happen *between* two short transactions, never inside one, so a
slow model never holds a pooled connection.
"""

import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import (
    Chunk,
    Container,
    IngestionEvent,
    MemberProfile,
    Membership,
    Role,
    SourceItem,
    TopicOwner,
    User,
    UserRole,
)
from brain.db.session import global_session, tenant_session
from brain.ingestion import authority, pii
from brain.ingestion.chunking import section_chunks, slugify, split_long
from brain.ingestion.extract import Extractor, LlmExtractor, TopicHint
from brain.ingestion.injection import detect_injection
from brain.ingestion.types import IngestItem
from brain.llm.embed import GeminiEmbedder, get_embedder
from brain.tenancy import domains as company_domains

CONTEXT_BEFORE, CONTEXT_AFTER = 2, 1
EMBED_CHARS = 2000


@dataclass
class IngestReport:
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    deleted: int = 0
    containers_created: list[str] = field(default_factory=list)
    item_ids: list[str] = field(default_factory=list)
    injection_flagged: list[str] = field(default_factory=list)


@dataclass
class _Member:
    author: authority.Author
    email: str
    slack_user_id: str | None
    aliases: tuple[str, ...]


@dataclass
class _State:
    containers: dict[tuple[str, str], Container]
    existing: dict[tuple[str, str], SourceItem]
    members: list[_Member]
    topics: list[TopicHint]
    company_domains: frozenset[str]
    taken_ids: set[str]
    chat_counters: dict[uuid.UUID, int]
    prior_context: dict[uuid.UUID, list[str]]


@dataclass
class _Prepared:
    item: IngestItem
    row: dict
    chunks: list[dict]
    existing: SourceItem | None


class Ingestor:
    def __init__(self, embedder: GeminiEmbedder | None = None, extractor: Extractor | None = None):
        self._embedder = embedder
        self._extractor = extractor or LlmExtractor()

    @property
    def embedder(self) -> GeminiEmbedder:
        return self._embedder or get_embedder()

    async def ingest(self, tenant_id: uuid.UUID, items: list[IngestItem]) -> IngestReport:
        items = _latest_per_ref(items)
        report = IngestReport()
        if not items:
            return report
        state = await self._read_state(tenant_id, items)

        new_containers: list[Container] = []
        for it in items:
            key = (it.container_kind, it.container_external_id)
            if key not in state.containers:
                c = Container(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    source=it.container_kind,
                    external_id=it.container_external_id,
                    name=it.container_name,
                    # Default-deny (8.3): nobody sees it until an admin maps it.
                    tier="hidden",
                    mapped=False,
                )
                state.containers[key] = c
                new_containers.append(c)
                report.containers_created.append(it.container_name)

        to_delete: list[SourceItem] = []
        todo: list[tuple[IngestItem, SourceItem | None]] = []
        for it in items:
            ex = state.existing.get((it.source, it.external_ref))
            if it.deleted:
                if ex is not None and ex.deleted_at is None:
                    to_delete.append(ex)
                continue
            if (
                ex is not None
                and ex.version >= it.version
                and ex.raw_text == it.full_text
                and ex.deleted_at is None
            ):
                report.unchanged += 1
                report.item_ids.append(ex.id)
                continue
            todo.append((it, ex))

        prepared = self._prepare(tenant_id, todo, state)
        await self._enrich(prepared, state.topics)

        async with tenant_session(tenant_id) as s:
            s.add_all(new_containers)
            await s.flush()
            for ex in to_delete:
                await s.execute(
                    update(SourceItem).where(SourceItem.id == ex.id).values(deleted_at=func.now())
                )
                s.add(_event(tenant_id, ex.source, ex.external_ref, "delete"))
                report.deleted += 1
            for p in prepared:
                await self._write(s, p)
                s.add(
                    _event(
                        tenant_id,
                        p.item.source,
                        p.item.external_ref,
                        "update" if p.existing else "create",
                    )
                )
                report.item_ids.append(p.row["id"])
                if p.row["injection_flag"]:
                    report.injection_flagged.append(p.row["id"])
                if p.existing:
                    report.updated += 1
                else:
                    report.created += 1
        return report

    # --- phase A: one read transaction ---------------------------------------------------

    async def _read_state(self, tenant_id: uuid.UUID, items: list[IngestItem]) -> _State:
        kinds = {it.container_kind for it in items}
        ext_ids = {it.container_external_id for it in items}
        refs = {it.external_ref for it in items}
        sources = {it.source for it in items}
        async with tenant_session(tenant_id) as s:
            containers = {
                (c.source, c.external_id): c
                for c in await s.scalars(
                    select(Container).where(
                        Container.source.in_(kinds), Container.external_id.in_(ext_ids)
                    )
                )
            }
            existing = {
                (i.source, i.external_ref): i
                for i in await s.scalars(
                    select(SourceItem).where(
                        SourceItem.source.in_(sources), SourceItem.external_ref.in_(refs)
                    )
                )
            }
            profiles = (
                (
                    await s.execute(
                        select(MemberProfile)
                        .join(
                            Membership,
                            (Membership.user_id == MemberProfile.user_id)
                            & (Membership.tenant_id == MemberProfile.tenant_id),
                        )
                        .where(Membership.status == "active")
                    )
                )
                .scalars()
                .all()
            )
            role_rows = (
                await s.execute(
                    select(UserRole.user_id, Role.key).join(
                        Role, (Role.id == UserRole.role_id) & (Role.tenant_id == UserRole.tenant_id)
                    )
                )
            ).all()
            topics = [
                TopicHint(t.topic_key, t.display_name, tuple(t.aliases))
                for t in await s.scalars(select(TopicOwner))
            ]
            taken_ids = set(await s.scalars(select(SourceItem.id).where(SourceItem.type != "chat")))
            declared_domains = await company_domains.configured(s)
            chat_counters: dict[uuid.UUID, int] = {}
            prior_context: dict[uuid.UUID, list[str]] = {}
            chat_containers = [
                containers[(it.container_kind, it.container_external_id)].id
                for it in items
                if it.type == "chat" and (it.container_kind, it.container_external_id) in containers
            ]
            for cid in set(chat_containers):
                ids = await s.scalars(
                    select(SourceItem.id).where(
                        SourceItem.container_id == cid, SourceItem.type == "chat"
                    )
                )
                chat_counters[cid] = max((_seq(i) for i in ids), default=0)
                recent = await s.execute(
                    select(SourceItem.author_display, Chunk.text_masked)
                    .join(
                        Chunk,
                        (Chunk.item_id == SourceItem.id)
                        & (Chunk.tenant_id == SourceItem.tenant_id),
                    )
                    .where(SourceItem.container_id == cid, SourceItem.deleted_at.is_(None))
                    .order_by(SourceItem.created_at.desc())
                    .limit(CONTEXT_BEFORE)
                )
                prior_context[cid] = [f"{a}: {t}" for a, t in reversed(recent.all())]

        roles: dict[uuid.UUID, set[str]] = defaultdict(set)
        for uid, key in role_rows:
            roles[uid].add(key)
        async with global_session() as s:
            users = {
                u.id: u
                for u in await s.scalars(
                    select(User).where(User.id.in_([p.user_id for p in profiles]))
                )
            }
        members = [
            _Member(
                author=authority.Author(
                    user_id=p.user_id,
                    name=users[p.user_id].name,
                    title=p.title,
                    role_keys=frozenset(roles.get(p.user_id, ())),
                ),
                email=users[p.user_id].email.lower(),
                slack_user_id=p.slack_user_id,
                aliases=tuple(a.lower() for a in (p.display_aliases or [])),
            )
            for p in profiles
            if p.user_id in users
        ]
        domains = company_domains.from_emails(m.email for m in members) | declared_domains
        return _State(
            containers, existing, members, topics, domains, taken_ids, chat_counters, prior_context
        )

    # --- pure computation --------------------------------------------------------------------

    def _resolve_author(self, it: IngestItem, members: list[_Member]) -> authority.Author | None:
        ext = (it.author_external_id or "").strip()
        if not ext:
            return None
        low = ext.lower()
        for m in members:
            if (
                (it.source == "slack" and m.slack_user_id == ext)
                or low == m.email
                or (it.source == "whatsapp" and (low == m.author.name.lower() or low in m.aliases))
            ):
                return m.author
        return None

    def _assign_id(self, it: IngestItem, container: Container, state: _State) -> str:
        if it.type == "chat":
            n = state.chat_counters.get(container.id, 0) + 1
            state.chat_counters[container.id] = n
            prefix = "wa-" if it.source == "whatsapp" else ""
            return f"CHAT-{prefix}{slugify(container.name, 32)}-{n:04d}"
        base = (
            f"TASK-{it.id_hint}"
            if it.type == "task" and it.id_hint
            else f"DOC-{slugify(it.id_hint or it.title or it.external_ref)}"
        )
        candidate, n = base, 1
        while candidate in state.taken_ids:
            n += 1
            candidate = f"{base}-{n}"
        state.taken_ids.add(candidate)
        return candidate

    def _prepare(
        self, tenant_id: uuid.UUID, todo: list[tuple[IngestItem, SourceItem | None]], state: _State
    ) -> list[_Prepared]:
        prepared: list[_Prepared] = []
        masked_chat: dict[str, str] = {}  # external_ref -> "author: masked text"
        for it, _ in todo:
            if it.type == "chat":
                masked = pii.mask_text(it.text, state.company_domains)[0]
                author = self._resolve_author(it, state.members)
                name = author.name if author else (it.author_display or "?")
                masked_chat[it.external_ref] = f"{name}: {masked}"

        # Context windows: neighbours in the same thread (else container), ordered by time.
        groups: dict[str, list[IngestItem]] = defaultdict(list)
        for it, _ in todo:
            if it.type == "chat":
                groups[it.thread_key or it.container_external_id].append(it)
        window: dict[str, str] = {}
        for msgs in groups.values():
            msgs.sort(key=lambda m: m.created_at)
            container = state.containers[(msgs[0].container_kind, msgs[0].container_external_id)]
            prior = state.prior_context.get(container.id, [])
            for i, m in enumerate(msgs):
                before = [masked_chat[x.external_ref] for x in msgs[max(0, i - CONTEXT_BEFORE) : i]]
                if len(before) < CONTEXT_BEFORE and i == len(before):
                    before = prior[-(CONTEXT_BEFORE - len(before)) :] + before if prior else before
                after = [masked_chat[x.external_ref] for x in msgs[i + 1 : i + 1 + CONTEXT_AFTER]]
                window[m.external_ref] = "\n".join([*before, *after])

        for it, ex in sorted(todo, key=lambda p: p[0].created_at):
            container = state.containers[(it.container_kind, it.container_external_id)]
            author = self._resolve_author(it, state.members)
            item_id = ex.id if ex is not None else self._assign_id(it, container, state)
            spans = pii.detect(it.full_text, state.company_domains)
            injection = detect_injection(it.full_text)
            row = {
                "tenant_id": tenant_id,
                "id": item_id,
                "type": it.type,
                "source": it.source,
                "container_id": container.id,
                "external_ref": it.external_ref,
                "url": it.url,
                "title": it.title,
                "author_user_id": author.user_id if author else None,
                "author_display": author.name if author else it.author_display,
                "created_at": it.created_at,
                "updated_at": it.updated_at,
                "deleted_at": None,
                "version": it.version,
                "supersedes_id": f"{item_id}@v{ex.version}" if ex is not None else None,
                "authority": authority.decide(
                    it.type, container.authority_default, container.owner_user_id, author
                ),
                "injection_flag": bool(injection),
                "pii_spans": [sp.as_dict() for sp in spans],
                "structured": it.structured,
                "raw_text": it.full_text,
                "storage_key": it.storage_key,
                "topic_keys": [],
                "entities": [],
            }
            prepared.append(
                _Prepared(it, row, self._chunks(it, item_id, container, window, state), ex)
            )
        return prepared

    def _chunks(
        self, it: IngestItem, item_id: str, container: Container, window: dict, state: _State
    ) -> list[dict]:
        if it.type == "chat":
            parts = [(None, None, it.text, window.get(it.external_ref) or None)]
        elif it.type == "task":
            st = it.structured or {}
            ctx = ", ".join(
                f"{k}: {st[k]}" for k in ("status", "assignee", "priority", "due") if st.get(k)
            )
            parts = [(None, None, t, f"{it.title}. {ctx}") for t in split_long(it.text)]
        else:
            from brain.ingestion.connectors.documents import parse_markdown

            sections = it.sections if it.sections is not None else parse_markdown(it.text)[1]
            parts = [
                (anchor, heading, text, " › ".join(x for x in (it.title, heading) if x))
                for anchor, heading, text in section_chunks(sections)
            ]
        out = []
        for ord_, (anchor, _heading, text, context) in enumerate(parts):
            masked, _ = pii.mask_text(text, state.company_domains)
            ctx_masked = pii.mask_text(context, state.company_domains)[0] if context else None
            label = f"#{container.name}" if it.type == "chat" else (it.title or container.name)
            embed_text = "\n".join(
                x for x in (label, ctx_masked if it.type != "chat" else None, masked) if x
            )
            if it.type == "chat" and ctx_masked:
                embed_text += f"\n(konteks: {ctx_masked})"
            out.append(
                {
                    "ord": ord_,
                    "anchor": anchor,
                    "text_masked": masked,
                    "text_raw": text,
                    "context_text": ctx_masked,
                    "_embed": embed_text[:EMBED_CHARS],
                }
            )
        return out

    # --- network: extraction + embeddings (no transaction open) ---------------------------------

    async def _enrich(self, prepared: list[_Prepared], topics: list[TopicHint]) -> None:
        if not prepared:
            return
        masked_docs = [" ".join(c["text_masked"] for c in p.chunks)[:1500] for p in prepared]
        extracted = await self._extractor.extract(masked_docs, topics)
        for p, e in zip(prepared, extracted, strict=True):
            p.row["topic_keys"], p.row["entities"] = e.topic_keys, e.entities
        flat = [c for p in prepared for c in p.chunks]
        vectors = await self.embedder.embed_documents([c["_embed"] for c in flat])
        for c, v in zip(flat, vectors, strict=True):
            c["embedding"] = v
            c["embedding_model"] = self.embedder.model

    # --- phase B: write ---------------------------------------------------------------------------

    async def _write(self, s: AsyncSession, p: _Prepared) -> None:
        if p.existing is None:
            s.add(SourceItem(**p.row))
            await s.flush()
        else:
            values = {k: v for k, v in p.row.items() if k not in ("tenant_id", "id")}
            await s.execute(update(SourceItem).where(SourceItem.id == p.row["id"]).values(**values))
            await s.execute(delete(Chunk).where(Chunk.item_id == p.row["id"]))
        s.add_all(
            Chunk(
                tenant_id=p.row["tenant_id"],
                item_id=p.row["id"],
                **{k: v for k, v in c.items() if not k.startswith("_")},
            )
            for c in p.chunks
        )
        await s.flush()


def _seq(item_id: str) -> int:
    m = re.search(r"-(\d+)$", item_id)
    return int(m.group(1)) if m else 0


def _latest_per_ref(items: list[IngestItem]) -> list[IngestItem]:
    """Several events for one message in a batch (e.g. edits): keep the highest version/last."""
    latest: dict[tuple[str, str], IngestItem] = {}
    for it in items:
        key = (it.source, it.external_ref)
        if key not in latest or it.version >= latest[key].version:
            latest[key] = it
    return list(latest.values())


def _event(tenant_id: uuid.UUID, source: str, ref: str, kind: str) -> IngestionEvent:
    now = datetime.now(UTC)
    return IngestionEvent(
        tenant_id=tenant_id, source=source, external_ref=ref, event_type=kind,
        received_at=now, processed_at=now, status="processed",
    )  # fmt: skip
