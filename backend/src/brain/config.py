from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"

    # Neon-managed (written by `neon deploy` / `neon env pull`), owner role.
    # Pooled URL is not used by the app; unpooled URL runs migrations and bootstrap.
    database_url: str = ""
    database_url_unpooled: str = ""
    # Ours (written by `brain-db-bootstrap`): pooled, brain_app role, RLS enforced.
    app_database_url: str = ""

    session_secret: str = "change-me"
    credentials_key: str = ""
    web_origin: str = "http://localhost:3000"

    # Gemini via Agent Platform (formerly Vertex AI). API key = express mode;
    # otherwise project + location + GOOGLE_APPLICATION_CREDENTIALS.
    google_api_key: str = ""
    google_cloud_project: str = ""
    google_cloud_location: str = "global"
    # Model tiers. Never above gemini-3.8-flash (cost); stable IDs only, no -preview.
    # lite: understand, retrieval planning, ingestion extraction.
    # flash_fast: claim extraction (blocks streaming, output never shown).
    # flash: streamed answer composition; hedged with flash_fast if no first token in time.
    llm_model_lite: str = "gemini-3.5-flash-lite"
    llm_model_flash_fast: str = "gemini-3.6-flash"
    llm_model_flash: str = "gemini-3.7-flash"
    llm_flash_thinking_level: str = "low"
    llm_compose_hedge_after_s: float = 8.0
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768

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
