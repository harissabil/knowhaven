"""Hedged streaming logic, offline and deterministic (fake model streams)."""

import asyncio

import pytest

from brain.llm.stream import HedgedStream, LLMStreamBroken, LLMUnavailable


def fake(behaviors: dict, cancelled: set):
    """behaviors[model] = list of steps: ("sleep", s) | ("text", t) | ("fail", msg)."""

    async def open_stream(model: str):
        try:
            for kind, val in behaviors[model]:
                if kind == "sleep":
                    await asyncio.sleep(val)
                elif kind == "text":
                    yield val
                else:
                    raise RuntimeError(val)
        except asyncio.CancelledError:
            cancelled.add(model)
            raise

    return open_stream


async def collect(stream: HedgedStream) -> str:
    return "".join([c async for c in stream])


def make(behaviors, hedge_after=0.1, total=2.0, cancelled=None):
    return HedgedStream(
        fake(behaviors, cancelled if cancelled is not None else set()), "p", "h", hedge_after, total
    )


async def test_fast_primary_never_hedges():
    s = make({"p": [("text", "Rp"), ("text", "750.000")], "h": [("text", "x")]})
    assert await collect(s) == "Rp750.000"
    assert s.model == "p" and not s.hedged


async def test_slow_primary_loses_to_hedge_and_is_cancelled():
    cancelled: set = set()
    s = make(
        {"p": [("sleep", 1.0), ("text", "late")], "h": [("text", "cepat"), ("text", "!")]},
        cancelled=cancelled,
    )
    assert await collect(s) == "cepat!"
    assert s.model == "h" and s.hedged
    await asyncio.sleep(0)  # let the cancellation land
    assert "p" in cancelled


async def test_primary_that_wins_after_hedge_started_still_wins():
    s = make(
        {"p": [("sleep", 0.15), ("text", "primary")], "h": [("sleep", 1.0), ("text", "hedge")]}
    )
    assert await collect(s) == "primary"
    assert s.model == "p" and s.hedged


async def test_early_primary_failure_falls_back_immediately():
    s = make({"p": [("fail", "429")], "h": [("text", "ok")]}, hedge_after=5.0)
    assert await collect(s) == "ok"
    assert s.model == "h" and s.first_token_ms < 1000 and "429" in s.errors[0]


async def test_both_fail_raises_unavailable():
    s = make({"p": [("fail", "500")], "h": [("fail", "503")]})
    with pytest.raises(LLMUnavailable, match="500.*503"):
        await collect(s)


async def test_no_first_token_within_total_timeout():
    s = make({"p": [("sleep", 5)], "h": [("sleep", 5)]}, hedge_after=0.05, total=0.3)
    with pytest.raises(LLMUnavailable, match="no first token"):
        await collect(s)


async def test_failure_after_first_token_breaks_stream_but_draft_was_sent():
    s = make({"p": [("text", "Uang bensin "), ("fail", "conn reset")], "h": [("text", "x")]})
    got = []
    with pytest.raises(LLMStreamBroken):
        async for c in s:
            got.append(c)
    assert got == ["Uang bensin "] and s.model == "p"
