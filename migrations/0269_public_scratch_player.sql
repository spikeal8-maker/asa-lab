-- Publication-scoped Scratch reads. Internal identity never becomes a player claim.
CREATE FUNCTION public.public_scratch_player_source(p_publication uuid, p_revision uuid)
RETURNS TABLE(document_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT version.document_json
 FROM public.project_publication_state state
 JOIN public.project_publication_revisions revision
   ON revision.id=state.current_revision_id AND revision.id=p_revision
  AND revision.publication_id=state.id AND revision.project_id=state.project_id
  AND revision.tenant_id=state.tenant_id
 JOIN public.project_versions version
   ON version.id=revision.project_version_id AND version.project_id=state.project_id
  AND version.tenant_id=state.tenant_id
 WHERE state.id=p_publication AND revision.schema_version=2 AND revision.module_key='blocks'
   AND octet_length(version.document_json::text)<=16777216
   AND public.project_publication_readable(state.id)
$$;
REVOKE ALL ON FUNCTION public.public_scratch_player_source(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_scratch_player_source(uuid,uuid) TO asalab_app;

CREATE FUNCTION public.public_scratch_player_asset(p_publication uuid,p_revision uuid,p_asset text,p_format text)
RETURNS TABLE(tenant_id uuid,asset_id varchar,data_format varchar,sha256 varchar,size_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT state.tenant_id,alias.asset_id,alias.data_format,alias.sha256,blob.size_bytes
 FROM public.project_publication_state state
 JOIN public.project_publication_revisions revision
   ON revision.id=state.current_revision_id AND revision.id=p_revision
  AND revision.publication_id=state.id AND revision.project_id=state.project_id
  AND revision.tenant_id=state.tenant_id
 JOIN public.project_versions version
   ON version.id=revision.project_version_id AND version.project_id=state.project_id
  AND version.tenant_id=state.tenant_id
 JOIN public.blocks_asset_aliases alias
   ON alias.tenant_id=state.tenant_id AND alias.asset_id=p_asset AND alias.data_format=p_format
 JOIN public.blocks_blobs blob
   ON blob.tenant_id=alias.tenant_id AND blob.sha256=alias.sha256 AND blob.data_format=alias.data_format
 WHERE state.id=p_publication AND revision.schema_version=2 AND revision.module_key='blocks'
   AND public.project_publication_readable(state.id)
   AND jsonb_typeof(version.document_json->'assets')='array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(version.document_json->'assets') ref
     WHERE ref->>'assetId'=alias.asset_id AND ref->>'dataFormat'=alias.data_format
       AND ref->>'sha256'=alias.sha256 AND ref->>'sizeBytes'=blob.size_bytes::text
   )
   AND blob.object_key='tenants/'||state.tenant_id::text||'/blocks/assets/'||
       left(blob.sha256,2)||'/'||blob.sha256||'.'||blob.data_format
$$;
REVOKE ALL ON FUNCTION public.public_scratch_player_asset(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_scratch_player_asset(uuid,uuid,text,text) TO asalab_app;
