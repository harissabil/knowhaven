"""Agno model factory. Agno's own Vertex mode ignores api_key, so we inject our client."""

from agno.models.google import Gemini

from brain.config import get_settings
from brain.llm.client import get_genai_client
from brain.llm.tiers import Tier, model_ids


def agno_model(tier: Tier = Tier.LITE, temperature: float = 0.0) -> Gemini:
    s = get_settings()
    return Gemini(
        id=model_ids(s)[tier],
        client=get_genai_client(),
        temperature=temperature,
        thinking_level=None if tier == Tier.LITE else s.llm_flash_thinking_level,
        timeout=s.llm_timeout_lite_s if tier == Tier.LITE else s.llm_timeout_flash_s,
    )
