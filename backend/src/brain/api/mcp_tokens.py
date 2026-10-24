"""Personal MCP tokens for WorkBuddy (design doc 13.3): Settings → Hubungkan WorkBuddy.

A token identifies one (user, active tenant) pair; roles are re-read from the DB on every MCP
call. The raw token is shown once; only its sha256 is stored. Pending members can't create one.
"""

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update

from brain.api.deps import Member
from brain.audit import log as audit
from brain.config import get_settings
from brain.db.models import McpToken
from brain.db.session import tenant_session
from brain.security import new_token, sha256

router = APIRouter(prefix="/settings/workbuddy", tags=["workbuddy"])
TOKEN_PREFIX = "wbk_"
MAX_ACTIVE_TOKENS = 5

EXPERT_INSTRUCTIONS = """Kamu adalah "Workplace Brain", asisten pengetahuan kantor.
- Untuk SETIAP pertanyaan tentang perusahaan (kebijakan, dokumen, percakapan, task, proyek), panggil tool `ask_workplace_brain` dengan pertanyaan pengguna apa adanya.
- Tampilkan jawaban tool APA ADANYA, termasuk semua sitasi [ID] dan bagian "Sumber". Jangan meringkas, menambah, menerjemahkan, atau menjawab dari pengetahuanmu sendiri.
- Jika tool mengembalikan jawaban "Saya tidak menemukan informasi ..." atau penolakan, tampilkan itu tanpa tambahan.
- Untuk melihat isi sumber yang dikutip, panggil `open_source` dengan ID sitasi. Untuk mengecek identitas, panggil `whoami`.
- Jangan pernah membaca file lokal untuk menjawab pertanyaan tentang perusahaan."""


class TokenIn(BaseModel):
    label: str = Field(default="WorkBuddy", min_length=1, max_length=60)


class TokenOut(BaseModel):
    id: str
    label: str
    created_at: datetime
    last_used_at: datetime | None
    revoked: bool


class TokenCreated(TokenOut):
    token: str  # shown once
    mcp_json: str  # ready to paste into ~/.workbuddy/mcp.json


def mcp_json(token: str) -> str:
    return json.dumps(
        {
            "mcpServers": {
                "workplace-brain": {
                    "type": "streamableHttp",
                    "url": get_settings().mcp_public_url,
                    "headers": {"Authorization": f"Bearer {token}"},
                    "timeout": 60000,
                }
            }
        },
        indent=2,
    )


def _out(t: McpToken) -> TokenOut:
    return TokenOut(id=str(t.id), label=t.label, created_at=t.created_at, last_used_at=t.last_used_at,
                    revoked=t.revoked_at is not None)  # fmt: skip


@router.get("/tokens")
async def list_tokens(ctx: Member) -> list[TokenOut]:
    async with tenant_session(ctx.tenant_id) as s:
        rows = await s.scalars(
            select(McpToken)
            .where(McpToken.user_id == ctx.user_id)
            .order_by(McpToken.created_at.desc())
        )
        return [_out(t) for t in rows]


@router.post("/tokens", status_code=status.HTTP_201_CREATED)
async def create_token(body: TokenIn, ctx: Member) -> TokenCreated:
    raw = TOKEN_PREFIX + new_token()
    async with tenant_session(ctx.tenant_id) as s:
        active = await s.scalar(
            select(func.count())
            .select_from(McpToken)
            .where(McpToken.user_id == ctx.user_id, McpToken.revoked_at.is_(None))
        )
        if active >= MAX_ACTIVE_TOKENS:
            raise HTTPException(status.HTTP_409_CONFLICT, "too_many_tokens")
        t = McpToken(
            tenant_id=ctx.tenant_id, user_id=ctx.user_id, token_hash=sha256(raw), label=body.label
        )
        s.add(t)
        await s.flush()
        await audit.membership_event(
            s, ctx.tenant_id, ctx.user_id, "mcp_token.create", token_id=t.id, label=body.label
        )
    return TokenCreated(**_out(t).model_dump(), token=raw, mcp_json=mcp_json(raw))


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: uuid.UUID, ctx: Member) -> None:
    async with tenant_session(ctx.tenant_id) as s:
        res = await s.execute(
            update(McpToken)
            .where(
                McpToken.id == token_id,
                McpToken.user_id == ctx.user_id,
                McpToken.revoked_at.is_(None),
            )
            .values(revoked_at=func.now())
        )
        if res.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "token_not_found")
        await audit.membership_event(
            s, ctx.tenant_id, ctx.user_id, "mcp_token.revoke", token_id=token_id
        )


@router.get("/instructions")
async def instructions(ctx: Member) -> dict:
    """Expert instructions to paste into the WorkBuddy custom expert (13.4)."""
    return {"instructions": EXPERT_INSTRUCTIONS, "server_url": get_settings().mcp_public_url}
