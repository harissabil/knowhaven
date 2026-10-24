"""Slack: one app of ours, installed per tenant with "Add to Slack" (design doc 15.1).

- Install: a signed, short-lived, single-use `state` binds the OAuth round trip to the admin's
  session and active tenant. The tenant always comes from that state, never from Slack.
- Events: one URL for every workspace. The request is verified with the app's signing secret
  (HMAC-SHA256 over v0:<timestamp>:<body>, max 5 minutes old) and the workspace (`team_id`) is
  mapped to its tenant; unknown workspaces are dropped (T31).
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from brain.config import get_settings
from brain.ingestion.connectors.slack import message_to_item, ts_to_dt
from brain.ingestion.types import IngestItem

API = "https://slack.com/api"
BOT_SCOPES = [
    "channels:history",
    "groups:history",
    "channels:read",
    "groups:read",
    "channels:join",  # join public channels by itself; private ones still need /invite @havi
    "users:read",
    "users:read.email",
]
STATE_TTL_S = 600
MAX_EVENT_AGE_S = 300
_used_nonces: dict[str, float] = {}  # single-use state (one API process; good enough for OAuth)
default_transport = None  # tests swap in an httpx.MockTransport


class SlackError(Exception):
    pass


def redirect_uri() -> str:
    return f"{get_settings().web_origin.rstrip('/')}/api/integrations/slack/oauth/callback"


def events_url() -> str:
    return f"{get_settings().web_origin.rstrip('/')}/api/integrations/slack/events"


def configured() -> bool:
    st = get_settings()
    return bool(st.slack_client_id and st.slack_client_secret and st.slack_signing_secret)


# --- OAuth state ------------------------------------------------------------------------------


def _sign(payload: bytes) -> str:
    key = get_settings().session_secret.encode()
    return (
        base64.urlsafe_b64encode(hmac.new(key, payload, hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )


def make_state(tenant_id: uuid.UUID, user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    body = json.dumps({"t": str(tenant_id), "u": str(user_id), "s": str(session_id),
                       "exp": int(time.time()) + STATE_TTL_S, "n": secrets.token_urlsafe(12)}, separators=(",", ":"))  # fmt: skip
    raw = base64.urlsafe_b64encode(body.encode()).decode().rstrip("=")
    return f"{raw}.{_sign(raw.encode())}"


def read_state(state: str, session_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """(tenant_id, user_id) if the state is ours, fresh, unused and from this same session."""
    try:
        raw, sig = state.split(".", 1)
    except ValueError:
        raise SlackError("bad_state") from None
    if not hmac.compare_digest(sig, _sign(raw.encode())):
        raise SlackError("bad_state")
    data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    now = time.time()
    if data["exp"] < now:
        raise SlackError("state_expired")
    if data["s"] != str(session_id):
        raise SlackError("state_other_session")
    for n, exp in list(_used_nonces.items()):
        if exp < now:
            _used_nonces.pop(n, None)
    if data["n"] in _used_nonces:
        raise SlackError("state_reused")
    _used_nonces[data["n"]] = data["exp"]
    return uuid.UUID(data["t"]), uuid.UUID(data["u"])


def authorize_url(state: str) -> str:
    q = urlencode({"client_id": get_settings().slack_client_id, "scope": ",".join(BOT_SCOPES),
                   "redirect_uri": redirect_uri(), "state": state})  # fmt: skip
    return f"https://slack.com/oauth/v2/authorize?{q}"


# --- Web API -----------------------------------------------------------------------------------


async def _call(method: str, token: str | None = None, transport=None, **params) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(timeout=20.0, transport=transport or default_transport) as h:
        r = await h.post(f"{API}/{method}", data=params, headers=headers)
    data = r.json()
    if not data.get("ok"):
        raise SlackError(data.get("error", f"http_{r.status_code}"))
    return data


async def exchange_code(code: str, transport=None) -> dict:
    st = get_settings()
    return await _call("oauth.v2.access", transport=transport, code=code, client_id=st.slack_client_id,
                       client_secret=st.slack_client_secret, redirect_uri=redirect_uri())  # fmt: skip


async def _paged(method: str, key: str, token: str, transport=None, **params) -> list[dict]:
    out, cursor = [], None
    for _ in range(100):
        data = await _call(
            method, token, transport, limit=200, **params, **({"cursor": cursor} if cursor else {})
        )
        out += data.get(key, [])
        cursor = (data.get("response_metadata") or {}).get("next_cursor")
        if not cursor:
            break
    return out


async def channels(token: str, transport=None) -> list[dict]:
    return await _paged("conversations.list", "channels", token, transport,
                        types="public_channel,private_channel", exclude_archived="true")  # fmt: skip


async def join_public(token: str, chans: list[dict], transport=None) -> tuple[int, str | None]:
    """Join every public channel the bot isn't in yet, so its messages start arriving as events.
    Safe: a joined channel is still a hidden container until an admin maps it (default-deny).
    Returns (joined, error) where error is e.g. missing_scope for installs made before the
    channels:join scope existed (reinstall via "Add to Slack" fixes it)."""
    joined = 0
    for c in chans:
        if c.get("is_private") or c.get("is_member") or c.get("is_archived"):
            continue
        try:
            await _call("conversations.join", token, transport, channel=c["id"])
        except SlackError as e:
            return joined, str(e)
        c["is_member"] = True
        joined += 1
    return joined, None


async def users(token: str, transport=None) -> list[dict]:
    return [
        u
        for u in await _paged("users.list", "members", token, transport)
        if not u.get("deleted") and not u.get("is_bot")
    ]


# --- Events ---------------------------------------------------------------------------------------


def verify(
    body: bytes, timestamp: str | None, signature: str | None, now: float | None = None
) -> bool:
    if not timestamp or not signature:
        return False
    try:
        if abs((now or time.time()) - int(timestamp)) > MAX_EVENT_AGE_S:
            return False  # replay protection
    except ValueError:
        return False
    base = b"v0:" + timestamp.encode() + b":" + body
    mine = (
        "v0="
        + hmac.new(get_settings().slack_signing_secret.encode(), base, hashlib.sha256).hexdigest()
    )
    return hmac.compare_digest(mine, signature)


@dataclass
class Change:
    item: IngestItem | None  # new/edited message, or a tombstone
    channel_id: str


def event_to_change(event: dict, channel_name: str, user_names: dict[str, str]) -> Change | None:
    """message → new item · message_changed → new version · message_deleted → soft delete."""
    if event.get("type") != "message":
        return None
    ch = event.get("channel", "")
    sub = event.get("subtype")
    if sub == "message_deleted":
        ts = event.get("deleted_ts") or (event.get("previous_message") or {}).get("ts")
        if not ts:
            return None
        when = ts_to_dt(ts)
        return Change(IngestItem(source="slack", container_external_id=ch, container_name=channel_name,
                                 external_ref=f"{ch}:{ts}", type="chat", text="", created_at=when, updated_at=when,
                                 deleted=True), ch)  # fmt: skip
    if sub == "message_changed":
        msg = dict(event.get("message") or {})
        msg.setdefault("type", "message")
        if msg.get("subtype") == "tombstone":
            return None
        item = message_to_item(msg, ch, channel_name, user_names)
        return Change(item, ch) if item else None
    if sub in ("bot_message",) or event.get("bot_id"):
        return None  # our knowledge is what people say, not bots
    item = message_to_item(event, ch, channel_name, user_names)
    return Change(item, ch) if item else None
