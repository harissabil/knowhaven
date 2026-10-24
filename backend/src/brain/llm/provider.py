"""LLMProvider (design doc 16.3): JSON / text generation with tiered fallback, and the hedged
answer stream. Gemini is the only implementation today; callers depend on this interface."""

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from functools import lru_cache

from google import genai
from google.genai import types
from pydantic import BaseModel

from brain.config import Settings, get_settings
from brain.llm.client import get_genai_client, model_slots
from brain.llm.stream import HedgedStream, LLMUnavailable
from brain.llm.tiers import FALLBACK, Tier, model_ids, thinking, timeout_s


@dataclass
class LLMCall:
    """What actually ran, for the trace and the audit row (model_ids, latency)."""

    tier: Tier
    model: str
    latency_ms: int
    fell_back: bool
    errors: list[str] = field(default_factory=list)
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass
class LLMResult[T]:
    value: T
    call: LLMCall


class GeminiProvider:
    def __init__(
        self,
        client: genai.Client | None = None,
        settings: Settings | None = None,
        models: dict[Tier, str] | None = None,
    ):
        self._client = client
        self._s = settings or get_settings()
        self._models = models or model_ids(self._s)

    @property
    def client(self) -> genai.Client:
        return self._client or get_genai_client()

    def model(self, tier: Tier) -> str:
        return self._models[tier]

    def _config(self, tier: Tier, system: str | None, temperature: float, **extra):
        return types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            thinking_config=thinking(self._s, tier),
            **extra,
        )

    async def _generate(self, tier: Tier, prompt, config_extra: dict, system, temperature, parse):
        errors: list[str] = []
        started = time.monotonic()
        for i, t in enumerate(FALLBACK[tier]):
            model = self._models[t]
            try:
                async with model_slots():
                    res = await asyncio.wait_for(
                        self.client.aio.models.generate_content(
                            model=model,
                            contents=prompt,
                            config=self._config(t, system, temperature, **config_extra),
                        ),
                        timeout_s(self._s, t),
                    )
                value = parse(res)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - timeout, quota, 5xx, bad output: next tier
                errors.append(f"{model}: {type(e).__name__}: {e}"[:300])
                continue
            usage = res.usage_metadata
            return LLMResult(
                value,
                LLMCall(
                    tier=t,
                    model=model,
                    latency_ms=int((time.monotonic() - started) * 1000),
                    fell_back=i > 0,
                    errors=errors,
                    input_tokens=usage.prompt_token_count if usage else None,
                    output_tokens=usage.candidates_token_count if usage else None,
                ),
            )
        raise LLMUnavailable("; ".join(errors))

    async def json[M: BaseModel](
        self,
        prompt: str,
        schema: type[M],
        tier: Tier = Tier.LITE,
        system: str | None = None,
        temperature: float = 0.0,
    ) -> LLMResult[M]:
        """Structured output validated against `schema` (design doc 10.3: steps 2 and 5)."""

        def parse(res):
            if isinstance(res.parsed, schema):
                return res.parsed
            return schema.model_validate_json(res.text or "")

        return await self._generate(
            tier,
            prompt,
            {"response_mime_type": "application/json", "response_schema": schema},
            system,
            temperature,
            parse,
        )

    async def text(
        self,
        prompt: str,
        tier: Tier = Tier.LITE,
        system: str | None = None,
        temperature: float = 0.2,
    ) -> LLMResult[str]:
        def parse(res):
            if not res.text:
                raise ValueError("empty response")
            return res.text

        return await self._generate(tier, prompt, {}, system, temperature, parse)

    def stream(
        self,
        prompt,
        system: str | None = None,
        tier: Tier = Tier.FLASH,
        hedge_tier: Tier | None = Tier.FLASH_FAST,
        temperature: float = 0.2,
    ) -> HedgedStream:
        """Answer stream with hedging (iterate it for text chunks; read .model etc. after)."""
        tier_of = {self._models[t]: t for t in Tier}

        async def open_stream(model: str) -> AsyncIterator[str]:
            async with model_slots():
                chunks = await self.client.aio.models.generate_content_stream(
                    model=model,
                    contents=prompt,
                    config=self._config(tier_of[model], system, temperature),
                )
                async for chunk in chunks:
                    if chunk.text:
                        yield chunk.text

        return HedgedStream(
            open_stream,
            primary=self._models[tier],
            hedge=self._models[hedge_tier] if hedge_tier else None,
            hedge_after_s=self._s.llm_compose_hedge_after_s,
            total_timeout_s=self._s.llm_stream_timeout_s,
        )


@lru_cache
def get_llm() -> GeminiProvider:
    return GeminiProvider()
