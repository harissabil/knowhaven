"""rls policies and pre-tenant lookup functions

Design doc 6.2: every tenant table gets ENABLE + FORCE row level security and a
tenant_isolation policy keyed on the transaction-local setting app.tenant_id.
The runtime role brain_app (NOBYPASSRLS) is always subject to these policies.

Some lookups must happen before a tenant is known (invite links, join codes, MCP
tokens, Slack team_id, "my companies"). They go through narrow SECURITY DEFINER
functions owned by the migration role (neondb_owner has BYPASSRLS). Each one looks
up by an exact hash/ID only and returns minimal columns. If the owner ever lacks
BYPASSRLS these functions return nothing (fail closed).

Revision ID: c4fdb4b4ac66
Revises: b0089691e8b1
Create Date: 2026-10-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c4fdb4b4ac66"
down_revision: str | None = "b0089691e8b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "brain_app"

# Frozen list (do not derive from models: migrations must not change after the fact).
TENANT_TABLES = [
    "access_requests",
    "action_drafts",
    "audit_log",
    "chunks",
    "container_acl",
    "containers",
    "conversations",
    "ingestion_events",
    "integrations",
    "invites",
    "item_acl_override",
    "managers",
    "mcp_tokens",
    "member_profiles",
    "memberships",
    "messages",
    "permission_state",
    "pii_permissions",
    "roles",
    "source_items",
    "temp_grants",
    "topic_owners",
    "trace_events",
    "user_roles",
]
APPEND_ONLY_TABLES = ["audit_log", "trace_events"]

LOOKUP_FUNCTIONS = {
    "list_my_memberships(uuid)": """
CREATE FUNCTION list_my_memberships(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, tenant_name text, tenant_slug text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.tenant_id, t.name, t.slug, m.status
  FROM memberships m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id AND m.status <> 'removed' AND t.status = 'active'
  ORDER BY t.name
$$""",
    "resolve_invite(text)": """
CREATE FUNCTION resolve_invite(p_token_hash text)
RETURNS TABLE (invite_id uuid, tenant_id uuid, tenant_name text, default_role_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.id, i.tenant_id, t.name, i.default_role_id
  FROM invites i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = p_token_hash
    AND i.revoked_at IS NULL AND i.expires_at > now() AND i.used_count < i.max_uses
    AND t.status = 'active'
$$""",
    "resolve_join_code(text)": """
CREATE FUNCTION resolve_join_code(p_code_hash text)
RETURNS TABLE (tenant_id uuid, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.name FROM tenants t
  WHERE t.join_code_hash = p_code_hash AND t.status = 'active'
$$""",
    "resolve_mcp_token(text)": """
CREATE FUNCTION resolve_mcp_token(p_token_hash text)
RETURNS TABLE (token_id uuid, tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.id, k.tenant_id, k.user_id
  FROM mcp_tokens k
  JOIN memberships m ON m.tenant_id = k.tenant_id AND m.user_id = k.user_id
  JOIN tenants t ON t.id = k.tenant_id
  WHERE k.token_hash = p_token_hash AND k.revoked_at IS NULL
    AND m.status = 'active' AND t.status = 'active'
$$""",
    "resolve_integration(text, text)": """
CREATE FUNCTION resolve_integration(p_type text, p_external_id text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.tenant_id FROM integrations i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.type = p_type AND i.external_workspace_id = p_external_id
    AND i.status <> 'disconnected' AND t.status = 'active'
$$""",
}


def upgrade() -> None:
    op.execute(
        """
CREATE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$"""
    )

    # Explicit grants (bootstrap default privileges also cover these; this keeps migrations
    # correct on a fresh database).
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}")
    op.execute(f"REVOKE ALL ON alembic_version FROM {APP_ROLE}")

    op.execute("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenants FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON tenants "
        "USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant())"
    )
    for table in TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            "USING (tenant_id = app_current_tenant()) "
            "WITH CHECK (tenant_id = app_current_tenant())"
        )

    for table in APPEND_ONLY_TABLES:
        op.execute(f"REVOKE UPDATE, DELETE, TRUNCATE ON {table} FROM {APP_ROLE}")

    for signature, ddl in LOOKUP_FUNCTIONS.items():
        op.execute(ddl)
        op.execute(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {signature} TO {APP_ROLE}")


def downgrade() -> None:
    for signature in LOOKUP_FUNCTIONS:
        op.execute(f"DROP FUNCTION IF EXISTS {signature}")
    for table in APPEND_ONLY_TABLES:
        op.execute(f"GRANT UPDATE, DELETE ON {table} TO {APP_ROLE}")
    for table in [*TENANT_TABLES, "tenants"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.execute("DROP FUNCTION IF EXISTS app_current_tenant()")
