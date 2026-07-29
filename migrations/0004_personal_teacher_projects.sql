-- Personal teacher projects for the Tinkercad-style workbench.
-- Existing classroom projects remain unchanged; a teacher can now create a
-- project outside a classroom for demonstrations, experiments and preparation.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_scope varchar(16) NOT NULL DEFAULT 'classroom';

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_project_scope_check;
ALTER TABLE projects ADD CONSTRAINT projects_project_scope_check CHECK (project_scope IN ('personal', 'classroom'));
ALTER TABLE projects ALTER COLUMN classroom_id DROP NOT NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_scope_classroom_check;
ALTER TABLE projects ADD CONSTRAINT projects_scope_classroom_check CHECK ((project_scope = 'personal' AND classroom_id IS NULL) OR (project_scope = 'classroom' AND classroom_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS projects_teacher_personal_idx
  ON projects (tenant_id, created_by, created_at DESC)
  WHERE project_scope = 'personal' AND status = 'active';
CREATE INDEX IF NOT EXISTS projects_teacher_scope_idx
  ON projects (tenant_id, created_by, project_scope, status, created_at DESC);

-- The workbench may rename a project, but the runtime role must not be able to
-- rewrite ownership, tenant lineage, classroom/scope, module identity,
-- idempotency metadata or timestamps through direct SQL. Revoke any inherited
-- table-level UPDATE grant before issuing the single required column grant.
REVOKE UPDATE ON projects FROM asalab_app;
GRANT UPDATE (title) ON projects TO asalab_app;
