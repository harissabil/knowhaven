"""Slack messages → IngestItems: workspace export files (history, design doc 15.1) and single
Events API payloads (live, Phase 11) share `message_to_item`.

Export layout: users.json, channels.json (+ groups.json for private),
<channel-name>/<YYYY-MM-DD>.json
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path

from brain.ingestion.types import IngestItem

# Message subtypes that are not content.
_SKIP_SUBTYPES = {
    "channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name",
    "group_join", "group_leave", "bot_add", "bot_remove", "pinned_item", "unpinned_item",
}  # fmt: skip
_MENTION = re.compile(r"<@([A-Z0-9]+)(?:\|[^>]+)?>")
_CHANNEL = re.compile(r"<#[A-Z0-9]+\|([^>]+)>")
_LINK = re.compile(r"<(https?://[^|>]+)(?:\|([^>]+))?>")


def ts_to_dt(ts: str) -> datetime:
    return datetime.fromtimestamp(float(ts), tz=UTC)


def clean_text(text: str, user_names: dict[str, str]) -> str:
    text = _MENTION.sub(lambda m: "@" + user_names.get(m.group(1), m.group(1)), text)
    text = _CHANNEL.sub(lambda m: "#" + m.group(1), text)
    text = _LINK.sub(lambda m: m.group(2) or m.group(1), text)
    return text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")


def message_to_item(
    msg: dict, channel_id: str, channel_name: str, user_names: dict[str, str]
) -> IngestItem | None:
    if msg.get("type") != "message" or msg.get("subtype") in _SKIP_SUBTYPES:
        return None
    text = clean_text(msg.get("text", ""), user_names).strip()
    if not text:
        return None
    ts = msg["ts"]
    edited = msg.get("edited", {}).get("ts")
    user = msg.get("user")
    return IngestItem(
        source="slack",
        container_external_id=channel_id,
        container_name=channel_name,
        external_ref=f"{channel_id}:{ts}",
        type="chat",
        text=text,
        created_at=ts_to_dt(ts),
        updated_at=ts_to_dt(edited or ts),
        # Edits become new versions; the version is the edit time in whole seconds.
        version=int(float(edited)) if edited else 1,
        author_external_id=user,
        author_display=user_names.get(user or "", msg.get("username") or user),
        thread_key=f"{channel_id}:{msg.get('thread_ts') or ts}",
    )


def load_export(root: Path) -> tuple[list[IngestItem], dict[str, dict]]:
    """Returns (items, users_by_id). Users carry email for member mapping (users:read.email)."""
    users = {u["id"]: u for u in json.loads((root / "users.json").read_text(encoding="utf-8"))}
    names = {
        uid: u.get("profile", {}).get("display_name") or u.get("real_name") or u.get("name", uid)
        for uid, u in users.items()
    }
    channels = []
    for f in ("channels.json", "groups.json"):
        if (root / f).exists():
            channels += json.loads((root / f).read_text(encoding="utf-8"))
    items: list[IngestItem] = []
    for ch in channels:
        folder = root / ch["name"]
        if not folder.is_dir():
            continue
        for day in sorted(folder.glob("*.json")):
            for msg in json.loads(day.read_text(encoding="utf-8")):
                item = message_to_item(msg, ch["id"], ch["name"], names)
                if item:
                    items.append(item)
    items.sort(key=lambda i: i.created_at)
    return items, users
