"""Hybrid, permission-filtered retrieval (design doc 10.2, 8.4, 11.1).

One SQL statement per search: a `vis` CTE applies visible(item, user) *first*; the vector,
lexical and trigram legs only ever rank chunks of visible items, and are fused with Reciprocal
Rank Fusion. Forbidden items therefore can't appear, can't shift ranks or scores, and can't
change latency in a data-dependent way. `filtered_count` (auditor-only) is the one place that
looks at non-visible items, and it only counts.
"""

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import (
    ColumnElement,
    Select,
    and_,
    func,
    literal_column,
    not_,
    or_,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import Chunk, Container, Membership, PiiPermission, SourceItem, User
from brain.ingestion import pii
from brain.ingestion.pipeline import FREE_MAIL
from brain.rbac.context import RequestContext
from brain.rbac.visibility import visible_item_clause
from brain.retrieval.expansion import lexical_terms, name_terms, tsquery

RRF_K = 60
LEG_LIMIT = 40
TRIGRAM_MIN = 0.5
MAX_CHUNKS_PER_ITEM = 2


@dataclass
class Hit:
    citation_id: str  # item id, or item id#anchor for document sections
    item_id: str
    type: str
    source: str
    title: str | None
    container: str
    author: str | None
    created_at: datetime
    updated_at: datetime
    authority: str
    injection_flag: bool
    text: str
    context: str | None
    url: str | None
    structured: dict | None = None
    score: float = 0.0
    revealed_pii: bool = False


@dataclass
class SearchResult:
    hits: list[Hit] = field(default_factory=list)
    filtered_count: int = 0  # auditor-only: matching chunks of items the user can't see


@dataclass(frozen=True)
class PiiPolicy:
    """Whether raw PII may be shown for this request, and which types (11.4)."""

    allowed: frozenset[str] = frozenset()
    company_domains: frozenset[str] = frozenset()

    @property
    def any(self) -> bool:
        return bool(self.allowed)


NO_PII = PiiPolicy()


async def pii_policy(s: AsyncSession, ctx: RequestContext, needs_pii: bool) -> PiiPolicy:
    """Raw PII only if the question needs it (step 2) AND a business role has the permission.
    Company email domains are always loaded: work addresses aren't personal data (11.4)."""
    emails = await s.scalars(
        select(User.email)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.status == "active")
    )
    domains = frozenset(e.split("@")[1].lower() for e in emails) - FREE_MAIL
    if not needs_pii or not ctx.business_role_ids:
        return PiiPolicy(frozenset(), domains)
    allowed = frozenset(
        await s.scalars(
            select(PiiPermission.pii_type).where(
                PiiPermission.role_id.in_(sorted(ctx.business_role_ids))
            )
        )
    )
    return PiiPolicy(allowed, domains)


def _visible_ids(ctx: RequestContext, types: tuple[str, ...], since: datetime | None):
    q = select(SourceItem.id.label("item_id")).where(
        visible_item_clause(ctx), SourceItem.type.in_(types)
    )
    if since is not None:
        q = q.where(SourceItem.created_at >= since)
    return q.cte("vis")


def _tsq(terms: list[str]) -> ColumnElement | None:
    tq = tsquery(terms)
    if not tq:
        return None
    return func.to_tsquery(literal_column("'indonesian'::regconfig"), tq).op("||")(
        func.to_tsquery(literal_column("'english'::regconfig"), tq)
    )


def _haystack():
    return func.coalesce(Chunk.context_text, "") + " " + Chunk.text_masked


def _similarity(names: list[str]) -> ColumnElement:
    sims = [func.word_similarity(n, _haystack()) for n in names]
    return sims[0] if len(sims) == 1 else func.greatest(*sims)


def _legs(vis, query_vector, tsq, names) -> list[Select]:
    legs: list[Select] = []
    joined = select().select_from(Chunk).join(vis, vis.c.item_id == Chunk.item_id)
    if query_vector is not None:
        dist = Chunk.embedding.cosine_distance(query_vector)
        legs.append(
            joined.add_columns(
                Chunk.id.label("cid"), func.row_number().over(order_by=dist).label("r")
            )
            .where(Chunk.embedding.is_not(None))
            .order_by(dist)
            .limit(LEG_LIMIT)
        )
    if tsq is not None:
        rank = func.ts_rank_cd(Chunk.tsv, tsq)
        legs.append(
            joined.add_columns(
                Chunk.id.label("cid"), func.row_number().over(order_by=rank.desc()).label("r")
            )
            .where(Chunk.tsv.op("@@")(tsq))
            .order_by(rank.desc())
            .limit(LEG_LIMIT)
        )
    if names:
        sim = _similarity(names)
        legs.append(
            joined.add_columns(
                Chunk.id.label("cid"), func.row_number().over(order_by=sim.desc()).label("r")
            )
            .where(sim >= TRIGRAM_MIN)
            .order_by(sim.desc())
            .limit(LEG_LIMIT)
        )
    return legs


def _hit(row, policy: PiiPolicy) -> Hit:
    c, item, container = row.Chunk, row.SourceItem, row.container
    text, revealed = c.text_masked, False
    if policy.any:
        text, revealed = pii.mask_except(c.text_raw, policy.allowed, policy.company_domains)
    return Hit(
        citation_id=f"{item.id}#{c.anchor}" if c.anchor else item.id,
        item_id=item.id,
        type=item.type,
        source=item.source,
        title=item.title,
        container=container,
        author=item.author_display,
        created_at=item.created_at,
        updated_at=item.updated_at,
        authority=item.authority,
        injection_flag=item.injection_flag,
        text=text,
        context=c.context_text,
        url=item.url,
        structured=item.structured,
        score=round(float(getattr(row, "score", 0.0) or 0.0), 6),
        revealed_pii=revealed,
    )


def _detail_query():
    return (
        select(Chunk, SourceItem, Container.name.label("container"))
        .join(
            SourceItem, (SourceItem.id == Chunk.item_id) & (SourceItem.tenant_id == Chunk.tenant_id)
        )
        .join(
            Container,
            (Container.id == SourceItem.container_id)
            & (Container.tenant_id == SourceItem.tenant_id),
        )
    )


async def hybrid_search(
    s: AsyncSession,
    ctx: RequestContext,
    query: str,
    *,
    types: tuple[str, ...],
    query_vector: list[float] | None,
    entities: list[str] | tuple[str, ...] = (),
    since: datetime | None = None,
    limit: int = 8,
    policy: PiiPolicy = NO_PII,
) -> SearchResult:
    vis = _visible_ids(ctx, types, since)
    tsq = _tsq(lexical_terms(query, entities))
    names = name_terms(query, entities)
    legs = _legs(vis, query_vector, tsq, names)
    result = SearchResult()
    if legs:
        allr = union_all(*legs).subquery("allr")
        fused = (
            select(allr.c.cid, func.sum(1.0 / (RRF_K + allr.c.r)).label("score"))
            .group_by(allr.c.cid)
            .subquery("fused")
        )
        rows = (
            await s.execute(
                _detail_query()
                .add_columns(fused.c.score)
                .join(fused, fused.c.cid == Chunk.id)
                .order_by(fused.c.score.desc(), Chunk.id)
                .limit(limit * 3)
            )
        ).all()
        per_item: dict[str, int] = {}
        for row in rows:
            n = per_item.get(row.SourceItem.id, 0)
            if n < MAX_CHUNKS_PER_ITEM:
                per_item[row.SourceItem.id] = n + 1
                result.hits.append(_hit(row, policy))
            if len(result.hits) == limit:
                break
    result.filtered_count = await _filtered_count(s, ctx, types, tsq, names)
    return result


async def _filtered_count(s, ctx, types, tsq, names) -> int:
    """Auditor-only count of matching chunks the user may NOT see (never shown to the user)."""
    conds = []
    if tsq is not None:
        conds.append(Chunk.tsv.op("@@")(tsq))
    if names:
        conds.append(_similarity(names) >= TRIGRAM_MIN)
    if not conds:
        return 0
    return await s.scalar(
        select(func.count())
        .select_from(Chunk)
        .join(
            SourceItem, (SourceItem.id == Chunk.item_id) & (SourceItem.tenant_id == Chunk.tenant_id)
        )
        .where(SourceItem.type.in_(types), not_(visible_item_clause(ctx)), or_(*conds))
    )


# --- tasks: structured query (design doc 7.4: tasks are answered from `structured`) ----------

OPEN_WORDS = {
    "open",
    "aktif",
    "active",
    "belum selesai",
    "masih open",
    "ongoing",
    "berjalan",
    "todo",
    "to do",
}
DONE_WORDS = {"done", "selesai", "closed", "resolved", "tutup"}


async def query_tasks(
    s: AsyncSession,
    ctx: RequestContext,
    *,
    project: str | None = None,
    status: str | None = None,
    assignee: str | None = None,
    entity: str | None = None,
    due_before: str | None = None,
    limit: int = 20,
    policy: PiiPolicy = NO_PII,
) -> SearchResult:
    st = SourceItem.structured
    conds = [SourceItem.type == "task", visible_item_clause(ctx)]
    if project:
        conds.append(st["project"].astext == project.strip().upper())
    if status:
        low = status.strip().lower()
        if low in OPEN_WORDS:
            conds.append(st["status_category"].astext.in_(("new", "indeterminate")))
        elif low in DONE_WORDS:
            conds.append(st["status_category"].astext == "done")
        else:
            conds.append(st["status"].astext.ilike(low))
    if assignee:
        conds.append(st["assignee"].astext.ilike(f"%{assignee.strip()}%"))
    if due_before:
        conds.append(st["due"].astext <= due_before)
    if entity:
        e = entity.strip()
        # Match on entities, title and *masked* text only (a PII value must not find a task).
        conds.append(
            or_(
                func.array_to_string(SourceItem.entities, " ").ilike(f"%{e}%"),
                SourceItem.title.ilike(f"%{e}%"),
                Chunk.text_masked.ilike(f"%{e}%"),
            )
        )
    rows = (
        await s.execute(
            _detail_query()
            .where(and_(*conds), Chunk.ord == 0)
            .order_by(
                st["due"].astext.asc().nulls_last(), SourceItem.updated_at.desc(), SourceItem.id
            )
            .limit(limit)
        )
    ).all()
    return SearchResult(hits=[_hit(r, policy) for r in rows])


# --- single item --------------------------------------------------------------------------


async def get_item(
    s: AsyncSession, ctx: RequestContext, citation_id: str, policy: PiiPolicy = NO_PII
) -> list[Hit] | None:
    """Chunks of one visible item (optionally one section). Forbidden and unknown IDs both return
    None, through the same query, so the response can't tell them apart (11.1, T24)."""
    item_id, _, anchor = citation_id.strip().partition("#")
    q = (
        _detail_query()
        .where(SourceItem.id == item_id, visible_item_clause(ctx))
        .order_by(Chunk.ord)
    )
    if anchor:
        q = q.where(Chunk.anchor == anchor)
    rows = (await s.execute(q)).all()
    return [_hit(r, policy) for r in rows] or None
