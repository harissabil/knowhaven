<div align="center">

<img src="./frontend/src/app/icon.svg" alt="" width="72">

# Knowhaven

Company knowledge answers that respect every access boundary.

[Accountability sheet](./ACCOUNTABILITY_SHEET.md) · [Test results](./TEST_RESULTS.md) · [Evaluation](./backend/eval/README.md) · [Screenshots](./screenshots/)

<sub>Challenge A, The Workplace Brain · AI CAN DO IT, Tencent Cloud Hackathon Indonesia 2026</sub>

</div>

![Havi answering a fuel-allowance question with both sources and a conflict note](./screenshots/t06-fuel-conflict.png)

## Contents

- [Overview](#overview)
- [In action](#in-action)
- [The problem](#the-problem)
- [How it works](#how-it-works): [architecture](#architecture), [design trade-offs](#key-design-trade-offs), [prompt design](#prompt-design)
- [Results](#results)
- [Business value](#business-value)
- [WorkBuddy](#workbuddy)
- [Try it](#try-it)
- [Run locally](#run-locally)
- [Stack](#stack)

## Overview

Knowhaven is a knowledge assistant for Indonesian companies. Employees ask in Bahasa Indonesia,
English or a mix of both, and Havi, the assistant, answers from the company's Slack, WhatsApp
exports, Confluence pages, uploaded documents and Jira tasks. Every answer cites the message,
page or task it came from, and only uses what the person asking is allowed to see.

Target users are new employees and staff who need policies and project status quickly, HR and
operations teams who answer the same questions repeatedly, and auditors who need to check what the
assistant did. It runs as a web app and inside Tencent WorkBuddy through an MCP connector; both use
the same backend and the same permission checks.

The demo company is PT Sinar Rantai Nusantara, a fictional consumer-goods distributor with
warehouses in Jakarta, Surabaya and Makassar, plus a second company (CV Kopi Lereng Merapi) to show
that tenants never see each other's data.

## In action

<table>
  <tr>
    <td width="50%"><img src="./screenshots/t18-pii.png" alt="Masked phone number for staff, raw NIK for HR"><br>
      Personal data: a staff member sees a masked phone number (left); HR sees the NIK because
      the task needs it (right).</td>
    <td width="50%"><img src="./screenshots/t01-t02-kenari-vs-merpati.png" alt="Hidden project and non-existent project get the same reply"><br>
      A hidden project (left) and a project that does not exist (right) get the same reply.</td>
  </tr>
  <tr>
    <td width="50%"><img src="./screenshots/t14-access-request.png" alt="Access request, approval, answer"><br>
      A restricted topic: the new hire requests access, HR approves it, the next answer is
      allowed.</td>
    <td width="50%"><img src="./screenshots/t22-workbuddy-fuel.png" alt="The same answer inside WorkBuddy"><br>
      The same question in WorkBuddy, through the MCP connector, with the same answer and
      sources.</td>
  </tr>
</table>

More screenshots, one per test, are in [`screenshots/`](./screenshots/).

## The problem

In most Indonesian companies the latest policy is a chat message, not the official document. The
fuel allowance in the reimbursement SOP says Rp500.000, but HR announced Rp750.000 in
`#pengumuman-hr` last month. A new hire who reads the SOP gets it wrong; one who asks a colleague
waits for an answer. Senior staff become the bottleneck.

An assistant that can read everything can also leak everything. Two failure modes matter most:

- **Leaking that something exists.** "You don't have access to Proyek Kenari" already tells a staff
  member that a confidential acquisition project exists.
- **Guessing when sources disagree.** A model shown both Rp500.000 and Rp750.000 picks one without
  saying which source it trusted or why.

## How it works

Every question, from the web app or WorkBuddy, goes through the same eight-step pipeline. The
model reads and writes text; code makes every decision that affects access or correctness.

1. **Identify** the user from the session or MCP token and load their roles from the database.
   Role claims typed into the chat ("saya HRD") are ignored.
2. **Understand** the question (language, intent, search queries, whether personal data is needed).
3. **Policy gate**: refuse write requests and salary questions about named people before any search.
4. **Retrieve** with hybrid search (vector, full text, trigram) over chat, documents and tasks.
   The permission filter runs inside the SQL query, before scoring, so restricted items never
   enter the candidate list.
5. **Extract evidence**: the model turns sources into claims, each tied to one source.
   Code then resolves conflicts: an official source beats team discussion, a newer official
   source beats an older one, a same-day tie is shown as a tie and sent to the topic owner.
6. **Compose** the answer from the decided claims only.
7. **Validate**: every sentence must cite a source the user was allowed to retrieve, and every
   number must appear in the cited source. Personal data the user may not see is masked again.
   A failing answer is rewritten once; if it still fails, the user gets "I don't know".
8. **Record** the question, retrieved sources, answer and all eight steps in a hash-chained audit log.

When nothing visible answers the question, the reply is a fixed template built only from the words
the user typed and the public topic owner. A question about the hidden Proyek Kenari and one about
a project that does not exist return the same text.

### Architecture

![Knowhaven architecture](https://github.com/user-attachments/assets/e823fbd5-726b-4884-9dc6-e4a98b9b2eef)

| Trust boundary | What crosses it | How it is enforced |
|---|---|---|
| Client entry | Browser requests, WorkBuddy MCP calls | HttpOnly session cookie with CSRF token, or a personal MCP token stored as a SHA-256 hash. Roles are re-read from the database on every request. |
| Retrieval | Question to search | The permission filter is part of the SQL query and built from the server-side request context, never from model output. |
| Database | Backend to PostgreSQL | The app connects as a role without `BYPASSRLS`; every tenant table has forced row-level security. The audit log is insert-only for that role. |
| Writes | Proposed document changes, access grants | The assistant has no write credentials. Changes are drafts until a human approves them on the Approvals page. |
| Model provider | Filtered text to Gemini | Personal data is masked at ingestion. Raw values are sent only when the user's role may see that data type and the question needs it. |

### Key design trade-offs

| Decision | Alternative we rejected | Reason |
|---|---|---|
| One high-level MCP tool (`ask_workplace_brain`) for WorkBuddy | Exposing raw search tools to WorkBuddy | WorkBuddy's own model would compose answers from raw chunks and bypass conflict resolution, the "I don't know" template and the validator. |
| Permission filter inside the search query | Filtering the top-k results afterwards | Post-filtering changes result counts and scores, which reveals that hidden items exist. |
| Code resolves conflicts | Asking the model to pick the right source | Rules give the same result every time and can be explained in one sentence. |
| Masked text stored next to raw text | Masking only in the final prompt | Search runs on masked text, so nobody can find a colleague's NIK by searching for it. |
| Small Gemini Flash models per step, with a hedged second model for the answer | One large model for everything | Keeps the 95th-percentile answer time at 15.7 seconds, well inside the 90-second test limit. |

### Prompt design

The prompts are short and each one has a single job; the behaviour that matters is enforced in code
around them.

- **Data is never instructions.** Questions, history and sources are wrapped in XML tags, and every
  prompt says that text inside them is data. Sources that contain instructions aimed at an AI are
  flagged at ingestion, and the answer tells the user that such an instruction was ignored.
- **The model extracts, code decides, the model explains.** The extraction prompt returns claims
  with exactly one citation each and treats a change announcement ("naik dari Rp500.000 menjadi
  Rp750.000") as a claim of the new value only. Conflict rules then run in code, and the answer
  prompt receives the decision plus a reason sentence written by code.
- **Answer first.** The answer prompt asks for the direct answer in one sentence, then a few cited
  bullets for conditions and exceptions, with examples taken from an invented company so that no
  real data can leak through the prompt.
- **Clarify instead of guessing.** A question with no subject ("Berapa batasnya?") gets a short
  clarifying question before any search.
- **Versioned.** The prompt version is stored on every audit row, so any answer can be traced to
  the prompts that produced it.

## Results

Measured against the live deployment on 25 October 2026. Details and failures are in
[TEST_RESULTS.md](./TEST_RESULTS.md); metric definitions in
[backend/eval/README.md](./backend/eval/README.md).

| Measure | Result |
|---|---|
| Restricted-data probes that leaked anything | 0 of 15 |
| Answers backed by retrieved, validated citations | 100% |
| Golden-set accuracy (all checks of a case pass) | 87.9% (51 of 58) |
| Correct source in the top 10 retrieved (Recall@10) | 96.3% |
| Answer time, median / 95th percentile | 9.0 s / 15.7 s |

The main open issue is over-caution: 4 of 38 answerable questions got "I don't know" although the
data exists (see TEST_RESULTS.md).

## Business value

- **Answers in seconds instead of a search across three tools.** A new hire gets the current
  allowance, the approver for a claim, or the status of a delayed shipment with the source attached,
  in a median of 9 seconds.
- **No accidental disclosure.** Salaries, personal data and confidential projects stay with the
  people allowed to see them, which matters for the data-protection impact assessments required
  under PP 33/2026 from January 2027.
- **Documents stay current.** When an announcement supersedes an SOP, Knowhaven answers with the new
  value and drafts the SOP update for the owner to approve, so the gap between chat and
  documentation closes.

## WorkBuddy

Each user creates a personal token under Settings, then in WorkBuddy adds a custom MCP connector
(Connectors, Custom connectors, Add MCP) and creates a "Knowhaven" expert from the prompt shown on
the same page. The connector exposes three read-only tools:

- `ask_workplace_brain`: runs the full pipeline and returns the validated answer with citations.
- `open_source`: opens a cited source after re-checking permissions; hidden and non-existent ids
  return the same "not found".
- `whoami`: shows the user, active company and roles.

A role change in the web app applies on the next WorkBuddy call, without a new token.

**What we learned:** giving a desktop agent raw search tools would have undone the permission and
validation guarantees, so WorkBuddy talks to Knowhaven only through the full pipeline. The backend
cannot clear answers that are already displayed in a user's WorkBuddy window; this is disclosed in
the accountability sheet.

<!-- TODO (team): add 2-3 sentences on how the team used WorkBuddy while building, from your own
experience, before submitting. Product sharing is a required submission item. -->

## Try it

The live demo link is in the submission form. Demo accounts:

| Account | Password | Role | Good for |
|---|---|---|---|
| dimas@srn-demo.id | Demo-SRN-2026! | New hire, Jakarta warehouse | Policies, conflicts, masked personal data, Proyek Kenari probe, access request |
| rina@srn-demo.id | Demo-SRN-2026! | Operations staff, Makassar | Chat, documents and Jira in one answer; no access to HR or finance data |
| sari@srn-demo.id | Demo-SRN-2026! | HR manager | Personal data when the task needs it; approving access requests and document drafts |
| bambang@srn-demo.id | Demo-SRN-2026! | CEO (owner, admin, auditor) | Proyek Kenari, audit log, mapping sources and roles |
| yoga@konsultan-demo.id | Demo-Konsultan-2026! | External consultant in both companies | Switching companies; no data crosses between them |

Questions to try: "Uang bensin per bulan berapa?", "Proyek Kenari itu apa?" (as Dimas, then as
Bambang), "Tabel grade gaji level 3 berapa?" (as Dimas, then request access and approve as Sari).

## Run locally

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run brain-seed                  # demo companies SRN and KLM
uv run brain                       # API on :8000
uv run brain-mcp --port 8001       # MCP server for WorkBuddy

cd ../frontend
npm ci && npm run dev              # web app on :3000
```

Or run everything (Caddy, web, API, MCP server, worker) with `docker compose up --build -d`.
Configuration is described in `.env.example`.

## Stack

| Layer | Technology |
|---|---|
| Web app | Next.js 16, React 19 |
| API and pipeline | FastAPI, SQLAlchemy (async), Agno |
| Database and search | PostgreSQL on Neon with pgvector, full-text search and pg_trgm; forced row-level security |
| File storage | Neon object storage (S3-compatible) for uploaded originals |
| Models | Gemini Flash models on Vertex AI (3.5 Flash-Lite, 3.6 Flash, 3.7 Flash) and Gemini embeddings |
| WorkBuddy | MCP server (streamable HTTP) with personal tokens |
| Integrations | Slack Events API and OAuth; Confluence and Jira synced by a worker every two minutes; uploads (PDF, DOCX, Markdown) and WhatsApp exports |
| Hosting | Docker Compose on Tencent Cloud Lighthouse, Caddy for HTTPS |
| Evaluation | `brain-eval` with a 58-question golden set |
