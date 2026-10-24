"""Integration endpoints (design doc 15, backend plan Phase 11).

Admin (cookie session):
  GET    /api/admin/integrations                    status + metadata, never credentials
  GET    /api/integrations/slack/install            302 to Slack ("Add to Slack")
  GET    /api/integrations/slack/oauth/callback     Slack sends the admin back here
  POST   /api/admin/integrations/slack/refresh      re-list channels and members
  POST   /api/admin/integrations/atlassian          connect Confluence + Jira (site, email, token)
  POST   /api/admin/integrations/atlassian/sync     pull now instead of waiting for the worker
  DELETE /api/admin/integrations/{kind}             disconnect slack | atlassian

Slack (no session, signed):
  POST   /api/integrations/slack/events             Events API for every workspace
"""

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from brain.api.deps import Admin, Auth
from brain.api.uploads import get_ingestor
from brain.audit import log as audit
from brain.db.models import Container, Integration, MemberProfile, Membership, User
from brain.db.session import tenant_session
from brain.ingestion.pipeline import Ingestor
from brain.integrations import atlassian, slack, store, sync
from brain.rbac.context import load_context
from brain.security import encrypt

router = APIRouter(tags=["integrations"])
log = logging.getLogger(__name__)


class IntegrationOut(BaseModel):
    type: str  # slack | confluence | jira
    status: str  # active | error | disconnected
    workspace: str  # Slack team name or Atlassian site
    meta: dict
    last_sync_at: datetime | None
    last_error: str | None
    connected_at: datetime


class IntegrationsOut(BaseModel):
    slack_available: bool  # the app's client id/secret/signing secret are configured
    slack_redirect_url: str
    slack_events_url: str
    integrations: list[IntegrationOut]


@router.get("/admin/integrations")
async def list_integrations(ctx: Admin) -> IntegrationsOut:
    async with tenant_session(ctx.tenant_id) as s:
        rows = (await s.scalars(select(Integration).order_by(Integration.type))).all()
    return IntegrationsOut(
        slack_available=slack.configured(), slack_redirect_url=slack.redirect_uri(), slack_events_url=slack.events_url(),
        integrations=[IntegrationOut(type=r.type, status=r.status, workspace=(r.meta or {}).get("workspace") or r.external_workspace_id,
                                     meta=r.meta or {}, last_sync_at=r.last_sync_at, last_error=r.last_error,
                                     connected_at=r.created_at) for r in rows],
    )  # fmt: skip


# --- Slack install ------------------------------------------------------------------------------


@router.get("/integrations/slack/install")
async def slack_install(ctx: Admin, auth: Auth) -> RedirectResponse:
    if not slack.configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "slack_app_not_configured")
    return RedirectResponse(
        slack.authorize_url(slack.make_state(ctx.tenant_id, ctx.user_id, auth.session_id)),
        status.HTTP_302_FOUND,
    )


def _back(**q) -> RedirectResponse:
    from urllib.parse import urlencode

    return RedirectResponse(f"/admin/integrations?{urlencode(q)}", status.HTTP_302_FOUND)


async def map_slack_members(tenant_id: uuid.UUID, people: list[dict]) -> int:
    """Slack user ↔ member by email (users:read.email). Unmapped senders stay `personal`."""
    by_email = {
        (u.get("profile") or {}).get("email", "").lower(): u["id"]
        for u in people
        if (u.get("profile") or {}).get("email")
    }
    mapped = 0
    async with tenant_session(tenant_id) as s:
        members = (await s.execute(
            select(Membership.user_id, User.email).join(User, User.id == Membership.user_id).where(Membership.status == "active")
        )).all()  # fmt: skip
        for user_id, email in members:
            sid = by_email.get((email or "").lower())
            if not sid:
                continue
            prof = await s.scalar(select(MemberProfile).where(MemberProfile.user_id == user_id))
            if prof is None:
                s.add(MemberProfile(tenant_id=tenant_id, user_id=user_id, slack_user_id=sid))
            elif prof.slack_user_id != sid:
                prof.slack_user_id = sid
            mapped += 1
    return mapped


async def refresh_slack(tenant_id: uuid.UUID, token: str) -> dict:
    chans = await slack.channels(token)
    counts = await sync.ensure_containers(
        tenant_id, "slack_channel", [(c["id"], c["name"]) for c in chans], adopt_by_name=True
    )
    mapped = await map_slack_members(tenant_id, await slack.users(token))
    member_of = sum(1 for c in chans if c.get("is_member"))
    return {
        "channels": len(chans),
        "bot_in_channels": member_of,
        "members_mapped": mapped,
        **{f"channels_{k}": v for k, v in counts.items()},
    }


@router.get("/integrations/slack/oauth/callback")
async def slack_callback(
    auth: Auth, code: str | None = None, state: str | None = None, error: str | None = None
) -> RedirectResponse:
    if error or not code or not state:
        return _back(slack_error=error or "missing_code")
    try:
        tenant_id, user_id = slack.read_state(state, auth.session_id)
    except slack.SlackError as e:
        return _back(slack_error=str(e))
    if user_id != auth.user_id:
        return _back(slack_error="state_other_user")
    async with tenant_session(tenant_id) as s:
        ctx = await load_context(s, tenant_id, auth.user_id)
    if ctx is None or not ctx.is_admin:
        return _back(slack_error="not_admin")
    try:
        data = await slack.exchange_code(code)
    except slack.SlackError as e:
        return _back(slack_error=f"oauth_{e}")
    team = data.get("team") or {}
    cfg = {
        "bot_token": data["access_token"],
        "bot_user_id": data.get("bot_user_id"),
        "scope": data.get("scope"),
    }
    try:
        row = await store.upsert(tenant_id, "slack", team["id"], cfg, auth.user_id,
                                 {"workspace": team.get("name") or team["id"], "team_id": team["id"]})  # fmt: skip
    except store.WorkspaceTaken:
        return _back(slack_error="workspace_connected_to_another_company")
    try:
        meta = await refresh_slack(tenant_id, cfg["bot_token"])
        await store.mark(tenant_id, row.id, synced=True, meta=meta)
    except slack.SlackError as e:
        await store.mark(tenant_id, row.id, error=f"setup: {e}")
    async with tenant_session(tenant_id) as s:
        await audit.admin_event(
            s,
            ctx,
            "integration.connect",
            type="slack",
            workspace=team.get("name"),
            team_id=team["id"],
        )
    return _back(slack="connected")


@router.post("/admin/integrations/slack/refresh")
async def slack_refresh(ctx: Admin) -> dict:
    async with tenant_session(ctx.tenant_id) as s:
        row = await store.get(s, "slack")
        cfg = store.config(row) if row else None
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "slack_not_connected")
    try:
        meta = await refresh_slack(ctx.tenant_id, cfg["bot_token"])
    except slack.SlackError as e:
        await store.mark(ctx.tenant_id, row.id, error=str(e))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"slack_{e}") from None
    await store.mark(ctx.tenant_id, row.id, synced=True, meta=meta)
    return meta


# --- Slack events -----------------------------------------------------------------------------------


async def _user_names(tenant_id: uuid.UUID) -> dict[str, str]:
    async with tenant_session(tenant_id) as s:
        rows = (await s.execute(
            select(MemberProfile.slack_user_id, User.name).join(User, User.id == MemberProfile.user_id)
            .where(MemberProfile.slack_user_id.is_not(None))
        )).all()  # fmt: skip
    return {sid: name for sid, name in rows}


async def process_slack_event(
    tenant_id: uuid.UUID, team_id: str, event: dict, ingestor: Ingestor
) -> None:
    try:
        ch = event.get("channel", "")
        async with tenant_session(tenant_id) as s:
            name = await s.scalar(
                select(Container.name).where(
                    Container.source == "slack_channel", Container.external_id == ch
                )
            )
            row = await store.get(s, "slack")
            cfg = store.config(row) if row else {}
        names = await _user_names(tenant_id)
        user = event.get("user") or (event.get("message") or {}).get("user")
        if user and user not in names and cfg.get("bot_token"):
            try:
                info = await slack._call("users.info", cfg["bot_token"], user=user)
                prof = info["user"].get("profile") or {}
                names[user] = (
                    prof.get("display_name")
                    or prof.get("real_name")
                    or info["user"].get("name", user)
                )
            except slack.SlackError:
                pass
        if name is None and cfg.get("bot_token"):
            try:
                name = (await slack._call("conversations.info", cfg["bot_token"], channel=ch))[
                    "channel"
                ]["name"]
            except slack.SlackError:
                name = ch
        change = slack.event_to_change(event, name or ch, names)
        if change is None or change.item is None:
            return
        await ingestor.ingest(tenant_id, [change.item])
        if row is not None:
            await store.mark(
                tenant_id, row.id, meta={"last_event_at": datetime.now(UTC).isoformat()}
            )
    except Exception:  # noqa: BLE001 - Slack already got its 200; keep the worker alive
        log.exception("slack event failed (tenant %s, team %s)", tenant_id, team_id)


@router.post("/integrations/slack/events")
async def slack_events(request: Request, background: BackgroundTasks,
                       ingestor: Annotated[Ingestor, Depends(get_ingestor)]) -> JSONResponse:  # fmt: skip
    body = await request.body()
    if not slack.configured() or not slack.verify(
        body,
        request.headers.get("X-Slack-Request-Timestamp"),
        request.headers.get("X-Slack-Signature"),
    ):
        return JSONResponse({"error": "invalid_signature"}, status.HTTP_401_UNAUTHORIZED)
    payload = json.loads(body or b"{}")
    if payload.get("type") == "url_verification":
        return JSONResponse({"challenge": payload.get("challenge")})
    if payload.get("type") != "event_callback":
        return JSONResponse({"ok": True})
    team_id = payload.get("team_id") or ""
    tenant_id = await store.resolve_tenant("slack", team_id)
    if tenant_id is None:
        log.warning("slack event from unknown workspace %s dropped", team_id)  # T31
        return JSONResponse({"ok": True, "dropped": "unknown_workspace"})
    # Answer within Slack's 3 s; ingestion (embedding) runs after the response.
    background.add_task(
        process_slack_event, tenant_id, team_id, payload.get("event") or {}, ingestor
    )
    return JSONResponse({"ok": True})


# --- Atlassian ----------------------------------------------------------------------------------------


class AtlassianIn(BaseModel):
    site_url: str = Field(min_length=3, max_length=200)
    email: str = Field(min_length=3, max_length=200)
    api_token: str = Field(min_length=10, max_length=500)


REASONS = {
    "bad_url": "Alamat situs harus berbentuk https://<nama>.atlassian.net",
    "bad_credentials": "Email atau API token ditolak Atlassian",
    "no_permission": "Token tidak punya izin membaca Confluence/Jira",
    "unreachable": "Situs Atlassian tidak bisa dihubungi",
    "not_found": "Confluence atau Jira tidak aktif di situs ini",
    "api_error": "Atlassian mengembalikan error",
}


@router.post("/admin/integrations/atlassian")
async def connect_atlassian(body: AtlassianIn, ctx: Admin, background: BackgroundTasks,
                            ingestor: Annotated[Ingestor, Depends(get_ingestor)]) -> dict:  # fmt: skip
    try:
        site = atlassian.normalize_site(body.site_url)
        async with atlassian.AtlassianClient(site, body.email.strip(), body.api_token.strip()) as c:
            who = await c.check()
            spaces, projects = await c.spaces(), await c.projects()
    except atlassian.AtlassianError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            {"reason": e.reason, "message": REASONS.get(e.reason, e.reason)},
        ) from None
    cfg = {"site": site, "email": body.email.strip(), "token": body.api_token.strip()}
    meta = {"workspace": site.removeprefix("https://"), "email": cfg["email"], "account": who.get("account"),
            "token_hint": store.token_hint(cfg["token"])}  # fmt: skip
    try:
        await store.upsert(
            ctx.tenant_id, "confluence", site, cfg, ctx.user_id, meta | {"spaces": len(spaces)}
        )
        await store.upsert(
            ctx.tenant_id, "jira", site, cfg, ctx.user_id, meta | {"projects": len(projects)}
        )
    except store.WorkspaceTaken:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"reason": "site_taken", "message": "Situs ini sudah terhubung ke perusahaan lain"},
        ) from None
    await sync.ensure_containers(
        ctx.tenant_id, "confluence_space", [(sp.key, sp.name) for sp in spaces]
    )
    await sync.ensure_containers(ctx.tenant_id, "jira_project", [(p.key, p.name) for p in projects])
    async with tenant_session(ctx.tenant_id) as s:
        await audit.admin_event(s, ctx, "integration.connect", type="atlassian", site=site)
    background.add_task(sync.sync_atlassian, ctx.tenant_id, ingestor)  # first pull right away
    return {
        "site": site,
        "account": who.get("account"),
        "spaces": [sp.key for sp in spaces],
        "projects": [p.key for p in projects],
    }


@router.post("/admin/integrations/atlassian/sync")
async def sync_atlassian_now(
    ctx: Admin, ingestor: Annotated[Ingestor, Depends(get_ingestor)]
) -> dict:
    report = await sync.sync_atlassian(ctx.tenant_id, ingestor)
    if report.get("skipped"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "atlassian_not_connected")
    return report


@router.delete("/admin/integrations/{kind}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(kind: Literal["slack", "atlassian"], ctx: Admin) -> None:
    """Stops syncing and forgets the credentials. Already-imported content stays (and keeps its
    access rules) until an admin unmaps or removes it."""
    types = ["slack"] if kind == "slack" else ["confluence", "jira"]
    async with tenant_session(ctx.tenant_id) as s:
        res = await s.execute(
            update(Integration).where(Integration.type.in_(types), Integration.status != "disconnected")
            .values(status="disconnected", config_encrypted=encrypt("{}"))
        )  # fmt: skip
        if res.rowcount == 0:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "not_connected")
        await audit.admin_event(s, ctx, "integration.disconnect", type=kind)


# --- Slack member mapping -------------------------------------------------------------------------


class SlackUserOut(BaseModel):
    slack_user_id: str
    name: str
    email: str | None
    member_user_id: str | None  # who this Slack account speaks for (authority of their messages)


@router.get("/admin/integrations/slack/users")
async def slack_users(ctx: Admin) -> list[SlackUserOut]:
    async with tenant_session(ctx.tenant_id) as s:
        row = await store.get(s, "slack")
        cfg = store.config(row) if row else None
        mapped = dict((await s.execute(
            select(MemberProfile.slack_user_id, MemberProfile.user_id).where(MemberProfile.slack_user_id.is_not(None))
        )).all())  # fmt: skip
    if cfg is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "slack_not_connected")
    try:
        people = await slack.users(cfg["bot_token"])
    except slack.SlackError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"slack_{e}") from None
    return [
        SlackUserOut(slack_user_id=u["id"], name=(u.get("profile") or {}).get("real_name") or u.get("real_name") or u.get("name", u["id"]),
                     email=(u.get("profile") or {}).get("email"), member_user_id=str(mapped[u["id"]]) if u["id"] in mapped else None)
        for u in people
    ]  # fmt: skip


class SlackMapIn(BaseModel):
    member_user_id: uuid.UUID | None  # None = unmap


@router.put("/admin/integrations/slack/users/{slack_user_id}")
async def map_slack_user(slack_user_id: str, body: SlackMapIn, ctx: Admin) -> dict:
    """Pin a Slack account to a member (e.g. a team account demoing as HR). Only messages
    ingested after this use the new mapping."""
    async with tenant_session(ctx.tenant_id) as s:
        await s.execute(
            update(MemberProfile)
            .where(MemberProfile.slack_user_id == slack_user_id)
            .values(slack_user_id=None)
        )
        if body.member_user_id is not None:
            active = await s.scalar(
                select(Membership.user_id).where(
                    Membership.user_id == body.member_user_id, Membership.status == "active"
                )
            )
            if active is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "member_not_found")
            prof = await s.scalar(
                select(MemberProfile).where(MemberProfile.user_id == body.member_user_id)
            )
            if prof is None:
                s.add(
                    MemberProfile(
                        tenant_id=ctx.tenant_id,
                        user_id=body.member_user_id,
                        slack_user_id=slack_user_id,
                    )
                )
            else:
                prof.slack_user_id = slack_user_id
        await audit.admin_event(s, ctx, "integration.slack.map_user", slack_user_id=slack_user_id,
                                member_user_id=str(body.member_user_id) if body.member_user_id else None)  # fmt: skip
    return {
        "slack_user_id": slack_user_id,
        "member_user_id": str(body.member_user_id) if body.member_user_id else None,
    }
