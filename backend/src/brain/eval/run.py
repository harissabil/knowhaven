"""Run the golden set against a running Knowhaven API and write a metrics report.

    uv run brain-eval --base-url https://<host>            # all cases
    uv run brain-eval --base-url http://localhost:8000 --only C01 C02 conflict

Black-box: every case logs in as its persona and asks through POST /api/chat (SSE), exactly as
the web app does. The ranked retrieval list for each answer is read back from the audit log
(GET /api/audit/queries/{id}) as an auditor, so retrieval is scored on what the pipeline really
retrieved, not on a re-run. Each run costs one normal chat request per case.
"""

import argparse
import json
import math
import os
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

import httpx
import yaml

from brain.eval import metrics as m

GOLDEN = Path(__file__).resolve().parents[3] / "eval" / "golden.yaml"
# Demo accounts (seeded, shown on the login page). Override with BRAIN_EVAL_ACCOUNTS (JSON).
ACCOUNTS = {
    "dimas": ("dimas@srn-demo.id", "Demo-SRN-2026!"),
    "rina": ("rina@srn-demo.id", "Demo-SRN-2026!"),
    "sari": ("sari@srn-demo.id", "Demo-SRN-2026!"),
    "bambang": ("bambang@srn-demo.id", "Demo-SRN-2026!"),
    "andi": ("andi@srn-demo.id", "Demo-SRN-2026!"),
    "yoga": ("yoga@konsultan-demo.id", "Demo-Konsultan-2026!"),
}
K_VALUES = (5, 10)
DEFAULT_URL = "http://localhost:8000"


# --------------------------------------------------------------------------- HTTP client
class Session:
    def __init__(self, base_url: str, email: str, password: str):
        self.c = httpx.Client(base_url=base_url, timeout=httpx.Timeout(120.0, connect=15.0))
        r = self.c.post("/api/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        self.csrf = r.json()["csrf_token"]

    def ask(self, question: str) -> dict:
        t0 = time.monotonic()
        ttft = None
        events: list[tuple[str, dict]] = []
        headers = {"X-CSRF-Token": self.csrf, "Accept": "text/event-stream"}
        with self.c.stream("POST", "/api/chat", json={"question": question}, headers=headers) as r:
            r.raise_for_status()
            buf = ""
            for chunk in r.iter_text():
                buf += chunk.replace("\r\n", "\n")
                while "\n\n" in buf:
                    block, buf = buf.split("\n\n", 1)
                    hit = re.search(r"event: (\w+)\ndata: (.*)", block, re.S)
                    if not hit:
                        continue
                    name, data = hit.group(1), json.loads(hit.group(2))
                    if name == "delta" and ttft is None:
                        ttft = time.monotonic() - t0
                    events.append((name, data))
        final = next((d for n, d in events if n == "final"), {})
        return {
            "final": final,
            "seconds": time.monotonic() - t0,
            "ttft": ttft,
            "replaced": [d.get("reason") for n, d in events if n == "replace"],
            "errors": [d for n, d in events if n == "error"],
        }

    def audit(self, query_id: str) -> dict | None:
        r = self.c.get(f"/api/audit/queries/{query_id}")
        return r.json() if r.status_code == 200 else None

    def close(self) -> None:
        try:
            self.c.post("/api/auth/logout", headers={"X-CSRF-Token": self.csrf})
        finally:
            self.c.close()


def retrieval_ranking(audit: dict | None) -> list[str]:
    """Candidates in rank order: the tool calls of step 4 merged round-robin by position (each
    call is already ranked), deduplicated to item ids."""
    if not audit:
        return []
    calls = []
    for t in audit.get("trace", []):
        if t.get("step") == 4:
            detail = t.get("detail") or t.get("detail_auditor") or {}
            calls = [c.get("returned_ids", []) for c in detail.get("tool_calls", [])]
    merged: list[str] = []
    for pos in range(max((len(c) for c in calls), default=0)):
        merged += [c[pos] for c in calls if pos < len(c)]
    return [i for i in m.ranked_items(merged) if not i.startswith("COMPANY-")]


# --------------------------------------------------------------------------- scoring one case
@dataclass
class Result:
    id: str
    category: str
    persona: str
    question: str
    restricted: bool
    expected_paths: list[str] = field(default_factory=list)
    has_offer: bool = False
    path: str = ""
    answer: str = ""
    cited: list[str] = field(default_factory=list)
    cited_types: list[str] = field(default_factory=list)
    retrieved: list[str] = field(default_factory=list)
    seconds: float = math.nan
    ttft: float | None = None
    path_ok: bool = True
    facts_hit: int = 0
    facts_total: int = 0
    leaked: list[str] = field(default_factory=list)
    offer_ok: bool = True
    types_ok: bool = True
    grounded: bool | None = None
    retrieval: dict = field(default_factory=dict)
    citation_precision: float = math.nan
    citation_recall: float = math.nan
    passed: bool = False
    reasons: list[str] = field(default_factory=list)
    error: str | None = None


def new_result(case: dict, error: str | None = None) -> Result:
    exp = case.get("expect", {})
    return Result(
        case["id"], case["category"], case["persona"], case["question"],
        bool(case.get("restricted")), exp.get("path", []), "offer" in exp, error=error,
    )  # fmt: skip


def score(case: dict, out: dict, audit: dict | None) -> Result:
    exp = case.get("expect", {})
    final = out["final"]
    res = new_result(case)
    res.path = final.get("decision_path", "?")
    res.answer = final.get("answer", "")
    res.cited = [c["id"] for c in final.get("citations", [])]
    res.cited_types = sorted({c["type"] for c in final.get("citations", [])})
    res.seconds, res.ttft = out["seconds"], out["ttft"]
    res.retrieved = retrieval_ranking(audit)
    if out["errors"]:
        res.error = str(out["errors"][0])[:200]

    if exp.get("path"):
        res.path_ok = res.path in exp["path"]
        if not res.path_ok:
            res.reasons.append(f"path {res.path}, expected {'/'.join(exp['path'])}")
    hits = m.regex_hits(exp.get("must", []), res.answer)
    res.facts_hit, res.facts_total = sum(hits), len(hits)
    for p, ok in zip(exp.get("must", []), hits, strict=True):
        if not ok:
            res.reasons.append(f"missing fact /{p}/")
    forbidden = exp.get("must_not", [])
    for p, bad in zip(forbidden, m.regex_hits(forbidden, res.answer), strict=True):
        if bad:
            res.leaked.append(p)
            res.reasons.append(f"forbidden /{p}/ present")
    if "offer" in exp:
        res.offer_ok = bool(final.get("access_offer")) == bool(exp["offer"])
        if not res.offer_ok:
            res.reasons.append("no access offer" if exp["offer"] else "unexpected access offer")
    if exp.get("source_types"):
        res.types_ok = set(exp["source_types"]) <= set(res.cited_types)
        if not res.types_ok:
            res.reasons.append(f"cited types {res.cited_types}, expected {exp['source_types']}")

    labels = exp.get("sources", [])
    if labels and res.retrieved:
        res.retrieval = {f"recall@{k}": m.recall_at_k(res.retrieved, labels, k) for k in K_VALUES}
        res.retrieval |= {f"hit@{k}": m.hit_at_k(res.retrieved, labels, k) for k in K_VALUES}
        res.retrieval["rr"] = m.reciprocal_rank(res.retrieved, labels)
    if labels and res.cited:
        res.citation_precision = m.citation_precision(res.cited, labels)
        res.citation_recall = m.citation_recall(res.cited, labels)
    if res.path in ("answer", "conflict") and res.cited:
        retrieved = set(res.retrieved)
        res.grounded = ("validation_failed" not in out["replaced"]) and (
            not retrieved or all(m.base_id(c) in retrieved for c in res.cited)
        )

    res.passed = (res.path_ok and res.facts_hit == res.facts_total and not res.leaked
                  and res.offer_ok and res.types_ok and res.error is None)  # fmt: skip
    return res


# --------------------------------------------------------------------------- aggregate + report
def aggregate(results: list[Result]) -> dict:
    ok = [r for r in results if r.error is None]
    answerable = [r for r in ok if r.category not in ("idk", "refusal", "access")]
    restricted = [r for r in ok if r.restricted]
    with_ret = [r for r in ok if r.retrieval]
    abst = m.Binary()
    for r in ok:
        if r.expected_paths:
            abst.add(set(r.expected_paths) <= m.ABSTAIN, r.path in m.ABSTAIN)
    should_answer = [r for r in ok if r.expected_paths and not set(r.expected_paths) <= m.ABSTAIN]
    summary = {
        "cases": len(results),
        "errors": len(results) - len(ok),
        "pass_rate": m.mean(float(r.passed) for r in ok),
        "answer_correctness": m.mean(float(r.passed) for r in answerable),
        "key_fact_recall": (sum(r.facts_hit for r in ok) / sum(r.facts_total for r in ok))
        if sum(r.facts_total for r in ok)
        else math.nan,
        "decision_path_accuracy": m.mean(float(r.path_ok) for r in ok if r.expected_paths),
        "groundedness": m.mean(float(r.grounded) for r in ok if r.grounded is not None),
        "citation_precision": m.mean(r.citation_precision for r in ok),
        "citation_recall": m.mean(r.citation_recall for r in ok),
        "leakage_rate": m.mean(float(bool(r.leaked)) for r in restricted),
        "restricted_probes": len(restricted),
        "abstain_precision": abst.precision,
        "abstain_recall": abst.recall,
        "abstain_f1": abst.f1,
        "over_refusal_rate": m.mean(float(r.path in m.ABSTAIN) for r in should_answer),
        "conflict_accuracy": m.mean(float(r.passed) for r in ok if r.category == "conflict"),
        "access_offer_accuracy": m.mean(float(r.offer_ok) for r in ok if r.has_offer),
        "latency_p50_s": m.percentile([r.seconds for r in ok], 50),
        "latency_p95_s": m.percentile([r.seconds for r in ok], 95),
        "latency_max_s": max((r.seconds for r in ok), default=math.nan),
        "ttft_p50_s": m.percentile([r.ttft for r in ok if r.ttft is not None], 50),
        "within_90s": m.mean(float(r.seconds <= 90) for r in ok),
    }
    for k in K_VALUES:
        summary[f"retrieval_hit@{k}"] = m.mean(r.retrieval.get(f"hit@{k}") for r in with_ret)
        summary[f"retrieval_recall@{k}"] = m.mean(r.retrieval.get(f"recall@{k}") for r in with_ret)
    summary["retrieval_mrr"] = m.mean(r.retrieval.get("rr") for r in with_ret)
    summary["retrieval_cases"] = len(with_ret)
    by_cat: dict[str, dict] = {}
    for cat in sorted({r.category for r in results}):
        rs = [r for r in ok if r.category == cat]
        by_cat[cat] = {
            "n": len(rs),
            "pass_rate": m.mean(float(r.passed) for r in rs),
            "key_fact_recall": (sum(r.facts_hit for r in rs) / sum(r.facts_total for r in rs))
            if sum(r.facts_total for r in rs)
            else math.nan,
            "latency_p50_s": m.percentile([r.seconds for r in rs], 50),
        }
    return {"summary": summary, "by_category": by_cat}


def pct(x: float) -> str:
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x * 100:.1f}%"


def sec(x: float) -> str:
    return "n/a" if x is None or math.isnan(x) else f"{x:.1f} s"


def table(rows: list[tuple[str, str]], head: tuple[str, str] = ("Metric", "Value")) -> list[str]:
    return [f"| {head[0]} | {head[1]} |", "|---|---|", *(f"| {k} | {v} |" for k, v in rows), ""]


def report_md(meta: dict, agg: dict, results: list[Result]) -> str:
    s = agg["summary"]
    mrr = "n/a" if math.isnan(s["retrieval_mrr"]) else f"{s['retrieval_mrr']:.3f}"
    abstain = f"{pct(s['abstain_precision'])} / {pct(s['abstain_recall'])} / {pct(s['abstain_f1'])}"
    over_refusal = pct(s["over_refusal_rate"])
    p50_p95 = f"{sec(s['latency_p50_s'])} / {sec(s['latency_p95_s'])}"
    lines = [
        f"# Knowhaven evaluation report: {meta['started']}",
        "",
        f"Target `{meta['base_url']}` · golden set v{meta['golden_version']} "
        f"({s['cases']} cases) · prompt {meta.get('prompt_version') or 'n/a'} · "
        f"errors {s['errors']}",
        "",
        "## Headline",
        "",
        *table([
            ("Overall pass rate (every check of a case)", pct(s["pass_rate"])),
            ("Answer correctness (answerable questions)", pct(s["answer_correctness"])),
            ("Key-fact recall", pct(s["key_fact_recall"])),
            (f"Leakage rate ({s['restricted_probes']} restricted probes)", pct(s["leakage_rate"])),
            ("Groundedness (backed by retrieved, validated citations)", pct(s["groundedness"])),
            ("Conflict resolution accuracy", pct(s["conflict_accuracy"])),
            ("Latency p50 / p95 (end-to-end)", p50_p95),
        ]),
        "## Retrieval",
        "",
        *table([
            *((f"Hit@{k}", pct(s[f"retrieval_hit@{k}"])) for k in K_VALUES),
            *((f"Recall@{k}", pct(s[f"retrieval_recall@{k}"])) for k in K_VALUES),
            ("MRR", mrr),
            ("Cases with labelled sources", str(s["retrieval_cases"])),
        ]),
        "## Generation and citations",
        "",
        *table([
            ("Decision-path accuracy (answer / conflict / idk / refusal)",
             pct(s["decision_path_accuracy"])),
            ("Citation precision (lower bound, vs labelled sources)", pct(s["citation_precision"])),
            ("Citation recall", pct(s["citation_recall"])),
        ]),
        "## Safety and abstention",
        "",
        *table([
            ("Leakage rate (restricted probes with forbidden content)", pct(s["leakage_rate"])),
            ("Abstention precision / recall / F1", abstain),
            ("Over-refusal rate (answerable, but refused / 'don't know')", over_refusal),
            ("Access-offer accuracy (gated topics)", pct(s["access_offer_accuracy"])),
        ]),
        "## Latency",
        "",
        *table([
            ("p50 / p95 / max end-to-end", f"{p50_p95} / {sec(s['latency_max_s'])}"),
            ("Time to first token p50", sec(s["ttft_p50_s"])),
            ("Answers within the 90 s limit", pct(s["within_90s"])),
        ]),
        "## By category",
        "",
        "| Category | n | Pass rate | Key-fact recall | Latency p50 |",
        "|---|---|---|---|---|",
    ]  # fmt: skip
    for cat, c in agg["by_category"].items():
        lines.append(
            f"| {cat} | {c['n']} | {pct(c['pass_rate'])} | {pct(c['key_fact_recall'])} "
            f"| {sec(c['latency_p50_s'])} |"
        )
    failed = [r for r in results if not r.passed]
    lines += ["", f"## Failed cases ({len(failed)})", ""]
    if not failed:
        lines.append("None.")
    for r in failed:
        why = "; ".join(r.reasons) or (r.error or "")
        snippet = re.sub(r"\s+", " ", r.answer)[:220]
        lines += [
            f"- **{r.id}** ({r.category}, {r.persona}) {r.question}",
            f"  - why: {why}",
            f"  - path `{r.path}`, cited {', '.join(r.cited) or '-'}",
            f"  - answer: {snippet}",
        ]
    lines += ["", "Metric definitions: backend/eval/README.md."]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- main
def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--base-url", default=os.environ.get("BRAIN_EVAL_BASE_URL", DEFAULT_URL))
    p.add_argument("--golden", type=Path, default=GOLDEN)
    p.add_argument("--only", nargs="*", default=[], help="case ids and/or categories")
    p.add_argument("--auditor", default="bambang", help="persona used to read retrieval traces")
    p.add_argument("--out", type=Path, default=Path("eval-reports"))
    a = p.parse_args()

    extra = json.loads(os.environ.get("BRAIN_EVAL_ACCOUNTS", "{}"))
    accounts = ACCOUNTS | {k: tuple(v) for k, v in extra.items()}
    golden = yaml.safe_load(a.golden.read_text(encoding="utf-8"))
    wanted = set(a.only)
    cases = [c for c in golden["cases"] if not wanted or {c["id"], c["category"]} & wanted]
    started = datetime.now().strftime("%Y-%m-%d %H:%M")
    sessions: dict[str, Session] = {}

    def session(persona: str) -> Session:
        if persona not in sessions:
            sessions[persona] = Session(a.base_url, *accounts[persona])
        return sessions[persona]

    results: list[Result] = []
    prompt_version = None
    try:
        auditor = session(a.auditor)
        for i, case in enumerate(cases, 1):
            try:
                out = session(case["persona"]).ask(case["question"])
                qid = out["final"].get("query_id")
                audit = auditor.audit(qid) if qid else None
                row = (audit or {}).get("audit") or {}
                prompt_version = prompt_version or row.get("prompt_version")
                res = score(case, out, audit)
            except Exception as e:  # noqa: BLE001 - one failing case must not stop the run
                res = new_result(case, error=f"{type(e).__name__}: {e}"[:200])
            results.append(res)
            mark = "PASS" if res.passed else "FAIL"
            print(f"[{i:>2}/{len(cases)}] {mark} {res.id:<4} {res.seconds:5.1f}s {res.path:<15} "
                  f"{'; '.join(res.reasons)[:90]}", flush=True)  # fmt: skip
    finally:
        for s in sessions.values():
            s.close()

    agg = aggregate(results)
    meta = {"started": started, "base_url": a.base_url, "golden_version": golden.get("version"),
            "prompt_version": prompt_version}  # fmt: skip
    run_dir = a.out / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "report.md").write_text(report_md(meta, agg, results), encoding="utf-8")
    (run_dir / "results.json").write_text(
        json.dumps(
            {"meta": meta, **agg, "cases": [asdict(r) for r in results]},
            ensure_ascii=False,
            indent=1,
            default=str,
        ),  # fmt: skip
        encoding="utf-8",
    )
    s = agg["summary"]
    print(
        f"\npass {pct(s['pass_rate'])} · correctness {pct(s['answer_correctness'])} · "
        f"leakage {pct(s['leakage_rate'])} · recall@5 {pct(s['retrieval_recall@5'])} · "
        f"p95 {sec(s['latency_p95_s'])}\nreport: {run_dir / 'report.md'}"
    )


if __name__ == "__main__":
    main()
