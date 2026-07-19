-- Teacher Portal v0.1 (TASK-PORTAL-001, Issue #18).
-- Identity + organization + classroom schema with composite tenant lineage,
-- append-only audit, RLS defense-in-depth and a dedicated runtime role that
-- owns nothing, has no BYPASSRLS and no broad table grants: identity access
-- goes through narrow, reviewable auth_* functions only.
--
-- Threat model note: GUC-scoped RLS and the restricted role limit the blast
-- radius of application bugs (missing predicates, confused-deputy requests).
-- They are NOT claimed to protect against a full compromise of the runtime
-- database credentials together with arbitrary SQL execution.

CREATE TABLE IF NOT EXISTS tenants (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_slug varchar(64)  NOT NULL UNIQUE,
    title          varchar(255) NOT NULL,
    status         varchar(32)  NOT NULL DEFAULT 'active',
    created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_placements (
    tenant_id  uuid PRIMARY KEY REFERENCES tenants(id),
    mode       varchar(32) NOT NULL DEFAULT 'SHARED_CLUSTER'
               CHECK (mode IN ('SHARED_CLUSTER', 'DEDICATED_DATABASE', 'DEDICATED_REGION', 'ON_PREMISE')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schools (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants(id),
    title      varchar(255) NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS academic_periods (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants(id),
    school_id  uuid NOT NULL,
    title      varchar(255) NOT NULL,
    starts_on  date NOT NULL,
    ends_on    date NOT NULL,
    is_active  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS academic_periods_one_active_idx
    ON academic_periods (tenant_id, school_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS users (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    school_id     uuid,
    role          varchar(32)  NOT NULL CHECK (role = 'teacher'),
    email         varchar(255) NOT NULL,
    display_name  varchar(255) NOT NULL,
    password_hash text         NOT NULL,
    status        varchar(32)  NOT NULL DEFAULT 'active',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_ci_idx ON users (tenant_id, lower(email));

CREATE TABLE IF NOT EXISTS sessions (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants(id),
    user_id    uuid NOT NULL,
    token_hash varchar(128) NOT NULL UNIQUE,
    created_at timestamptz  NOT NULL DEFAULT now(),
    expires_at timestamptz  NOT NULL,
    revoked_at timestamptz,
    PRIMARY KEY (id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS classrooms (
    id                  uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    school_id           uuid NOT NULL,
    academic_period_id  uuid NOT NULL,
    title               varchar(255) NOT NULL,
    status              varchar(32)  NOT NULL DEFAULT 'active',
    created_by          uuid NOT NULL,
    idempotency_key     varchar(128),
    request_fingerprint varchar(64),
    created_at          timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, school_id)          REFERENCES schools (tenant_id, id),
    FOREIGN KEY (tenant_id, academic_period_id) REFERENCES academic_periods (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by)         REFERENCES users (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS classrooms_idempotency_idx
    ON classrooms (tenant_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS classrooms_teacher_idx ON classrooms (tenant_id, created_by, status);

CREATE TABLE IF NOT EXISTS classroom_memberships (
    id           uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    classroom_id uuid NOT NULL,
    user_id      uuid NOT NULL,
    member_role  varchar(32) NOT NULL CHECK (member_role = 'owner'),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, classroom_id, user_id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, user_id)      REFERENCES users (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id            bigserial PRIMARY KEY,
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    actor_user_id uuid,
    entity_type   varchar(64)  NOT NULL,
    entity_id     uuid,
    action        varchar(128) NOT NULL,
    payload_json  jsonb,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events (tenant_id, created_at);

CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- ---------------------------------------------------------------------------
-- Runtime role: owns nothing, NOSUPERUSER, NOBYPASSRLS. It has NO direct
-- access to tenants/users/sessions; identity flows go through the narrow
-- auth_* functions below. Tenant-scoped data access is limited to classroom
-- tables plus read-only organization lookups, all under forced RLS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asalab_app') THEN
        CREATE ROLE asalab_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO asalab_app;
REVOKE ALL ON tenants, tenant_placements, users, sessions FROM asalab_app;
GRANT SELECT ON schools, academic_periods TO asalab_app;
GRANT SELECT, INSERT ON classrooms, classroom_memberships, audit_events TO asalab_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO asalab_app;

-- Forced RLS with a verified-session tenant context (SET LOCAL app.tenant_id,
-- transaction-scoped, applied only by server middleware after session
-- validation; client-supplied tenant identifiers are never used).
ALTER TABLE classrooms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE classrooms            FORCE  ROW LEVEL SECURITY;
ALTER TABLE classroom_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_memberships FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events          FORCE  ROW LEVEL SECURITY;
ALTER TABLE schools               ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools               FORCE  ROW LEVEL SECURITY;
ALTER TABLE academic_periods      ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_periods      FORCE  ROW LEVEL SECURITY;
-- users/sessions: the runtime role has no table grants at all; RLS is enabled
-- (not forced) so the owner-executed auth_* functions below keep working while
-- any accidentally granted non-owner access would still be tenant-scoped.
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classrooms_tenant ON classrooms;
CREATE POLICY classrooms_tenant ON classrooms
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS memberships_tenant ON classroom_memberships;
CREATE POLICY memberships_tenant ON classroom_memberships
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS audit_tenant ON audit_events;
CREATE POLICY audit_tenant ON audit_events
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS schools_tenant ON schools;
CREATE POLICY schools_tenant ON schools
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS academic_periods_tenant ON academic_periods;
CREATE POLICY academic_periods_tenant ON academic_periods
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS users_tenant ON users;
CREATE POLICY users_tenant ON users
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS sessions_tenant ON sessions;
CREATE POLICY sessions_tenant ON sessions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Narrow identity access paths (SECURITY DEFINER, owner-executed, fixed
-- search_path). These are the ONLY identity operations available to the
-- runtime role: tenant slug locator, teacher lookup for password verification,
-- session create/resolve/revoke. The workspace slug acts purely as a locator;
-- the authorization tenant context always comes from the stored session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_lookup_tenant_id(p_slug varchar)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id FROM tenants WHERE workspace_slug = p_slug AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION auth_find_active_teacher(p_tenant_id uuid, p_email_lower varchar)
RETURNS TABLE (
    id uuid,
    email varchar,
    display_name varchar,
    school_id uuid,
    password_hash text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT u.id, u.email, u.display_name, u.school_id, u.password_hash
      FROM users u
     WHERE u.tenant_id = p_tenant_id
       AND lower(u.email) = p_email_lower
       AND u.role = 'teacher'
       AND u.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_create_session(
    p_tenant_id uuid,
    p_user_id uuid,
    p_token_hash varchar,
    p_ttl_hours int
)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
    VALUES (p_tenant_id, p_user_id, p_token_hash, now() + make_interval(hours => p_ttl_hours));
$$;

CREATE OR REPLACE FUNCTION auth_resolve_session(p_token_hash varchar)
RETURNS TABLE (
    tenant_id uuid,
    user_id uuid,
    email varchar,
    display_name varchar,
    school_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT s.tenant_id, s.user_id, u.email, u.display_name, u.school_id
      FROM sessions s
      JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.user_id
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND u.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_revoke_session(p_token_hash varchar)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
    UPDATE sessions SET revoked_at = now()
     WHERE token_hash = p_token_hash AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION auth_lookup_tenant_id(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_active_teacher(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_create_session(uuid, uuid, varchar, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_resolve_session(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_revoke_session(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_tenant_id(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_find_active_teacher(uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_create_session(uuid, uuid, varchar, int) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_resolve_session(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_revoke_session(varchar) TO asalab_app;
