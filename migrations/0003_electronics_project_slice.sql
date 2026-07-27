-- Electronics Project Slice (TASK-ELECTRONICS-SLICE-001, Issue #33).
-- Project shell tables (project, mutable draft, immutable checkpoint) carrying
-- the subject document as JSONB. Tenant lineage, forced RLS and the restricted
-- runtime role follow the same rules as the classroom tables in 0002.

CREATE TABLE IF NOT EXISTS projects (
    id              uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    classroom_id    uuid NOT NULL,
    module_key      varchar(64)  NOT NULL CHECK (module_key = 'electronics'),
    title           varchar(255) NOT NULL,
    status          varchar(32)  NOT NULL DEFAULT 'active',
    created_by          uuid NOT NULL,
    idempotency_key     varchar(128),
    request_fingerprint varchar(64),
    created_at          timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by)   REFERENCES users (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_idempotency_idx
    ON projects (tenant_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS projects_classroom_idx ON projects (tenant_id, classroom_id, status);

-- Exactly one mutable draft per project; the subject document lives in JSONB.
CREATE TABLE IF NOT EXISTS project_drafts (
    project_id    uuid NOT NULL,
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    document_json jsonb NOT NULL,
    revision      integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid NOT NULL,
    PRIMARY KEY (project_id),
    UNIQUE (tenant_id, project_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, updated_by) REFERENCES users (tenant_id, id)
);

-- Immutable checkpoints: a numbered snapshot of the draft at a point in time.
CREATE TABLE IF NOT EXISTS project_versions (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    project_id    uuid NOT NULL,
    version_no    integer NOT NULL CHECK (version_no > 0),
    document_json jsonb NOT NULL,
    label         varchar(255),
    created_by    uuid NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, project_id, version_no),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS project_versions_project_idx
    ON project_versions (tenant_id, project_id, version_no DESC);

CREATE OR REPLACE FUNCTION project_versions_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'project_versions are immutable checkpoints';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_versions_no_update ON project_versions;
CREATE TRIGGER project_versions_no_update
    BEFORE UPDATE OR DELETE ON project_versions
    FOR EACH ROW EXECUTE FUNCTION project_versions_immutable();

-- ---------------------------------------------------------------------------
-- Runtime role access: same restricted model as 0002 — narrow grants only.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON projects, project_versions TO asalab_app;
GRANT SELECT, INSERT, UPDATE ON project_drafts TO asalab_app;

ALTER TABLE projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects         FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_drafts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_drafts   FORCE  ROW LEVEL SECURITY;
ALTER TABLE project_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_versions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_tenant ON projects;
CREATE POLICY projects_tenant ON projects
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS project_drafts_tenant ON project_drafts;
CREATE POLICY project_drafts_tenant ON project_drafts
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS project_versions_tenant ON project_versions;
CREATE POLICY project_versions_tenant ON project_versions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
