"""Chat (SSE), conversation history, and the source viewer (design doc 14.1, 10.5, 11.1)."""

import asyncio
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from brain import storage
from brain.agent.pipeline import Event, Pipeline
from brain.api.deps import Member
from brain.db.models import Conversation, Message, SourceItem
from brain.db.session import tenant_session
from brain.rbac.visibility import visible_item_clause
from brain.retrieval.tools import Retriever

router = APIRouter(tags=["chat"])

_STOP = object()


def get_pipeline() -> Pipeline:
    return Pipeline()


class ChatIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None


@router.post("/chat")
async def chat(
    body: ChatIn, ctx: Member, pipeline: Annotated[Pipeline, Depends(get_pipeline)]
) -> StreamingResponse:
    """Server-Sent Events over POST: `trace`, `delta` (draft), `replace`, `final`, `error`.
    The pipeline runs in its own task, so a client disconnect never skips the audit record."""
    queue: asyncio.Queue = asyncio.Queue()

    async def produce() -> None:
        try:
            async for ev in pipeline.run(ctx, body.question, body.conversation_id, "web"):
                await queue.put(ev)
        finally:
            await queue.put(_STOP)

    task = asyncio.create_task(produce())

    async def stream():
        while True:
            ev = await queue.get()
            if ev is _STOP:
                break
            yield ev.sse()
        await task

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def ask(
    ctx,
    question: str,
    conversation_id: uuid.UUID | None,
    channel: str,
    pipeline: Pipeline | None = None,
) -> dict:
    """Non-streaming helper (MCP, tests): run the pipeline and return the `final` payload."""
    final: dict = {}
    async for ev in (pipeline or Pipeline()).run(ctx, question, conversation_id, channel):
        if isinstance(ev, Event) and ev.name == "final":
            final = ev.data
    return final


class ConversationOut(BaseModel):
    id: str
    title: str | None
    channel: str
    created_at: datetime


class MessageOut(BaseModel):
    role: str
    content: str
    citations: list[str]
    created_at: datetime
    query_id: str | None
    stale: bool  # written under an older permission version: not reused as context (10.5)


@router.get("/conversations")
async def conversations(ctx: Member) -> list[ConversationOut]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = await s.scalars(
            select(Conversation)
            .where(Conversation.user_id == ctx.user_id)
            .order_by(Conversation.created_at.desc())
            .limit(50)
        )
        return [
            ConversationOut(id=str(c.id), title=c.title, channel=c.channel, created_at=c.created_at)
            for c in rows
        ]


@router.get("/conversations/{conversation_id}")
async def conversation(conversation_id: uuid.UUID, ctx: Member) -> list[MessageOut]:
    async with tenant_session(ctx.tenant_id) as s:
        conv = await s.scalar(
            select(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == ctx.user_id
            )
        )
        if conv is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation_not_found")
        msgs = await s.scalars(
            select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at)
        )
        return [
            MessageOut(
                role=m.role,
                content=m.content,
                citations=m.citations,
                created_at=m.created_at,
                query_id=str(m.query_id) if m.query_id else None,
                stale=m.permission_version != ctx.permission_version,
            )  # fmt: skip
            for m in msgs
        ]


class SourceChunkOut(BaseModel):
    citation_id: str
    anchor: str | None
    text: str


class SourceOut(BaseModel):
    id: str
    type: str
    source: str
    title: str | None
    container: str
    author: str | None
    created_at: datetime
    updated_at: datetime
    url: str | None
    authority: str
    injection_flag: bool
    structured: dict | None
    chunks: list[SourceChunkOut]
    download_url: str | None


@router.get("/sources/{citation_id:path}")
async def source(citation_id: str, ctx: Member) -> SourceOut:
    """Open a cited source. Permission is checked again; forbidden and unknown IDs both 404
    with the same body (T24). Text is masked (raw PII only through a question that needs it)."""
    r = Retriever(ctx)
    res = await r.get_item(citation_id)
    if not res.hits:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source_not_found")
    h = res.hits[0]
    download = None
    async with tenant_session(ctx.tenant_id) as s:
        key = await s.scalar(
            select(SourceItem.storage_key).where(
                SourceItem.id == h.item_id, visible_item_clause(ctx)
            )
        )
    if key:
        download = storage.presigned_get_url(key, expires_in=300)
    return SourceOut(
        id=h.item_id, type=h.type, source=h.source, title=h.title, container=h.container, author=h.author,
        created_at=h.created_at, updated_at=h.updated_at, url=h.url, authority=h.authority,
        injection_flag=h.injection_flag, structured=h.structured,
        chunks=[SourceChunkOut(citation_id=x.citation_id, anchor=x.citation_id.partition("#")[2] or None, text=x.text) for x in res.hits],
        download_url=download,
    )  # fmt: skip
