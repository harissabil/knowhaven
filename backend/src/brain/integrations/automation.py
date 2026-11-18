"""The two Confluence Automation flows that tell Knowhaven which page changed, installed through
Atlassian's Automation REST API with the integration's own email + API token.

Why not an import file: Confluence's importer always makes the "Automation for Confluence" bot the
flow's actor, whatever the file says, and such a flow will not enable on a Free site. Through the
API the flows run as the connected account. The flows are site-wide, so that account must be a
Confluence admin; otherwise Atlassian answers 403 (AtlassianError "no_permission").

A flow only sends {pageId, spaceKey, event}; the webhook re-reads the page from Atlassian.
"""

import json
import logging

from brain.integrations.atlassian import AtlassianClient, AtlassianError

log = logging.getLogger(__name__)

EVENTS = {
    "published": "confluence.page-published.trigger",
    "updated": "confluence.page-updated.trigger",
}
API = "https://api.atlassian.com/automation/public/confluence/{cloud}/rest/v1"


def name(event: str) -> str:
    return f"Knowhaven: page {event}"


def rule(event: str, *, actor: str, cloud: str, url: str, token: str) -> dict:
    site = f"ari:cloud:confluence::site/{cloud}"
    body = json.dumps({"pageId": "{{page.id}}", "spaceKey": "{{space.key}}", "event": event})
    return {
        "name": name(event),
        "description": "Tells Knowhaven which page changed; Knowhaven reads the page itself. "
        "Managed from Knowhaven → Integrations.",
        "state": "DISABLED",  # enabled by a separate call once saved
        "canOtherRuleTrigger": False,
        "notifyOnError": "FIRSTERROR",
        "authorAccountId": actor,
        "actor": {"type": "ACCOUNT_ID", "actor": actor},
        "trigger": {
            "component": "TRIGGER", "schemaVersion": 1, "type": EVENTS[event],
            "value": {"eventFilters": [site]}, "connectionId": None, "conditions": [],
        },
        "components": [{
            "component": "ACTION", "schemaVersion": 1, "type": "outgoing.webhook",
            "value": {
                "url": url, "urlSecure": False, "method": "POST",
                # Secure: other Confluence admins see the header name, not the token.
                "headers": [{"id": "_header_knowhaven_token", "name": "X-Knowhaven-Token",
                             "value": token, "headerSecure": True}],
                "sendIssue": False, "contentType": "custom", "customBody": body,
                "responseEnabled": False, "continueOnErrorEnabled": False,
            },
            "connectionId": None, "conditions": [], "parentId": None, "conditionParentId": None,
            "children": [],
        }],
        "ruleScopeARIs": [site],
        "labels": [],
        "writeAccessType": "UNRESTRICTED",
        "collaborators": [],
    }  # fmt: skip


async def _base(c: AtlassianClient) -> str:
    cloud = await c.cloud_id()
    if not cloud:
        raise AtlassianError("api_error", "no cloud id")
    return API.format(cloud=cloud)


async def _existing(c: AtlassianClient, base: str) -> dict[str, str]:
    """name → uuid of the flows already on the site (ours carry a fixed name)."""
    out: dict[str, str] = {}
    data = await c._req("GET", f"{base}/rule/summary", params={"limit": 100})
    for _ in range(20):  # safety stop
        for r in data.get("data", []):
            out.setdefault(r.get("name", ""), r["uuid"])
        nxt = (data.get("links") or {}).get("next")
        if not nxt:
            break
        data = await c._req("GET", nxt if nxt.startswith("http") else f"{base}/rule/summary{nxt}")
    return out


async def install(c: AtlassianClient, *, url: str, token: str) -> dict[str, str]:
    """Create or update both flows (run as the connected account, current token) and enable them.
    Safe to repeat: a flow with our name is updated in place. Returns event → flow uuid."""
    base = await _base(c)
    actor = (await c.check())["account_id"]
    if not actor:
        raise AtlassianError("api_error", "no account id")
    cloud = base.split("/confluence/")[1].split("/")[0]
    have = await _existing(c, base)
    out = {}
    for event in EVENTS:
        payload = {"rule": rule(event, actor=actor, cloud=cloud, url=url, token=token)}
        if uuid := have.get(name(event)):
            await c._req("PUT", f"{base}/rule/{uuid}", json=payload)
        else:
            uuid = (await c._req("POST", f"{base}/rule", json=payload))["ruleUuid"]
        await c._req("PUT", f"{base}/rule/{uuid}/state", json={"value": "ENABLED"})
        out[event] = uuid
    return out


async def status(c: AtlassianClient) -> dict[str, str]:
    """event → state (ENABLED / DISABLED / missing) of our flows on the site right now."""
    base = await _base(c)
    have = await _existing(c, base)
    out = {}
    for event in EVENTS:
        uuid = have.get(name(event))
        out[event] = (
            (await c._req("GET", f"{base}/rule/{uuid}"))["rule"]["state"] if uuid else "missing"
        )
    return out


async def remove(c: AtlassianClient) -> None:
    """Disable and delete our flows (on disconnect). Atlassian only deletes disabled flows."""
    base = await _base(c)
    have = await _existing(c, base)
    for event in EVENTS:
        if uuid := have.get(name(event)):
            await c._req("PUT", f"{base}/rule/{uuid}/state", json={"value": "DISABLED"})
            # Without a JSON Content-Type the API answers 415, even though there is no body.
            await c._req(
                "DELETE", f"{base}/rule/{uuid}", headers={"Content-Type": "application/json"}
            )
