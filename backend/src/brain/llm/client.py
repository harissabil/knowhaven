import asyncio
from functools import lru_cache

from google import genai

from brain.config import get_settings


@lru_cache
def _credentials():
    from google.oauth2 import service_account

    path = get_settings().google_application_credentials
    if not path:
        return None  # Application Default Credentials (e.g. on a GCP host)
    return service_account.Credentials.from_service_account_file(
        path, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )


@lru_cache
def get_genai_client(location: str | None = None) -> genai.Client:
    """One shared client per location. Service account (project) if configured, else the
    express-mode API key (which can't pick a location)."""
    s = get_settings()
    if s.google_cloud_project:
        return genai.Client(
            vertexai=True,
            project=s.google_cloud_project,
            location=location or s.google_cloud_location,
            credentials=_credentials(),
        )
    if s.google_api_key:
        return genai.Client(vertexai=True, api_key=s.google_api_key)
    raise RuntimeError(
        "Gemini not configured: set GOOGLE_CLOUD_PROJECT (+ key file) or GOOGLE_API_KEY"
    )


def get_embedding_client() -> genai.Client:
    return get_genai_client(get_settings().embedding_location)


_semaphore: asyncio.Semaphore | None = None


def model_slots() -> asyncio.Semaphore:
    """Global cap on concurrent model calls (per process), so the test suite can't blow quotas."""
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(get_settings().llm_max_concurrency)
    return _semaphore
