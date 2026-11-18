"""Who may poke the Atlassian webhooks. A webhook only names a page/issue to re-read (see sync.py).

Jira: the site admin creates the webhook with a secret; Jira signs each body with HMAC-SHA256 in
`X-Hub-Signature: sha256=<hex>`. The tenant is the one connected to the issue's site, and the
secret is stored encrypted with that tenant's Jira credentials.

Confluence Cloud has no admin webhooks, so an Automation flow ("Send web request") calls us with
`X-Knowhaven-Token: <tenant id>.<mac>`. The mac is keyed on SESSION_SECRET and a per-tenant nonce,
so rotating the nonce revokes the old token without storing any token.
"""

import hashlib
import hmac
import secrets
import uuid
from urllib.parse import urlsplit

from brain.config import get_settings


def _mac(tenant_id: uuid.UUID, nonce: str) -> str:
    key = get_settings().session_secret.encode()
    return hmac.new(
        key, f"confluence-webhook:{tenant_id}:{nonce}".encode(), hashlib.sha256
    ).hexdigest()


def new_nonce() -> str:
    return secrets.token_urlsafe(16)


def confluence_token(tenant_id: uuid.UUID, nonce: str) -> str:
    return f"{tenant_id}.{_mac(tenant_id, nonce)}"


def token_tenant(token: str | None) -> uuid.UUID | None:
    """The tenant a token claims; check it with `confluence_token_ok` before trusting it."""
    try:
        return uuid.UUID((token or "").split(".", 1)[0])
    except ValueError:
        return None


def confluence_token_ok(token: str, tenant_id: uuid.UUID, nonce: str | None) -> bool:
    return bool(nonce) and hmac.compare_digest(token, confluence_token(tenant_id, nonce))


def jira_signature_ok(body: bytes, header: str | None, secret: str | None) -> bool:
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header.removeprefix("sha256="), expected)


def issue_site(payload: dict) -> str | None:
    """https://<name>.atlassian.net from the issue's REST link, the form integrations are keyed by."""
    u = urlsplit(((payload.get("issue") or {}).get("self")) or "")
    return f"https://{u.hostname}" if u.scheme == "https" and u.hostname else None


def urls() -> dict:
    base = get_settings().web_origin.rstrip("/")
    return {
        "jira": f"{base}/api/integrations/jira/webhook",
        "confluence": f"{base}/api/integrations/confluence/webhook",
    }
