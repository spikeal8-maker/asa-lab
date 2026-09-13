-- E1 Preview-as-Learner: exact authored source, read-only, no learner runtime.
CREATE OR REPLACE FUNCTION public.learning_activity_preview_as_author(
  p_principal_id uuid,
  p_tenant_id uuid,
  p_activity_id uuid,
  p_source_kind varchar,
  p_source_id uuid,
  p_expected_draft_revision integer
)
RETURNS TABLE (
  result_code varchar,
  activity_id uuid,
  source_kind varchar,
  source_id uuid,
  draft_revision integer,
  version_number integer,
  title varchar,
  instructions varchar,
  module_key varchar,
  result_mode varchar,
  max_points integer,
  policy_snapshot jsonb,
  content_digest varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_activity public.learning_activities%ROWTYPE;
  v_version public.learning_activity_versions%ROWTYPE;
BEGIN
  SELECT activity.* INTO v_activity
    FROM public.learning_activities activity
   WHERE activity.id = p_activity_id
     AND activity.tenant_id = p_tenant_id
     AND activity.owner_principal_id = p_principal_id
     AND activity.reusable_authored_content = true
     AND activity.authoring_origin <> 'legacy_runtime'
     AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);
  IF v_activity.id IS NULL THEN
    RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::uuid,NULL::varchar,NULL::uuid,
      NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
      NULL::integer,NULL::jsonb,NULL::varchar;
    RETURN;
  END IF;

  IF p_source_kind = 'draft' THEN
    IF p_source_id IS NOT NULL OR p_expected_draft_revision IS NULL THEN
      RETURN QUERY SELECT 'invalid_source'::varchar,v_activity.id,'draft'::varchar,NULL::uuid,
        v_activity.draft_revision,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar;
      RETURN;
    END IF;
    IF v_activity.draft_revision <> p_expected_draft_revision THEN
      RETURN QUERY SELECT 'revision_conflict'::varchar,v_activity.id,'draft'::varchar,NULL::uuid,
        v_activity.draft_revision,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_activity.id,'draft'::varchar,NULL::uuid,
      v_activity.draft_revision,NULL::integer,
      (v_activity.draft_payload->>'title')::varchar,
      NULLIF(v_activity.draft_payload->>'instructions','')::varchar,
      NULLIF(v_activity.draft_payload->>'moduleKey','')::varchar,
      (v_activity.draft_payload->>'resultMode')::varchar,
      NULLIF(v_activity.draft_payload->>'maxPoints','')::integer,
      v_activity.draft_payload->'policies',
      encode(public.digest(convert_to(v_activity.draft_payload::text,'UTF8'),'sha256'),'hex')::varchar;
    RETURN;
  END IF;

  IF p_source_kind = 'published' THEN
    IF p_source_id IS NULL OR p_expected_draft_revision IS NOT NULL THEN
      RETURN QUERY SELECT 'invalid_source'::varchar,v_activity.id,'published'::varchar,p_source_id,
        NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar;
      RETURN;
    END IF;
    SELECT version.* INTO v_version
      FROM public.learning_activity_versions version
     WHERE version.id = p_source_id
       AND version.tenant_id = p_tenant_id
       AND version.activity_id = p_activity_id
       AND version.canonical_contract_version = 1;
    IF v_version.id IS NULL THEN
      RETURN QUERY SELECT 'version_not_found'::varchar,v_activity.id,'published'::varchar,p_source_id,
        NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_activity.id,'published'::varchar,v_version.id,
      v_version.source_draft_revision,v_version.version_number,v_version.title,v_version.instructions,
      v_version.module_key,v_version.result_mode,v_version.max_points,v_version.policy_snapshot,
      v_version.content_digest;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'invalid_source'::varchar,v_activity.id,p_source_kind,p_source_id,
    NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
    NULL::integer,NULL::jsonb,NULL::varchar;
END;
$$;

REVOKE ALL ON FUNCTION public.learning_activity_preview_as_author(uuid,uuid,uuid,varchar,uuid,integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_preview_as_author(uuid,uuid,uuid,varchar,uuid,integer)
  TO asalab_app;
