"""Metric definitions (pure functions). See backend/eval/README.md for the reasoning behind each.

Retrieval      Hit@k, Recall@k, MRR over the ranked candidate list the retriever produced
               (BEIR / IR convention: a hit = an item whose id starts with a labelled prefix).
Generation     answer correctness (all key facts + right decision path), key-fact recall,
               citation precision / recall against labelled sources, groundedness.
Safety         leakage rate on restricted probes, abstention precision / recall / F1,
               over-refusal rate, access-offer accuracy.
Latency        p50 / p95 / max end-to-end and time to first token.
"""

import math
import re
from dataclasses import dataclass, field

ABSTAIN = frozenset({"idk", "policy_refusal"})


def groups(labels: list[str]) -> list[list[str]]:
    """'A|B' = either A or B counts as that one relevant source."""
    return [[p for p in g.split("|") if p] for g in labels]


def matches(item_id: str, group: list[str]) -> bool:
    return any(item_id.startswith(p) for p in group)


def base_id(citation_id: str) -> str:
    return citation_id.split("#", 1)[0]


def ranked_items(citation_ids: list[str]) -> list[str]:
    """Distinct item ids in first-seen order (chunks of the same item count once)."""
    out: list[str] = []
    for c in citation_ids:
        b = base_id(c)
        if b not in out:
            out.append(b)
    return out


def recall_at_k(ranked: list[str], labels: list[str], k: int) -> float:
    gs = groups(labels)
    top = ranked[:k]
    return sum(any(matches(i, g) for i in top) for g in gs) / len(gs) if gs else math.nan


def hit_at_k(ranked: list[str], labels: list[str], k: int) -> float:
    gs = groups(labels)
    return float(any(matches(i, g) for i in ranked[:k] for g in gs)) if gs else math.nan


def reciprocal_rank(ranked: list[str], labels: list[str]) -> float:
    gs = groups(labels)
    if not gs:
        return math.nan
    for rank, item in enumerate(ranked, 1):
        if any(matches(item, g) for g in gs):
            return 1.0 / rank
    return 0.0


def citation_precision(cited: list[str], labels: list[str]) -> float:
    """Share of cited items that are labelled sources. Labels are the sources that *hold* the
    answer, so a correct but unlabelled extra citation lowers this: read it as a lower bound."""
    items = ranked_items(cited)
    gs = groups(labels)
    if not items or not gs:
        return math.nan
    return sum(any(matches(i, g) for g in gs) for i in items) / len(items)


def citation_recall(cited: list[str], labels: list[str]) -> float:
    items = ranked_items(cited)
    gs = groups(labels)
    if not gs:
        return math.nan
    return sum(any(matches(i, g) for i in items) for g in gs) / len(gs)


def regex_hits(patterns: list[str], text: str) -> list[bool]:
    return [re.search(p, text) is not None for p in patterns]


def percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile (q in 0..100)."""
    vals = sorted(v for v in values if not math.isnan(v))
    if not vals:
        return math.nan
    k = max(1, math.ceil(q / 100 * len(vals)))
    return vals[k - 1]


def mean(values) -> float:
    vals = [v for v in values if v is not None and not math.isnan(v)]
    return sum(vals) / len(vals) if vals else math.nan


@dataclass
class Binary:
    """Confusion counts for a yes/no decision (here: should the assistant abstain?)."""

    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0
    _: list = field(default_factory=list, repr=False)

    def add(self, expected: bool, predicted: bool) -> None:
        if expected and predicted:
            self.tp += 1
        elif predicted:
            self.fp += 1
        elif expected:
            self.fn += 1
        else:
            self.tn += 1

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else math.nan

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else math.nan

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r and not math.isnan(p + r) else math.nan
