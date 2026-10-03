-- A6.2a: a single PDF task block, stored as immutable version media.
-- The byte hash is a locator; exact pinned version and viewer policy authorize reads.
ALTER TABLE public.learning_activity_draft_media
  DROP CONSTRAINT learning_activity_draft_media_role_check,
  ADD CONSTRAINT learning_activity_draft_media_role_check
    CHECK (role IN ('sample','task-image','task-file')),
  DROP CONSTRAINT learning_activity_draft_media_content_type_check,
  ADD CONSTRAINT learning_activity_draft_media_content_type_check
    CHECK ((role='task-file' AND content_type='application/pdf')
        OR (role<>'task-file' AND content_type IN ('image/png','image/jpeg','image/webp')));
ALTER TABLE public.learning_activity_version_media
  DROP CONSTRAINT learning_activity_version_media_role_check,
  ADD CONSTRAINT learning_activity_version_media_role_check
    CHECK (role IN ('sample','task-image','task-file')),
  DROP CONSTRAINT learning_activity_version_media_content_type_check,
  ADD CONSTRAINT learning_activity_version_media_content_type_check
    CHECK ((role='task-file' AND content_type='application/pdf')
        OR (role<>'task-file' AND content_type IN ('image/png','image/jpeg','image/webp')));

CREATE OR REPLACE FUNCTION public.learning_safe_task_blocks_valid(p_blocks jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_block jsonb; v_item jsonb; v_type text; v_text text; v_name text;
        v_images integer := 0; v_files integer := 0;
BEGIN
    IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_blocks) > 32 THEN RETURN false; END IF;
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
        IF jsonb_typeof(v_block) <> 'object' THEN RETURN false; END IF;
        v_type := v_block ->> 'type';
        IF v_type IS NULL OR v_type NOT IN ('heading','paragraph','list','callout','link','image','file') THEN RETURN false; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_block) AS fields(name)
                    WHERE fields.name NOT IN ('type','text','items','href','alt','name','contentHash')) THEN RETURN false; END IF;
        IF v_type = 'file' THEN
            v_files := v_files + 1;
            v_name := v_block ->> 'name';
            IF v_files > 1 OR (SELECT count(*) FROM jsonb_object_keys(v_block)) <> 3
               OR NOT (v_block ? 'name') OR jsonb_typeof(v_block -> 'name') <> 'string'
               OR length(trim(v_name)) NOT BETWEEN 5 AND 160
               OR lower(right(v_name,4)) <> '.pdf'
               OR v_name ~ '[[:cntrl:]]' OR position('/' IN v_name)>0
               OR position(chr(92) IN v_name)>0
               OR NOT (v_block ? 'contentHash')
               OR jsonb_typeof(v_block -> 'contentHash') <> 'string'
               OR (v_block ->> 'contentHash') !~ '^[0-9a-f]{64}$'
               THEN RETURN false; END IF;
        ELSIF v_type = 'image' THEN
            v_images := v_images + 1;
            IF v_images > 1 OR v_block ? 'text' OR v_block ? 'items' OR v_block ? 'href'
               OR v_block ? 'name'
               OR NOT (v_block ? 'alt') OR jsonb_typeof(v_block -> 'alt') <> 'string'
               OR length(trim(v_block ->> 'alt')) NOT BETWEEN 1 AND 160
               OR NOT (v_block ? 'contentHash')
               OR jsonb_typeof(v_block -> 'contentHash') <> 'string'
               OR (v_block ->> 'contentHash') !~ '^[0-9a-f]{64}$'
               THEN RETURN false; END IF;
        ELSIF v_type = 'list' THEN
            IF v_block ? 'alt' OR v_block ? 'name' OR v_block ? 'contentHash' THEN RETURN false; END IF;
            IF v_block ? 'text' OR v_block ? 'href' OR NOT (v_block ? 'items')
               OR jsonb_typeof(v_block -> 'items') <> 'array' THEN RETURN false; END IF;
            IF jsonb_array_length(v_block -> 'items') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
            FOR v_item IN SELECT value FROM jsonb_array_elements(v_block -> 'items') LOOP
                IF jsonb_typeof(v_item) <> 'string' OR length(trim(v_item #>> '{}')) NOT BETWEEN 1 AND 500
                   THEN RETURN false; END IF;
            END LOOP;
        ELSE
            IF v_block ? 'alt' OR v_block ? 'name' OR v_block ? 'contentHash' THEN RETURN false; END IF;
            IF v_block ? 'items' OR NOT (v_block ? 'text')
               OR jsonb_typeof(v_block -> 'text') <> 'string' THEN RETURN false; END IF;
            v_text := trim(v_block ->> 'text');
            IF length(v_text) < 1 THEN RETURN false; END IF;
            IF v_type IN ('heading','link') AND length(v_text) > 160 THEN RETURN false; END IF;
            IF v_type IN ('paragraph','callout') AND length(v_text) > 12000 THEN RETURN false; END IF;
            IF v_type = 'link' THEN
                IF NOT (v_block ? 'href') OR jsonb_typeof(v_block -> 'href') <> 'string'
                   OR length(v_block ->> 'href') > 2048
                   OR (v_block ->> 'href') !~* '^https?://[^[:space:]]+$' THEN RETURN false; END IF;
            ELSIF v_block ? 'href' THEN RETURN false;
            END IF;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

-- Keep the existing A2/A3 publisher (including capability and idempotency
-- checks) as the inner operation. This wrapper verifies and copies the file in
-- the same transaction; blocks already participate in its version digest.
ALTER FUNCTION public.learning_activity_publish(uuid,uuid,uuid,integer,varchar)
  RENAME TO learning_activity_publish_without_file;
REVOKE ALL ON FUNCTION public.learning_activity_publish_without_file(uuid,uuid,uuid,integer,varchar)
  FROM PUBLIC, asalab_app;

CREATE FUNCTION public.learning_activity_publish(
    p_principal_id uuid,p_tenant_id uuid,p_activity_id uuid,
    p_expected_revision integer,p_request_id varchar)
RETURNS TABLE(result_code varchar,activity_version_id uuid,version_number integer,
              content_digest varchar,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_activity record; v_file_hash varchar; v_file_type varchar;
        v_file_bytes bytea; v_result record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text,9001));
  SELECT activity.draft_revision,activity.draft_payload INTO v_activity
    FROM public.learning_activities activity
   WHERE activity.id=p_activity_id AND activity.tenant_id=p_tenant_id
     AND activity.owner_principal_id=p_principal_id
     AND public.learning_author_can_use_tenant(p_principal_id,p_tenant_id)
     AND activity.reusable_authored_content AND activity.archived_at IS NULL
   FOR UPDATE;
  IF v_activity.draft_revision=p_expected_revision THEN
    SELECT item.value ->> 'contentHash' INTO v_file_hash
      FROM jsonb_array_elements(COALESCE(v_activity.draft_payload -> 'blocks','[]'::jsonb)) item
     WHERE item.value ->> 'type'='file';
    IF v_file_hash IS NOT NULL THEN
      SELECT media.content_type,media.bytes INTO v_file_type,v_file_bytes
        FROM public.learning_activity_draft_media media
       WHERE media.tenant_id=p_tenant_id AND media.activity_id=p_activity_id
         AND media.role='task-file' AND media.content_hash=v_file_hash;
      IF v_file_bytes IS NULL THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::uuid,NULL::integer,NULL::varchar,false;
        RETURN;
      END IF;
    END IF;
  END IF;
  SELECT * INTO v_result FROM public.learning_activity_publish_without_file(
    p_principal_id,p_tenant_id,p_activity_id,p_expected_revision,p_request_id);
  IF v_result.result_code='ok' AND NOT v_result.reused AND v_file_hash IS NOT NULL THEN
    INSERT INTO public.learning_activity_version_media
      (tenant_id,activity_version_id,role,content_type,bytes,content_hash)
    VALUES (p_tenant_id,v_result.activity_version_id,'task-file',
            v_file_type,v_file_bytes,v_file_hash);
  END IF;
  RETURN QUERY SELECT v_result.result_code::varchar,v_result.activity_version_id::uuid,
                      v_result.version_number::integer,v_result.content_digest::varchar,
                      v_result.reused::boolean;
END;
$$;
REVOKE ALL ON FUNCTION public.learning_activity_publish(uuid,uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_publish(uuid,uuid,uuid,integer,varchar) TO asalab_app;

ALTER FUNCTION public.learning_activity_draft_put(
  uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb)
  RENAME TO learning_activity_draft_put_without_file;
REVOKE ALL ON FUNCTION public.learning_activity_draft_put_without_file(
  uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb)
  FROM PUBLIC, asalab_app;
CREATE FUNCTION public.learning_activity_draft_put(
    p_principal_id uuid,p_tenant_id uuid,p_activity_id uuid,
    p_expected_revision integer,p_title varchar,p_instructions varchar,
    p_result_mode varchar,p_max_points integer,p_policy_snapshot jsonb,
    p_module_key varchar,p_quiz_version_id uuid,p_starter_project_version_id uuid,
    p_goal jsonb,p_blocks jsonb)
RETURNS TABLE(result_code varchar,draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_file_hash text; v_result record;
BEGIN
  IF p_blocks IS NOT NULL AND jsonb_typeof(p_blocks)<>'array' THEN
    RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::integer; RETURN;
  END IF;
  IF p_blocks IS NOT NULL THEN
    SELECT item.value ->> 'contentHash' INTO v_file_hash
      FROM jsonb_array_elements(p_blocks) item WHERE item.value ->> 'type'='file';
    IF v_file_hash IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.learning_activity_draft_media media
       WHERE media.tenant_id=p_tenant_id AND media.activity_id=p_activity_id
         AND media.role='task-file' AND media.content_hash=v_file_hash
    ) THEN
      RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::integer; RETURN;
    END IF;
  END IF;
  SELECT * INTO v_result FROM public.learning_activity_draft_put_without_file(
    p_principal_id,p_tenant_id,p_activity_id,p_expected_revision,p_title,p_instructions,
    p_result_mode,p_max_points,p_policy_snapshot,p_module_key,p_quiz_version_id,
    p_starter_project_version_id,p_goal,p_blocks);
  IF v_result.result_code='ok' AND p_blocks IS NOT NULL AND v_file_hash IS NULL THEN
    DELETE FROM public.learning_activity_draft_media media
     WHERE media.tenant_id=p_tenant_id AND media.activity_id=p_activity_id
       AND media.role='task-file';
  END IF;
  RETURN QUERY SELECT v_result.result_code::varchar,v_result.draft_revision::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.learning_activity_draft_put(
  uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_put(
  uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb) TO asalab_app;

ALTER FUNCTION public.learning_activity_create(
  uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb)
  RENAME TO learning_activity_create_without_file;
REVOKE ALL ON FUNCTION public.learning_activity_create_without_file(
  uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb)
  FROM PUBLIC, asalab_app;
CREATE FUNCTION public.learning_activity_create(
    p_principal_id uuid,p_tenant_id uuid,p_scope_kind varchar,
    p_visibility_policy varchar,p_kind varchar,p_title varchar,
    p_instructions varchar,p_result_mode varchar,p_max_points integer,
    p_policy_snapshot jsonb,p_module_key varchar,p_quiz_version_id uuid,
    p_starter_project_version_id uuid,p_source_teacher_assignment_id uuid,
    p_request_id varchar,p_goal jsonb,p_blocks jsonb)
RETURNS TABLE(result_code varchar,activity_id uuid,draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_result record;
BEGIN
  IF p_blocks IS NOT NULL AND jsonb_typeof(p_blocks)<>'array' THEN
    RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::uuid,NULL::integer; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_blocks,'[]'::jsonb)) item
              WHERE item.value ->> 'type'='file') THEN
    RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::uuid,NULL::integer; RETURN;
  END IF;
  SELECT * INTO v_result FROM public.learning_activity_create_without_file(
    p_principal_id,p_tenant_id,p_scope_kind,p_visibility_policy,p_kind,p_title,
    p_instructions,p_result_mode,p_max_points,p_policy_snapshot,p_module_key,
    p_quiz_version_id,p_starter_project_version_id,p_source_teacher_assignment_id,
    p_request_id,p_goal,p_blocks);
  RETURN QUERY SELECT v_result.result_code::varchar,v_result.activity_id::uuid,
                      v_result.draft_revision::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.learning_activity_create(
  uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_create(
  uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb) TO asalab_app;

ALTER FUNCTION public.learning_activity_draft_from_version(uuid,uuid,uuid,uuid,integer)
  RENAME TO learning_activity_draft_from_version_without_file;
REVOKE ALL ON FUNCTION public.learning_activity_draft_from_version_without_file(uuid,uuid,uuid,uuid,integer)
  FROM PUBLIC, asalab_app;
CREATE FUNCTION public.learning_activity_draft_from_version(
  p_principal uuid,p_tenant uuid,p_activity uuid,p_version uuid,p_expected integer)
RETURNS TABLE(result_code varchar,draft_revision integer,source_version_number integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM public.learning_activity_draft_from_version_without_file(
    p_principal,p_tenant,p_activity,p_version,p_expected);
  IF v_result.result_code='ok' THEN
    DELETE FROM public.learning_activity_draft_media media
     WHERE media.tenant_id=p_tenant AND media.activity_id=p_activity
       AND media.role='task-file';
    INSERT INTO public.learning_activity_draft_media
      (tenant_id,activity_id,role,content_type,bytes,content_hash)
    SELECT p_tenant,p_activity,'task-file',media.content_type,media.bytes,media.content_hash
      FROM public.learning_activity_version_media media
     WHERE media.tenant_id=p_tenant AND media.activity_version_id=p_version
       AND media.role='task-file';
  END IF;
  RETURN QUERY SELECT v_result.result_code::varchar,v_result.draft_revision::integer,
                      v_result.source_version_number::integer;
END;
$$;
REVOKE ALL ON FUNCTION public.learning_activity_draft_from_version(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_from_version(uuid,uuid,uuid,uuid,integer) TO asalab_app;

CREATE FUNCTION public.learning_activity_draft_task_file_set(
    p_principal_id uuid,p_tenant_id uuid,p_activity_id uuid,
    p_expected_revision integer,p_bytes bytea,p_name varchar)
RETURNS TABLE(result_code varchar,draft_revision integer,content_hash varchar)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_activity record; v_hash varchar; v_blocks jsonb;
        v_position integer; v_revision integer;
BEGIN
  IF p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 5 AND 400000
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

CREATE FUNCTION public.learning_activity_draft_task_file_get(
    p_principal uuid,p_tenant uuid,p_activity uuid,p_hash varchar)
RETURNS TABLE(file_bytes bytea,content_type varchar,content_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT media.bytes,media.content_type::varchar,media.content_hash::varchar
    FROM public.learning_activities activity
    JOIN public.learning_activity_draft_media media
      ON media.tenant_id=activity.tenant_id AND media.activity_id=activity.id
     AND media.role='task-file' AND media.content_hash=p_hash
   WHERE activity.id=p_activity AND activity.tenant_id=p_tenant
     AND activity.owner_principal_id=p_principal AND activity.archived_at IS NULL
     AND activity.reusable_authored_content AND activity.authoring_origin='canonical'
     AND public.learning_author_can_use_tenant(p_principal,p_tenant)
     AND activity.draft_payload -> 'blocks' @> jsonb_build_array(
       jsonb_build_object('type','file','contentHash',p_hash));
$$;

CREATE FUNCTION public.learning_activity_version_task_file_get(
    p_principal uuid,p_tenant uuid,p_activity uuid,p_version uuid,p_hash varchar)
RETURNS TABLE(file_bytes bytea,content_type varchar,content_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT media.bytes,media.content_type::varchar,media.content_hash::varchar
    FROM public.learning_activities activity
    JOIN public.learning_activity_versions version
      ON version.tenant_id=activity.tenant_id AND version.activity_id=activity.id
     AND version.id=p_version AND version.canonical_contract_version=1
     AND version.blocks_snapshot_present
    JOIN public.learning_activity_version_media media
      ON media.tenant_id=version.tenant_id AND media.activity_version_id=version.id
     AND media.role='task-file' AND media.content_hash=p_hash
   WHERE activity.id=p_activity AND activity.tenant_id=p_tenant
     AND activity.owner_principal_id=p_principal AND activity.reusable_authored_content
     AND activity.authoring_origin<>'legacy_runtime'
     AND public.learning_author_can_use_tenant(p_principal,p_tenant)
     AND version.blocks @> jsonb_build_array(
       jsonb_build_object('type','file','contentHash',p_hash));
$$;

CREATE FUNCTION public.learning_task_file_for_viewer(
    p_hash varchar,p_tenant uuid,p_account uuid,p_seat uuid)
RETURNS TABLE(file_bytes bytea,content_type varchar,content_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT media.bytes,media.content_type::varchar,media.content_hash::varchar
    FROM public.activity_runs runtime
    JOIN public.classroom_assignments assignment
      ON assignment.id=runtime.source_classroom_assignment_id
     AND assignment.tenant_id=runtime.tenant_id
    JOIN public.classroom_student_seats seat
      ON seat.tenant_id=assignment.tenant_id
     AND seat.classroom_id=assignment.classroom_id AND seat.status='active'
    JOIN public.learning_activity_versions version
      ON version.tenant_id=runtime.tenant_id
     AND version.id=runtime.learning_activity_version_id
     AND version.canonical_contract_version=1
    JOIN public.learning_activity_version_media media
      ON media.tenant_id=version.tenant_id
     AND media.activity_version_id=version.id
     AND media.role='task-file' AND media.content_hash=p_hash
   WHERE runtime.tenant_id=p_tenant AND runtime.source_kind IN ('direct','course')
     AND num_nonnulls(p_account,p_seat)=1
     AND ((p_seat IS NOT NULL AND seat.id=p_seat)
          OR (p_account IS NOT NULL AND seat.account_id=p_account))
     AND (runtime.source_kind='direct' OR EXISTS (
       SELECT 1 FROM public.classroom_course_run_lessons lesson
       JOIN LATERAL jsonb_array_elements(lesson.blocks) block(value) ON
            block.value ->> 'id'=runtime.source_course_block_id
        AND block.value ->> 'type'='activity'
        AND block.value ->> 'learningActivityVersionId'=version.id::text
        AND block.value -> 'hidden' IS DISTINCT FROM 'true'::jsonb
       WHERE lesson.tenant_id=runtime.tenant_id
         AND lesson.id=runtime.source_course_lesson_id
         AND lesson.run_id=runtime.source_course_run_id
     ))
     AND version.blocks_snapshot_present
     AND version.blocks @> jsonb_build_array(
       jsonb_build_object('type','file','contentHash',p_hash))
     AND (public.learning_activity_blocks_for_seat(
       seat.id,assignment.id,
       CASE WHEN runtime.source_kind='course' THEN runtime.id ELSE NULL::uuid END
     ) -> 'blocks') @> jsonb_build_array(
       jsonb_build_object('type','file','contentHash',p_hash))
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.learning_activity_draft_task_file_set(uuid,uuid,uuid,integer,bytea,varchar)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_draft_task_file_get(uuid,uuid,uuid,varchar)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_version_task_file_get(uuid,uuid,uuid,uuid,varchar)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_task_file_for_viewer(varchar,uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_task_file_set(uuid,uuid,uuid,integer,bytea,varchar)
  TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_task_file_get(uuid,uuid,uuid,varchar)
  TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_version_task_file_get(uuid,uuid,uuid,uuid,varchar)
  TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_task_file_for_viewer(varchar,uuid,uuid,uuid)
  TO asalab_app;
