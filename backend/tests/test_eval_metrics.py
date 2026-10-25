"""Evaluation metric definitions (brain.eval.metrics). Pure functions."""

import math

from brain.eval import metrics as m

RANKED = ["CHAT-general-0002", "DOC-sop-cuti", "TASK-OPS-19", "DOC-kebijakan-k3"]


def test_recall_hit_and_mrr_use_prefix_groups():
    labels = ["DOC-sop-cuti", "TASK-OPS-19|TASK-OPS-20"]
    assert m.recall_at_k(RANKED, labels, 2) == 0.5
    assert m.recall_at_k(RANKED, labels, 5) == 1.0
    assert m.hit_at_k(RANKED, labels, 1) == 0.0 and m.hit_at_k(RANKED, labels, 2) == 1.0
    assert m.reciprocal_rank(RANKED, labels) == 0.5  # first relevant item at rank 2
    assert m.reciprocal_rank(RANKED, ["DOC-none"]) == 0.0
    assert math.isnan(m.recall_at_k(RANKED, [], 5))


def test_chunks_of_one_item_count_once():
    assert m.ranked_items(["DOC-a#1", "DOC-a#2", "DOC-b#1"]) == ["DOC-a", "DOC-b"]


def test_citation_precision_and_recall():
    cited = ["DOC-sop-cuti#2", "DOC-sop-cuti#3", "CHAT-general-0002"]
    assert m.citation_precision(cited, ["DOC-sop-cuti"]) == 0.5
    assert m.citation_recall(cited, ["DOC-sop-cuti", "TASK-OPS-19"]) == 0.5


def test_percentile_nearest_rank():
    vals = [float(x) for x in range(1, 11)]
    assert m.percentile(vals, 50) == 5.0
    assert m.percentile(vals, 95) == 10.0


def test_binary_abstention_scores():
    b = m.Binary()
    for expected, predicted in [(True, True), (True, False), (False, True), (False, False)]:
        b.add(expected, predicted)
    assert b.precision == 0.5 and b.recall == 0.5 and b.f1 == 0.5
