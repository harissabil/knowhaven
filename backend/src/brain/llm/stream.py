"""Hedged streaming for the answer (docs/backend-plan.md 1.1).

Start the primary model. If it hasn't produced a first token after `hedge_after_s` (or fails
before producing one), start the hedge model too; whichever streams first wins and the other is
cancelled. After the first token we're committed to that model: a later failure raises
`LLMStreamBroken`, and the pipeline replaces the draft (SSE `replace`).
"""

import asyncio
import time
from collections.abc import AsyncIterator, Callable

OpenStream = Callable[[str], AsyncIterator[str]]


class LLMUnavailable(Exception):
    """No model produced output in time."""


class LLMStreamBroken(Exception):
    """The chosen model failed after it had started streaming."""


class HedgedStream:
    def __init__(
        self,
        open_stream: OpenStream,
        primary: str,
        hedge: str | None,
        hedge_after_s: float,
        total_timeout_s: float,
    ):
        self._open = open_stream
        self._primary = primary
        self._hedge = hedge if hedge and hedge != primary else None
        self._hedge_after = hedge_after_s
        self._total = total_timeout_s
        # Filled in while streaming; read by the trace/audit afterwards.
        self.model: str | None = None
        self.hedged = False
        self.first_token_ms: int | None = None
        self.latency_ms: int | None = None
        self.errors: list[str] = []

    async def _pump(self, model: str, q: asyncio.Queue) -> None:
        try:
            async for chunk in self._open(model):
                if chunk:
                    await q.put(("delta", chunk))
            await q.put(("done", None))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - every provider error means "try the other one"
            await q.put(("error", f"{model}: {type(e).__name__}: {e}"[:300]))

    async def __aiter__(self) -> AsyncIterator[str]:
        start = time.monotonic()
        deadline = start + self._total
        queues: dict[str, asyncio.Queue] = {}
        pumps: dict[str, asyncio.Task] = {}

        def launch(model: str) -> asyncio.Future:
            queues[model] = asyncio.Queue()
            pumps[model] = asyncio.create_task(self._pump(model, queues[model]))
            return asyncio.ensure_future(queues[model].get())

        gets: dict[asyncio.Future, str] = {launch(self._primary): self._primary}
        winner: str | None = None
        first: str | None = None
        try:
            while winner is None:
                hedge_pending = self._hedge is not None and not self.hedged
                wake_at = min(start + self._hedge_after, deadline) if hedge_pending else deadline
                done, _ = await asyncio.wait(
                    gets,
                    timeout=max(0.0, wake_at - time.monotonic()),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    if hedge_pending and time.monotonic() < deadline:
                        self.hedged = True
                        gets[launch(self._hedge)] = self._hedge
                        continue
                    raise LLMUnavailable(f"no first token within {self._total:.0f}s")
                for fut in done:
                    model = gets.pop(fut)
                    kind, value = fut.result()
                    if kind in ("delta", "done") and winner is None:
                        winner, first = model, value
                    elif kind == "error":
                        self.errors.append(value)
                if winner is None and not gets:
                    if self._hedge is not None and not self.hedged:
                        self.hedged = True  # primary failed early: fall back immediately
                        gets[launch(self._hedge)] = self._hedge
                    else:
                        raise LLMUnavailable("; ".join(self.errors) or "all models failed")

            for fut in gets:
                fut.cancel()
            for model, task in pumps.items():
                if model != winner:
                    task.cancel()
            self.model = winner
            self.first_token_ms = int((time.monotonic() - start) * 1000)
            if first is None:  # finished without any text
                return
            yield first
            q = queues[winner]
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise LLMStreamBroken(f"{winner}: stream exceeded {self._total:.0f}s")
                kind, value = await asyncio.wait_for(q.get(), remaining)
                if kind == "delta":
                    yield value
                elif kind == "done":
                    return
                else:
                    self.errors.append(value)
                    raise LLMStreamBroken(value)
        finally:
            self.latency_ms = int((time.monotonic() - start) * 1000)
            for task in pumps.values():
                task.cancel()
