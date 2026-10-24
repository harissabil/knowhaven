FROM ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim AS builder

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# Install dependencies first for optimal docker layer caching
COPY pyproject.toml uv.lock README.md* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Copy source and migrations
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY alembic.ini ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Final production stage
FROM python:3.12-slim-bookworm

WORKDIR /app

COPY --from=builder /app /app

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

EXPOSE 8000 8001

CMD ["uvicorn", "brain.main:app", "--host", "0.0.0.0", "--port", "8000"]
