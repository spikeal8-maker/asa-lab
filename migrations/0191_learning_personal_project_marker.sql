-- A personal Project list page may label immutable Learning origins without
-- reading work details or granting the runtime role access to the origin table.
-- Materializing candidates means the authorization checks run only for the
-- (usually few) origin Projects in the requested page, not every Project card.
CREATE FUNCTION public.learning_personal_project_origin_ids(
    p_viewer_principal_id uuid, p_project_ids uuid[]
)
RETURNS TABLE (project_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH candidates AS MATERIALIZED (
      SELECT origin.project_id, origin.owner_principal_id
        FROM public.learning_project_origins origin
        JOIN public.projects project
          ON project.id = origin.project_id
         AND project.tenant_id = origin.project_tenant_id
         AND project.owner_principal_id = origin.owner_principal_id
         AND project.project_scope = 'personal'
       WHERE origin.project_id = ANY(p_project_ids)
    )
    SELECT candidate.project_id
      FROM candidates candidate
     WHERE EXISTS (
       SELECT 1 FROM public.project_context_for_principal(
           p_viewer_principal_id, candidate.project_id))
       AND (candidate.owner_principal_id = p_viewer_principal_id
            OR public.learning_linked_project_access(
                p_viewer_principal_id, candidate.project_id));
$$;

REVOKE ALL ON FUNCTION public.learning_personal_project_origin_ids(uuid,uuid[])
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_personal_project_origin_ids(uuid,uuid[])
    TO asalab_app;
