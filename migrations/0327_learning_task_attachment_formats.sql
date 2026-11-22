ALTER TABLE public.learning_activity_draft_media
  ALTER COLUMN content_type TYPE varchar(96),
  DROP CONSTRAINT learning_activity_draft_media_content_type_check,
  ADD CONSTRAINT learning_activity_draft_media_content_type_check CHECK (
    (role='task-file' AND content_type IN ('application/pdf','text/plain','text/csv','application/zip','application/x.scratch.sb3','model/stl',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
    OR (role<>'task-file' AND content_type IN ('image/png','image/jpeg','image/webp'))),
  DROP CONSTRAINT learning_activity_draft_media_size_check,
  ADD CONSTRAINT learning_activity_draft_media_size_check CHECK (
    octet_length(bytes) BETWEEN 1 AND CASE
      WHEN role='task-file' AND content_type='application/pdf' THEN 25000000
      WHEN role='task-file' THEN 50000000
      WHEN role='task-image' THEN 20000000
      ELSE 400000 END);

ALTER TABLE public.learning_activity_version_media
  ALTER COLUMN content_type TYPE varchar(96),
  DROP CONSTRAINT learning_activity_version_media_content_type_check,
  ADD CONSTRAINT learning_activity_version_media_content_type_check CHECK (
    (role='task-file' AND content_type IN ('application/pdf','text/plain','text/csv','application/zip','application/x.scratch.sb3','model/stl',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
    OR (role<>'task-file' AND content_type IN ('image/png','image/jpeg','image/webp'))),
  DROP CONSTRAINT learning_activity_version_media_size_check,
  ADD CONSTRAINT learning_activity_version_media_size_check CHECK (
    octet_length(bytes) BETWEEN 1 AND CASE
      WHEN role='task-file' AND content_type='application/pdf' THEN 25000000
      WHEN role='task-file' THEN 50000000
      WHEN role='task-image' THEN 20000000
      ELSE 400000 END);

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
               OR v_name !~* '[.](pdf|docx|pptx|xlsx|txt|csv|sb3|stl|ino|zip)$'
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

CREATE FUNCTION public.learning_activity_draft_task_file_set(
    p_principal_id uuid,p_tenant_id uuid,p_activity_id uuid,
    p_expected_revision integer,p_bytes bytea,p_name varchar,p_content_type varchar)
RETURNS TABLE(result_code varchar,draft_revision integer,content_hash varchar)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_activity record; v_hash varchar; v_blocks jsonb;
        v_position integer; v_revision integer;
BEGIN
  IF p_bytes IS NULL OR octet_length(p_bytes) < 1
     OR octet_length(p_bytes) > (CASE WHEN p_content_type='application/pdf' THEN 25000000 ELSE 50000000 END)
     OR p_content_type IS NULL OR p_content_type IS DISTINCT FROM (CASE lower(substring(p_name FROM '[.]([^.]+)$'))
       WHEN 'pdf' THEN 'application/pdf'
       WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
       WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
       WHEN 'txt' THEN 'text/plain'
       WHEN 'ino' THEN 'text/plain'
       WHEN 'csv' THEN 'text/csv'
       WHEN 'zip' THEN 'application/zip'
       WHEN 'sb3' THEN 'application/x.scratch.sb3'
       WHEN 'stl' THEN 'model/stl' END)
     OR p_content_type='application/pdf' AND substring(p_bytes FROM 1 FOR 5) <> decode('255044462d','hex')
     OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 5 AND 160
     OR p_name !~* '[.](pdf|docx|pptx|xlsx|txt|csv|sb3|stl|ino|zip)$' OR p_name ~ '[[:cntrl:]]'
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
  VALUES (p_tenant_id,p_activity_id,'task-file',p_content_type,p_bytes,v_hash,now())
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

REVOKE ALL ON FUNCTION public.learning_activity_draft_task_file_set(uuid,uuid,uuid,integer,bytea,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_task_file_set(uuid,uuid,uuid,integer,bytea,varchar,varchar) TO asalab_app;

CREATE OR REPLACE FUNCTION learning_activity_draft_task_image_set(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer,
    p_bytes bytea,
    p_content_type varchar
)
RETURNS TABLE (
    result_code varchar,
    draft_revision integer,
    content_hash varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_revision integer;
    v_hash varchar;
    v_blocks jsonb;
    v_position integer;
BEGIN
    IF p_content_type NOT IN ('image/png', 'image/jpeg', 'image/webp')
       OR p_bytes IS NULL
       OR octet_length(p_bytes) < 1
       OR octet_length(p_bytes) > 20000000 THEN
        RETURN QUERY SELECT 'invalid_media'::varchar, NULL::integer, NULL::varchar;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));

    SELECT activity.id, activity.draft_revision, activity.draft_payload
      INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin = 'canonical'
       AND activity.source_teacher_assignment_id IS NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
     FOR UPDATE;

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::integer, NULL::varchar;
        RETURN;
    END IF;

    IF p_expected_revision IS NULL OR v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, v_activity.draft_revision, NULL::varchar;
        RETURN;
    END IF;

    v_hash := encode(public.digest(p_bytes, 'sha256'), 'hex');
    v_blocks := COALESCE(v_activity.draft_payload -> 'blocks','[]'::jsonb);
    SELECT (item.ordinality - 1)::integer INTO v_position
      FROM jsonb_array_elements(v_blocks) WITH ORDINALITY item(value,ordinality)
     WHERE item.value ->> 'type' = 'image';
    IF v_position IS NULL THEN
        v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
            'type','image','alt','Изображение задания','contentHash',v_hash));
    ELSE
        v_blocks := jsonb_set(v_blocks,ARRAY[v_position::text,'contentHash'],to_jsonb(v_hash));
    END IF;
    IF NOT public.learning_safe_task_blocks_valid(
        public.learning_activity_task_blocks(v_blocks,
            NULLIF(v_activity.draft_payload ->> 'instructions','')::varchar)
    ) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::integer,NULL::varchar; RETURN;
    END IF;

    INSERT INTO public.learning_activity_draft_media (
        tenant_id, activity_id, role, content_type, bytes, content_hash, updated_at
    ) VALUES (
        p_tenant_id, p_activity_id, 'task-image', p_content_type, p_bytes, v_hash, now()
    )
    ON CONFLICT (activity_id, role) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        content_type = EXCLUDED.content_type,
        bytes = EXCLUDED.bytes,
        content_hash = EXCLUDED.content_hash,
        updated_at = now();

    UPDATE public.learning_activities activity
       SET draft_payload = activity.draft_payload || jsonb_build_object('blocks',v_blocks),
           draft_revision = activity.draft_revision + 1
     WHERE activity.id = p_activity_id
     RETURNING activity.draft_revision INTO v_revision;

    RETURN QUERY SELECT 'ok'::varchar, v_revision, v_hash;
END;
$$;
