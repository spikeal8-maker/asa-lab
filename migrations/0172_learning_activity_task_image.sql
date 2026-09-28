-- A2d: one ordered, first-class image block per activity.
-- Reuse immutable version media; published migrations remain untouched.
ALTER TABLE public.learning_activity_draft_media
  DROP CONSTRAINT learning_activity_draft_media_role_check,
  ADD CONSTRAINT learning_activity_draft_media_role_check
      CHECK (role IN ('sample','task-image'));
ALTER TABLE public.learning_activity_version_media
  DROP CONSTRAINT learning_activity_version_media_role_check,
  ADD CONSTRAINT learning_activity_version_media_role_check
      CHECK (role IN ('sample','task-image'));

CREATE OR REPLACE FUNCTION public.learning_safe_task_blocks_valid(p_blocks jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_block jsonb; v_item jsonb; v_type text; v_text text; v_images integer := 0;
BEGIN
    IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_blocks) > 32 THEN RETURN false; END IF;
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
        IF jsonb_typeof(v_block) <> 'object' THEN RETURN false; END IF;
        v_type := v_block ->> 'type';
        IF v_type IS NULL OR v_type NOT IN ('heading','paragraph','list','callout','link','image') THEN RETURN false; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_block) AS fields(name)
                    WHERE fields.name NOT IN ('type','text','items','href','alt','contentHash')) THEN RETURN false; END IF;
        IF v_type = 'image' THEN
            v_images := v_images + 1;
            IF v_images > 1 OR v_block ? 'text' OR v_block ? 'items' OR v_block ? 'href'
               OR NOT (v_block ? 'alt') OR jsonb_typeof(v_block -> 'alt') <> 'string'
               OR length(trim(v_block ->> 'alt')) NOT BETWEEN 1 AND 160
               OR NOT (v_block ? 'contentHash')
               OR jsonb_typeof(v_block -> 'contentHash') <> 'string'
               OR (v_block ->> 'contentHash') !~ '^[0-9a-f]{64}$'
               THEN RETURN false; END IF;
        ELSIF v_type = 'list' THEN
            IF v_block ? 'alt' OR v_block ? 'contentHash' THEN RETURN false; END IF;
            IF v_block ? 'text' OR v_block ? 'href' OR NOT (v_block ? 'items')
               OR jsonb_typeof(v_block -> 'items') <> 'array' THEN RETURN false; END IF;
            IF jsonb_array_length(v_block -> 'items') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
            FOR v_item IN SELECT value FROM jsonb_array_elements(v_block -> 'items') LOOP
                IF jsonb_typeof(v_item) <> 'string' OR length(trim(v_item #>> '{}')) NOT BETWEEN 1 AND 500
                   THEN RETURN false; END IF;
            END LOOP;
        ELSE
            IF v_block ? 'alt' OR v_block ? 'contentHash' THEN RETURN false; END IF;
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

CREATE OR REPLACE FUNCTION public.learning_activity_draft_put(
    p_principal_id uuid, p_tenant_id uuid, p_activity_id uuid,
    p_expected_revision integer, p_title varchar, p_instructions varchar,
    p_result_mode varchar, p_max_points integer, p_policy_snapshot jsonb,
    p_module_key varchar, p_quiz_version_id uuid,
    p_starter_project_version_id uuid, p_goal jsonb, p_blocks jsonb
)
RETURNS TABLE (result_code varchar, draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_result record; v_image_hash text;
BEGIN
    IF p_blocks IS NOT NULL AND (
        NOT public.learning_safe_task_blocks_valid(p_blocks) OR
        NOT public.learning_safe_task_blocks_valid(
            public.learning_activity_task_blocks(p_blocks,p_instructions))
    ) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::integer; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));
    SELECT item.value ->> 'contentHash' INTO v_image_hash
      FROM jsonb_array_elements(COALESCE(p_blocks,'[]'::jsonb)) item
     WHERE item.value ->> 'type' = 'image';
    IF v_image_hash IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.learning_activity_draft_media media
         WHERE media.tenant_id=p_tenant_id AND media.activity_id=p_activity_id
           AND media.role='task-image' AND media.content_hash=v_image_hash
    ) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::integer; RETURN;
    END IF;
    SELECT * INTO v_result FROM public.learning_activity_draft_put(
        p_principal_id,p_tenant_id,p_activity_id,p_expected_revision,
        p_title,p_instructions,p_result_mode,p_max_points,p_policy_snapshot,
        p_module_key,p_quiz_version_id,p_starter_project_version_id,p_goal
    );
    IF v_result.result_code = 'ok' AND p_blocks IS NOT NULL THEN
        UPDATE public.learning_activities AS activity
           SET draft_payload = activity.draft_payload || jsonb_build_object('blocks',p_blocks)
         WHERE activity.id=p_activity_id AND activity.tenant_id=p_tenant_id
           AND activity.owner_principal_id=p_principal_id
           AND activity.draft_revision=v_result.draft_revision;
        IF v_image_hash IS NULL THEN
            DELETE FROM public.learning_activity_draft_media media
             WHERE media.tenant_id=p_tenant_id AND media.activity_id=p_activity_id
               AND media.role='task-image';
        END IF;
    END IF;
    RETURN QUERY SELECT v_result.result_code::varchar,v_result.draft_revision;
END;
$$;

CREATE OR REPLACE FUNCTION public.learning_activity_create(
    p_principal_id uuid,p_tenant_id uuid,p_scope_kind varchar,
    p_visibility_policy varchar,p_kind varchar,p_title varchar,
    p_instructions varchar,p_result_mode varchar,p_max_points integer,
    p_policy_snapshot jsonb,p_module_key varchar,p_quiz_version_id uuid,
    p_starter_project_version_id uuid,p_source_teacher_assignment_id uuid,
    p_request_id varchar,p_goal jsonb,p_blocks jsonb
)
RETURNS TABLE (result_code varchar,activity_id uuid,draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_existing uuid; v_result record; v_stored jsonb;
BEGIN
    IF p_blocks IS NOT NULL AND (
        NOT public.learning_safe_task_blocks_valid(p_blocks) OR
        NOT public.learning_safe_task_blocks_valid(
            public.learning_activity_task_blocks(p_blocks,p_instructions))
    ) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::uuid,NULL::integer; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_blocks,'[]'::jsonb)) item
                WHERE item.value ->> 'type' = 'image') THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::uuid,NULL::integer; RETURN;
    END IF;
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar,NULL::uuid,NULL::integer; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        COALESCE(p_source_teacher_assignment_id::text,
                 p_tenant_id::text || ':' || p_principal_id::text || ':' || p_request_id),9000));
    SELECT id INTO v_existing FROM public.learning_activities
     WHERE tenant_id=p_tenant_id AND owner_principal_id=p_principal_id
       AND creation_request_id=p_request_id;
    IF v_existing IS NULL AND p_source_teacher_assignment_id IS NOT NULL THEN
        SELECT id INTO v_existing FROM public.learning_activities
         WHERE source_teacher_assignment_id=p_source_teacher_assignment_id;
    END IF;
    SELECT * INTO v_result FROM public.learning_activity_create(
        p_principal_id,p_tenant_id,p_scope_kind,p_visibility_policy,p_kind,
        p_title,p_instructions,p_result_mode,p_max_points,p_policy_snapshot,
        p_module_key,p_quiz_version_id,p_starter_project_version_id,
        p_source_teacher_assignment_id,p_request_id,p_goal
    );
    IF v_result.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_result.result_code::varchar,v_result.activity_id,v_result.draft_revision;
        RETURN;
    END IF;
    SELECT creation_blocks_snapshot INTO v_stored
      FROM public.learning_activities WHERE id=v_result.activity_id;
    IF v_existing IS NOT NULL THEN
        IF v_stored IS DISTINCT FROM p_blocks THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,NULL::integer;
            RETURN;
        END IF;
    ELSIF p_blocks IS NOT NULL THEN
        UPDATE public.learning_activities AS activity
           SET draft_payload=activity.draft_payload || jsonb_build_object('blocks',p_blocks),
                creation_blocks_snapshot=p_blocks
          WHERE activity.id=v_result.activity_id AND activity.tenant_id=p_tenant_id
            AND activity.owner_principal_id=p_principal_id AND activity.draft_revision=1;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_result.activity_id,v_result.draft_revision;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_publish(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer,
    p_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    activity_version_id uuid,
    version_number integer,
    content_digest varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_existing record;
    v_number integer;
    v_id uuid;
    v_snapshot jsonb;
    v_digest varchar;
    v_sample_content_type varchar;
    v_sample_bytes bytea;
    v_sample_content_hash varchar;
    v_goal varchar;
    v_blocks jsonb;
    v_image_hash varchar;
    v_image_content_type varchar;
    v_image_bytes bytea;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));

    SELECT * INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime'
       AND activity.archived_at IS NULL
     FOR UPDATE;

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT version.id, version.version_number, version.content_digest,
           version.source_draft_revision
      INTO v_existing
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id
       AND version.publication_request_id = p_request_id;

    IF v_existing.id IS NOT NULL THEN
        IF v_existing.source_draft_revision <> p_expected_revision THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar, NULL::uuid,
                                NULL::integer, NULL::varchar, false;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_existing.id, v_existing.version_number,
                                v_existing.content_digest, true;
        END IF;
        RETURN;
    END IF;

    SELECT version.id, version.version_number, version.content_digest,
           version.source_draft_revision
      INTO v_existing
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id
       AND version.source_draft_revision = p_expected_revision
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing.id, v_existing.version_number,
                            v_existing.content_digest, true;
        RETURN;
    END IF;

    IF v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.learning_migration_compatibility_activity_versions compatibility
         WHERE compatibility.learning_activity_version_id = v_activity.current_published_version_id
            OR compatibility.classroom_assignment_id::text =
               v_activity.draft_payload ->> 'sourceClassroomAssignmentId'
    ) THEN
        RETURN QUERY SELECT 'compatibility_not_reusable'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT media.content_type, media.bytes, media.content_hash
      INTO v_sample_content_type, v_sample_bytes, v_sample_content_hash
      FROM public.learning_activity_draft_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_id = p_activity_id
       AND media.role = 'sample';

    SELECT COALESCE(max(version.version_number), 0) + 1
      INTO v_number
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id;

    -- Pre-goal drafts can still be published. Freeze their teacher source goal
    -- once, at publication; an explicit null in a new draft stays null.
    v_goal := CASE WHEN v_activity.draft_payload ? 'goal'
        THEN NULLIF(v_activity.draft_payload ->> 'goal', '')
        ELSE (
            SELECT teacher.goal
              FROM public.teacher_assignments teacher
             WHERE teacher.tenant_id = p_tenant_id
               AND teacher.id = v_activity.source_teacher_assignment_id
        )
    END;

    v_blocks := public.learning_activity_task_blocks(
        v_activity.draft_payload -> 'blocks',
        NULLIF(v_activity.draft_payload ->> 'instructions','')::varchar);
    IF NOT public.learning_safe_task_blocks_valid(v_blocks) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::uuid, NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT item.value ->> 'contentHash' INTO v_image_hash
      FROM jsonb_array_elements(v_blocks) item
     WHERE item.value ->> 'type' = 'image';
    IF v_image_hash IS NOT NULL THEN
        SELECT media.content_type,media.bytes
          INTO v_image_content_type,v_image_bytes
          FROM public.learning_activity_draft_media media
         WHERE media.tenant_id=p_tenant_id AND media.activity_id=p_activity_id
           AND media.role='task-image' AND media.content_hash=v_image_hash;
        IF v_image_bytes IS NULL THEN
            RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::uuid,NULL::integer,NULL::varchar,false;
            RETURN;
        END IF;
    END IF;
    v_snapshot := jsonb_build_object(
        'activityId', v_activity.id,
        'versionNumber', v_number,
        'kind', v_activity.draft_payload ->> 'kind',
        'title', v_activity.draft_payload ->> 'title',
        'instructions', v_activity.draft_payload -> 'instructions',
        'goal', v_goal,
        'blocks', v_blocks,
        'resultMode', v_activity.draft_payload ->> 'resultMode',
        'maxPoints', v_activity.draft_payload -> 'maxPoints',
        'policies', v_activity.draft_payload -> 'policies',
        'moduleKey', v_activity.draft_payload -> 'moduleKey',
        'quizVersionId', v_activity.draft_payload -> 'quizVersionId',
        'starterProjectVersionId', v_activity.draft_payload -> 'starterProjectVersionId',
        'sample', CASE
            WHEN v_sample_content_hash IS NULL THEN NULL::jsonb
            ELSE jsonb_build_object(
                'contentType', v_sample_content_type,
                'contentHash', v_sample_content_hash
            )
        END,
        'provenance', jsonb_build_object(
            'authoringOrigin', v_activity.authoring_origin,
            'sourceVersionId', v_activity.draft_base_version_id,
            'sourceTeacherAssignmentId', v_activity.source_teacher_assignment_id,
            'sourceDraftRevision', v_activity.draft_revision
        )
    );

    IF v_image_hash IS NOT NULL THEN
        v_snapshot := v_snapshot || jsonb_build_object('taskImage',
            jsonb_build_object('contentType',v_image_content_type,'contentHash',v_image_hash));
    END IF;
    v_digest := public.learning_activity_snapshot_digest(v_snapshot);

    INSERT INTO public.learning_activity_versions (
        tenant_id, activity_id, version_number, title, instructions,
        activity_type, module_key, max_points, scoring_policy, content_digest,
        canonical_kind, result_mode, policy_snapshot, quiz_version_id,
        starter_project_version_id, provenance, source_draft_revision,
        publication_request_id, published_by_principal_id,
        canonical_contract_version, goal, goal_snapshot_present, blocks, blocks_snapshot_present
    ) VALUES (
        v_activity.tenant_id, v_activity.id, v_number,
        v_activity.draft_payload ->> 'title',
        NULLIF(v_activity.draft_payload ->> 'instructions', ''),
        v_activity.draft_payload ->> 'kind',
        NULLIF(v_activity.draft_payload ->> 'moduleKey', ''),
        NULLIF(v_activity.draft_payload ->> 'maxPoints', '')::integer,
        jsonb_build_object('kind', 'canonical',
                           'resultMode', v_activity.draft_payload ->> 'resultMode'),
        v_digest,
        v_activity.draft_payload ->> 'kind',
        v_activity.draft_payload ->> 'resultMode',
        v_activity.draft_payload -> 'policies',
        NULLIF(v_activity.draft_payload ->> 'quizVersionId', '')::uuid,
        NULLIF(v_activity.draft_payload ->> 'starterProjectVersionId', '')::uuid,
        v_snapshot -> 'provenance', v_activity.draft_revision,
        p_request_id, p_principal_id, 1,
        v_goal, true, v_blocks, true
    ) RETURNING id INTO v_id;

    IF v_sample_content_hash IS NOT NULL THEN
        INSERT INTO public.learning_activity_version_media (
            tenant_id, activity_version_id, role, content_type, bytes, content_hash
        ) VALUES (
            p_tenant_id, v_id, 'sample',
            v_sample_content_type, v_sample_bytes, v_sample_content_hash
        );
    END IF;

    IF v_image_hash IS NOT NULL THEN
        INSERT INTO public.learning_activity_version_media
            (tenant_id,activity_version_id,role,content_type,bytes,content_hash)
        VALUES (p_tenant_id,v_id,'task-image',v_image_content_type,v_image_bytes,v_image_hash);
    END IF;
    UPDATE public.learning_activities
       SET current_published_version_id = v_id, draft_base_version_id = NULL
     WHERE id = p_activity_id;

    RETURN QUERY SELECT 'ok'::varchar, v_id, v_number, v_digest, false;
END;
$$;


CREATE OR REPLACE FUNCTION learning_activity_draft_from_version(p_principal uuid,p_tenant uuid,p_activity uuid,p_version uuid,p_expected integer)
RETURNS TABLE(result_code varchar,draft_revision integer,source_version_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.learning_activities%ROWTYPE; v public.learning_activity_versions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_activity::text,9001));
 SELECT * INTO a FROM public.learning_activities WHERE id=p_activity AND tenant_id=p_tenant
   AND owner_principal_id=p_principal AND reusable_authored_content AND archived_at IS NULL
   AND public.learning_author_can_use_tenant(p_principal,p_tenant) FOR UPDATE;
 IF a.id IS NULL THEN RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::integer,NULL::integer; RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.learning_activity_versions WHERE id=a.current_published_version_id
   AND source_draft_revision=a.draft_revision) THEN
   RETURN QUERY SELECT 'draft_exists'::varchar,a.draft_revision,NULL::integer; RETURN;
 END IF;
 IF a.draft_revision IS DISTINCT FROM p_expected THEN RETURN QUERY SELECT 'revision_conflict'::varchar,a.draft_revision,NULL::integer; RETURN; END IF;
 SELECT * INTO v FROM public.learning_activity_versions WHERE id=p_version AND activity_id=a.id AND canonical_contract_version=1;
 IF v.id IS NULL THEN RETURN QUERY SELECT 'version_not_found'::varchar,a.draft_revision,NULL::integer; RETURN; END IF;
 UPDATE public.learning_activities SET title=v.title,draft_revision=a.draft_revision+1,draft_base_version_id=v.id,
   draft_payload=jsonb_build_object('kind',v.canonical_kind,'title',v.title,'instructions',v.instructions,
     'goal',CASE WHEN v.goal_snapshot_present THEN v.goal ELSE NULL END,
     'resultMode',v.result_mode,'maxPoints',v.max_points,'policies',v.policy_snapshot,'moduleKey',v.module_key,
     'quizVersionId',v.quiz_version_id,'starterProjectVersionId',v.starter_project_version_id,
     'blocks', CASE WHEN v.blocks_snapshot_present THEN
         CASE WHEN v.instructions IS NOT NULL AND jsonb_array_length(v.blocks)>0
                    AND v.blocks -> 0 = jsonb_build_object('type','paragraph','text',v.instructions)
              THEN v.blocks - 0 ELSE v.blocks END
         ELSE '[]'::jsonb END)
 WHERE id=a.id;
 DELETE FROM public.learning_activity_draft_media
  WHERE tenant_id=p_tenant AND activity_id=a.id AND role='task-image';
 INSERT INTO public.learning_activity_draft_media
   (tenant_id,activity_id,role,content_type,bytes,content_hash)
 SELECT p_tenant,a.id,'task-image',media.content_type,media.bytes,media.content_hash
   FROM public.learning_activity_version_media media
  WHERE media.tenant_id=p_tenant AND media.activity_version_id=v.id
    AND media.role='task-image';
 RETURN QUERY SELECT 'ok'::varchar,a.draft_revision+1,v.version_number;
END;
$$;


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
       OR octet_length(p_bytes) > 400000 THEN
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

CREATE OR REPLACE FUNCTION learning_activity_draft_task_image_get(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid
)
RETURNS TABLE (
    result_code varchar,
    content_type varchar,
    bytes bytea,
    content_hash varchar,
    draft_revision integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_media record;
BEGIN
    SELECT activity.id, activity.draft_revision
      INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin = 'canonical'
       AND activity.source_teacher_assignment_id IS NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::varchar, NULL::bytea,
                            NULL::varchar, NULL::integer;
        RETURN;
    END IF;

    SELECT media.content_type, media.bytes, media.content_hash
      INTO v_media
      FROM public.learning_activity_draft_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_id = p_activity_id
       AND media.role = 'task-image';

    IF v_media.content_hash IS NULL THEN
        RETURN QUERY SELECT 'sample_not_found'::varchar, NULL::varchar, NULL::bytea,
                            NULL::varchar, v_activity.draft_revision;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_media.content_type::varchar, v_media.bytes::bytea,
                        v_media.content_hash::varchar, v_activity.draft_revision;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_version_task_image_get(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_activity_version_id uuid
)
RETURNS TABLE (
    result_code varchar,
    content_type varchar,
    bytes bytea,
    content_hash varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity_id uuid;
    v_version_id uuid;
    v_media record;
BEGIN
    SELECT activity.id
      INTO v_activity_id
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime'
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);

    IF v_activity_id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::varchar, NULL::bytea, NULL::varchar;
        RETURN;
    END IF;

    SELECT version.id
      INTO v_version_id
      FROM public.learning_activity_versions version
     WHERE version.id = p_activity_version_id
       AND version.tenant_id = p_tenant_id
       AND version.activity_id = p_activity_id
       AND version.canonical_contract_version = 1;

    IF v_version_id IS NULL THEN
        RETURN QUERY SELECT 'version_not_found'::varchar, NULL::varchar, NULL::bytea, NULL::varchar;
        RETURN;
    END IF;

    SELECT media.content_type, media.bytes, media.content_hash
      INTO v_media
      FROM public.learning_activity_version_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_version_id = p_activity_version_id
       AND media.role = 'task-image';

    IF v_media.content_hash IS NULL THEN
        RETURN QUERY SELECT 'sample_not_found'::varchar, NULL::varchar, NULL::bytea, NULL::varchar;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_media.content_type::varchar, v_media.bytes::bytea,
                        v_media.content_hash::varchar;
END;
$$;

-- The hash is a locator, never authority. The exact pinned ActivityRun and
-- the existing server-side block visibility check authorize every byte read.
CREATE FUNCTION public.learning_task_image_for_viewer(
    p_hash varchar, p_tenant uuid, p_account uuid, p_seat uuid
)
RETURNS TABLE (image_bytes bytea, image_content_type varchar, content_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT media.bytes, media.content_type::varchar, media.content_hash::varchar
      FROM public.activity_runs runtime
      JOIN public.classroom_assignments assignment
        ON assignment.id=runtime.source_classroom_assignment_id
       AND assignment.tenant_id=runtime.tenant_id
      JOIN public.classroom_student_seats seat
        ON seat.tenant_id=assignment.tenant_id
       AND seat.classroom_id=assignment.classroom_id
       AND seat.status='active'
      JOIN public.learning_activity_versions version
        ON version.tenant_id=runtime.tenant_id
       AND version.id=runtime.learning_activity_version_id
       AND version.canonical_contract_version=1
      JOIN public.learning_activity_version_media media
        ON media.tenant_id=version.tenant_id
       AND media.activity_version_id=version.id
       AND media.role='task-image'
       AND media.content_hash=p_hash
     WHERE runtime.tenant_id=p_tenant
       AND runtime.source_kind IN ('direct','course')
       AND num_nonnulls(p_account,p_seat)=1
       AND ((p_seat IS NOT NULL AND seat.id=p_seat)
            OR (p_account IS NOT NULL AND seat.account_id=p_account))
       AND (runtime.source_kind='direct' OR EXISTS (
           SELECT 1
             FROM public.classroom_course_run_lessons lesson
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
           jsonb_build_object('type','image','contentHash',p_hash))
       AND (public.learning_activity_blocks_for_seat(
           seat.id,assignment.id,
           CASE WHEN runtime.source_kind='course' THEN runtime.id ELSE NULL::uuid END
       ) -> 'blocks') @> jsonb_build_array(
           jsonb_build_object('type','image','contentHash',p_hash))
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.learning_task_image_for_viewer(varchar,uuid,uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_draft_task_image_set(uuid,uuid,uuid,integer,bytea,varchar)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_draft_task_image_get(uuid,uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_version_task_image_get(uuid,uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_task_image_for_viewer(varchar,uuid,uuid,uuid)
  TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_task_image_set(uuid,uuid,uuid,integer,bytea,varchar)
  TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_task_image_get(uuid,uuid,uuid)
  TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_version_task_image_get(uuid,uuid,uuid,uuid)
  TO asalab_app;
