-- Anonymous and Seat viewing use the same canonical current-public predicate.
-- No license gate: this function authorizes inert display, never copy/export.
CREATE FUNCTION public.public_project_artifact_document(p_publication uuid, p_revision uuid)
RETURNS TABLE(publication_id uuid, revision_id uuid, revision_no integer, module_key varchar, document_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT state.id, revision.id, revision.revision_no, revision.module_key,
        CASE WHEN octet_length(version.document_json::text) <= 1048576 THEN version.document_json ELSE NULL END
 FROM public.project_publication_state state
 JOIN public.project_publication_revisions revision
   ON revision.id = state.current_revision_id AND revision.id = p_revision
  AND revision.publication_id = state.id AND revision.project_id = state.project_id
  AND revision.tenant_id = state.tenant_id
 JOIN public.project_versions version
   ON version.id = revision.project_version_id AND version.project_id = state.project_id
  AND version.tenant_id = state.tenant_id
 WHERE state.id = p_publication AND revision.schema_version = 2
   AND public.project_publication_readable(state.id)
$$;
REVOKE ALL ON FUNCTION public.public_project_artifact_document(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_project_artifact_document(uuid,uuid) TO asalab_app;
