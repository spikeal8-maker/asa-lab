-- Teacher Portal v0.1 (TASK-MVP-001, Issue #18).
-- Identity + organization + classroom schema with composite tenant lineage,
-- append-only audit, forced RLS on classroom/membership/audit tables and a
-- dedicated runtime role that owns nothing and has no BYPASSRLS.

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
               CHECK (mode IN ('SHARED_CLUSTER', 'DEDICATED_DATABASE', 'DEDICATED_DEPLOYMENT', 'ON_PREMISE')),
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
    id                 uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    school_id          uuid NOT NULL,
    academic_period_id uuid NOT NULL,
    title              varchar(255) NOT NULL,
    status             varchar(32)  NOT NULL DEFAULT 'active',
    created_by         uuid NOT NULL,
    idempotency_key    varchar(128),
    created_at         timestamptz  NOT NULL DEFAULT now(),
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
-- Runtime role: owns nothing, no BYPASSRLS; RLS is FORCED on critical tables.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'asalab_app') THEN
        CREATE ROLE asalab_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO asalab_app;
GRANT SELECT ON tenants, tenant_placements, schools, academic_periods, users TO asalab_app;
GRANT SELECT, INSERT, UPDATE ON sessions TO asalab_app;
GRANT SELECT, INSERT ON classrooms, classroom_memberships, audit_events TO asalab_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO asalab_app;

ALTER TABLE classrooms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE classrooms            FORCE  ROW LEVEL SECURITY;
ALTER TABLE classroom_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_memberships FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events          FORCE  ROW LEVEL SECURITY;

-- The tenant context is set only by verified middleware via
-- SET LOCAL app.tenant_id inside a transaction, so it clears automatically
-- before the connection returns to the pool.
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
