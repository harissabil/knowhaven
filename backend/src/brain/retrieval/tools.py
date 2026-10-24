"""The retrieval tools the agent may call (design doc 10.2).

A `Retriever` is built per request from the RequestContext. The model can only choose query
text, entities, dates and task filters; tenant, user, roles and the permission filter come from
the context and are never tool arguments. Every call is logged for the trace, and every returned
ID is remembered: that set is what citation validation (step 7) checks against.
"""

import asyncio
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime

from brain.config import get_settings
from brain.db.session import tenant_session
from brain.llm.embed import GeminiEmbedder, get_embedder
from brain.rbac.context import RequestContext
from brain.retrieval import search
from brain.retrieval.search import NO_PII, Hit, PiiPolicy, SearchResult

NOT_FOUND = "Tidak ditemukan. / Not found."

# Query embeddings, per tenant (cache keys always start with the tenant, 6.2). Small LRU.
_VECTOR_CACHE: OrderedDict[tuple, list[float]] = OrderedDict()
_VECTOR_CACHE_MAX = 512


def _cache_get(key: tuple) -> list[float] | None:
    v = _VECTOR_CACHE.get(key)
    if v is not None:
        _VECTOR_CACHE.move_to_end(key)
    return v


def _cache_put(key: tuple, v: list[float]) -> None:
    _VECTOR_CACHE[key] = v
    _VECTOR_CACHE.move_to_end(key)
    while len(_VECTOR_CACHE) > _VECTOR_CACHE_MAX:
        _VECTOR_CACHE.popitem(last=False)


@dataclass
class ToolCall:
    tool: str
    args: dict
    returned_ids: list[str]
    filtered_count: int  # auditor-only
    ms: int
    vector: bool = True  # False when the semantic leg was skipped (embedding not ready in time)


@dataclass
class Retriever:
    ctx: RequestContext
    policy: PiiPolicy = NO_PII
    embedder: GeminiEmbedder | None = None
    calls: list[ToolCall] = field(default_factory=list)
    seen: dict[str, Hit] = field(default_factory=dict)  # citation_id -> hit (the allowed set)
    _pending: dict[str, asyncio.Task] = field(default_factory=dict)
    _last_vector_used: bool = True

    def prefetch(self, *queries: str) -> None:
        """Start embedding queries now (e.g. the user's question, in parallel with step 2)."""
        for q in queries:
            self._task(q)

    def _task(self, query: str) -> asyncio.Task | None:
        key = (self.ctx.tenant_id, query)
        if _cache_get(key) is not None:
            return None
        if query not in self._pending:

            async def run() -> list[float]:
                v = await (self.embedder or get_embedder()).embed_query(query)
                _cache_put(key, v)
                return v

            self._pending[query] = asyncio.create_task(run())
        return self._pending[query]

    async def _vector(self, query: str) -> list[float] | None:
        cached = _cache_get((self.ctx.tenant_id, query))
        if cached is not None:
            self._last_vector_used = True
            return cached
        task = self._task(query)
        try:
            v = await asyncio.wait_for(asyncio.shield(task), get_settings().retrieval_vector_wait_s)
        except (TimeoutError, Exception):  # noqa: BLE001 - degrade to keyword + trigram search
            v = None
        self._last_vector_used = v is not None
        return v

    def _record(self, tool: str, args: dict, res: SearchResult, started: float) -> SearchResult:
        for h in res.hits:
            self.seen[h.citation_id] = h
            self.seen.setdefault(h.item_id, h)
        self.calls.append(
            ToolCall(
                tool,
                {k: v for k, v in args.items() if v not in (None, [], ())},
                [h.citation_id for h in res.hits],
                res.filtered_count,
                int((time.monotonic() - started) * 1000),
                vector=self._last_vector_used if tool.startswith("search_") else False,
            )
        )
        return res

    async def search_messages(
        self,
        query: str,
        entities: list[str] | None = None,
        since: datetime | None = None,
        limit: int = 8,
    ) -> SearchResult:
        t = time.monotonic()
        qv = await self._vector(query)
        async with tenant_session(self.ctx.tenant_id) as s:
            res = await search.hybrid_search(
                s, self.ctx, query, types=("chat",), query_vector=qv, entities=entities or (),
                since=since, limit=min(limit, 12), policy=self.policy,
            )  # fmt: skip
        return self._record(
            "search_messages", {"query": query, "entities": entities, "since": since}, res, t
        )

    async def search_documents(
        self, query: str, entities: list[str] | None = None, limit: int = 6
    ) -> SearchResult:
        t = time.monotonic()
        qv = await self._vector(query)
        async with tenant_session(self.ctx.tenant_id) as s:
            res = await search.hybrid_search(
                s, self.ctx, query, types=("doc",), query_vector=qv, entities=entities or (),
                limit=min(limit, 10), policy=self.policy,
            )  # fmt: skip
        return self._record("search_documents", {"query": query, "entities": entities}, res, t)

    async def query_tasks(
        self,
        project: str | None = None,
        status: str | None = None,
        assignee: str | None = None,
        entity: str | None = None,
        due_before: str | None = None,
    ) -> SearchResult:
        t = time.monotonic()
        args = {
            "project": project,
            "status": status,
            "assignee": assignee,
            "entity": entity,
            "due_before": due_before,
        }
        async with tenant_session(self.ctx.tenant_id) as s:
            res = await search.query_tasks(s, self.ctx, policy=self.policy, **args)
        return self._record("query_tasks", args, res, t)

    async def get_item(self, item_id: str) -> SearchResult:
        t = time.monotonic()
        async with tenant_session(self.ctx.tenant_id) as s:
            hits = await search.get_item(s, self.ctx, item_id, policy=self.policy)
        return self._record("get_item", {"item_id": item_id}, SearchResult(hits=hits or []), t)


def _safe(text: str) -> str:
    # Retrieved text is data: it must not be able to close or open a <source> block.
    return text.replace("<", "‹").replace(">", "›")


def format_hits(res: SearchResult) -> str:
    """Wrap results as data blocks for the model (design doc 11.5, layer 3)."""
    if not res.hits:
        return NOT_FOUND
    blocks = []
    for h in res.hits:
        attrs = {
            "id": h.citation_id,
            "type": h.type,
            "container": h.container,
            "author": h.author,
            "date": h.updated_at.date().isoformat(),
            "authority": h.authority,
        }
        if h.injection_flag:
            attrs["flag"] = "contains_instructions_to_ignore"
        head = " ".join(f'{k}="{_safe(str(v))}"' for k, v in attrs.items() if v)
        body = _safe(h.text)
        if h.type == "task" and h.structured:
            st = h.structured
            fields = "; ".join(
                f"{k}: {st.get(k)}" for k in ("status", "assignee", "priority", "due")
            )
            body = f"{_safe(h.title or '')}\n{fields}\n{body}"
        elif h.context:
            body += f"\n(konteks: {_safe(h.context)})"
        blocks.append(f"<source {head}>\n{body}\n</source>")
    return "\n".join(blocks)
