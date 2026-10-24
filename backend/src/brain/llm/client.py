import asyncio
from functools import lru_cache

from google import genai

from brain.config import get_settings


@lru_cache
def get_genai_client() -> genai.Client:
    """One shared client. Express-mode API key if set, else project/location + ADC."""
    s = get_settings()
    if s.google_api_key:
        return genai.Client(vertexai=True, api_key=s.google_api_key)
    if s.google_cloud_project:
        return genai.Client(
            vertexai=True, project=s.google_cloud_project, location=s.google_cloud_location
        )
    raise RuntimeError("Gemini not configured: set GOOGLE_API_KEY or GOOGLE_CLOUD_PROJECT")


_semaphore: asyncio.Semaphore | None = None


def model_slots() -> asyncio.Semaphore:
    """Global cap on concurrent model calls (per process), so the test suite can't blow quotas."""
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(get_settings().llm_max_concurrency)
    return _semaphore
