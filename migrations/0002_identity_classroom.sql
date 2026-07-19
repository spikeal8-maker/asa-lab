-- First user vertical slice (TASK-TEN-001): tenants, schools, teacher users,
-- server-side sessions, classrooms and an immutable audit log.
-- Every tenant-owned table carries tenant_id; child rows reference parents via
-- composite (tenant_id, id) foreign keys so cross-tenant links are impossible.

CREATE TABLE IF NOT EXISTS tenants (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title       varchar(255) NOT NULL,
    status      varchar(32)  NOT NULL DEFAULT 'active',
    created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schools (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    title       varchar(255) NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS users (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    school_id     uuid,
    role          varchar(32)  NOT NULL CHECK (role IN ('teacher', 'admin')),
    email         varchar(255) NOT NULL,
    display_name  varchar(255) NOT NULL,
    password_hash text         NOT NULL,
    status        varchar(32)  NOT NULL DEFAULT 'active',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, email),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    user_id     uuid NOT NULL,
    token_hash  varchar(128) NOT NULL UNIQUE,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    expires_at  timestamptz  NOT NULL,
    revoked_at  timestamptz,
    PRIMARY KEY (id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (tenant_id, user_id);

CREATE TABLE IF NOT EXISTS classrooms (
    id          uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    school_id   uuid NOT NULL,
    teacher_id  uuid NOT NULL,
    title       varchar(255) NOT NULL,
    status      varchar(32)  NOT NULL DEFAULT 'active',
    created_at  timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, school_id)  REFERENCES schools (tenant_id, id),
    FOREIGN KEY (tenant_id, teacher_id) REFERENCES users   (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS classrooms_teacher_idx ON classrooms (tenant_id, teacher_id);

CREATE TABLE IF NOT EXISTS audit_events (
    id             bigserial PRIMARY KEY,
    tenant_id      uuid NOT NULL REFERENCES tenants(id),
    actor_user_id  uuid,
    entity_type    varchar(64)  NOT NULL,
    entity_id      uuid,
    action         varchar(128) NOT NULL,
    payload_json   jsonb,
    created_at     timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events (tenant_id, created_at);

-- Audit events are immutable: any UPDATE or DELETE is rejected at the database.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
