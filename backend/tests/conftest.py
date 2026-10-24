import hashlib
import json
import math
import time
import uuid
from pathlib import Path

import httpx
import pytest
from sqlalchemy import text

from brain.config import get_settings
from brain.db.engine import create_engine

TEST_EMAIL_DOMAIN = "pytest.wb-demo.com"


async def _purge_test_data() -> None:
    """Owner role (bypasses RLS): delete tenants created by test users, then the users."""
    engine = create_engine(get_settings().database_url_unpooled)
    async with engine.begin() as conn:
        users = "SELECT id FROM users WHERE email LIKE :pat"
        params = {"pat": f"%@{TEST_EMAIL_DOMAIN}"}
        await conn.execute(text(f"DELETE FROM tenants WHERE created_by IN ({users})"), params)
        await conn.execute(text("DELETE FROM users WHERE email LIKE :pat"), params)
    await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
async def _clean_test_users():
    if not get_settings().app_database_url:
        yield
        return
    await _purge_test_data()
    yield
    await _purge_test_data()


class ApiUser:
    """An httpx client with its own cookie jar that sends the CSRF header automatically."""

    def __init__(self, client: httpx.AsyncClient, email: str, password: str):
        self.client = client
        self.email = email
        self.password = password
        self.csrf: str | None = None
        self.user_id: str | None = None

    async def request(self, method: str, url: str, csrf: bool = True, **kw) -> httpx.Response:
        headers = kw.pop("headers", {})
        if csrf and self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        r = await self.client.request(method, url, headers=headers, **kw)
        if r.is_success and url.endswith(("/auth/login", "/auth/register")):
            self.csrf = r.json()["csrf_token"]
            self.user_id = r.json()["user_id"]
        return r

    async def get(self, url: str, **kw) -> httpx.Response:
        return await self.request("GET", url, **kw)

    async def post(self, url: str, **kw) -> httpx.Response:
        return await self.request("POST", url, **kw)

    async def delete(self, url: str, **kw) -> httpx.Response:
        return await self.request("DELETE", url, **kw)

    async def put(self, url: str, **kw) -> httpx.Response:
        return await self.request("PUT", url, **kw)

    async def patch(self, url: str, **kw) -> httpx.Response:
        return await self.request("PATCH", url, **kw)


@pytest.fixture
async def make_user():
    from brain.main import app

    clients: list[httpx.AsyncClient] = []

    async def _make(name: str = "Tester") -> ApiUser:
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        clients.append(client)
        user = ApiUser(client, f"{uuid.uuid4().hex[:12]}@{TEST_EMAIL_DOMAIN}", "correct-horse-1")
        r = await user.post(
            "/api/auth/register",
            json={"email": user.email, "name": name, "password": user.password},
        )
        assert r.status_code == 201, r.text
        return user

    yield _make
    for c in clients:
        await c.aclose()


class FakeEmbedder:
    """Deterministic 768-dim unit vectors from a hash: no API cost, stable across runs."""

    model = "fake-embed"
    dim = 768

    async def embed_documents(self, texts):
        out = []
        for t in texts:
            h = hashlib.sha256(t.encode()).digest()
            v = [(h[i % 32] - 128) / 128 for i in range(self.dim)]
            n = math.sqrt(sum(x * x for x in v))
            out.append([x / n for x in v])
        return out

    async def embed_query(self, text):
        return (await self.embed_documents([text]))[0]


# --- test results for GET /api/tests (design doc 20.1: report every result, failures included) ---
# Outcomes are merged into test-results/last_run.json, so an offline run and a live run together
# cover all cases. The API maps handbook cases (T01-T33) onto these test node IDs.

_RESULTS = Path(__file__).resolve().parents[1] / "test-results" / "last_run.json"
_outcomes: dict[str, dict] = {}


def pytest_runtest_logreport(report):
    nodeid = report.nodeid.split("[")[0]  # parametrized cases collapse to their test function
    if report.when == "call" or report.outcome in ("failed", "skipped"):
        prev = _outcomes.get(nodeid)
        outcome = report.outcome
        if prev and prev["outcome"] == "failed":
            outcome = "failed"  # one failing parametrization fails the whole test
        _outcomes[nodeid] = {"outcome": outcome, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                             "duration_s": round(getattr(report, "duration", 0.0), 2)}  # fmt: skip


def pytest_sessionfinish(session, exitstatus):
    if not _outcomes:
        return
    _RESULTS.parent.mkdir(exist_ok=True)
    data = json.loads(_RESULTS.read_text(encoding="utf-8")) if _RESULTS.exists() else {"tests": {}}
    data["tests"].update(_outcomes)
    data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    _RESULTS.write_text(json.dumps(data, indent=1, sort_keys=True), encoding="utf-8")
