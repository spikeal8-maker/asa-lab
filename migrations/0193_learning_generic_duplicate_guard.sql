-- A5-A2: generic Project duplicate uses the same immutable-origin policy as
-- status and Gallery. The caller first locks and authorizes the source Project;
-- this narrow accessor keeps origin tables and the internal policy unavailable
-- to the application role and returns no provenance for an unrelated principal.
CREATE OR REPLACE FUNCTION public.learning_original_project_action_allowed(
    p_project_id uuid, p_action text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_action IN ('generic_status', 'gallery_publish', 'generic_duplicate') THEN
        RETURN NOT EXISTS (
            SELECT 1 FROM public.learning_project_origins origin
             WHERE origin.project_id = p_project_id
        ) AND NOT EXISTS (
            SELECT 1 FROM public.learning_legacy_project_origins origin
             WHERE origin.project_id = p_project_id
        ) AND NOT EXISTS (
            SELECT 1 FROM public.classroom_assignment_work work
             WHERE work.project_id = p_project_id
        );
    ELSIF p_action = 'attach_learning' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.projects project
             WHERE project.id = p_project_id AND project.status = 'active'
        ) AND NOT EXISTS (
            SELECT 1 FROM public.project_publication_state publication
             WHERE publication.project_id = p_project_id
               AND publication.state IN ('public', 'unlisted')
        ) AND NOT EXISTS (
            SELECT 1 FROM public.project_publications publication
             WHERE publication.project_id = p_project_id
        );
    END IF;
    RETURN false;
END;
$$;

CREATE FUNCTION public.learning_original_project_duplicate_allowed(
    p_actor_principal_id uuid, p_project_id uuid
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.project_context_for_principal(
        p_actor_principal_id, p_project_id)
    ) AND public.learning_original_project_action_allowed(
      p_project_id, 'generic_duplicate');
$$;

REVOKE ALL ON FUNCTION public.learning_original_project_duplicate_allowed(uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_original_project_duplicate_allowed(uuid,uuid)
    TO asalab_app;
