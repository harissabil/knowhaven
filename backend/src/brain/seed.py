"""Demo data loader (design doc 17.4 "make seed", 21): resets and reloads the demo tenants.

    uv run brain-seed                       # srn + klm on the linked Neon branch
    uv run brain-seed --tenants srn --no-llm-extract
    uv run brain-seed --allow-production    # required when NEON_BRANCH=production

Everything goes through the real code paths: tenancy service, RBAC tables, and the ingestion
pipeline (Slack/Jira content is authored in compact JSON and expanded to the connectors' native
shapes first). Re-running is idempotent: the tenants are deleted and rebuilt from the files.
"""

import argparse
import asyncio
import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import func, select, text

from brain import storage
from brain.audit import log as audit
from brain.config import get_settings
from brain.db.engine import create_engine
from brain.db.models import (
    Container,
    ContainerAcl,
    Manager,
    MemberProfile,
    Membership,
    Role,
    Tenant,
    TopicOwner,
    User,
    UserRole,
)
from brain.db.session import global_session, tenant_session
from brain.ingestion.connectors import jira, slack, whatsapp
from brain.ingestion.connectors.documents import parse_markdown
from brain.ingestion.extract import DictionaryExtractor, LlmExtractor
from brain.ingestion.pipeline import Ingestor
from brain.ingestion.types import IngestItem
from brain.rbac.state import bump_permission_version
from brain.security import hash_password
from brain.tenancy import service

SEED_ROOT = Path(__file__).resolve().parents[2] / "seed"
SOURCE_OF = {"slack_channel": "slack", "whatsapp_group": "whatsapp", "confluence_space": "confluence",
             "upload_folder": "upload", "jira_project": "jira"}  # fmt: skip


def _load(slug: str) -> tuple[Path, dict]:
    root = SEED_ROOT / slug
    return root, json.loads((root / "manifest.json").read_text(encoding="utf-8"))


async def reset(slugs: list[str]) -> None:
    """Owner role (bypasses RLS): drop the demo tenants, their users, and stored files."""
    emails = {u["email"] for slug in slugs for u in _load(slug)[1]["users"]}
    engine = create_engine(get_settings().database_url_unpooled)
    async with engine.begin() as conn:
        ids = (
            (await conn.execute(text("SELECT id FROM tenants WHERE slug = ANY(:s)"), {"s": slugs}))
            .scalars()
            .all()
        )
        await conn.execute(text("DELETE FROM tenants WHERE id = ANY(:ids)"), {"ids": ids})
        # Users are global: only delete those no longer in any other tenant.
        await conn.execute(
            text(
                "DELETE FROM users u WHERE email = ANY(:e) AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)"
            ),
            {"e": sorted(emails)},
        )
    await engine.dispose()
    for tid in ids:
        await storage.delete_prefix(f"tenants/{tid}/")


async def _ensure_users(manifest: dict) -> dict[str, uuid.UUID]:
    out = {}
    async with global_session() as s:
        for u in manifest["users"]:
            user = await s.scalar(select(User).where(func.lower(User.email) == u["email"].lower()))
            if user is None:
                user = User(
                    email=u["email"].lower(),
                    name=u["name"],
                    password_hash=hash_password(u["password"]),
                )
                s.add(user)
                await s.flush()
            out[u["email"]] = user.id
    return out


async def _build_tenant(manifest: dict, users: dict[str, uuid.UUID]) -> tuple[uuid.UUID, dict]:
    t = manifest["tenant"]
    tenant_id = uuid.uuid4()
    owner = users[t["owner"]]
    async with tenant_session(tenant_id) as s:
        await service.create_tenant(s, tenant_id, t["name"], owner, slug=t["slug"])
        tenant = await s.scalar(select(Tenant))
        tenant.default_contact = manifest.get("default_contact")
        tenant.email_domains = manifest.get("email_domains", [])
        s.add_all(
            Role(tenant_id=tenant_id, key=r["key"], name=r["name"]) for r in manifest["extra_roles"]
        )
        await s.flush()
        roles = {r.key: r for r in await s.scalars(select(Role))}
        business = [r.id for r in roles.values() if not r.is_system]

        for u in manifest["users"]:
            uid = users[u["email"]]
            if uid != owner:
                s.add(Membership(tenant_id=tenant_id, user_id=uid, status="active"))
                await s.flush()
                s.add(MemberProfile(tenant_id=tenant_id, user_id=uid))
                await s.flush()
            profile = await s.scalar(select(MemberProfile).where(MemberProfile.user_id == uid))
            profile.department, profile.title = u.get("department"), u.get("title")
            profile.branch_office, profile.slack_user_id = u.get("branch"), u.get("slack")
            profile.display_aliases = u.get("aliases", [])
            have = set(await s.scalars(select(UserRole.role_id).where(UserRole.user_id == uid)))
            s.add_all(
                UserRole(tenant_id=tenant_id, user_id=uid, role_id=roles[k].id, granted_by=owner)
                for k in u["roles"]
                if roles[k].id not in have
            )
        await s.flush()

        containers = {}
        for c in manifest["containers"]:
            row = Container(
                tenant_id=tenant_id, source=c["source"], external_id=c["external_id"], name=c["name"],
                tier=c["tier"], mapped=True, authority_default=c.get("authority"),
                owner_user_id=users.get(c.get("owner", "")),
            )  # fmt: skip
            s.add(row)
            await s.flush()
            role_ids = business if c["roles"] == "ALL" else [roles[k].id for k in c["roles"]]
            s.add_all(
                ContainerAcl(tenant_id=tenant_id, container_id=row.id, role_id=r) for r in role_ids
            )
            containers[c["key"]] = row

        for tp in manifest["topics"]:
            s.add(
                TopicOwner(
                    tenant_id=tenant_id, topic_key=tp["key"], display_name=tp["display_name"],
                    aliases=tp.get("aliases", []), owner_user_id=users.get(tp.get("owner", "")),
                    fallback_contact=tp["fallback_contact"], tier=tp["tier"],
                    container_id=containers[tp["container"]].id if tp.get("container") else None,
                )
            )  # fmt: skip
        for m in manifest["managers"]:
            scope = (
                str(containers[m["scope_id"]].id)
                if m["scope_type"] == "container"
                else m["scope_id"]
            )
            s.add(
                Manager(
                    tenant_id=tenant_id,
                    scope_type=m["scope_type"],
                    scope_id=scope,
                    manager_user_id=users[m["manager"]],
                )
            )
        await s.flush()
        version = await bump_permission_version(s, tenant_id)
        await audit.append(
            s, tenant_id, "admin", actor_user_id=owner, channel="system", permission_version=version,
            details={"action": "seed.load", "users": len(manifest["users"]), "containers": len(containers)},
        )  # fmt: skip
    return tenant_id, containers


def _slack_items(root: Path, manifest: dict) -> list[IngestItem]:
    data = json.loads((root / manifest["slack"]).read_text(encoding="utf-8"))
    names = {u["id"]: u["name"] for u in data["users"]}
    items = []
    for ch in data["channels"]:
        stamps = []
        for msg in ch["messages"]:
            ts = f"{datetime.fromisoformat(msg['at']).timestamp():.6f}"
            stamps.append(ts)
            raw = {"type": "message", "user": msg["user"], "text": msg["text"], "ts": ts}
            if "reply_to" in msg:
                raw["thread_ts"] = stamps[msg["reply_to"]]
            item = slack.message_to_item(raw, ch["id"], ch["name"], names)
            if item:
                items.append(item)
    return items


def _jira_items(root: Path, manifest: dict) -> list[IngestItem]:
    data = json.loads((root / manifest["jira"]).read_text(encoding="utf-8"))
    email = {u["name"]: u["email"] for u in manifest["users"]}

    def person(name):
        return {"displayName": name, "emailAddress": email.get(name)} if name else None

    issues = []
    for i in data["issues"]:
        project = i["key"].split("-")[0]
        issues.append(
            {
                "key": i["key"],
                "fields": {
                    "project": {"key": project, "name": data["projects"][project]},
                    "summary": i["summary"], "description": i.get("description"),
                    "status": {"name": i["status"], "statusCategory": {"key": i["category"]}},
                    "assignee": person(i.get("assignee")), "reporter": person(i.get("reporter")),
                    "priority": {"name": i.get("priority")}, "duedate": i.get("due"),
                    "labels": i.get("labels", []), "components": [{"name": c} for c in i.get("components", [])],
                    "created": i["created"].replace("+0700", ".000+0700"),
                    "updated": i["updated"].replace("+0700", ".000+0700"),
                    "comment": {"comments": [{"author": {"displayName": c["author"]}, "body": c["body"]} for c in i.get("comments", [])]},
                },
            }
        )  # fmt: skip
    return jira.issues_to_items(issues, data.get("site_url"))


async def _doc_items(
    root: Path, manifest: dict, tenant_id: uuid.UUID, containers: dict
) -> list[IngestItem]:
    items = []
    for d in manifest["documents"]:
        c = containers[d["container"]]
        path = root / d["file"]
        raw = path.read_bytes()
        title, sections = parse_markdown(raw.decode("utf-8"))
        when = datetime.fromisoformat(d["updated_at"])
        key = None
        if d["source"] == "upload":  # originals of uploads live in object storage
            key = storage.tenant_key(tenant_id, "uploads", str(c.id), path.name)
            await storage.put_object(key, raw, "text/markdown")
        url = (
            f"https://{manifest['tenant']['slug']}-demo.atlassian.net/wiki/spaces/{c.external_id}/pages/{d['id']}"
            if d["source"] == "confluence"
            else None
        )
        items.append(
            IngestItem(
                source=d["source"], container_external_id=c.external_id, container_name=c.name,
                external_ref=f"{c.external_id}/{d['id']}", type="doc", text="", sections=sections,
                title=title or d["id"], id_hint=d["id"], version=d["version"], created_at=when,
                updated_at=when, url=url, labels=d.get("labels", []), storage_key=key,
            )
        )  # fmt: skip
    return items


async def seed_tenant(slug: str, ingestor: Ingestor) -> dict:
    root, manifest = _load(slug)
    users = await _ensure_users(manifest)
    tenant_id, containers = await _build_tenant(manifest, users)
    items = _slack_items(root, manifest)
    for wa in manifest["whatsapp"]:
        c = containers[wa["container"]]
        items += whatsapp.to_items(
            (root / wa["file"]).read_text(encoding="utf-8"), c.external_id, c.name
        )
    items += _jira_items(root, manifest)
    items += await _doc_items(root, manifest, tenant_id, containers)
    report = await ingestor.ingest(tenant_id, items)
    return {
        "tenant": manifest["tenant"]["name"], "tenant_id": str(tenant_id), "users": len(users),
        "containers": len(containers), "items": report.created, "new_unmapped_containers": report.containers_created,
        "injection_flagged": report.injection_flagged,
    }  # fmt: skip


async def run(slugs: list[str], llm_extract: bool) -> None:
    await reset(slugs)
    ingestor = Ingestor(extractor=LlmExtractor() if llm_extract else DictionaryExtractor())
    for slug in slugs:
        print(json.dumps(await seed_tenant(slug, ingestor), ensure_ascii=False))


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--tenants", nargs="+", default=["srn", "klm"])
    p.add_argument(
        "--no-llm-extract", action="store_true", help="dictionary topic/entity extraction only"
    )
    p.add_argument("--allow-production", action="store_true")
    args = p.parse_args()
    branch = os.environ.get("NEON_BRANCH") or _env_branch()
    if branch == "production" and not args.allow_production:
        raise SystemExit(
            "Linked Neon branch is 'production'. Re-run with --allow-production to reset demo data there."
        )
    asyncio.run(run(args.tenants, not args.no_llm_extract))


def _env_branch() -> str | None:
    env = Path(".env")
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("NEON_BRANCH="):
                return line.split("=", 1)[1].strip()
    return None
