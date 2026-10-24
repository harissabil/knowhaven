"""MCP behind the reverse proxy: the public host is allowed, others still get 421 (DNS rebinding)."""

from starlette.testclient import TestClient

from brain.config import get_settings
from brain.mcp_server.server import build_server, transport_security

INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}  # fmt: skip
HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


def _status(host: str) -> int:
    app = build_server().streamable_http_app(
        streamable_http_path="/mcp", stateless_http=True, transport_security=transport_security()
    )
    with TestClient(app, base_url=f"http://{host}") as c:
        return c.post("/mcp", json=INIT, headers=HEADERS).status_code


def test_public_host_from_settings_is_accepted_and_others_are_not(monkeypatch):
    monkeypatch.setenv("MCP_PUBLIC_URL", "http://203.0.113.7/mcp")
    get_settings.cache_clear()
    try:
        assert _status("203.0.113.7") == 200
        assert _status("localhost:8001") == 200
        assert _status("evil.example") == 421
    finally:
        get_settings.cache_clear()
