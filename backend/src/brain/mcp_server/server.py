"""MCP server for WorkBuddy (design doc 13): a separate process, read + ask tools only.

    uv run brain-mcp [--host 0.0.0.0] [--port 8001]     → http://<host>:<port>/mcp

Identity: every HTTP request must carry `Authorization: Bearer wbk_...` (a personal token from
Settings → Hubungkan WorkBuddy). The outer middleware rejects unknown/revoked tokens with 401 and
rate-limits per token; each tool resolves the token again from *its own* request and re-reads the
user's roles from the database, so a role change in the web app applies to the next call (T23)
and a removed member's token stops working immediately (T33). Stateless HTTP: no MCP session
carries identity between requests.

No write tools, no admin tools, no low-level search: WorkBuddy's own model must not compose
answers from raw search results, or our conflict rules, IDK template and citation checks would
be bypassed (13.2).
"""

import argparse
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from urllib.parse import urlsplit

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy import func, select, text, update
from starlette.requests import Request
from starlette.responses import JSONResponse

from brain.agent.pipeline import Pipeline
from brain.api.chat import ask
from brain.api.mcp_tokens import EXPERT_INSTRUCTIONS
from brain.config import get_settings
from brain.db.models import McpToken, Tenant, User
from brain.db.session import global_session, tenant_session
from brain.rbac.context import RequestContext, load_context
from brain.retrieval.tools import NOT_FOUND, Retriever
from brain.security import sha256

# Tests swap this for a stub pipeline.
PIPELINE_FACTORY = Pipeline

UNAUTHORIZED = {
    "error": "invalid_token",
    "message": "Token tidak valid atau sudah dicabut. / Invalid or revoked token.",
}


@dataclass(frozen=True)
class TokenIdentity:
    token_id: uuid.UUID
    tenant_id: uuid.UUID
    user_id: uuid.UUID


def _bearer(value: str | None) -> str | None:
    if not value:
        return None
    scheme, _, token = value.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


async def resolve(raw: str | None) -> TokenIdentity | None:
    """Token → (tenant, user) via the SECURITY DEFINER lookup; requires an active membership."""
    if not raw:
        return None
    async with global_session() as s:
        row = (
            await s.execute(text("SELECT * FROM resolve_mcp_token(:h)"), {"h": sha256(raw)})
        ).one_or_none()
    return TokenIdentity(row.token_id, row.tenant_id, row.user_id) if row else None


class _RateLimiter:
    def __init__(self):
        self._hits: dict[uuid.UUID, deque] = defaultdict(deque)

    def allow(self, key: uuid.UUID, per_min: int) -> bool:
        now, q = time.monotonic(), self._hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= per_min:
            return False
        q.append(now)
        return True


class BearerAuth:
    """ASGI middleware: no valid personal token, no MCP at all."""

    def __init__(self, app):
        self.app, self.limiter = app, _RateLimiter()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") == "/healthz":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        ident = await resolve(_bearer(headers.get("authorization")))
        if ident is None:
            return await JSONResponse(
                UNAUTHORIZED, status_code=401, headers={"WWW-Authenticate": "Bearer"}
            )(scope, receive, send)
        if not self.limiter.allow(ident.token_id, get_settings().mcp_rate_limit_per_min):
            return await JSONResponse({"error": "rate_limited"}, status_code=429)(
                scope, receive, send
            )
        async with tenant_session(ident.tenant_id) as s:
            await s.execute(
                update(McpToken)
                .where(McpToken.id == ident.token_id)
                .values(last_used_at=func.now())
            )
        return await self.app(scope, receive, send)


async def _context(ctx: Context) -> RequestContext:
    """Identity for THIS tool call, from this request's header, re-read from the DB."""
    ident = await resolve(_bearer((ctx.headers or {}).get("authorization")))
    if ident is None:
        raise PermissionError(UNAUTHORIZED["message"])
    async with tenant_session(ident.tenant_id) as s:
        rc = await load_context(s, ident.tenant_id, ident.user_id)
    if rc is None or not rc.is_active:
        raise PermissionError(UNAUTHORIZED["message"])
    return rc


def _format_answer(final: dict) -> str:
    lines = [final.get("answer", "")]
    cites = final.get("citations") or []
    if cites:
        lines += ["", "Sumber:"]
        lines += [
            f"- [{c['id']}] {c['title']} ({c['container']}, {c['date']})"
            + (f" {c['url']}" if c.get("url") else "")
            for c in cites
        ]
    if final.get("access_offer"):
        lines += [
            "",
            f'Ajukan akses ke "{final["access_offer"]["display_name"]}" lewat web app (halaman chat).',
        ]
    meta = [f"query_id={final.get('query_id')}", f"conversation_id={final.get('conversation_id')}"]
    if final.get("data_as_of"):
        meta.insert(0, f"data per {final['data_as_of'][:16].replace('T', ' ')}")
    lines += ["", "(" + "; ".join(meta) + ")"]
    return "\n".join(lines)


def build_server() -> MCPServer:
    mcp = MCPServer(
        name="workplace-brain", title="Workplace Brain", instructions=EXPERT_INSTRUCTIONS
    )

    @mcp.tool(
        description="Ask the company knowledge assistant (Indonesian or English). Runs the full permission-aware "
        "pipeline and returns the final answer with citations. Show the result to the user exactly as returned."
    )
    async def ask_workplace_brain(
        question: str, ctx: Context, conversation_id: str | None = None
    ) -> str:
        rc = await _context(ctx)
        conv = None
        if conversation_id:
            try:
                conv = uuid.UUID(conversation_id)
            except ValueError:
                conv = None
        final = await ask(rc, question, conv, "mcp", PIPELINE_FACTORY())
        return _format_answer(final)

    @mcp.tool(
        description="Open a cited source by its id (e.g. DOC-sop-distribusi#4.2). Permission is checked again."
    )
    async def open_source(item_id: str, ctx: Context) -> str:
        rc = await _context(ctx)
        res = await Retriever(rc).get_item(item_id)
        if not res.hits:
            return NOT_FOUND  # identical for forbidden and non-existent IDs (T24)
        h = res.hits[0]
        head = f"[{h.item_id}] {h.title or h.container} ({h.container}, {h.updated_at.date().isoformat()})"
        body = "\n\n".join(f"[{x.citation_id}]\n{x.text}" for x in res.hits)
        return f"{head}\n\n{body}"

    @mcp.tool(
        description="Show who you are connected as: name, company and roles (read fresh from the database)."
    )
    async def whoami(ctx: Context) -> str:
        rc = await _context(ctx)
        async with global_session() as s:
            user = await s.scalar(select(User).where(User.id == rc.user_id))
        async with tenant_session(rc.tenant_id) as s:
            tenant = await s.scalar(select(Tenant))
        return (
            f"Nama: {user.name} ({user.email})\nPerusahaan: {tenant.name}\n"
            f"Peran: {', '.join(sorted(rc.role_keys)) or '-'}\nVersi izin: {rc.permission_version}"
        )

    @mcp.custom_route("/healthz", methods=["GET"])
    async def healthz(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    return mcp


def transport_security() -> TransportSecuritySettings:
    """DNS-rebinding protection stays on, but the public host from MCP_PUBLIC_URL must be allowed:
    behind the reverse proxy requests arrive with that Host header, and the SDK default (localhost
    only) answers them with 421 Misdirected Request."""
    hosts = ["127.0.0.1:*", "localhost:*", "[::1]:*"]
    origins = ["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]
    public = urlsplit(get_settings().mcp_public_url)
    if public.hostname:
        name = f"[{public.hostname}]" if ":" in public.hostname else public.hostname
        hosts += [name, f"{name}:*"]
        origins += [f"{public.scheme}://{name}", f"{public.scheme}://{name}:*"]
    return TransportSecuritySettings(allowed_hosts=hosts, allowed_origins=origins)


def create_app():
    return BearerAuth(
        build_server().streamable_http_app(
            streamable_http_path="/mcp",
            stateless_http=True,
            transport_security=transport_security(),
        )
    )


def main() -> None:
    import uvicorn

    p = argparse.ArgumentParser(description="Workplace Brain MCP server (WorkBuddy)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8001)
    args = p.parse_args()
    uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
