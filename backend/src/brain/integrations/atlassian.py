"""Atlassian Cloud (Confluence REST v2 + Jira REST v3) with one site URL + email + API token
(design doc 15.2, 15.3). Read-only except `update_page`, which only `hitl.executors` calls.

Confluence pages arrive as "storage" XHTML. They are turned into Markdown-ish text and then cut
into sections by the same parser as uploaded Markdown, so headings like "3. Uang Bensin" give the
same citation anchors (DOC-x#3) whether a page came from a seed file or from the live site.
"""

import html
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser

import httpx

from brain.ingestion.chunking import slugify
from brain.ingestion.connectors.documents import parse_markdown
from brain.ingestion.connectors.jira import issue_to_item
from brain.ingestion.types import IngestItem

TIMEOUT = httpx.Timeout(20.0, connect=10.0)
default_transport = None  # tests swap in an httpx.MockTransport
JIRA_FIELDS = ["summary", "description", "status", "assignee", "reporter", "priority", "duedate", "labels",
               "components", "created", "updated", "comment", "project"]  # fmt: skip


class AtlassianError(Exception):
    """A user-facing reason: bad_url | bad_credentials | no_permission | unreachable | api_error."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(reason)
        self.reason, self.detail = reason, detail


def normalize_site(url: str) -> str:
    """'acme', 'acme.atlassian.net', 'https://acme.atlassian.net/wiki/…' → https://acme.atlassian.net"""
    u = url.strip().lower()
    u = re.sub(r"^https?://", "", u).split("/")[0]
    if u and "." not in u:
        u += ".atlassian.net"
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*\.atlassian\.net", u):
        raise AtlassianError("bad_url", "expected https://<name>.atlassian.net")
    return f"https://{u}"


@dataclass
class Space:
    id: str
    key: str
    name: str
    homepage_id: str | None = None  # Atlassian's "Welcome to your new space" page: not knowledge


@dataclass
class Project:
    key: str
    name: str


class AtlassianClient:
    def __init__(
        self, site: str, email: str, token: str, transport: httpx.AsyncBaseTransport | None = None
    ):
        self.site = site
        self._http = httpx.AsyncClient(base_url=site, auth=(email, token), timeout=TIMEOUT, transport=transport or default_transport,
                                       headers={"Accept": "application/json"})  # fmt: skip

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self._http.aclose()

    async def _req(self, method: str, path: str, **kw) -> dict:
        try:
            r = await self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise AtlassianError("unreachable", type(e).__name__) from e
        if r.status_code == 401:
            raise AtlassianError("bad_credentials")
        if r.status_code == 403:
            raise AtlassianError("no_permission", path)
        if r.status_code == 404 and path.startswith(("/wiki", "/rest")):
            raise AtlassianError("not_found", path)
        if r.status_code >= 400:
            raise AtlassianError("api_error", f"{r.status_code} {r.text[:200]}")
        return r.json() if r.content else {}

    async def _paged_v2(self, path: str, params: dict) -> list[dict]:
        """Confluence v2 cursor paging: follow _links.next until it's gone."""
        out, url, p = [], path, dict(params)
        for _ in range(200):  # safety stop
            data = await self._req("GET", url, params=p)
            out += data.get("results", [])
            nxt = (data.get("_links") or {}).get("next")
            if not nxt:
                break
            url, p = nxt, None  # next already carries the cursor and the other params
        return out

    # --- checks ---------------------------------------------------------------------------

    async def check(self) -> dict:
        """Fails with a clear reason if the site, token or permissions are wrong."""
        me = await self._req("GET", "/rest/api/3/myself")
        await self._req("GET", "/wiki/api/v2/spaces", params={"limit": 1})
        return {
            "account": me.get("displayName") or me.get("emailAddress"),
            "account_id": me.get("accountId"),
        }

    # --- Confluence -----------------------------------------------------------------------

    async def spaces(self) -> list[Space]:
        rows = await self._paged_v2(
            "/wiki/api/v2/spaces", {"limit": 100, "type": "global", "status": "current"}
        )
        return [Space(str(r["id"]), r["key"], r.get("name") or r["key"], str(r["homepageId"]) if r.get("homepageId") else None)
                for r in rows]  # fmt: skip

    async def pages(self, space: Space) -> list[dict]:
        rows = await self._paged_v2(f"/wiki/api/v2/spaces/{space.id}/pages",
                                    {"limit": 100, "body-format": "storage", "status": "current"})  # fmt: skip
        return [p for p in rows if str(p.get("id")) != space.homepage_id]

    async def page(self, page_id: str) -> dict:
        return await self._req(
            "GET", f"/wiki/api/v2/pages/{page_id}", params={"body-format": "storage"}
        )

    async def create_page(self, space_id: str, title: str, storage: str) -> dict:
        return await self._req("POST", "/wiki/api/v2/pages", json={
            "spaceId": space_id, "status": "current", "title": title,
            "body": {"representation": "storage", "value": storage}})  # fmt: skip

    async def update_page(
        self, page_id: str, title: str, storage: str, next_version: int, message: str
    ) -> dict:
        """Only for APPROVED drafts. Confluence rejects a stale version (someone edited it) → re-draft."""
        return await self._req("PUT", f"/wiki/api/v2/pages/{page_id}", json={
            "id": page_id, "status": "current", "title": title,
            "body": {"representation": "storage", "value": storage},
            "version": {"number": next_version, "message": message}})  # fmt: skip

    # --- Jira -----------------------------------------------------------------------------

    async def projects(self) -> list[Project]:
        out, start = [], 0
        while True:
            data = await self._req(
                "GET", "/rest/api/3/project/search", params={"startAt": start, "maxResults": 50}
            )
            out += [Project(p["key"], p.get("name") or p["key"]) for p in data.get("values", [])]
            if data.get("isLast", True) or not data.get("values"):
                return out
            start += len(data["values"])

    async def search(self, jql: str) -> list[dict]:
        """POST /rest/api/3/search/jql (the old /search is removed); token paging."""
        out, token = [], None
        for _ in range(200):
            body = {"jql": jql, "fields": JIRA_FIELDS, "maxResults": 100}
            if token:
                body["nextPageToken"] = token
            data = await self._req("POST", "/rest/api/3/search/jql", json=body)
            out += data.get("issues", [])
            token = data.get("nextPageToken")
            if not token or data.get("isLast"):
                break
        return out

    async def create_issue(self, fields: dict) -> dict:
        return await self._req("POST", "/rest/api/3/issue", json={"fields": fields})

    async def transition_to(self, key: str, status_name: str) -> bool:
        data = await self._req("GET", f"/rest/api/3/issue/{key}/transitions")
        for t in data.get("transitions", []):
            if (t.get("to") or {}).get("name", "").lower() == status_name.lower() or t.get(
                "name", ""
            ).lower() == status_name.lower():
                await self._req(
                    "POST",
                    f"/rest/api/3/issue/{key}/transitions",
                    json={"transition": {"id": t["id"]}},
                )
                return True
        return False


# --- storage XHTML <-> Markdown ---------------------------------------------------------------


class _ToMarkdown(HTMLParser):
    BLOCK = {"p", "div", "br", "tr", "table", "ul", "ol", "blockquote", "pre"}
    # Macro plumbing, not content: parameters, attributes, attachments, and the rendered fallback
    # copy of ADF panels (the real content is in ac:adf-content, so the fallback would duplicate it).
    SKIP = {
        "ac:parameter",
        "ac:adf-attribute",
        "ac:adf-fallback",
        "ri:attachment",
        "ac:image",
        "ac:placeholder",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._skip = 0  # inside ac:parameter etc.
        self._cell = 0  # inside td/th: keep a table row on one line

    def handle_starttag(self, tag, attrs):
        if tag == "time" and not self._skip:
            # <time datetime="2026-03-01" />: the date is an attribute, not text
            self.out.append(dict(attrs).get("datetime") or "")
            return
        if tag in self.SKIP:
            self._skip += 1
        elif self._skip:
            return
        elif re.fullmatch(r"h[1-6]", tag):
            self.out.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag == "li":
            self.out.append("\n- ")
        elif tag in ("td", "th"):
            self._cell += 1
            self.out.append("| ")
        elif tag in self.BLOCK:
            self.out.append(" " if self._cell and tag != "tr" else "\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
        elif self._skip:
            return
        elif tag in ("td", "th"):
            self._cell = max(0, self._cell - 1)
            self.out.append(" ")
        elif tag == "tr":
            self.out.append("|\n")
        elif re.fullmatch(r"h[1-6]", tag) or tag in self.BLOCK:
            self.out.append(" " if self._cell else "\n")

    def handle_data(self, data):
        if not self._skip:
            self.out.append(data)


def storage_to_markdown(storage: str) -> str:
    p = _ToMarkdown()
    p.feed(storage or "")
    text = "".join(p.out)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def markdown_to_storage(md: str) -> str:
    """Enough for our seed pages: headings, paragraphs, bullet lists and pipe tables."""
    out, para, items, rows = [], [], [], []

    def flush():
        nonlocal para, items, rows
        if para:
            out.append("<p>" + "<br/>".join(html.escape(x) for x in para) + "</p>")
        if items:
            out.append("<ul>" + "".join(f"<li>{html.escape(x)}</li>" for x in items) + "</ul>")
        if rows:
            body = "".join("<tr>" + "".join(f"<td>{html.escape(c.strip())}</td>" for c in r.strip("|").split("|")) + "</tr>"
                           for r in rows if not re.fullmatch(r"\|?[\s:|-]+\|?", r))  # fmt: skip
            out.append(f"<table><tbody>{body}</tbody></table>")
        para, items, rows = [], [], []

    for line in md.splitlines():
        s = line.rstrip()
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            flush()
            out.append(f"<h{len(m.group(1))}>{html.escape(m.group(2))}</h{len(m.group(1))}>")
        elif s.startswith(("- ", "* ")):
            if para or rows:
                flush()
            items.append(s[2:])
        elif s.startswith("|"):
            if para or items:
                flush()
            rows.append(s)
        elif not s.strip():
            flush()
        else:
            if items or rows:
                flush()
            para.append(s.strip())
    flush()
    return "".join(out)


# --- remote objects -> IngestItems ----------------------------------------------------------


def _dt(value: str | None) -> datetime:
    if not value:
        return datetime.now(UTC)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# Header rows our pages use to state when a document takes effect. Policies are decided by their
# effective date, not by when someone last saved the page (the demo pages were all created on one
# day, which would otherwise make an old SOP look newer than a later HR announcement).
_EFFECTIVE = re.compile(
    r"\b(?:berlaku sejak|tanggal rapat|tanggal charter|tanggal berlaku|effective(?: date| from)?)[\s|:]*(\d{4}-\d{2}-\d{2})",
    re.I,
)


def effective_date(markdown: str) -> datetime | None:
    m = _EFFECTIVE.search(markdown)
    return datetime.fromisoformat(m.group(1) + "T00:00:00+07:00") if m else None


def page_to_item(page: dict, space: Space, site: str) -> IngestItem:
    storage = ((page.get("body") or {}).get("storage") or {}).get("value", "")
    markdown = storage_to_markdown(storage)
    md_title, sections = parse_markdown(markdown)
    title = page.get("title") or md_title or page["id"]
    version = page.get("version") or {}
    webui = (page.get("_links") or {}).get("webui")
    return IngestItem(
        source="confluence",
        container_external_id=space.key,
        container_name=space.name,
        external_ref=str(page["id"]),
        type="doc",
        text="",
        sections=sections,
        title=title,
        id_hint=slugify(title),
        version=int(version.get("number") or 1),
        created_at=min(
            _dt(page.get("createdAt")), effective_date(markdown) or _dt(page.get("createdAt"))
        ),
        updated_at=effective_date(markdown)
        or _dt(version.get("createdAt") or page.get("createdAt")),
        url=f"{site}/wiki{webui}" if webui else None,
    )


def issue_item(issue: dict, site: str) -> IngestItem:
    item = issue_to_item(issue, site)
    # Demo issues are all created by one team account; the person responsible is kept as a
    # "pic-<name>" label so task questions ("tiket Rina") still work.
    pic = next(
        (lbl[4:].replace("-", " ").title() for lbl in item.labels if lbl.startswith("pic-")), None
    )
    if pic and item.structured is not None and not item.structured.get("assignee"):
        item.structured["assignee"] = pic
    return item
