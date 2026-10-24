from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"

    # Neon-managed (written by `neon deploy` / `neon env pull`), owner role.
    # Pooled URL is not used by the app; unpooled URL runs migrations and bootstrap.
    database_url: str = ""
    database_url_unpooled: str = ""
    # Runtime role brain_app (RLS enforced). Password written by `brain-db-bootstrap`; the URL is
    # derived from the pooled DATABASE_URL so it follows `neon checkout <branch>`.
    app_db_user: str = "brain_app"
    app_db_password: str = ""
    app_database_url_override: str = ""

    @property
    def app_database_url(self) -> str:
        if self.app_database_url_override:
            return self.app_database_url_override
        if not (self.database_url and self.app_db_password):
            return ""
        return (
            make_url(self.database_url)
            .set(username=self.app_db_user, password=self.app_db_password)
            .render_as_string(hide_password=False)
        )

    # MCP server for WorkBuddy (separate process, `uv run brain-mcp`), design doc 13.
    mcp_public_url: str = "http://localhost:8001/mcp"  # what users paste into ~/.workbuddy/mcp.json
    mcp_rate_limit_per_min: int = 30  # per token

    session_secret: str = "change-me"
    credentials_key: str = ""
    web_origin: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Gemini via Agent Platform (formerly Vertex AI). Preferred: service account (project + key
    # file). Fallback: express-mode API key. Measured 2026-10-24: embeddings on `global` take
    # ~11.5 s/call but 0.13-0.4 s in asia-southeast1; Gemini 3.x generation is only on `global`.
    google_api_key: str = ""
    google_cloud_project: str = ""
    google_application_credentials: str = ""  # path to the service-account JSON (outside the repo)
    google_cloud_location: str = "global"  # generation
    embedding_location: str = "asia-southeast1"
    # Model tiers. Never above gemini-3.8-flash (cost); stable IDs only, no -preview.
    # lite: understand, retrieval planning, ingestion extraction.
    # flash_fast: claim extraction (blocks streaming, output never shown).
    # flash: streamed answer composition; hedged with flash_fast if no first token in time.
    llm_model_lite: str = "gemini-3.5-flash-lite"
    llm_model_flash_fast: str = "gemini-3.6-flash"
    llm_model_flash: str = "gemini-3.7-flash"
    llm_flash_thinking_level: str = "low"
    llm_compose_hedge_after_s: float = 4.0  # 3.7-flash first token measured 6-21 s
    # Per-call budgets (seconds) and a global cap on concurrent model calls (quota safety).
    llm_timeout_lite_s: float = 15.0
    llm_timeout_flash_s: float = 30.0
    llm_stream_timeout_s: float = 45.0
    llm_max_concurrency: int = 8
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    embedding_batch_size: int = 32
    # How long a search waits for the query embedding before running keyword + trigram only.
    # Express-mode embeddings measured ~11 s/call (2026-10-24); the embedding keeps running in the
    # background and fills the cache for the next search.
    retrieval_vector_wait_s: float = 12.0

    slack_client_id: str = ""
    slack_client_secret: str = ""
    slack_signing_secret: str = ""

    # Neon Object Storage (S3-compatible, Neon-managed AWS_* vars).
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_endpoint_url_s3: str = ""
    aws_region: str = ""
    storage_bucket: str = "uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()
