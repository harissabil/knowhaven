"""Model tiers (docs/backend-plan.md 1.1). Cap: nothing above gemini-3.8-flash; stable IDs only."""

from enum import StrEnum

from google.genai import types

from brain.config import Settings


class Tier(StrEnum):
    LITE = "lite"  # understand, retrieval planning, ingestion extraction
    FLASH_FAST = "flash_fast"  # claim extraction (blocks streaming; never shown)
    FLASH = "flash"  # streamed answer composition


# On timeout/error a call moves down its chain; the last resort is the caller's IDK template.
FALLBACK: dict[Tier, tuple[Tier, ...]] = {
    Tier.FLASH: (Tier.FLASH, Tier.FLASH_FAST, Tier.LITE),
    Tier.FLASH_FAST: (Tier.FLASH_FAST, Tier.LITE),
    Tier.LITE: (Tier.LITE,),
}


def model_ids(s: Settings) -> dict[Tier, str]:
    return {
        Tier.LITE: s.llm_model_lite,
        Tier.FLASH_FAST: s.llm_model_flash_fast,
        Tier.FLASH: s.llm_model_flash,
    }


def timeout_s(s: Settings, tier: Tier) -> float:
    return s.llm_timeout_lite_s if tier == Tier.LITE else s.llm_timeout_flash_s


def thinking(s: Settings, tier: Tier) -> types.ThinkingConfig | None:
    # Lite models answer directly; flash models think at a low level (minimal is rejected
    # by 3.8-flash, and higher levels cost 20-40 s of latency).
    if tier == Tier.LITE:
        return None
    return types.ThinkingConfig(thinking_level=s.llm_flash_thinking_level)
