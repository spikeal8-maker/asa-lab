-- R3B Project lifecycle: explicit archive and recoverable trash states.
-- ProjectVersion and drafts remain intact; this migration never deletes user work.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM projects WHERE status NOT IN ('active', 'archived', 'trashed')
  ) THEN
    RAISE EXCEPTION 'projects contains an unsupported lifecycle status';
  END IF;
END;
$$;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('active', 'archived', 'trashed'));

CREATE INDEX IF NOT EXISTS projects_owner_status_activity_idx
  ON projects (tenant_id, owner_principal_id, status, created_at DESC)
  WHERE owner_principal_id IS NOT NULL;

-- Personal Workspace actors do not carry a legacy user_id. Their narrowly
-- scoped SECURITY DEFINER lookup must therefore resolve projects in every
-- recoverable lifecycle state, not only active projects. Ownership remains
-- bound to the server-derived principal and classroom projects stay excluded.
CREATE OR REPLACE FUNCTION project_tenant_for_principal(
    p_principal_id uuid,
    p_project_id uuid
)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.tenant_id
      FROM public.projects p
     WHERE p.id = p_project_id
       AND p.project_scope = 'personal'
       AND p.owner_principal_id = p_principal_id
       AND p.status IN ('active', 'archived', 'trashed')
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION project_tenant_for_principal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_tenant_for_principal(uuid, uuid) TO asalab_app;

REVOKE UPDATE ON TABLE projects FROM asalab_app;
GRANT UPDATE (title, status) ON TABLE projects TO asalab_app;
