"""Approval-gated document updates (design doc 12.2, T06 "draf update SOP dibuat untuk approval").

When conflict resolution finds an authoritative announcement newer than an official document,
the pipeline proposes an `action_draft`: target document + section, old → new value, a diff,
the evidence citations and the originating query. Nothing is executed until an approver (topic
owner → document owner → managers → admins) approves it; then `executors.execute()` applies it.
"""

import difflib
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.audit import log as audit
from brain.db.models import ActionDraft, Chunk, SourceItem
from brain.hitl import approvers
from brain.hitl.access import HitlError
from brain.policy.conflict import _AMOUNT, amounts
from brain.rbac.context import RequestContext


def format_amount(n: int) -> str:
    return "Rp" + f"{n:,}".replace(",", ".")


def replace_amount(text: str, old: int, new: int) -> tuple[str, int]:
    """Replace every occurrence of the amount `old` in `text` with `new` (Indonesian format)."""
    count = 0

    def sub(m: re.Match) -> str:
        nonlocal count
        if amounts(m.group(0)) == [old]:
            count += 1
            return format_amount(new)
        return m.group(0)

    return _AMOUNT.sub(sub, text), count


async def propose(
    s: AsyncSession, ctx: RequestContext, query_id: uuid.UUID, candidates: list[dict]
) -> list[uuid.UUID]:
    """Create pending drafts for stale documents (deduplicated per target + new value)."""
    created = []
    for r in candidates:
        chosen = r.get("chosen") or {}
        new_vals = amounts(chosen.get("value", ""))
        for comp in r.get("competing", []):
            cid = comp["citation_id"]
            item_id, _, anchor = cid.partition("#")
            old_vals = amounts(comp.get("value", ""))
            if item_id not in r.get("stale_doc_ids", []) or not (new_vals and old_vals):
                continue
            item = await s.scalar(select(SourceItem).where(SourceItem.id == item_id))
            q = select(Chunk).where(Chunk.item_id == item_id).order_by(Chunk.ord)
            if anchor:
                q = q.where(Chunk.anchor == anchor)
            chunk = await s.scalar(q)
            if item is None or chunk is None:
                continue
            new_text, n = replace_amount(chunk.text_raw, old_vals[0], new_vals[0])
            if n == 0:
                continue
            dup = await s.scalar(
                select(ActionDraft.id).where(
                    ActionDraft.target_ref == cid, ActionDraft.status == "pending",
                    ActionDraft.payload["new_value"].astext == format_amount(new_vals[0]),
                )
            )  # fmt: skip
            if dup:
                continue
            diff = "".join(
                difflib.unified_diff(
                    chunk.text_raw.splitlines(keepends=True), new_text.splitlines(keepends=True),
                    fromfile=f"{cid} (v{item.version})", tofile=f"{cid} (usulan)",
                )
            )  # fmt: skip
            draft = ActionDraft(
                tenant_id=ctx.tenant_id,
                kind="update_doc_value",
                target_system="confluence" if item.source == "confluence" else "internal",
                target_ref=cid,
                payload={
                    "item_id": item_id, "anchor": anchor or None, "title": item.title, "url": item.url,
                    "topic": r.get("topic"), "old_value": format_amount(old_vals[0]), "new_value": format_amount(new_vals[0]),
                    "old_text": chunk.text_raw, "new_text": new_text, "base_version": item.version,
                    "reason": "announcement_newer_than_doc",
                },
                diff=diff,
                evidence_ids=sorted({chosen.get("citation_id"), cid} - {None}),
                created_by_query_id=query_id,
            )  # fmt: skip
            s.add(draft)
            await s.flush()
            await audit.append(
                s, ctx.tenant_id, "approval", actor_user_id=None, channel="system", permission_version=ctx.permission_version,
                details={"action": "draft.propose", "draft_id": str(draft.id), "target": cid, "proposed_by": "agent",
                         "query_id": str(query_id), "old": format_amount(old_vals[0]), "new": format_amount(new_vals[0])},
            )  # fmt: skip
            created.append(draft.id)
    return created


async def approvers_for(s: AsyncSession, draft: ActionDraft) -> set[uuid.UUID]:
    item = await s.scalar(select(SourceItem).where(SourceItem.id == draft.payload["item_id"]))
    if item is None:
        return set()
    return await approvers.for_draft(s, draft.payload.get("topic"), item.container_id)


async def load_for_decision(
    s: AsyncSession, ctx: RequestContext, draft_id: uuid.UUID
) -> ActionDraft:
    draft = await s.scalar(select(ActionDraft).where(ActionDraft.id == draft_id).with_for_update())
    if draft is None or ctx.user_id not in await approvers_for(s, draft):
        raise HitlError("draft_not_found")
    if draft.status != "pending":
        raise HitlError("already_decided")
    return draft
