-- A5-B: classify only a Project the viewer may read. The mutation policy is
-- the single source of truth for durable canonical and legacy provenance.
CREATE FUNCTION public.learning_personal_project_is_learning(
    p_viewer_principal_id uuid, p_project_id uuid
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.projects project
       WHERE project.id = p_project_id
         AND project.project_scope = 'personal'
         AND EXISTS (
           SELECT 1 FROM public.project_context_for_principal(
             p_viewer_principal_id, p_project_id))
         AND (project.owner_principal_id = p_viewer_principal_id
              OR public.learning_linked_project_access(
                p_viewer_principal_id, p_project_id))
         AND NOT public.learning_original_project_action_allowed(
           p_project_id, 'generic_status')
    );
$$;

REVOKE ALL ON FUNCTION public.learning_personal_project_is_learning(uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_personal_project_is_learning(uuid,uuid)
    TO asalab_app;

-- Keep one marker query per paginated list. A legacy origin survives teacher
-- takeback of the old assignment-work row and still protects its Project.
CREATE OR REPLACE FUNCTION public.learning_personal_project_origin_ids(
    p_viewer_principal_id uuid, p_project_ids uuid[]
)
RETURNS TABLE (project_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT candidate.id
      FROM unnest(p_project_ids) AS candidate(id)
     WHERE public.learning_personal_project_is_learning(
       p_viewer_principal_id, candidate.id);
$$;

REVOKE ALL ON FUNCTION public.learning_personal_project_origin_ids(uuid,uuid[])
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_personal_project_origin_ids(uuid,uuid[])
    TO asalab_app;
