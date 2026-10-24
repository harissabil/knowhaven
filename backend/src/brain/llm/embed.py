"""Embedder (design doc 16.2): multilingual, 768 dims (pgvector HNSW limit is 2000, 7.4).

At 768 dims gemini-embedding-001 returns unnormalized vectors, so we L2-normalize; cosine
distance in pgvector doesn't care, but normalized vectors make scores comparable.
"""

import asyncio
import math
from functools import lru_cache

from google import genai
from google.genai import types

from brain.config import Settings, get_settings
from brain.llm.client import get_genai_client, model_slots


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


class GeminiEmbedder:
    def __init__(self, client: genai.Client | None = None, settings: Settings | None = None):
        self._client = client
        s = settings or get_settings()
        self.model = s.embedding_model
        self.dim = s.embedding_dim
        self._batch = s.embedding_batch_size
        self._timeout = s.llm_timeout_flash_s

    @property
    def client(self) -> genai.Client:
        return self._client or get_genai_client()

    async def _embed(self, texts: list[str], task_type: str) -> list[list[float]]:
        last: Exception | None = None
        for attempt in range(3):
            try:
                async with model_slots():
                    res = await asyncio.wait_for(
                        self.client.aio.models.embed_content(
                            model=self.model,
                            contents=texts,
                            config=types.EmbedContentConfig(
                                output_dimensionality=self.dim, task_type=task_type
                            ),
                        ),
                        self._timeout,
                    )
                vectors = [_normalize(list(e.values)) for e in res.embeddings]
                if len(vectors) != len(texts) or any(len(v) != self.dim for v in vectors):
                    raise ValueError("embedding count/dimension mismatch")
                return vectors
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - retry quota/5xx/timeouts with backoff
                last = e
                await asyncio.sleep(0.5 * 2**attempt)
        raise RuntimeError(f"embedding failed: {last}") from last

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self._batch):
            out.extend(await self._embed(texts[i : i + self._batch], "RETRIEVAL_DOCUMENT"))
        return out

    async def embed_query(self, text: str) -> list[float]:
        return (await self._embed([text], "RETRIEVAL_QUERY"))[0]


@lru_cache
def get_embedder() -> GeminiEmbedder:
    return GeminiEmbedder()
