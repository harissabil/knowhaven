# Workplace Brain: backend

FastAPI + Agno + Lakebase Postgres on Neon (pgvector, RLS) + Neon Object Storage.
Plan and progress: [`../docs/backend-plan.md`](../docs/backend-plan.md).

## Quickstart (local)

Prereqs: uv, Node (for the Neon CLI and `neon.ts`), `neon login` done once.

```sh
npm install                   # @neon/config for neon.ts
neon deploy                   # provision services in neon.ts, pull DATABASE_URL* + AWS_* into .env
uv sync
uv run brain-db-bootstrap     # extensions + brain_app runtime role, writes APP_DATABASE_URL
uv run brain                  # API on http://localhost:8000 (docs at /docs, health at /healthz)
```

```sh
uv run ruff check src tests && uv run ruff format src tests
uv run pytest                 # tests/test_infra.py hits the linked Neon branch
```

- The API connects as `brain_app` over the pooled URL (non-owner, NOBYPASSRLS, so RLS always applies).
- Migrations and bootstrap run as the Neon owner role over `DATABASE_URL_UNPOOLED`.
- Feature work: `neon checkout dev-<name> --create` gives an isolated DB + bucket branch (7-day TTL per `neon.ts`).
