"""Server-side sessions. The cookie holds a random token; the DB stores only its sha256."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import Response
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from brain.config import get_settings
from brain.db.models import Session, User
from brain.security import new_token, sha256

COOKIE_NAME = "wb_session"
SESSION_TTL = timedelta(days=7)
# Refresh last_seen/expiry at most this often to avoid a write per request.
_TOUCH_EVERY = timedelta(minutes=10)


@dataclass(frozen=True)
class AuthSession:
    session_id: str
    user_id: UUID
    email: str
    name: str
    active_tenant_id: UUID | None
    csrf_token: str


async def create_session(s: AsyncSession, user_id: UUID, active_tenant_id: UUID | None) -> str:
    token = new_token()
    s.add(
        Session(
            id=sha256(token),
            user_id=user_id,
            active_tenant_id=active_tenant_id,
            csrf_token=new_token(),
            expires_at=datetime.now(UTC) + SESSION_TTL,
        )
    )
    await s.flush()
    return token


async def get_session(s: AsyncSession, token: str) -> AuthSession | None:
    row = (
        await s.execute(
            select(Session, User.email, User.name)
            .join(User, User.id == Session.user_id)
            .where(Session.id == sha256(token), Session.expires_at > datetime.now(UTC))
        )
    ).one_or_none()
    if row is None:
        return None
    sess, email, name = row
    now = datetime.now(UTC)
    if now - sess.last_seen_at > _TOUCH_EVERY:
        await s.execute(
            update(Session)
            .where(Session.id == sess.id)
            .values(last_seen_at=now, expires_at=now + SESSION_TTL)
        )
    return AuthSession(sess.id, sess.user_id, email, name, sess.active_tenant_id, sess.csrf_token)


async def set_active_tenant(s: AsyncSession, session_id: str, tenant_id: UUID | None) -> None:
    await s.execute(
        update(Session).where(Session.id == session_id).values(active_tenant_id=tenant_id)
    )


async def delete_session(s: AsyncSession, session_id: str) -> None:
    await s.execute(delete(Session).where(Session.id == session_id))


def set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=get_settings().app_env != "local",
        samesite="lax",
        path="/",
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
