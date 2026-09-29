-- A3b-1: database projection of the API module registry learning capability.
-- Module onboarding updates these rows in a versioned migration alongside the
-- registry manifest. Missing/disabled modules are deliberately fail-closed.
CREATE TABLE public.module_learning_capabilities (
    module_key varchar(64) PRIMARY KEY,
    creatable boolean NOT NULL,
    assignable boolean NOT NULL,
    editable_evidence boolean NOT NULL,
    submit_project_version boolean NOT NULL,
    preview varchar(16) NOT NULL
        CHECK (preview IN ('snapshot','interactive','summary','none')),
    CONSTRAINT module_learning_capabilities_consistent CHECK (
        (NOT submit_project_version OR editable_evidence)
        AND (assignable OR
             (NOT editable_evidence AND NOT submit_project_version AND preview='none'))
        AND (NOT assignable OR creatable)
    )
);

INSERT INTO public.module_learning_capabilities
    (module_key,creatable,assignable,editable_evidence,submit_project_version,preview)
VALUES
    ('electronics',true,true,true,true,'snapshot'),
    ('three-d',true,true,true,true,'snapshot'),
    ('chess',true,false,false,false,'none'),
    ('checkers',true,false,false,false,'none'),
    ('blocks',true,false,false,false,'none'),
    ('robotics',false,false,false,false,'none'),
    ('drawing',false,false,false,false,'none');

-- A global deployment-owned capability projection; tenants and app callers
-- cannot grant themselves authoring support by editing a row.
REVOKE ALL ON public.module_learning_capabilities FROM PUBLIC;
REVOKE ALL ON public.module_learning_capabilities FROM asalab_app;

CREATE FUNCTION public.module_learning_assignable(p_module_key varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
    SELECT COALESCE((
      SELECT capability.creatable AND capability.assignable
        FROM public.module_learning_capabilities capability
       WHERE capability.module_key=p_module_key
    ),false);
$$;
REVOKE ALL ON FUNCTION public.module_learning_assignable(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.module_learning_assignable(varchar) TO asalab_app;

CREATE OR REPLACE FUNCTION course_lesson_save_v3(
    p_principal_id uuid, p_course_id uuid, p_section_id uuid, p_lesson_id uuid,
    p_title varchar, p_summary varchar, p_blocks jsonb, p_kind varchar,
    p_assignment_id uuid, p_estimated_minutes integer, p_activity_version_id uuid
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_tenant uuid; v_id uuid; v_position integer;
BEGIN
    -- Lock the root before computing outline position or changing a pin.
    SELECT course.tenant_id INTO v_tenant FROM public.courses course
     WHERE course.id=p_course_id AND course.owner_principal_id=p_principal_id FOR UPDATE;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;
    IF p_activity_version_id IS NULL THEN
        -- An explicit transition away from a canonical lesson clears its pin in
        -- this transaction; delegate legacy writes without inventing source rows.
        IF p_lesson_id IS NOT NULL THEN
            UPDATE public.course_lessons SET kind='material',learning_activity_version_id=NULL
             WHERE id=p_lesson_id AND course_id=p_course_id
               AND learning_activity_version_id IS NOT NULL;
        END IF;
        v_id := public.course_lesson_save_v2(p_principal_id,p_course_id,p_section_id,
          p_lesson_id,p_title,p_summary,p_blocks,p_kind,p_assignment_id,p_estimated_minutes);
        IF v_id IS NULL THEN RAISE EXCEPTION 'invalid course lesson' USING ERRCODE='22023'; END IF;
        RETURN v_id;
    END IF;
    IF p_kind IS DISTINCT FROM 'assignment' OR p_assignment_id IS NOT NULL
       OR length(trim(coalesce(p_title,''))) NOT BETWEEN 1 AND 160
       OR NOT public.course_lesson_blocks_valid(p_blocks)
       OR (p_estimated_minutes IS NOT NULL AND p_estimated_minutes NOT BETWEEN 1 AND 600)
       OR NOT EXISTS (SELECT 1 FROM public.course_sections WHERE id=p_section_id AND course_id=p_course_id)
       OR NOT EXISTS (
         SELECT 1 FROM public.learning_activity_versions version
         JOIN public.learning_activities activity ON activity.id=version.activity_id
         WHERE version.id=p_activity_version_id AND version.canonical_contract_version=1
           AND version.canonical_kind='project' AND public.module_learning_assignable(version.module_key)
           AND version.tenant_id=v_tenant AND activity.tenant_id=v_tenant
           AND activity.owner_principal_id=p_principal_id AND activity.reusable_authored_content
           AND activity.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.learning_migration_compatibility_activity_versions compat
                           WHERE compat.learning_activity_version_id=version.id))
    THEN RETURN NULL; END IF;
    SELECT COALESCE(max(position),0)+1 INTO v_position FROM public.course_lessons WHERE section_id=p_section_id;
    IF p_lesson_id IS NULL THEN
        INSERT INTO public.course_lessons(tenant_id,course_id,section_id,title,summary,content,blocks,
          kind,learning_activity_version_id,estimated_minutes,position)
        VALUES(v_tenant,p_course_id,p_section_id,trim(p_title),nullif(trim(p_summary),''),
          public.course_lesson_blocks_plain_text(p_blocks),p_blocks,'assignment',
          p_activity_version_id,p_estimated_minutes,v_position) RETURNING id INTO v_id;
    ELSE
        UPDATE public.course_lessons SET
          position=CASE WHEN section_id=p_section_id THEN position ELSE v_position END,
          section_id=p_section_id,title=trim(p_title),summary=nullif(trim(p_summary),''),
          content=public.course_lesson_blocks_plain_text(p_blocks),blocks=p_blocks,
          kind='assignment',assignment_id=NULL,learning_activity_version_id=p_activity_version_id,
          estimated_minutes=p_estimated_minutes,updated_at=now()
         WHERE id=p_lesson_id AND course_id=p_course_id RETURNING id INTO v_id;
    END IF;
    IF v_id IS NOT NULL THEN
        UPDATE public.courses SET updated_at=now() WHERE id=p_course_id;
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_activity_blocks_authorized(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_blocks jsonb
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_block jsonb;
    v_version_id uuid;
    v_activity_id uuid;
    v_result_code varchar;
    v_module_key varchar;
BEGIN
    IF NOT public.course_lesson_blocks_valid(p_blocks) THEN RETURN false; END IF;

    FOR v_block IN
        SELECT value
          FROM jsonb_array_elements(p_blocks)
         WHERE value ->> 'type' = 'activity'
    LOOP
        v_version_id := (v_block ->> 'learningActivityVersionId')::uuid;
        SELECT version.activity_id
          INTO v_activity_id
          FROM public.learning_activity_versions version
         WHERE version.id = v_version_id
           AND version.tenant_id = p_tenant_id;

        IF v_activity_id IS NULL THEN RETURN false; END IF;

        SELECT preview.result_code, preview.module_key
          INTO v_result_code, v_module_key
          FROM public.learning_activity_preview_as_author(
            p_principal_id, p_tenant_id, v_activity_id,
            'published', v_version_id, NULL
          ) preview;

        IF v_result_code IS DISTINCT FROM 'ok'
           OR NOT public.module_learning_assignable(v_module_key) THEN
            RETURN false;
        END IF;
    END LOOP;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_prepublication_validation(
  p_principal uuid,
  p_course uuid
)
RETURNS TABLE(
  result_code varchar,
  problem_kind varchar,
  problem_id uuid,
  problem_path varchar,
  problem_message varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_course record;
  v_problem record;
BEGIN
  SELECT id,tenant_id,archived_at INTO v_course
    FROM public.courses
   WHERE id=p_course AND owner_principal_id=p_principal;
  IF v_course.id IS NULL THEN
    RETURN QUERY SELECT 'course_not_found'::varchar,NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar;
    RETURN;
  END IF;
  IF v_course.archived_at IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'course'::varchar,p_course,
      'Курс'::varchar,'Восстановите курс из архива перед публикацией.'::varchar;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.course_lessons lesson
      JOIN public.course_sections section ON section.id=lesson.section_id
     WHERE lesson.course_id=p_course
       AND NOT lesson.hidden
       AND NOT section.hidden
  ) THEN
    RETURN QUERY SELECT 'course_empty'::varchar,'course'::varchar,p_course,
      'Курс'::varchar,'Покажите хотя бы один урок перед публикацией.'::varchar;
    RETURN;
  END IF;

  SELECT section.title AS section_title,lesson.id,lesson.title
    INTO v_problem
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
   WHERE lesson.course_id=p_course
     AND NOT lesson.hidden
     AND NOT section.hidden
     AND NOT public.course_lesson_blocks_valid(lesson.blocks)
   ORDER BY section.position,lesson.position,lesson.id
   LIMIT 1;
  IF v_problem.id IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'lesson'::varchar,v_problem.id,
      ('Раздел «'||v_problem.section_title||'» → урок «'||v_problem.title||'»')::varchar,
      'Исправьте некорректный блок урока.'::varchar;
    RETURN;
  END IF;

  v_problem:=NULL;
  SELECT section.title AS section_title,lesson.id,lesson.title
    INTO v_problem
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
   WHERE lesson.course_id=p_course
     AND NOT lesson.hidden
     AND NOT section.hidden
     AND lesson.kind='material'
     AND jsonb_array_length(lesson.blocks)=0
     AND NULLIF(btrim(lesson.content),'') IS NULL
   ORDER BY section.position,lesson.position,lesson.id
   LIMIT 1;
  IF v_problem.id IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'lesson'::varchar,v_problem.id,
      ('Раздел «'||v_problem.section_title||'» → урок «'||v_problem.title||'»')::varchar,
      'Добавьте содержание в материал.'::varchar;
    RETURN;
  END IF;

  v_problem:=NULL;
  SELECT section.title AS section_title,lesson.id,lesson.title
    INTO v_problem
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
    JOIN public.teacher_assignments task ON task.id=lesson.assignment_id
   WHERE lesson.course_id=p_course
     AND NOT lesson.hidden
     AND NOT section.hidden
     AND lesson.kind='assignment'
     AND lesson.assignment_id IS NOT NULL
   ORDER BY section.position,lesson.position,lesson.id
   LIMIT 1;
  IF v_problem.id IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'lesson'::varchar,v_problem.id,
      ('Раздел «'||v_problem.section_title||'» → урок «'||v_problem.title||'»')::varchar,
      'Замените старое задание из банка на опубликованный материал из вашей библиотеки.'::varchar;
    RETURN;
  END IF;

  -- A previously valid Activity block can lose assignability after a
  -- module capability change. Recheck visible blocks at publication.
  v_problem:=NULL;
  SELECT section.title AS section_title,lesson.id,lesson.title
    INTO v_problem
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
    JOIN public.courses course ON course.id=lesson.course_id
   WHERE lesson.course_id=p_course
     AND NOT lesson.hidden
     AND NOT section.hidden
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(lesson.blocks) entry
        WHERE entry ->> 'type'='activity'
          AND NOT COALESCE((entry ->> 'hidden')::boolean,false)
     )
     AND NOT public.course_activity_blocks_authorized(
       p_principal,course.tenant_id,
       COALESCE((
         SELECT jsonb_agg(entry.value)
           FROM jsonb_array_elements(lesson.blocks) entry(value)
          WHERE NOT COALESCE((entry.value ->> 'hidden')::boolean,false)
       ),'[]'::jsonb)
     )
   ORDER BY section.position,lesson.position,lesson.id
   LIMIT 1;
  IF v_problem.id IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'lesson'::varchar,v_problem.id,
      ('Раздел «'||v_problem.section_title||'» → урок «'||v_problem.title||'»')::varchar,
      'Практика в уроке больше недоступна для нового выпуска. Выберите актуальный опубликованный материал.'::varchar;
    RETURN;
  END IF;

  v_problem:=NULL;
  SELECT section.title AS section_title,lesson.id,lesson.title
    INTO v_problem
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
   WHERE lesson.course_id=p_course
     AND NOT lesson.hidden
     AND NOT section.hidden
     AND lesson.kind='assignment'
     AND lesson.learning_activity_version_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.learning_activity_versions version
         JOIN public.learning_activities activity ON activity.id=version.activity_id
        WHERE version.id=lesson.learning_activity_version_id
          AND version.canonical_contract_version=1
          AND version.canonical_kind='project'
          AND public.module_learning_assignable(version.module_key)
          AND version.tenant_id=v_course.tenant_id
          AND activity.tenant_id=v_course.tenant_id
          AND activity.owner_principal_id=p_principal
          AND activity.reusable_authored_content
          AND activity.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM public.learning_migration_compatibility_activity_versions compat
             WHERE compat.learning_activity_version_id=version.id
          )
     )
   ORDER BY section.position,lesson.position,lesson.id
   LIMIT 1;
  IF v_problem.id IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'lesson'::varchar,v_problem.id,
      ('Раздел «'||v_problem.section_title||'» → урок «'||v_problem.title||'»')::varchar,
      'Закреплённый материал больше недоступен для нового выпуска. Выберите актуальную опубликованную версию.'::varchar;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::varchar,NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar;
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

    -- Preserve exact successful publication replays above. New project
    -- versions require the current server-side module capability.
    IF v_activity.draft_payload ->> 'kind' = 'project'
       AND NOT public.module_learning_assignable(
         v_activity.draft_payload ->> 'moduleKey'
       ) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::uuid,
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

-- Preserve the v2 successful-request receipt before checking the current
-- draft or module capability. A new request still passes prepublication
-- validation before it can reach the legacy publisher.
CREATE OR REPLACE FUNCTION public.course_publish_v3(
  p_principal uuid,p_course uuid,p_expected integer,p_request varchar
)
RETURNS TABLE(
  result_code varchar,version_id uuid,version_number integer,published_at timestamptz,reused boolean,
  problem_kind varchar,problem_id uuid,problem_path varchar,problem_message varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course public.courses%ROWTYPE; v_check record; v_result record;
BEGIN
  SELECT * INTO v_course FROM public.courses
   WHERE id=p_course AND owner_principal_id=p_principal FOR UPDATE;
  IF v_course.id IS NULL THEN
    RETURN QUERY SELECT 'course_not_found'::varchar,NULL::uuid,NULL::integer,NULL::timestamptz,false,
      NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar; RETURN;
  END IF;
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::integer,NULL::timestamptz,false,
      NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_events event
     WHERE event.entity_id=p_course AND event.action='course.publication.confirmed'
       AND event.payload_json->>'actorPrincipalId'=p_principal::text
       AND event.payload_json->>'requestId'=p_request
  ) THEN
    SELECT * INTO v_result FROM public.course_publish_v2(p_principal,p_course,p_expected,p_request);
    RETURN QUERY SELECT v_result.result_code,v_result.version_id,v_result.version_number,
      v_result.published_at,v_result.reused,NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar;
    RETURN;
  END IF;
  IF v_course.draft_revision IS DISTINCT FROM p_expected THEN
    RETURN QUERY SELECT 'draft_conflict'::varchar,NULL::uuid,NULL::integer,NULL::timestamptz,false,
      NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar; RETURN;
  END IF;
  SELECT * INTO v_check FROM public.course_prepublication_validation(p_principal,p_course);
  IF v_check.result_code IS DISTINCT FROM 'ok' THEN
    RETURN QUERY SELECT v_check.result_code,NULL::uuid,NULL::integer,NULL::timestamptz,false,
      v_check.problem_kind,v_check.problem_id,v_check.problem_path,v_check.problem_message;
    RETURN;
  END IF;
  SELECT * INTO v_result FROM public.course_publish_v2(p_principal,p_course,p_expected,p_request);
  RETURN QUERY SELECT v_result.result_code,v_result.version_id,v_result.version_number,
    v_result.published_at,v_result.reused,NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar;
END;
$$;

REVOKE ALL ON FUNCTION public.course_lesson_save_v3(uuid,uuid,uuid,uuid,varchar,varchar,jsonb,varchar,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_lesson_save_v3(uuid,uuid,uuid,uuid,varchar,varchar,jsonb,varchar,uuid,integer,uuid) TO asalab_app;
REVOKE ALL ON FUNCTION public.course_activity_blocks_authorized(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_activity_blocks_authorized(uuid,uuid,jsonb) TO asalab_app;
REVOKE ALL ON FUNCTION public.course_prepublication_validation(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_prepublication_validation(uuid,uuid) TO asalab_app;
REVOKE ALL ON FUNCTION public.learning_activity_publish(uuid,uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_publish(uuid,uuid,uuid,integer,varchar) TO asalab_app;
REVOKE ALL ON FUNCTION public.course_publish_v3(uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_publish_v3(uuid,uuid,integer,varchar) TO asalab_app;
