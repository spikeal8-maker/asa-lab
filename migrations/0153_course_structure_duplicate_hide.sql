-- E1-FIX-11B: Course Builder structural duplicate + hide/show.
-- Existing authoring rows remain visible by default. Hidden state only affects
-- future snapshots; published CourseVersion and existing CourseRun rows are untouched.

ALTER TABLE public.course_sections
  ADD COLUMN hidden boolean NOT NULL DEFAULT false;

ALTER TABLE public.course_lessons
  ADD COLUMN hidden boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.course_outline_v4(
  p_course_id uuid,
  p_principal_id uuid,
  p_account_id uuid,
  p_tenant_id uuid
)
RETURNS TABLE (
  section_id uuid,
  section_title varchar,
  section_summary varchar,
  section_position integer,
  section_hidden boolean,
  lesson_id uuid,
  lesson_title varchar,
  lesson_summary varchar,
  lesson_content varchar,
  lesson_blocks jsonb,
  lesson_kind varchar,
  lesson_assignment_id uuid,
  learning_activity_version_id uuid,
  assignment_title varchar,
  module_key varchar,
  estimated_minutes integer,
  lesson_position integer,
  lesson_hidden boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT section.id, section.title, section.summary, section.position, section.hidden,
         lesson.id, lesson.title, lesson.summary, lesson.content, lesson.blocks,
         lesson.kind, lesson.assignment_id, lesson.learning_activity_version_id,
         COALESCE(version.title, task.title), COALESCE(version.module_key, task.module_key),
         lesson.estimated_minutes, lesson.position, lesson.hidden
    FROM public.courses course
    JOIN public.course_sections section ON section.course_id=course.id
    LEFT JOIN public.course_lessons lesson ON lesson.section_id=section.id
    LEFT JOIN public.teacher_assignments task ON task.id=lesson.assignment_id
    LEFT JOIN public.learning_activity_versions version
      ON version.id=lesson.learning_activity_version_id
   WHERE course.id=p_course_id
     AND public.content_is_visible(
       'course',course.id,course.visibility,course.owner_principal_id,course.tenant_id,
       p_principal_id,p_account_id,p_tenant_id
     )
   ORDER BY section.position,section.id,lesson.position,lesson.id;
$$;

CREATE OR REPLACE FUNCTION public.course_section_duplicate_v1(
  p_principal uuid,
  p_course uuid,
  p_source uuid,
  p_expected integer,
  p_request varchar
)
RETURNS TABLE(result_code varchar,duplicate_id uuid,draft_revision integer,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_revision integer;
  v_source public.course_sections%ROWTYPE;
  v_duplicate uuid;
  v_receipt record;
BEGIN
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::integer,false;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_principal::text||':'||p_course::text||':'||p_request,1531)
  );

  SELECT course.tenant_id,course.draft_revision
    INTO v_tenant,v_revision
    FROM public.courses course
   WHERE course.id=p_course AND course.owner_principal_id=p_principal
   FOR UPDATE;
  IF v_tenant IS NULL THEN
    RETURN QUERY SELECT 'course_not_found'::varchar,NULL::uuid,NULL::integer,false;
    RETURN;
  END IF;

  SELECT event.action,event.payload_json
    INTO v_receipt
    FROM public.audit_events event
   WHERE event.entity_type='course'
     AND event.entity_id=p_course
     AND event.action IN ('course.section.duplicated','course.lesson.duplicated')
     AND event.payload_json->>'actorPrincipalId'=p_principal::text
     AND event.payload_json->>'requestId'=p_request
   ORDER BY event.id
   LIMIT 1;

  IF v_receipt.action IS NOT NULL THEN
    IF v_receipt.action<>'course.section.duplicated'
       OR v_receipt.payload_json->>'sourceId'<>p_source::text THEN
      RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,v_revision,false;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,
      (v_receipt.payload_json->>'duplicateId')::uuid,v_revision,true;
    RETURN;
  END IF;

  IF v_revision IS DISTINCT FROM p_expected THEN
    RETURN QUERY SELECT 'draft_conflict'::varchar,NULL::uuid,v_revision,false;
    RETURN;
  END IF;

  SELECT * INTO v_source
    FROM public.course_sections section
   WHERE section.id=p_source AND section.course_id=p_course;
  IF v_source.id IS NULL THEN
    RETURN QUERY SELECT 'section_not_found'::varchar,NULL::uuid,v_revision,false;
    RETURN;
  END IF;

  UPDATE public.course_sections
     SET position=position+1
   WHERE course_id=p_course AND position>v_source.position;

  INSERT INTO public.course_sections(
    tenant_id,course_id,title,summary,position,hidden
  ) VALUES (
    v_tenant,p_course,v_source.title,v_source.summary,v_source.position+1,v_source.hidden
  ) RETURNING id INTO v_duplicate;

  INSERT INTO public.course_lessons(
    tenant_id,course_id,section_id,title,summary,content,blocks,kind,
    assignment_id,learning_activity_version_id,estimated_minutes,position,hidden
  )
  SELECT v_tenant,p_course,v_duplicate,lesson.title,lesson.summary,lesson.content,
         lesson.blocks,lesson.kind,lesson.assignment_id,lesson.learning_activity_version_id,
         lesson.estimated_minutes,lesson.position,lesson.hidden
    FROM public.course_lessons lesson
   WHERE lesson.section_id=p_source
   ORDER BY lesson.position,lesson.id;

  PERFORM public.course_items_sync_outline(p_course);
  UPDATE public.courses SET updated_at=now() WHERE id=p_course
    RETURNING courses.draft_revision INTO v_revision;

  INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
  VALUES(
    v_tenant,'course',p_course,'course.section.duplicated',
    jsonb_build_object(
      'actorPrincipalId',p_principal,
      'requestId',p_request,
      'sourceId',p_source,
      'duplicateId',v_duplicate,
      'expectedRevision',p_expected,
      'draftRevision',v_revision
    )
  );

  RETURN QUERY SELECT 'ok'::varchar,v_duplicate,v_revision,false;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_lesson_duplicate_v1(
  p_principal uuid,
  p_course uuid,
  p_source uuid,
  p_expected integer,
  p_request varchar
)
RETURNS TABLE(result_code varchar,duplicate_id uuid,draft_revision integer,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_revision integer;
  v_source public.course_lessons%ROWTYPE;
  v_duplicate uuid;
  v_receipt record;
BEGIN
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::integer,false;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_principal::text||':'||p_course::text||':'||p_request,1531)
  );

  SELECT course.tenant_id,course.draft_revision
    INTO v_tenant,v_revision
    FROM public.courses course
   WHERE course.id=p_course AND course.owner_principal_id=p_principal
   FOR UPDATE;
  IF v_tenant IS NULL THEN
    RETURN QUERY SELECT 'course_not_found'::varchar,NULL::uuid,NULL::integer,false;
    RETURN;
  END IF;

  SELECT event.action,event.payload_json
    INTO v_receipt
    FROM public.audit_events event
   WHERE event.entity_type='course'
     AND event.entity_id=p_course
     AND event.action IN ('course.section.duplicated','course.lesson.duplicated')
     AND event.payload_json->>'actorPrincipalId'=p_principal::text
     AND event.payload_json->>'requestId'=p_request
   ORDER BY event.id
   LIMIT 1;

  IF v_receipt.action IS NOT NULL THEN
    IF v_receipt.action<>'course.lesson.duplicated'
       OR v_receipt.payload_json->>'sourceId'<>p_source::text THEN
      RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,v_revision,false;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,
      (v_receipt.payload_json->>'duplicateId')::uuid,v_revision,true;
    RETURN;
  END IF;

  IF v_revision IS DISTINCT FROM p_expected THEN
    RETURN QUERY SELECT 'draft_conflict'::varchar,NULL::uuid,v_revision,false;
    RETURN;
  END IF;

  SELECT * INTO v_source
    FROM public.course_lessons lesson
   WHERE lesson.id=p_source AND lesson.course_id=p_course;
  IF v_source.id IS NULL THEN
    RETURN QUERY SELECT 'lesson_not_found'::varchar,NULL::uuid,v_revision,false;
    RETURN;
  END IF;

  UPDATE public.course_lessons
     SET position=position+1
   WHERE section_id=v_source.section_id AND position>v_source.position;

  INSERT INTO public.course_lessons(
    tenant_id,course_id,section_id,title,summary,content,blocks,kind,
    assignment_id,learning_activity_version_id,estimated_minutes,position,hidden
  ) VALUES (
    v_source.tenant_id,v_source.course_id,v_source.section_id,v_source.title,
    v_source.summary,v_source.content,v_source.blocks,v_source.kind,
    v_source.assignment_id,v_source.learning_activity_version_id,
    v_source.estimated_minutes,v_source.position+1,v_source.hidden
  ) RETURNING id INTO v_duplicate;

  PERFORM public.course_items_sync_outline(p_course);
  UPDATE public.courses SET updated_at=now() WHERE id=p_course
    RETURNING courses.draft_revision INTO v_revision;

  INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
  VALUES(
    v_tenant,'course',p_course,'course.lesson.duplicated',
    jsonb_build_object(
      'actorPrincipalId',p_principal,
      'requestId',p_request,
      'sourceId',p_source,
      'duplicateId',v_duplicate,
      'expectedRevision',p_expected,
      'draftRevision',v_revision
    )
  );

  RETURN QUERY SELECT 'ok'::varchar,v_duplicate,v_revision,false;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_section_hidden_set_v1(
  p_principal uuid,
  p_course uuid,
  p_section uuid,
  p_hidden boolean,
  p_expected integer
)
RETURNS TABLE(result_code varchar,draft_revision integer,hidden boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_revision integer;
  v_current boolean;
BEGIN
  SELECT course.draft_revision INTO v_revision
    FROM public.courses course
   WHERE course.id=p_course AND course.owner_principal_id=p_principal
   FOR UPDATE;
  IF v_revision IS NULL THEN
    RETURN QUERY SELECT 'course_not_found'::varchar,NULL::integer,NULL::boolean;
    RETURN;
  END IF;
  IF v_revision IS DISTINCT FROM p_expected THEN
    RETURN QUERY SELECT 'draft_conflict'::varchar,v_revision,NULL::boolean;
    RETURN;
  END IF;

  SELECT section.hidden INTO v_current
    FROM public.course_sections section
   WHERE section.id=p_section AND section.course_id=p_course;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'section_not_found'::varchar,v_revision,NULL::boolean;
    RETURN;
  END IF;
  IF v_current IS NOT DISTINCT FROM p_hidden THEN
    RETURN QUERY SELECT 'ok'::varchar,v_revision,v_current;
    RETURN;
  END IF;

  UPDATE public.course_sections
     SET hidden=p_hidden,updated_at=now()
   WHERE id=p_section AND course_id=p_course;
  UPDATE public.courses SET updated_at=now() WHERE id=p_course
    RETURNING courses.draft_revision INTO v_revision;

  RETURN QUERY SELECT 'ok'::varchar,v_revision,p_hidden;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_lesson_hidden_set_v1(
  p_principal uuid,
  p_course uuid,
  p_lesson uuid,
  p_hidden boolean,
  p_expected integer
)
RETURNS TABLE(result_code varchar,draft_revision integer,hidden boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_revision integer;
  v_current boolean;
BEGIN
  SELECT course.draft_revision INTO v_revision
    FROM public.courses course
   WHERE course.id=p_course AND course.owner_principal_id=p_principal
   FOR UPDATE;
  IF v_revision IS NULL THEN
    RETURN QUERY SELECT 'course_not_found'::varchar,NULL::integer,NULL::boolean;
    RETURN;
  END IF;
  IF v_revision IS DISTINCT FROM p_expected THEN
    RETURN QUERY SELECT 'draft_conflict'::varchar,v_revision,NULL::boolean;
    RETURN;
  END IF;

  SELECT lesson.hidden INTO v_current
    FROM public.course_lessons lesson
   WHERE lesson.id=p_lesson AND lesson.course_id=p_course;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'lesson_not_found'::varchar,v_revision,NULL::boolean;
    RETURN;
  END IF;
  IF v_current IS NOT DISTINCT FROM p_hidden THEN
    RETURN QUERY SELECT 'ok'::varchar,v_revision,v_current;
    RETURN;
  END IF;

  UPDATE public.course_lessons
     SET hidden=p_hidden,updated_at=now()
   WHERE id=p_lesson AND course_id=p_course;
  UPDATE public.courses SET updated_at=now() WHERE id=p_course
    RETURNING courses.draft_revision INTO v_revision;

  RETURN QUERY SELECT 'ok'::varchar,v_revision,p_hidden;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_snapshot_build(p_course_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object(
    'schemaVersion',CASE WHEN EXISTS (
      SELECT 1
        FROM public.course_lessons pin
        JOIN public.course_sections section ON section.id=pin.section_id
       WHERE pin.course_id=p_course_id
         AND NOT pin.hidden
         AND NOT section.hidden
         AND pin.learning_activity_version_id IS NOT NULL
    ) THEN 3 ELSE 2 END,
    'course',jsonb_build_object(
      'sourceCourseId',course.id,
      'title',course.title,
      'summary',course.summary,
      'ageBand',course.age_band
    ),
    'sections',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'sourceSectionId',section.id,
          'title',section.title,
          'summary',section.summary,
          'position',section.position,
          'lessons',COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'sourceLessonId',lesson.id,
                'title',lesson.title,
                'summary',lesson.summary,
                'content',lesson.content,
                'blocks',lesson.blocks,
                'kind',lesson.kind,
                'learningActivityVersionId',lesson.learning_activity_version_id,
                'estimatedMinutes',lesson.estimated_minutes,
                'position',lesson.position,
                'assignment',CASE
                  WHEN version.id IS NOT NULL THEN jsonb_build_object(
                    'learningActivityVersionId',version.id,
                    'title',version.title,
                    'brief',version.instructions,
                    'moduleKey',version.module_key,
                    'resultMode',version.result_mode,
                    'maxPoints',version.max_points
                  )
                  WHEN task.id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'sourceAssignmentId',task.id,
                    'title',task.title,
                    'goal',task.goal,
                    'brief',task.brief,
                    'moduleKey',task.module_key,
                    'ageBand',task.age_band,
                    'staticSampleImage',CASE
                      WHEN task.sample_bytes IS NULL THEN task.sample_image ELSE NULL
                    END,
                    'hasVersionedSample',task.sample_bytes IS NOT NULL,
                    'sampleContentType',task.sample_content_type,
                    'sampleChecksum',CASE
                      WHEN task.sample_bytes IS NULL THEN NULL
                      ELSE md5(encode(task.sample_bytes,'base64'))
                    END
                  )
                END
              ) ORDER BY lesson.position,lesson.id
            )
              FROM public.course_lessons lesson
              LEFT JOIN public.teacher_assignments task ON task.id=lesson.assignment_id
              LEFT JOIN public.learning_activity_versions version
                ON version.id=lesson.learning_activity_version_id
             WHERE lesson.section_id=section.id
               AND NOT lesson.hidden
          ),'[]'::jsonb)
        ) ORDER BY section.position,section.id
      )
        FROM public.course_sections section
       WHERE section.course_id=course.id
         AND NOT section.hidden
    ),'[]'::jsonb)
  )
    FROM public.courses course
   WHERE course.id=p_course_id;
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
  SELECT id,archived_at INTO v_course
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
          AND version.module_key IN ('electronics','three-d')
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

REVOKE ALL ON FUNCTION public.course_outline_v4(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_outline_v4(uuid,uuid,uuid,uuid) TO asalab_app;

REVOKE ALL ON FUNCTION public.course_section_duplicate_v1(uuid,uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_section_duplicate_v1(uuid,uuid,uuid,integer,varchar) TO asalab_app;

REVOKE ALL ON FUNCTION public.course_lesson_duplicate_v1(uuid,uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_lesson_duplicate_v1(uuid,uuid,uuid,integer,varchar) TO asalab_app;

REVOKE ALL ON FUNCTION public.course_section_hidden_set_v1(uuid,uuid,uuid,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_section_hidden_set_v1(uuid,uuid,uuid,boolean,integer) TO asalab_app;

REVOKE ALL ON FUNCTION public.course_lesson_hidden_set_v1(uuid,uuid,uuid,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_lesson_hidden_set_v1(uuid,uuid,uuid,boolean,integer) TO asalab_app;


-- Independent-review repair: keep every published sidecar aligned with the exact
-- immutable outline and require an actual CourseRun lesson occurrence for media reads.
CREATE OR REPLACE FUNCTION public.course_publish(
    p_principal_id uuid,
    p_course_id    uuid
)
RETURNS TABLE (
    result_code    varchar,
    version_id     uuid,
    version_number integer,
    published_at   timestamptz,
    reused         boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_course       record;
    v_snapshot     jsonb;
    v_hash         varchar(32);
    v_latest       record;
    v_version_id   uuid;
    v_number       integer;
    v_published_at timestamptz;
BEGIN
    SELECT course.id, course.tenant_id, course.title, course.summary, course.age_band,
           course.draft_base_version_id
      INTO v_course
      FROM public.courses course
     WHERE course.id = p_course_id
       AND course.owner_principal_id = p_principal_id
     FOR UPDATE;

    IF v_course.id IS NULL THEN
        RETURN QUERY SELECT 'course_not_found'::varchar, NULL::uuid, NULL::integer,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.course_lessons lesson WHERE lesson.course_id = p_course_id
    ) THEN
        RETURN QUERY SELECT 'course_empty'::varchar, NULL::uuid, NULL::integer,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    v_snapshot := public.course_snapshot_build(p_course_id);
    v_hash := md5(v_snapshot::text);

    SELECT version.id, version.version_number, version.content_hash,
           version.published_at, version.outline
      INTO v_latest
      FROM public.course_versions version
     WHERE version.course_id = p_course_id
     ORDER BY version.version_number DESC
     LIMIT 1;

    IF v_latest.id IS NOT NULL
       AND public.course_snapshot_normalize_pins(v_latest.outline)
           = public.course_snapshot_normalize_pins(v_snapshot) THEN
        INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
        SELECT v_course.tenant_id,'course',p_course_id,'course.draft.published',
          jsonb_build_object(
            'sourceVersionId',v_course.draft_base_version_id,
            'publishedVersionId',v_latest.id
          )
        WHERE v_course.draft_base_version_id IS NOT NULL;
        UPDATE public.courses
           SET draft_active=false,draft_base_version_id=NULL,draft_started_revision=NULL
         WHERE id=p_course_id AND draft_active;
        RETURN QUERY SELECT 'ok'::varchar, v_latest.id, v_latest.version_number,
                            v_latest.published_at, true;
        RETURN;
    END IF;

    v_number := COALESCE(v_latest.version_number, 0) + 1;
    INSERT INTO public.course_versions (
        tenant_id, course_id, version_number, title, summary, age_band,
        outline, content_hash, published_by_principal_id
    ) VALUES (
        v_course.tenant_id, p_course_id, v_number, v_course.title,
        v_course.summary, v_course.age_band, v_snapshot, v_hash, p_principal_id
    )
    RETURNING id, course_versions.published_at INTO v_version_id, v_published_at;

    INSERT INTO public.course_version_media (
        version_id, source_lesson_id, sample_bytes, content_type, content_hash
    )
    SELECT v_version_id, lesson.id, task.sample_bytes, task.sample_content_type,
           md5(encode(task.sample_bytes, 'base64'))
      FROM public.course_lessons lesson
      JOIN public.course_sections section
        ON section.id = lesson.section_id
       AND section.course_id = lesson.course_id
      JOIN public.teacher_assignments task ON task.id = lesson.assignment_id
     WHERE lesson.course_id = p_course_id
       AND NOT lesson.hidden
       AND NOT section.hidden
       AND task.sample_bytes IS NOT NULL
       AND task.sample_content_type IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(v_snapshot -> 'sections')
                    AS frozen_section(section_json)
             CROSS JOIN LATERAL jsonb_array_elements(frozen_section.section_json -> 'lessons')
                    AS frozen_lesson(lesson_json)
            WHERE frozen_lesson.lesson_json ->> 'sourceLessonId' = lesson.id::text
       );

    INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
    SELECT v_course.tenant_id,'course',p_course_id,'course.draft.published',
      jsonb_build_object(
        'sourceVersionId',v_course.draft_base_version_id,
        'publishedVersionId',v_version_id
      )
    WHERE v_course.draft_base_version_id IS NOT NULL;
    UPDATE public.courses
       SET draft_active=false,draft_base_version_id=NULL,draft_started_revision=NULL
     WHERE id=p_course_id AND draft_active;
    RETURN QUERY SELECT 'ok'::varchar, v_version_id, v_number, v_published_at, false;
END;
$$;

CREATE OR REPLACE FUNCTION public.classroom_course_run_media(
    p_run_id           uuid,
    p_source_lesson_id uuid,
    p_seat_id          uuid,
    p_account_id       uuid
)
RETURNS TABLE (sample_bytes bytea, content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT media.sample_bytes, media.content_type
      FROM public.classroom_course_runs run
      JOIN public.classroom_course_run_lessons run_lesson
        ON run_lesson.tenant_id = run.tenant_id
       AND run_lesson.run_id = run.id
       AND run_lesson.source_lesson_id = p_source_lesson_id
      JOIN public.course_version_media media
        ON media.version_id = run.course_version_id
       AND media.source_lesson_id = run_lesson.source_lesson_id
     WHERE run.id = p_run_id
       AND (
           EXISTS (
               SELECT 1 FROM public.classroom_student_seats seat
                WHERE seat.id = p_seat_id
                  AND seat.classroom_id = run.classroom_id
                  AND seat.tenant_id = run.tenant_id
                  AND seat.status = 'active'
           )
           OR EXISTS (
               SELECT 1 FROM public.classroom_memberships membership
                WHERE membership.account_id = p_account_id
                  AND membership.classroom_id = run.classroom_id
                  AND membership.tenant_id = run.tenant_id
                  AND membership.member_role IN ('owner', 'co_teacher', 'student')
           )
       );
$$;

-- course_items remains a non-destructive compatibility index. Visibility is
-- derived from effective visible authoring occurrences instead of mutating it.
CREATE OR REPLACE FUNCTION public.course_contents(
    p_course_id    uuid,
    p_principal_id uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS TABLE (
    id uuid,
    title varchar,
    goal varchar,
    module_key varchar,
    sample_image varchar,
    step_number integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT task.id, task.title, task.goal, task.module_key, task.sample_image, item.position
      FROM public.courses course
      JOIN public.course_items item ON item.course_id = course.id
      JOIN public.teacher_assignments task ON task.id = item.assignment_id
     WHERE course.id = p_course_id
       AND public.content_is_visible(
           'course', course.id, course.visibility, course.owner_principal_id,
           course.tenant_id, p_principal_id, p_account_id, p_tenant_id
       )
       AND EXISTS (
           SELECT 1
             FROM public.course_lessons lesson
             JOIN public.course_sections section
               ON section.id = lesson.section_id
              AND section.course_id = lesson.course_id
            WHERE lesson.course_id = course.id
              AND lesson.assignment_id = item.assignment_id
              AND NOT lesson.hidden
              AND NOT section.hidden
       )
     ORDER BY item.position;
$$;

CREATE OR REPLACE FUNCTION public.assignment_media_visible(
    p_assignment_id uuid,
    p_principal_id  uuid,
    p_account_id    uuid,
    p_tenant_id     uuid,
    p_seat_id       uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE
        WHEN p_seat_id IS NOT NULL THEN EXISTS (
            SELECT 1
              FROM public.classroom_student_seats seat
              JOIN public.classroom_assignments handout
                ON handout.tenant_id = seat.tenant_id
               AND handout.classroom_id = seat.classroom_id
             WHERE seat.id = p_seat_id
               AND seat.tenant_id = p_tenant_id
               AND seat.status IN ('issued', 'active')
               AND handout.assignment_id = p_assignment_id
        )
        WHEN p_account_id IS NOT NULL THEN EXISTS (
            SELECT 1
              FROM public.teacher_assignments task
             WHERE task.id = p_assignment_id
               AND (
                   public.content_is_visible(
                       'assignment', task.id, task.visibility,
                       task.owner_principal_id, task.tenant_id,
                       p_principal_id, p_account_id, p_tenant_id
                   )
                   OR EXISTS (
                       SELECT 1
                         FROM public.classroom_assignments handout
                         JOIN public.classroom_memberships membership
                           ON membership.tenant_id = handout.tenant_id
                          AND membership.classroom_id = handout.classroom_id
                        WHERE handout.assignment_id = task.id
                          AND membership.account_id = p_account_id
                          AND membership.member_role IN ('owner', 'co_teacher')
                   )
                   OR EXISTS (
                       SELECT 1
                         FROM public.classroom_assignments handout
                         JOIN public.classroom_student_seats seat
                           ON seat.tenant_id = handout.tenant_id
                          AND seat.classroom_id = handout.classroom_id
                        WHERE handout.assignment_id = task.id
                          AND seat.account_id = p_account_id
                          AND seat.status = 'active'
                   )
                   OR EXISTS (
                       SELECT 1
                         FROM public.course_items item
                         JOIN public.courses course ON course.id = item.course_id
                        WHERE item.assignment_id = task.id
                          AND public.content_is_visible(
                              'course', course.id, course.visibility,
                              course.owner_principal_id, course.tenant_id,
                              p_principal_id, p_account_id, p_tenant_id
                          )
                          AND EXISTS (
                              SELECT 1
                                FROM public.course_lessons lesson
                                JOIN public.course_sections section
                                  ON section.id = lesson.section_id
                                 AND section.course_id = lesson.course_id
                               WHERE lesson.course_id = course.id
                                 AND lesson.assignment_id = item.assignment_id
                                 AND NOT lesson.hidden
                                 AND NOT section.hidden
                          )
                   )
               )
        )
        ELSE false
    END;
$$;

REVOKE ALL ON FUNCTION public.course_publish(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_publish(uuid,uuid) TO asalab_app;

REVOKE ALL ON FUNCTION public.classroom_course_run_media(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_course_run_media(uuid,uuid,uuid,uuid) TO asalab_app;

REVOKE ALL ON FUNCTION public.course_contents(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_contents(uuid,uuid,uuid,uuid) TO asalab_app;

REVOKE ALL ON FUNCTION public.assignment_media_visible(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assignment_media_visible(uuid,uuid,uuid,uuid,uuid) TO asalab_app;
