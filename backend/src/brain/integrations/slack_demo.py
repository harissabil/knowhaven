"""Demo helper: create the demo channels in a connected Slack workspace and post a display copy of
their imported history, so the channels don't look empty during a demo.

    brain-slack-demo --admin admin@srn-demo.id --tenant srn [--channels pengumuman-hr,general]

The copies are posted by the bot under each persona's name with the original date in front
("[2 Sep 2026] ..."). Havi ignores bot messages, so they are never indexed twice: answers keep using
the imported history with its real authors and dates. New messages written by people (e.g. a fresh
HR announcement) arrive through the Events API as usual.

Needs the bot scopes channels:manage (create), chat:write and chat:write.customize (persona names).
Running it again skips channels already posted (recorded in the integration's metadata).
With --since, only messages from that time on are posted (for history added to the seed later,
after `brain-seed --append ... --chat-since` imported them), whether or not the channel was posted.
"""

import argparse
import asyncio
import json
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

from brain.db.session import global_session, tenant_session
from brain.integrations import slack, store

MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def stamp(iso: str) -> str:
    d = datetime.fromisoformat(iso)
    return f"[{d.day} {MONTHS[d.month - 1]} {d.year}]"


async def ensure_channel(token: str, name: str, transport=None) -> tuple[str, bool]:
    """(channel id, created). Joins an existing public channel; creates it otherwise."""
    for c in await slack.channels(token, transport):
        if c["name"] == name:
            if not c.get("is_member"):
                await slack._call("conversations.join", token, transport, channel=c["id"])
            return c["id"], False
    created = await slack._call("conversations.create", token, transport, name=name)
    return created["channel"]["id"], True


async def post_history(token: str, channel_id: str, channel: dict, people: dict[str, str],
                       transport=None, pause: float = 1.1) -> int:  # fmt: skip
    """Post the channel's messages in order; replies go into the thread of their parent."""
    posted: list[str | None] = []
    for msg in channel["messages"]:
        parent = posted[msg["reply_to"]] if "reply_to" in msg else None
        res = await slack._call(
            "chat.postMessage", token, transport, channel=channel_id, text=f"_{stamp(msg['at'])}_ {msg['text']}",
            username=people.get(msg["user"], msg["user"]), icon_emoji=":bust_in_silhouette:",
            **({"thread_ts": parent} if parent else {}),
        )  # fmt: skip
        posted.append(res.get("ts"))
        if pause:
            await asyncio.sleep(
                pause
            )  # chat.postMessage allows about one message per second per channel
    return len(posted)


async def run(
    admin_email: str, tenant_slug: str, names: list[str], seed: Path, since: datetime | None = None
) -> None:
    async with global_session() as s:
        row = (await s.execute(text(
            "SELECT m.tenant_id FROM users u, LATERAL list_my_memberships(u.id) m "
            "WHERE lower(u.email) = lower(:e) AND m.tenant_slug = :t AND m.status = 'active'"),
            {"e": admin_email, "t": tenant_slug})).one_or_none()  # fmt: skip
    if row is None:
        raise SystemExit(f"{admin_email} is not an active member of '{tenant_slug}'")
    tenant_id = row.tenant_id
    async with tenant_session(tenant_id) as s:
        integ = await store.get(s, "slack")
        cfg = store.config(integ) if integ else None
    if integ is None:
        raise SystemExit("Slack is not connected for this company: use Add to Slack first")
    token = cfg["bot_token"]
    data = json.loads((seed / tenant_slug / "slack.json").read_text(encoding="utf-8"))
    people = {u["id"]: u["name"] for u in data["users"]}
    done = set((integ.meta or {}).get("demo_posted", []))
    for name in names:
        ch = next((c for c in data["channels"] if c["name"] == name), None)
        cid, created = await ensure_channel(token, name)
        print(f"#{name}: {'created' if created else 'exists'} ({cid})")
        if ch is not None and since is not None:
            recent = [m for m in ch["messages"]
                      if datetime.fromisoformat(m["at"]) >= since and "reply_to" not in m]  # fmt: skip
            n = await post_history(token, cid, {**ch, "messages": recent}, people)
            print(f"   posted {n} messages since {since.isoformat()}")
            continue
        if ch is None or name in done:
            print(f"   history: {'already posted' if name in done else 'none in seed'}")
            continue
        n = await post_history(token, cid, ch, people)
        done.add(name)
        await store.mark(tenant_id, integ.id, meta={"demo_posted": sorted(done)})
        print(f"   posted {n} messages")
    # Pick up the new channels as containers (same names as the imported ones → same access rules).
    from brain.api.integrations import refresh_slack

    print("refresh:", await refresh_slack(tenant_id, token))


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--admin", required=True, help="an active member's email, to find the company")
    p.add_argument("--tenant", default="srn")
    p.add_argument("--channels", default="pengumuman-hr,general")
    p.add_argument("--seed", default="seed", help="folder with <tenant>/slack.json")
    p.add_argument("--since", type=datetime.fromisoformat, default=None,
                   help="post only messages from this time on (ISO, with timezone)")  # fmt: skip
    a = p.parse_args()
    channels = [c.strip() for c in a.channels.split(",") if c.strip()]
    asyncio.run(run(a.admin, a.tenant, channels, Path(a.seed), a.since))
