-- Raise the PDF-only ceiling while preserving immutable pinned bytes and existing image limits.
ALTER TABLE public.learning_activity_draft_media
  DROP CONSTRAINT learning_activity_draft_media_size_check,
  ADD CONSTRAINT learning_activity_draft_media_size_check
    CHECK (octet_length(bytes) BETWEEN 1 AND CASE WHEN role='task-file' THEN 25000000 ELSE 400000 END);
ALTER TABLE public.learning_activity_version_media
  DROP CONSTRAINT learning_activity_version_media_size_check,
  ADD CONSTRAINT learning_activity_version_media_size_check
    CHECK (octet_length(bytes) BETWEEN 1 AND CASE WHEN role='task-file' THEN 25000000 ELSE 400000 END);

CREATE OR REPLACE FUNCTION public.learning_activity_draft_task_file_set(
    p_principal_id uuid,p_tenant_id uuid,p_activity_id uuid,
    p_expected_revision integer,p_bytes bytea,p_name varchar)
RETURNS TABLE(result_code varchar,draft_revision integer,content_hash varchar)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_activity record; v_hash varchar; v_blocks jsonb;
        v_position integer; v_revision integer;
BEGIN
  IF p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 5 AND 25000000
     OR substring(p_bytes FROM 1 FOR 5) <> decode('255044462d','hex')
     OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 5 AND 160
     OR lower(right(p_name,4)) <> '.pdf' OR p_name ~ '[[:cntrl:]]'
     OR position('/' IN p_name)>0 OR position(chr(92) IN p_name)>0 THEN
    RETURN QUERY SELECT 'invalid_media'::varchar,NULL::integer,NULL::varchar; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text,9001));
  SELECT activity.id,activity.draft_revision,activity.draft_payload INTO v_activity
    FROM public.learning_activities activity
   WHERE activity.id=p_activity_id AND activity.tenant_id=p_tenant_id
     AND activity.owner_principal_id=p_principal_id AND activity.archived_at IS NULL
     AND activity.reusable_authored_content AND activity.authoring_origin='canonical'
     AND activity.source_teacher_assignment_id IS NULL
     AND public.learning_author_can_use_tenant(p_principal_id,p_tenant_id)
   FOR UPDATE;
  IF v_activity.id IS NULL THEN
    RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::integer,NULL::varchar; RETURN;
  END IF;
  IF p_expected_revision IS NULL OR v_activity.draft_revision<>p_expected_revision THEN
    RETURN QUERY SELECT 'revision_conflict'::varchar,v_activity.draft_revision,NULL::varchar; RETURN;
  END IF;
  v_hash := encode(public.digest(p_bytes,'sha256'),'hex');
  v_blocks := COALESCE(v_activity.draft_payload -> 'blocks','[]'::jsonb);
  SELECT (item.ordinality-1)::integer INTO v_position
    FROM jsonb_array_elements(v_blocks) WITH ORDINALITY item(value,ordinality)
   WHERE item.value ->> 'type'='file';
  IF v_position IS NULL THEN
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'type','file','name',p_name,'contentHash',v_hash));
  ELSE
    v_blocks := jsonb_set(v_blocks,ARRAY[v_position::text],jsonb_build_object(
      'type','file','name',p_name,'contentHash',v_hash));
  END IF;
  IF NOT public.learning_safe_task_blocks_valid(public.learning_activity_task_blocks(
    v_blocks,NULLIF(v_activity.draft_payload ->> 'instructions','')::varchar)) THEN
    RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::integer,NULL::varchar; RETURN;
  END IF;
  INSERT INTO public.learning_activity_draft_media
    (tenant_id,activity_id,role,content_type,bytes,content_hash,updated_at)
  VALUES (p_tenant_id,p_activity_id,'task-file','application/pdf',p_bytes,v_hash,now())
  ON CONFLICT (activity_id,role) DO UPDATE SET
    tenant_id=EXCLUDED.tenant_id,content_type=EXCLUDED.content_type,
    bytes=EXCLUDED.bytes,content_hash=EXCLUDED.content_hash,updated_at=now();
  UPDATE public.learning_activities activity
     SET draft_payload=activity.draft_payload || jsonb_build_object('blocks',v_blocks),
         draft_revision=activity.draft_revision+1
   WHERE activity.id=p_activity_id RETURNING activity.draft_revision INTO v_revision;
  RETURN QUERY SELECT 'ok'::varchar,v_revision,v_hash;
END;
$$;
