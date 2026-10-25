"""The company's own email domains (design doc 11.4): addresses on them are work contacts, not
personal data, so they are never masked.

Sources: active members' addresses, domains the admin declared on the tenant, and the contacts the
admin wrote (default contact, topic fallback contacts): those are work addresses by definition.
Free mail providers never count, even if a member signed up with one.
"""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.db.models import Membership, Tenant, TopicOwner, User

FREE_MAIL = frozenset({
    "gmail.com", "yahoo.com", "yahoo.co.id", "hotmail.com", "outlook.com", "live.com",
    "icloud.com", "ymail.com", "proton.me", "protonmail.com", "aol.com",
})  # fmt: skip
EMAIL_DOMAIN = re.compile(r"@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})")
DOMAIN = re.compile(r"^(?:[a-z0-9-]+\.)+[a-z]{2,}$")


def from_emails(emails) -> frozenset[str]:
    return frozenset(e.rsplit("@", 1)[1].lower() for e in emails if "@" in e) - FREE_MAIL


async def configured(s: AsyncSession) -> frozenset[str]:
    """Declared domains plus those in admin-written contacts (tenant-scoped session)."""
    tenant = await s.scalar(select(Tenant))
    contacts = [tenant.default_contact or "", *await s.scalars(select(TopicOwner.fallback_contact))]
    found = {m.group(1).lower() for c in contacts for m in EMAIL_DOMAIN.finditer(c)}
    return frozenset({*(d.lower() for d in tenant.email_domains or ()), *found}) - FREE_MAIL


async def for_tenant(s: AsyncSession) -> frozenset[str]:
    """Every company domain: active members' plus `configured` (tenant-scoped session)."""
    emails = await s.scalars(
        select(User.email)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.status == "active")
    )
    return from_emails(emails) | await configured(s)
