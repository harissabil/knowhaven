"""Jira issues → IngestItems. Accepts the Jira Cloud REST v3 issue shape (from the search API or
a JSON export file, fallback 24.1 #1). Descriptions/comments may be ADF documents or strings."""

from datetime import datetime

from brain.ingestion.types import IngestItem


def adf_to_text(node) -> str:
    """Atlassian Document Format → plain text (paragraph/list structure kept as newlines)."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if node.get("type") == "text":
        return node.get("text", "")
    if node.get("type") == "hardBreak":
        return "\n"
    inner = "".join(adf_to_text(c) for c in node.get("content", []))
    if node.get("type") in ("paragraph", "heading", "listItem", "blockquote", "codeBlock"):
        return inner.strip() + "\n"
    return inner


def _dt(value: str | None) -> datetime | None:
    if not value:
        return None
    # Jira: 2026-10-01T09:12:00.000+0700
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%f%z")


def issue_to_item(issue: dict, site_url: str | None = None) -> IngestItem:
    f = issue["fields"]
    project = f["project"]
    assignee = f.get("assignee") or {}
    reporter = f.get("reporter") or {}
    comments = (f.get("comment") or {}).get("comments", [])
    created, updated = _dt(f.get("created")), _dt(f.get("updated"))
    description = adf_to_text(f.get("description")).strip()
    comment_text = "\n".join(
        f"- {(c.get('author') or {}).get('displayName', '?')}: {adf_to_text(c.get('body')).strip()}"
        for c in comments
    )
    text = "\n\n".join(
        p
        for p in [f.get("summary", ""), description, comment_text and "Komentar:\n" + comment_text]
        if p
    )
    status = f.get("status") or {}
    return IngestItem(
        source="jira",
        container_external_id=project["key"],
        container_name=project.get("name", project["key"]),
        external_ref=issue["key"],
        type="task",
        text=text,
        created_at=created,
        updated_at=updated or created,
        version=int(updated.timestamp()) if updated else 1,
        title=f"{issue['key']}: {f.get('summary', '')}",
        url=f"{site_url.rstrip('/')}/browse/{issue['key']}" if site_url else None,
        author_external_id=reporter.get("emailAddress") or reporter.get("accountId"),
        author_display=reporter.get("displayName"),
        id_hint=issue["key"],
        labels=list(f.get("labels") or []),
        structured={
            "key": issue["key"],
            "project": project["key"],
            "summary": f.get("summary"),
            "status": status.get("name"),
            "status_category": (status.get("statusCategory") or {}).get(
                "key"
            ),  # new|indeterminate|done
            "assignee": assignee.get("displayName"),
            "assignee_email": assignee.get("emailAddress"),
            "priority": (f.get("priority") or {}).get("name"),
            "due": f.get("duedate"),
            "labels": list(f.get("labels") or []),
            "components": [c.get("name") for c in f.get("components") or []],
            "updated": f.get("updated"),
        },
    )


def issues_to_items(data: dict | list, site_url: str | None = None) -> list[IngestItem]:
    issues = data.get("issues", []) if isinstance(data, dict) else data
    return [issue_to_item(i, site_url) for i in issues]
