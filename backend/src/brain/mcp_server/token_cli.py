"""Dev helper: mint a personal MCP token for an existing member and print the mcp.json snippet.

    uv run brain-mcp-token dimas@srn-demo.id [--tenant srn] [--label "WorkBuddy laptop"]

Same effect as Settings → Hubungkan WorkBuddy in the web app (hashed token, audited). Only works
for an *active* member of that tenant.
"""

import argparse
import asyncio

from sqlalchemy import text

from brain.api.mcp_tokens import TOKEN_PREFIX, mcp_json
from brain.audit import log as audit
from brain.db.models import McpToken
from brain.db.session import global_session, tenant_session
from brain.security import new_token, sha256


async def mint(email: str, tenant_slug: str, label: str) -> str:
    async with global_session() as s:
        row = (
            await s.execute(
                text(
                    "SELECT m.tenant_id, u.id AS user_id, m.status FROM users u, "
                    "LATERAL list_my_memberships(u.id) m WHERE lower(u.email) = lower(:e) AND m.tenant_slug = :t"
                ),
                {"e": email, "t": tenant_slug},
            )
        ).one_or_none()
    if row is None or row.status != "active":
        raise SystemExit(f"{email} is not an active member of tenant '{tenant_slug}'")
    raw = TOKEN_PREFIX + new_token()
    async with tenant_session(row.tenant_id) as s:
        t = McpToken(
            tenant_id=row.tenant_id, user_id=row.user_id, token_hash=sha256(raw), label=label
        )
        s.add(t)
        await s.flush()
        await audit.membership_event(
            s, row.tenant_id, row.user_id, "mcp_token.create", token_id=t.id, label=label, via="cli"
        )
    return raw


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("email")
    p.add_argument("--tenant", default="srn")
    p.add_argument("--label", default="WorkBuddy (dev)")
    args = p.parse_args()
    raw = asyncio.run(mint(args.email, args.tenant, args.label))
    print(mcp_json(raw))
