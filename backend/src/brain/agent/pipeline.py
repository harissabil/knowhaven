"""The 8-step query pipeline (design doc 10.1) as an async stream of events.

  1 [CODE] identify       context from the session/token, conversation history (trimmed on
                          permission changes), query embedding prefetch
  2 [LLM]  understand     lite model, JSON (language, intent, category, queries, needs_pii)
  3 [CODE] policy gate    category refusals (11.2), smalltalk
  4 [LLM+CODE] retrieve   deterministic baseline + Agno planner; tools are permission-bound
  5 [LLM+CODE] evidence   flash_fast extracts claims; code checks them and resolves conflicts
  6 [LLM]  compose        flash (3.7) streamed, hedged by flash_fast
  7 [CODE] validate       citations ⊆ retrieved, every sentence cited, numbers supported,
                          PII guard; retry once, else the "don't know" template
  8 [CODE] record         messages, trace_events, hash-chained audit_log

Events (SSE): trace, delta, final, replace, error. IDK and refusal paths never stream LLM
tokens, so a hidden topic and a non-existent one produce the same event sequence (11.1).
"""

import asyncio
import json
import re
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from agno.agent import Agent
from sqlalchemy import func, select

from brain.agent import prompts
from brain.agent.mentions import split_mentions
from brain.agent.schemas import Evidence, Understanding
from brain.audit import log as audit
from brain.db.models import Conversation, IngestionEvent, Message, TraceEvent
from brain.db.session import tenant_session
from brain.hitl import drafts
from brain.ingestion import pii
from brain.llm.agno import agno_model
from brain.llm.provider import GeminiProvider, LLMCall, get_llm
from brain.llm.stream import LLMStreamBroken, LLMUnavailable
from brain.llm.tiers import Tier
from brain.policy import conflict, idk, refusal
from brain.policy.validate import Validation, validate
from brain.rbac.context import RequestContext
from brain.retrieval.search import Hit, SearchResult, pii_policy
from brain.retrieval.tools import COMPANY_PROFILE_ID, Retriever, format_hits

HISTORY_TURNS = 3
STALE_ANSWER = (
    "(jawaban sebelumnya dihapus karena izin akses berubah; jawab ulang dengan izin sekarang)"
)
MAX_EVIDENCE_HITS = 16
PLANNER_BUDGET_S = 8.0

NOTES = {
    "injection": {
        "id": "Catatan: salah satu sumber berisi instruksi yang ditujukan ke AI; instruksi tersebut saya abaikan.",
        "en": "Note: one of the sources contains instructions aimed at an AI; I ignored them.",
    },
    "access_changed": {
        "id": "Akses Anda berubah sejak percakapan sebelumnya; jawaban dihitung ulang dengan izin terbaru.",
        "en": "Your access changed since earlier in this conversation; this answer uses your current permissions.",
    },
    "smalltalk": {
        "id": "Halo! Saya bisa menjawab pertanyaan tentang kebijakan, dokumen, percakapan, dan task perusahaan yang boleh Anda akses.",
        "en": "Hi! I can answer questions about company policies, documents, conversations and tasks you have access to.",
    },
}  # fmt: skip


@dataclass
class Event:
    name: str  # trace | delta | final | replace | error
    data: dict

    def sse(self) -> str:
        return f"event: {self.name}\ndata: {json.dumps(self.data, ensure_ascii=False, default=str)}\n\n"


@dataclass
class _Step:
    step: int
    label: str
    name: str
    started: datetime
    t: float
    summary: str | None = None
    detail: dict = field(default_factory=dict)
    ended: datetime | None = None
    ms: int | None = None


def _lang(und: Understanding | None) -> str:
    return "en" if und is not None and und.language == "en" else "id"


def _guess_language(q: str) -> str:
    en = len(re.findall(r"\b(what|how|who|when|where|why|is|are|the|my|please|can)\b", q.lower()))
    return "en" if en >= 2 else "id"


class Steps:
    """The LLM-backed steps. Tests substitute deterministic versions."""

    def __init__(self, llm: GeminiProvider | None = None):
        self.llm = llm or get_llm()

    async def understand(
        self, question: str, history: list[tuple[str, str]]
    ) -> tuple[Understanding, LLMCall]:
        hist = "\n".join(f"Q: {q}\nA: {a}" for q, a in history)
        prompt = f"<history>\n{hist}\n</history>\n<question>\n{question}\n</question>"
        res = await self.llm.json(prompt, Understanding, tier=Tier.LITE, system=prompts.UNDERSTAND)
        return res.value, res.call

    async def plan(
        self, retriever: Retriever, question: str, und: Understanding, found: str
    ) -> str | None:
        """Agentic retrieval: the model may call the permission-bound tools a few more times."""

        async def search_messages(
            query: str, entities: list[str] | None = None, since: str | None = None
        ) -> str:
            """Search chat messages (Slack channels, WhatsApp groups). since: YYYY-MM-DD, optional."""
            when = datetime.fromisoformat(since).replace(tzinfo=UTC) if since else None
            return format_hits(await retriever.search_messages(query, entities, when))

        async def search_documents(query: str, entities: list[str] | None = None) -> str:
            """Search documents (SOPs, policies, onboarding pack, meeting notes, Confluence pages)."""
            return format_hits(await retriever.search_documents(query, entities))

        async def query_tasks(
            project: str | None = None, status: str | None = None, assignee: str | None = None,
            entity: str | None = None, due_before: str | None = None,
        ) -> str:  # fmt: skip
            """Query Jira tasks by project key, status (e.g. open, done), assignee, entity or due date."""
            return format_hits(
                await retriever.query_tasks(project, status, assignee, entity, due_before)
            )

        async def get_item(item_id: str) -> str:
            """Open one source by its id (e.g. DOC-sop-distribusi#4.2)."""
            return format_hits(await retriever.get_item(item_id))

        model = agno_model(Tier.LITE)
        agent = Agent(
            model=model,
            tools=[search_messages, search_documents, query_tasks, get_item],
            instructions=prompts.PLANNER,
            db=None,  # no memory/session storage: nothing retrieved survives this request (10.3)
            add_history_to_context=False,
            tool_call_limit=2,
            telemetry=False,
        )
        prompt = f"<question>\n{question}\n</question>\nAlready found:\n{found or '(nothing yet)'}"
        await asyncio.wait_for(agent.arun(prompt), PLANNER_BUDGET_S)
        return model.id

    async def extract(self, question: str, sources: str) -> tuple[Evidence, LLMCall]:
        prompt = f"<question>\n{question}\n</question>\n{sources}"
        res = await self.llm.json(prompt, Evidence, tier=Tier.FLASH_FAST, system=prompts.EXTRACT)
        return res.value, res.call

    def compose_stream(self, prompt: str):
        return self.llm.stream(
            prompt, system=prompts.COMPOSE, tier=Tier.FLASH, hedge_tier=Tier.FLASH_FAST
        )

    async def recompose(self, prompt: str) -> tuple[str, LLMCall]:
        res = await self.llm.text(
            prompt, tier=Tier.FLASH_FAST, system=prompts.COMPOSE, temperature=0.0
        )
        return res.value, res.call


class Pipeline:
    def __init__(self, steps: Steps | None = None, retriever_factory=None):
        self.steps = steps or Steps()
        self._retriever_factory = retriever_factory or (lambda ctx: Retriever(ctx))

    async def run(
        self,
        ctx: RequestContext,
        question: str,
        conversation_id: uuid.UUID | None = None,
        channel: str = "web",
        document_ids: list[str] | None = None,
    ) -> AsyncIterator[Event]:
        run = _Run(
            self,
            ctx,
            question.strip()[:2000],
            conversation_id,
            channel,
            document_ids=document_ids,
        )
        async for ev in run.go():
            yield ev


class _Run:
    def __init__(
        self,
        p: Pipeline,
        ctx: RequestContext,
        question: str,
        conversation_id,
        channel: str,
        document_ids: list[str] | None = None,
    ):
        # Inline tags ("@[SOP Cuti](DOC-x)") stay in the stored message; the model sees "@SOP Cuti".
        plain_q, tagged_ids = split_mentions(question)
        self.p, self.ctx, self.q, self.channel = p, ctx, plain_q, channel
        self.raw_q = question
        self.conversation_id = conversation_id
        extra = [d.strip() for d in (document_ids or []) if d and d.strip()]
        self.document_ids = list(dict.fromkeys(tagged_ids + extra))[:10]
        self.query_id = uuid.uuid4()
        self.t0 = time.monotonic()
        self.steps: list[_Step] = []
        self.models: dict[str, str] = {}
        self.und: Understanding | None = None
        self.retriever: Retriever = p._retriever_factory(ctx)
        self.history: list[tuple[str, str]] = []
        self.notes: list[str] = []
        self.details: dict = {}

    # --- trace helpers -------------------------------------------------------------------

    def _start(self, step: int, label: str, name: str) -> tuple[_Step, Event]:
        st = _Step(step, label, name, datetime.now(UTC), time.monotonic())
        self.steps.append(st)
        return st, Event("trace", {"step": step, "label": label, "name": name, "status": "running"})

    def _end(self, st: _Step, summary: str, **detail) -> Event:
        st.ended, st.ms, st.summary, st.detail = (
            datetime.now(UTC),
            int((time.monotonic() - st.t) * 1000),
            summary,
            detail,
        )
        return Event(
            "trace",
            {
                "step": st.step,
                "label": st.label,
                "name": st.name,
                "status": "done",
                "ms": st.ms,
                "summary": summary,
            },
        )

    # --- the run -----------------------------------------------------------------------------

    async def go(self) -> AsyncIterator[Event]:
        try:
            async for ev in self._steps():
                yield ev
        except Exception as e:  # noqa: BLE001 - never leak internals; record and answer generically
            self.details["error"] = f"{type(e).__name__}: {e}"[:500]
            text = "Maaf, terjadi kesalahan saat memproses pertanyaan. Silakan coba lagi."
            try:
                final = await self._finish(text, "error", [], [], None, [])
                yield Event("error", {"message": text, "query_id": str(self.query_id)})
                yield final
            except Exception:  # noqa: BLE001
                yield Event("error", {"message": text})

    async def _steps(self) -> AsyncIterator[Event]:
        q, ctx, r = self.q, self.ctx, self.retriever

        # 1 [CODE] identify ----------------------------------------------------------------------
        st, ev = self._start(1, "CODE", "identify")
        yield ev
        r.prefetch(q)  # the question's embedding overlaps with step 2
        access_changed = await self._load_conversation()
        if access_changed:
            self.notes.append("access_changed")
        yield self._end(st, "Identitas dan izin dimuat", roles=sorted(ctx.role_keys), permission_version=ctx.permission_version,
                        history_turns=len(self.history), access_changed=access_changed)  # fmt: skip

        # 2 [LLM] understand -----------------------------------------------------------------------
        st, ev = self._start(2, "LLM", "understand")
        yield ev
        try:
            self.und, call = await self.p.steps.understand(q, self.history)
            self.models["understand"] = call.model if call else "stub"
        except LLMUnavailable as e:
            self.und = Understanding(language=_guess_language(q), intent="unknown", category="question", topic_phrase=q,
                                     search_queries=[q], source_types=["chat", "doc", "task"], needs_pii=False)  # fmt: skip
            self.details["understand_fallback"] = str(e)[:200]
        und = self.und
        r.prefetch(*und.search_queries[:3])
        yield self._end(st, f"Pertanyaan dipahami ({und.intent})", understanding=und.model_dump())
        lang = _lang(und)

        # 3 [CODE] policy gate -------------------------------------------------------------------------
        st, ev = self._start(3, "CODE", "policy_gate")
        yield ev
        ref = refusal.check(q, ctx.role_keys, und.category == "person_compensation")
        if ref is None and und.category == "action_request":
            ref = refusal.Refusal(refusal.WRITE_ACTION)
        if ref is not None:
            async with tenant_session(ctx.tenant_id) as s:
                match = await idk.match_topic(s, q)
                contact = match.contact if match else await idk.default_contact(s)
            yield self._end(
                st, "Pertanyaan termasuk kategori yang tidak bisa dijawab", refusal=ref.category
            )
            for e in self._skip_steps(4, 7):
                yield e
            yield await self._finish(
                refusal.refusal_text(ref, lang, contact), "policy_refusal", [], [], None, []
            )
            return
        if und.category == "smalltalk":
            yield self._end(st, "Sapaan")
            for e in self._skip_steps(4, 7):
                yield e
            yield await self._finish(NOTES["smalltalk"][lang], "answer", [], [], None, [])
            return
        if und.category == "unclear" and (und.clarifying_question or "").strip():
            # Asked back before any retrieval: the question comes from the user's words alone, so it
            # can't reveal data (a hidden project is never named in it).
            yield self._end(st, "Pertanyaan perlu diperjelas")
            for e in self._skip_steps(4, 7):
                yield e
            text = und.clarifying_question.strip()[:300]
            yield await self._finish(text, "answer", [], [], None, [])
            return
        yield self._end(st, "Lolos pemeriksaan kebijakan")

        # 4 [LLM+CODE] retrieve -----------------------------------------------------------------------
        st, ev = self._start(4, "LLM+CODE", "retrieve")
        yield ev
        async with tenant_session(ctx.tenant_id) as s:
            r.policy = await pii_policy(s, ctx, True)
        await self._baseline_retrieval()
        planner_model = None
        try:
            planner_model = await self.p.steps.plan(r, q, und, self._found_summary())
        except Exception as e:  # noqa: BLE001 - timeout / model error: keep what the baseline found
            self.details["planner_error"] = f"{type(e).__name__}"[:100]
        if planner_model:
            self.models["plan"] = planner_model
        hits = self._evidence_hits()
        yield self._end(st, f"Ditemukan {len(hits)} sumber yang bisa Anda akses",
                        tool_calls=[c.__dict__ for c in r.calls], filtered_total=sum(c.filtered_count for c in r.calls),
                        pii_released=any(h.revealed_pii for h in hits))  # fmt: skip

        # 5 [LLM+CODE] evidence -----------------------------------------------------------------------
        st, ev = self._start(5, "LLM+CODE", "evidence")
        yield ev
        claims: list[conflict.Claim] = []
        dropped: list[str] = []
        if hits:
            evidence, call = await self.p.steps.extract(q, format_hits(SearchResult(hits=hits)))
            self.models["extract"] = call.model if call else "stub"
            by_id = {h.citation_id: h for h in hits} | {h.item_id: h for h in hits}
            for c in evidence.claims if evidence.answerable else []:
                h = by_id.get(c.citation_id.strip())
                if h is None:
                    dropped.append(c.citation_id)  # cited something that wasn't retrieved: ignore
                    continue
                claims.append(conflict.Claim(c.topic, c.value, h.citation_id, h.item_id, c.statement, h.authority,
                                             h.updated_at, h.author, h.container, h.title, h.type))  # fmt: skip
        resolutions = conflict.resolve(claims)
        conflicts = [x for x in resolutions if x.is_conflict]
        yield self._end(st, (f"{len(claims)} klaim; {len(conflicts)} konflik diselesaikan oleh aturan" if claims else "Bukti tidak cukup"),
                        claims=[c.__dict__ | {"date": c.date} for c in claims], resolutions=[x.as_dict() for x in resolutions],
                        dropped_citations=dropped)  # fmt: skip

        if not claims:
            for e in self._skip_steps(6, 7):
                yield e
            async with tenant_session(ctx.tenant_id) as s:
                text, offer, _ = await idk.build(s, ctx, q, lang, und.topic_phrase)
            yield await self._finish(text, "idk", [], [], offer, [])
            return

        # 6 [LLM] compose (streamed) ----------------------------------------------------------------------
        st, ev = self._start(6, "LLM", "compose")
        yield ev
        async with tenant_session(ctx.tenant_id) as s:
            match = await idk.match_topic(s, q)
            owner_contact = match.contact if match else await idk.default_contact(s)
        prompt = self._compose_prompt(lang, resolutions, claims, owner_contact)
        text, streamed = "", False
        stream = self.p.steps.compose_stream(prompt)
        try:
            async for chunk in stream:
                text += chunk
                streamed = True
                yield Event("delta", {"text": chunk})
            broken = False
        except (LLMUnavailable, LLMStreamBroken) as e:
            broken = True
            self.details["compose_error"] = str(e)[:200]
        self.models["compose"] = getattr(stream, "model", None) or "stub"
        yield self._end(st, "Jawaban disusun", hedged=getattr(stream, "hedged", False),
                        first_token_ms=getattr(stream, "first_token_ms", None))  # fmt: skip

        # 7 [CODE] validate ---------------------------------------------------------------------------------
        st, ev = self._start(7, "CODE", "validate")
        yield ev
        allowed = self._allowed_texts()
        v = None if broken else self._validate(text, allowed)
        retried = False
        if v is None or not v.ok:
            retried = True
            feedback = "Fix these problems and return the full corrected answer: " + "; ".join(
                v.problems if v else ["stream failed"]
            )
            try:
                text2, call = await self.p.steps.recompose(
                    prompt + "\n<feedback>\n" + feedback + "\n</feedback>"
                )
                self.models["recompose"] = call.model if call else "stub"
                v2 = self._validate(text2, allowed)
            except LLMUnavailable:
                v2 = None
            self.details["validation_problems"] = v.problems if v else ["stream failed"]
            if v2 is not None and v2.ok:
                v = v2
            else:
                async with tenant_session(ctx.tenant_id) as s:
                    idk_text, offer, _ = await idk.build(s, ctx, q, lang, und.topic_phrase)
                self.details["validation_problems_retry"] = v2.problems if v2 else ["unavailable"]
                yield self._end(st, "Validasi gagal; memakai jawaban aman", ok=False)
                if streamed:
                    yield Event("replace", {"answer": idk_text, "reason": "validation_failed"})
                yield await self._finish(idk_text, "idk", [], [], offer, resolutions)
                return
        final_text = v.text
        cited = set(v.citations)
        cited_hits = [
            h
            for h in hits
            if h.citation_id in cited or h.item_id in {c.split("#")[0] for c in cited}
        ]
        if any(h.injection_flag for h in cited_hits):
            self.notes.append("injection")
        yield self._end(
            st,
            "Sitasi, angka, dan data pribadi divalidasi",
            ok=True,
            retried=retried,
            pii_masked=v.pii_masked,
        )
        if retried and streamed:
            yield Event("replace", {"answer": final_text, "reason": "corrected"})

        relevant = [
            x
            for x in resolutions
            if x.chosen is None or x.chosen.citation_id in cited or x.is_conflict
        ]
        decision = "conflict" if any(x.is_conflict for x in relevant) else "answer"
        stale = sorted({d for x in relevant for d in x.stale_doc_ids})
        if stale:
            self.details["draft_candidates"] = [
                x.as_dict() for x in relevant if x.stale_doc_ids
            ]  # Phase 9
        yield await self._finish(
            final_text, decision, v.citations, cited_hits, None, relevant, stale
        )

    # --- helpers --------------------------------------------------------------------------------------

    def _skip_steps(self, first: int, last: int) -> list[Event]:
        names = {
            4: ("LLM+CODE", "retrieve"),
            5: ("LLM+CODE", "evidence"),
            6: ("LLM", "compose"),
            7: ("CODE", "validate"),
        }
        out = []
        for n in range(first, last + 1):
            label, name = names[n]
            st, _ = self._start(n, label, name)
            out.append(self._end(st, "Dilewati", skipped=True))
        return out

    async def _load_conversation(self) -> bool:
        ctx = self.ctx
        async with tenant_session(ctx.tenant_id) as s:
            conv = None
            if self.conversation_id:
                conv = await s.scalar(
                    select(Conversation).where(
                        Conversation.id == self.conversation_id, Conversation.user_id == ctx.user_id
                    )
                )
            if conv is None:
                conv = Conversation(
                    tenant_id=ctx.tenant_id,
                    user_id=ctx.user_id,
                    channel=self.channel,
                    title=self.q[:80],
                )
                s.add(conv)
                await s.flush()
            self.conversation_id = conv.id
            msgs = (
                await s.scalars(
                    select(Message)
                    .where(Message.conversation_id == conv.id)
                    .order_by(Message.created_at.desc())
                    .limit(HISTORY_TURNS * 2)
                )
            ).all()
        msgs = list(reversed(msgs))
        # Noted once: on the first turn after the change, not on every later turn that still has
        # older messages in its window.
        changed = bool(msgs) and msgs[-1].permission_version != ctx.permission_version
        pairs, pending = [], None
        for m in msgs:
            if m.role == "user":
                pending = split_mentions(m.content)[0]  # tags as "@Title" for the model
            elif pending is not None:
                # Answers computed under other permissions are dropped (8.5): they may hold content
                # the user can no longer see. The user's own questions stay, so "and the one I
                # asked before?" still resolves after an access request is approved.
                answer = (
                    m.content if m.permission_version == ctx.permission_version else STALE_ANSWER
                )
                pairs.append((pending, answer))
                pending = None
        self.history = pairs[-HISTORY_TURNS:]
        return changed

    async def _baseline_retrieval(self) -> None:
        und, r = self.und, self.retriever
        queries = [self.q, *[x for x in und.search_queries if x.strip() and x != self.q]][:3]
        types = set(und.source_types or ["chat", "doc", "task"])
        jobs = []
        for doc_id in self.document_ids:
            jobs.append(r.get_item(doc_id))
        # Every source type is always searched: the model's source_types only adds the structured
        # task query. A policy question must still see chat (an HR announcement can override the
        # SOP, 11.3) and a "has it been done?" question must still see Jira.
        for i, query in enumerate(queries[:2]):
            jobs.append(
                r.search_messages(query, und.entities or None, limit=6 if "chat" in types else 4)
            )
            jobs.append(
                r.search_documents(query, und.entities or None, limit=5 if "doc" in types else 3)
            )
            if i == 0:
                jobs.append(
                    r.search_tasks(query, und.entities or None, limit=4 if "task" in types else 3)
                )
        if "task" in types:
            tf = und.task_filters
            jobs.append(r.query_tasks(tf.project, tf.status, tf.assignee, tf.entity or (und.entities[0] if und.entities else None))
                        if tf else r.query_tasks(entity=und.entities[0] if und.entities else None))  # fmt: skip
        jobs.append(
            r.company_profile()
        )  # common knowledge: always available, never crowds out evidence
        await asyncio.gather(*jobs)

    def _found_summary(self) -> str:
        seen = {id(h): h for h in self.retriever.seen.values()}.values()
        return "\n".join(
            f"- {h.citation_id} ({h.type}, {h.title or h.container}): {h.text[:80]}" for h in seen
        )

    def _evidence_hits(self) -> list[Hit]:
        uniq = {h.citation_id: h for h in self.retriever.seen.values()}
        profile = uniq.pop(COMPANY_PROFILE_ID, None)
        tagged = {d.split("#")[0] for d in self.document_ids}
        ranked = sorted(
            uniq.values(),
            key=lambda h: (0 if h.item_id in tagged else 1, -h.score, h.citation_id),
        )
        # Fair share per source type: every type is searched, and one type's weak matches (e.g.
        # unrelated announcements) must not push another type's best match out of the window.
        # Types the question is about get two slots per round, the others one.
        preferred = set(self.und.source_types or ()) if self.und else set()
        queues = {t: [h for h in ranked if h.type == t] for t in ("doc", "chat", "task")}
        queues["other"] = [h for h in ranked if h.type not in ("doc", "chat", "task")]
        top = [h for h in ranked if h.item_id in tagged][:MAX_EVIDENCE_HITS]
        picked = {h.citation_id for h in top}
        while len(top) < MAX_EVIDENCE_HITS and any(queues.values()):
            for t, q in queues.items():
                for _ in range(2 if t in preferred else 1):
                    while q and q[0].citation_id in picked:
                        q.pop(0)
                    if q and len(top) < MAX_EVIDENCE_HITS:
                        h = q.pop(0)
                        top.append(h)
                        picked.add(h.citation_id)
        return top + [profile] if profile else top

    def _allowed_texts(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for h in {h.citation_id: h for h in self.retriever.seen.values()}.values():
            text = " ".join(
                x
                for x in (
                    h.title,
                    h.text,
                    h.context,
                    json.dumps(h.structured) if h.structured else None,
                    # Source dates are metadata the answer may state ("sejak 2 September 2026").
                    f"{h.created_at.date().isoformat()} {h.updated_at.date().isoformat()}",
                )
                if x
            )
            out[h.citation_id] = text
            out[h.item_id] = (out.get(h.item_id, "") + " " + text).strip()
        return out

    def _validate(self, text: str, allowed: dict[str, str]) -> Validation:
        pol = self.retriever.policy
        return validate(text, allowed, self.q, pol.allowed, pol.company_domains)

    def _compose_prompt(self, lang: str, resolutions, claims, owner_contact: str) -> str:
        decided = []
        for x in resolutions:
            entry = x.as_dict()
            entry["reason_sentence"] = conflict.reason_sentence(x, lang)
            entry["owner_contact"] = owner_contact if x.tie else None
            decided.append(entry)
        cited = {c.citation_id for c in claims}
        sources = [h for h in self._evidence_hits() if h.citation_id in cited]
        language = {"en": "English", "mixed": "Indonesian (user mixed languages)"}.get(
            self.und.language, "Indonesian"
        )
        hist = "\n".join(f"Q: {a}\nA: {b}" for a, b in self.history)
        return (
            f"<language>{language}</language>\n<history>\n{hist}\n</history>\n<question>\n{self.q}\n</question>\n"
            f"<decided>\n{json.dumps(decided, ensure_ascii=False, default=str, indent=1)}\n</decided>\n"
            f"<claims>\n{json.dumps([{'value': c.value, 'citation_id': c.citation_id, 'statement': c.statement} for c in claims], ensure_ascii=False)}\n</claims>\n"
            f"<sources>\n{format_hits(SearchResult(hits=sources))}\n</sources>"
        )

    async def _finish(
        self, text, decision, citations, cited_hits, offer, resolutions, stale=()
    ) -> Event:
        ctx, lang = self.ctx, _lang(self.und)
        for n in self.notes:
            text += "\n\n" + NOTES[n][lang]
        st, _ = self._start(8, "CODE", "record")
        # Explicit, ordered timestamps: both rows share one transaction, and now() is per transaction.
        asked_at = datetime.now(UTC)
        pol = self.retriever.policy
        retrieved = sorted({h.item_id for h in self.retriever.seen.values()})
        async with tenant_session(ctx.tenant_id) as s:
            data_as_of = await s.scalar(select(func.max(IngestionEvent.processed_at)))
            s.add(Message(tenant_id=ctx.tenant_id, conversation_id=self.conversation_id, role="user",
                    created_at=asked_at, content=self.raw_q,
                          permission_version=ctx.permission_version, query_id=self.query_id))  # fmt: skip
            await s.flush()
            s.add(Message(tenant_id=ctx.tenant_id, conversation_id=self.conversation_id, role="assistant",
                    created_at=asked_at + timedelta(milliseconds=1), content=text,
                          citations=list(citations), permission_version=ctx.permission_version, query_id=self.query_id))  # fmt: skip
            self._end(st, "Dicatat")
            for x in self.steps:
                s.add(TraceEvent(tenant_id=ctx.tenant_id, query_id=self.query_id, step=x.step, label=x.label, name=x.name,
                                 started_at=x.started, ended_at=x.ended, summary_user=x.summary,
                                 detail_auditor=audit.jsonable(x.detail)))  # fmt: skip
            und = self.und
            draft_ids = []
            if decision == "conflict" and self.details.get("draft_candidates"):
                draft_ids = await drafts.propose(
                    s, ctx, self.query_id, self.details["draft_candidates"]
                )
                self.details["action_draft_ids"] = [str(d) for d in draft_ids]
            pii_released = any(h.revealed_pii for h in self.retriever.seen.values())
            await audit.append(
                s, ctx.tenant_id, "query", query_id=self.query_id, actor_user_id=ctx.user_id, channel=self.channel,
                query_text=pii.mask_text(self.q, pol.company_domains)[0],
                language=und.language if und else None, intent=und.intent if und else None,
                permission_version=ctx.permission_version, roles_snapshot=sorted(ctx.role_keys),
                retrieved_item_ids=retrieved, filtered_count=sum(c.filtered_count for c in self.retriever.calls),
                decision_path=decision, response_text=pii.mask_text(text, pol.company_domains)[0],
                citations=list(citations), model_ids=self.models, prompt_version=prompts.PROMPT_VERSION,
                latency_ms=int((time.monotonic() - self.t0) * 1000),
                details=audit.jsonable({**self.details, "pii_released": pii_released, "notes": self.notes,
                                        "conversation_id": self.conversation_id}),
            )  # fmt: skip
        by_id = {h.citation_id: h for h in cited_hits} | {h.item_id: h for h in cited_hits}
        return Event(
            "final",
            {
                "query_id": str(self.query_id),
                "conversation_id": str(self.conversation_id),
                "answer": text,
                "decision_path": decision,
                "citations": [
                    {
                        "id": c,
                        "type": by_id[c].type,
                        "title": by_id[c].title or by_id[c].container,
                        "container": by_id[c].container,
                        "url": by_id[c].url,
                        "date": by_id[c].updated_at.date().isoformat(),
                    }
                    for c in citations
                    if c in by_id
                ],  # fmt: skip
                "conflicts": [x.as_dict() for x in resolutions if x.is_conflict],
                "stale_doc_ids": list(stale),
                "access_offer": offer,
                "notes": self.notes,
                "action_draft_ids": [str(d) for d in draft_ids],
                "data_as_of": data_as_of.isoformat()
                if isinstance(data_as_of, datetime | date)
                else None,
                "latency_ms": int((time.monotonic() - self.t0) * 1000),
            },
        )
