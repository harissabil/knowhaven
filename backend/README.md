# Workplace Brain: backend

FastAPI + Agno + Postgres (pgvector, RLS) + S3-compatible object storage.
Production runs Postgres in Docker Compose next to the app and stores files in Tencent COS;
local development below uses Neon branches.
Plan and progress: [`../docs/backend-plan.md`](../docs/backend-plan.md).

## Quickstart (local)

Prereqs: uv, Node (for the Neon CLI and `neon.ts`), `neon login` done once.

```sh
npm install                   # @neon/config for neon.ts
neon checkout dev             # develop on the long-lived dev branch; pulls DATABASE_URL* + AWS_* into .env
uv sync
uv run brain-db-bootstrap     # extensions + brain_app runtime role, writes APP_DB_PASSWORD (once per project)
uv run alembic upgrade head   # schema + RLS, runs as the Neon owner over the direct URL
uv run brain                  # API on http://localhost:8000 (docs at /docs, health at /healthz)
```

```sh
uv run ruff check src tests && uv run ruff format src tests
uv run pytest                 # infra + RLS isolation tests against the linked Neon branch (use dev)
```

- The API connects as `brain_app` over the pooled URL (non-owner, NOBYPASSRLS, so RLS always applies).
- Migrations and bootstrap run as the Neon owner role over `DATABASE_URL_UNPOOLED`.
- Feature work: `neon checkout dev-<name> --create` gives an isolated DB + bucket branch (7-day TTL per `neon.ts`).
