"""Live checks against Gemini on Agent Platform (skipped without credentials).

Run only these: uv run pytest -m live -s   (prints latencies)
"""

import math
import time

import pytest
from agno.agent import Agent
from pydantic import BaseModel

from brain.config import get_settings
from brain.llm.agno import agno_model
from brain.llm.embed import get_embedder
from brain.llm.provider import GeminiProvider, get_llm
from brain.llm.tiers import Tier, model_ids

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not get_settings().google_api_key, reason="no GOOGLE_API_KEY"),
]


class Understanding(BaseModel):
    language: str  # id | en | mixed
    intent: str
    entities: list[str]
    needs_pii: bool


async def test_json_on_lite():
    r = await get_llm().json(
        "Pertanyaan: 'Cuti tahunan brp hari ya for probation?' "
        "Return language as one of id|en|mixed.",
        Understanding,
        tier=Tier.LITE,
    )
    print(f"\n[lite json] {r.call.model} {r.call.latency_ms} ms -> {r.value}")
    assert r.call.model == get_settings().llm_model_lite and not r.call.fell_back
    assert r.value.language in ("mixed", "id")


async def test_fallback_when_primary_model_fails():
    models = {**model_ids(get_settings()), Tier.FLASH: "gemini-does-not-exist"}
    r = await GeminiProvider(models=models).json(
        "Extract entities from: 'stok telat di Makassar'", Understanding, tier=Tier.FLASH
    )
    print(f"\n[fallback] {r.call.model} after {r.call.errors[0][:80]}")
    assert r.call.fell_back and r.call.model == get_settings().llm_model_flash_fast
    assert "gemini-does-not-exist" in r.call.errors[0]


async def test_hedged_answer_stream():
    stream = get_llm().stream(
        "Sumber: [CHAT-pengumuman-hr-0031] Uang bensin naik jadi Rp750.000/bulan mulai 1 Sept. "
        "Jawab dalam 1 kalimat dengan sitasi [ID]: uang bensin per bulan berapa?",
        system="Jawab hanya dari sumber. Sitasi setiap kalimat.",
    )
    text = "".join([c async for c in stream])
    print(
        f"\n[stream] model={stream.model} hedged={stream.hedged} "
        f"first_token={stream.first_token_ms} ms total={stream.latency_ms} ms -> {text!r}"
    )
    assert "750" in text and stream.model in model_ids(get_settings()).values()


async def test_embeddings_multilingual_and_normalized():
    e = get_embedder()
    docs = await e.embed_documents(
        ["Uang bensin karyawan Rp750.000 per bulan", "Cuti tahunan 12 hari setelah probation"]
    )
    t = time.monotonic()
    q = await e.embed_query("fuel allowance per month")
    print(f"\n[embed] query {int((time.monotonic() - t) * 1000)} ms")
    assert all(len(v) == 768 and abs(math.sqrt(sum(x * x for x in v)) - 1) < 1e-6 for v in docs)
    sim = [sum(a * b for a, b in zip(q, d, strict=True)) for d in docs]
    assert sim[0] > sim[1], sim


async def test_agno_tool_call_with_injected_client():
    calls = []

    def search_documents(query: str) -> str:
        """Search company documents."""
        calls.append(query)
        return '<source id="DOC-sop#3" type="doc">Uang bensin Rp500.000 (SOP 2025)</source>'

    agent = Agent(
        model=agno_model(Tier.LITE),
        tools=[search_documents],
        db=None,
        add_history_to_context=False,
        tool_call_limit=2,
        telemetry=False,
        instructions="Use the tool, then answer citing the source id in [brackets].",
    )
    r = await agent.arun("uang bensin brp?")
    assert calls and "DOC-sop#3" in r.content
