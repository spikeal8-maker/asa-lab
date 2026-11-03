-- Resolve the private source only for its active owner. Never add it to public DTOs.
CREATE FUNCTION public.project_publication_owner_editor(p_principal_id uuid, p_publication_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('projectId', project.id, 'moduleKey', project.module_key)
    FROM public.project_publications publication
    JOIN public.projects project ON project.id = publication.project_id
      AND project.tenant_id = publication.tenant_id
   WHERE publication.id = p_publication_id
     AND publication.owner_principal_id = p_principal_id
     AND project.owner_principal_id = p_principal_id
     AND project.status = 'active'
     AND public.project_publication_status(p_principal_id, project.id) IS NOT NULL
     AND NOT public.project_editor_has_immutable_learning_origin(project.id)
$$;
REVOKE ALL ON FUNCTION public.project_publication_owner_editor(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_publication_owner_editor(uuid,uuid) TO asalab_app;
