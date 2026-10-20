-- E1-FIX-07: stable editor locations for the existing publication validator.
-- Display labels are evidence for people, never an input to navigation.
CREATE FUNCTION public.course_block_problem_field(p_block jsonb)
RETURNS varchar
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_type text := p_block->>'type';
BEGIN
  IF jsonb_typeof(p_block) IS DISTINCT FROM 'object'
     OR COALESCE(p_block->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$'
     OR v_type NOT IN ('paragraph','heading','callout','image','video','audio','file',
                      'code','formula','table','divider','activity','manual-material') THEN
    RETURN 'blocks';
  END IF;
  IF p_block ? 'hidden' AND jsonb_typeof(p_block->'hidden') IS DISTINCT FROM 'boolean' THEN
    RETURN 'hidden';
  END IF;
  IF v_type IN ('activity','manual-material') THEN RETURN 'learningActivityVersionId'; END IF;
  IF v_type IN ('image','video','audio','file') THEN
    IF jsonb_typeof(p_block->'url') IS DISTINCT FROM 'string'
       OR (COALESCE(p_block->>'url','') !~ '^https://'
           AND COALESCE(p_block->>'url','') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
       OR COALESCE(p_block->>'url','') LIKE '%..%'
       OR length(p_block->>'url')>2000 THEN RETURN 'url'; END IF;
    IF v_type='image' THEN
      IF (p_block ? 'alt' AND jsonb_typeof(p_block->'alt') IS DISTINCT FROM 'string')
         OR length(COALESCE(p_block->>'alt',''))>300 THEN RETURN 'alt'; END IF;
      IF (p_block ? 'caption' AND jsonb_typeof(p_block->'caption') IS DISTINCT FROM 'string')
         OR length(COALESCE(p_block->>'caption',''))>600 THEN RETURN 'caption'; END IF;
    ELSIF v_type='file' THEN
      IF jsonb_typeof(p_block->'label') IS DISTINCT FROM 'string'
         OR length(btrim(COALESCE(p_block->>'label','')))=0
         OR length(p_block->>'label')>300 THEN RETURN 'label'; END IF;
    ELSIF (p_block ? 'title' AND jsonb_typeof(p_block->'title') IS DISTINCT FROM 'string')
       OR length(COALESCE(p_block->>'title',''))>300 THEN RETURN 'title';
    END IF;
  ELSIF v_type IN ('paragraph','heading','callout','code','formula') THEN
    IF jsonb_typeof(p_block->'text') IS DISTINCT FROM 'string'
       OR (v_type IN ('heading','callout','formula')
           AND length(btrim(COALESCE(p_block->>'text','')))=0)
       OR length(p_block->>'text') > (CASE v_type
         WHEN 'paragraph' THEN 12000 WHEN 'heading' THEN 300
         WHEN 'callout' THEN 3000 WHEN 'code' THEN 20000 ELSE 4000 END) THEN
      RETURN 'text';
    END IF;
    IF v_type='heading' AND COALESCE(p_block->>'level','') NOT IN ('2','3') THEN RETURN 'level'; END IF;
    IF v_type='callout' AND COALESCE(p_block->>'tone','') NOT IN ('note','tip','warning') THEN RETURN 'tone'; END IF;
    IF v_type='code' AND p_block ? 'language' AND (
      jsonb_typeof(p_block->'language') IS DISTINCT FROM 'string'
      OR COALESCE(p_block->>'language','') !~ '^[A-Za-z0-9][A-Za-z0-9_+.#-]{0,79}$'
    ) THEN RETURN 'language'; END IF;
  ELSIF v_type='table' AND NOT public.course_lesson_table_rows_valid(p_block->'rows') THEN
    RETURN 'rows';
  END IF;
  RETURN 'blocks';
END;
$$;

-- The existing validator keeps its category and lesson priority. Only fresh
-- publication requires active Activity pins: author preview deliberately allows
-- immutable versions of archived activities for historical reads. CREATE OR
-- REPLACE preserves the existing function owner and restricted execution ACL.
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
     AND (
       NOT public.course_activity_blocks_authorized(
         p_principal,course.tenant_id,
         COALESCE((
           SELECT jsonb_agg(entry.value)
             FROM jsonb_array_elements(lesson.blocks) entry(value)
            WHERE NOT COALESCE((entry.value ->> 'hidden')::boolean,false)
         ),'[]'::jsonb)
       )
       OR EXISTS (
         SELECT 1
           FROM jsonb_array_elements(lesson.blocks) entry
           JOIN public.learning_activity_versions version
             ON version.id=(entry->>'learningActivityVersionId')::uuid
           JOIN public.learning_activities activity ON activity.id=version.activity_id
             AND activity.tenant_id=version.tenant_id
          WHERE entry->>'type'='activity'
            AND entry->>'hidden' IS DISTINCT FROM 'true'
            AND version.tenant_id=course.tenant_id
            AND activity.archived_at IS NOT NULL
       )
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

  -- Visible manual material pins must still belong to this course author.
  v_problem:=NULL;
  SELECT section.title AS section_title,lesson.id,lesson.title
    INTO v_problem
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
   WHERE lesson.course_id=p_course AND NOT lesson.hidden AND NOT section.hidden
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(lesson.blocks) block
                 WHERE block->>'type'='manual-material'
                   AND block->>'hidden' IS DISTINCT FROM 'true')
     AND NOT public.course_manual_material_blocks_authorized(
       p_principal,v_course.tenant_id,
       COALESCE((SELECT jsonb_agg(block.value) FROM jsonb_array_elements(lesson.blocks) block(value)
                 WHERE block.value->>'hidden' IS DISTINCT FROM 'true'),'[]'::jsonb))
   ORDER BY section.position,lesson.position,lesson.id LIMIT 1;
  IF v_problem.id IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'lesson'::varchar,v_problem.id,
      ('Раздел «'||v_problem.section_title||'» → урок «'||v_problem.title||'»')::varchar,
      'Закреплённый материал больше недоступен для нового выпуска.'::varchar;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'ok'::varchar,NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar;
END;
$$;

CREATE FUNCTION public.course_prepublication_validation_v2(p_principal uuid,p_course uuid)
RETURNS TABLE(
  result_code varchar,problem_kind varchar,problem_id uuid,
  problem_path varchar,problem_message varchar,
  problem_section_id uuid,problem_lesson_id uuid,problem_block_id varchar,
  problem_field varchar,problem_reason varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course record; v_check record; v_lesson record; v_entry record;
        v_block jsonb; v_module varchar;
BEGIN
  SELECT id,tenant_id,archived_at INTO v_course FROM public.courses
   WHERE id=p_course AND owner_principal_id=p_principal
     AND public.learning_author_can_use_tenant(p_principal,tenant_id);
  IF v_course.id IS NULL THEN result_code:='course_not_found'; RETURN NEXT; RETURN; END IF;

  -- Keep the current validator's complete semantics and priority. Both STABLE
  -- reads use this statement's snapshot; publish_v4 already holds the course lock.
  SELECT * INTO v_check FROM public.course_prepublication_validation(p_principal,p_course);
  result_code:=v_check.result_code;
  problem_kind:=v_check.problem_kind; problem_id:=v_check.problem_id;
  problem_path:=v_check.problem_path; problem_message:=v_check.problem_message;
  IF result_code='ok' THEN RETURN NEXT; RETURN; END IF;
  IF problem_kind='course' THEN
    problem_field:=CASE WHEN v_course.archived_at IS NOT NULL THEN 'archivedAt' ELSE 'lessons' END;
    problem_reason:=CASE WHEN v_course.archived_at IS NOT NULL THEN 'course_archived' ELSE 'course_empty' END;
    RETURN NEXT; RETURN;
  END IF;

  SELECT lesson.*,section.title AS section_title INTO v_lesson
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
      AND section.course_id=lesson.course_id
   WHERE lesson.id=problem_id AND lesson.course_id=p_course;
  IF v_lesson.id IS NULL THEN
    -- Fail closed if a future validator introduces a different object kind.
    problem_field:='blocks'; problem_reason:='block_invalid'; RETURN NEXT; RETURN;
  END IF;
  problem_section_id:=v_lesson.section_id; problem_lesson_id:=v_lesson.id;
  problem_field:='blocks'; problem_reason:='block_invalid';

  IF NOT public.course_lesson_blocks_valid(v_lesson.blocks) THEN
    IF jsonb_typeof(v_lesson.blocks)='array' THEN
      SELECT entry.value,entry.ordinality INTO v_entry
        FROM jsonb_array_elements(v_lesson.blocks) WITH ORDINALITY entry(value,ordinality)
       WHERE NOT public.course_lesson_blocks_valid(jsonb_build_array(entry.value))
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_lesson.blocks)
                     WITH ORDINALITY earlier(value,ordinality)
                      WHERE earlier.ordinality<entry.ordinality
                        AND earlier.value->>'id'=entry.value->>'id')
       ORDER BY entry.ordinality LIMIT 1;
      IF v_entry.ordinality IS NOT NULL THEN
        v_block:=v_entry.value;
        IF COALESCE(v_block->>'id','') ~ '^[A-Za-z0-9_-]{1,80}$' THEN
          problem_block_id:=v_block->>'id';
        END IF;
        problem_path:=(problem_path||' → блок '||v_entry.ordinality)::varchar;
        problem_field:=public.course_block_problem_field(v_block);
        IF public.course_lesson_blocks_valid(jsonb_build_array(v_block)) THEN
          problem_block_id:=NULL; -- Duplicate IDs are ambiguous; focus the block list.
          problem_reason:='duplicate_block_id';
        ELSIF problem_field='url' THEN
          problem_reason:='asset_invalid';
          problem_message:='Исправьте ссылку на медиа или файл.';
        END IF;
      END IF;
    END IF;
    RETURN NEXT; RETURN;
  END IF;
  IF v_lesson.kind='material' AND jsonb_array_length(v_lesson.blocks)=0
     AND NULLIF(btrim(v_lesson.content),'') IS NULL THEN
    problem_reason:='content_required'; RETURN NEXT; RETURN;
  END IF;
  IF v_lesson.kind='assignment' AND v_lesson.assignment_id IS NOT NULL THEN
    problem_field:='learningActivityVersionId'; problem_reason:='legacy_assignment';
    RETURN NEXT; RETURN;
  END IF;

  FOR v_entry IN
    SELECT entry.value,entry.ordinality
      FROM jsonb_array_elements(v_lesson.blocks) WITH ORDINALITY entry(value,ordinality)
     WHERE entry.value->>'type'='activity' AND entry.value->>'hidden' IS DISTINCT FROM 'true'
     ORDER BY entry.ordinality
  LOOP
    IF NOT public.course_activity_blocks_authorized(
        p_principal,v_course.tenant_id,jsonb_build_array(v_entry.value))
       OR EXISTS (
         SELECT 1 FROM public.learning_activity_versions version
         JOIN public.learning_activities activity ON activity.id=version.activity_id
           AND activity.tenant_id=version.tenant_id
          WHERE version.id=(v_entry.value->>'learningActivityVersionId')::uuid
            AND version.tenant_id=v_course.tenant_id
            AND activity.archived_at IS NOT NULL
       ) THEN
      problem_block_id:=v_entry.value->>'id'; problem_field:='learningActivityVersionId';
      problem_reason:='pin_unavailable';
      problem_path:=(problem_path||' → блок '||v_entry.ordinality)::varchar;
      SELECT version.module_key INTO v_module
        FROM public.learning_activity_versions version
        JOIN public.learning_activities activity ON activity.id=version.activity_id
          AND activity.tenant_id=version.tenant_id
       WHERE version.id=(v_entry.value->>'learningActivityVersionId')::uuid
         AND version.tenant_id=v_course.tenant_id AND activity.owner_principal_id=p_principal
         AND activity.reusable_authored_content AND activity.archived_at IS NULL
         AND version.canonical_contract_version=1 AND version.canonical_kind='project';
      IF v_module IS NOT NULL AND NOT public.module_learning_assignable(v_module) THEN
        problem_reason:='module_unavailable';
        problem_message:='Среда этой практики недоступна для новых назначений. Выберите другую опубликованную практику.';
      END IF;
      RETURN NEXT; RETURN;
    END IF;
  END LOOP;
  IF v_lesson.kind='assignment' AND v_lesson.learning_activity_version_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.learning_activity_versions version
       JOIN public.learning_activities activity ON activity.id=version.activity_id
        WHERE version.id=v_lesson.learning_activity_version_id
          AND version.canonical_contract_version=1 AND version.canonical_kind='project'
          AND public.module_learning_assignable(version.module_key)
          AND version.tenant_id=v_course.tenant_id AND activity.tenant_id=v_course.tenant_id
          AND activity.owner_principal_id=p_principal
          AND activity.reusable_authored_content AND activity.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.learning_migration_compatibility_activity_versions compat
             WHERE compat.learning_activity_version_id=version.id
          )
     ) THEN
    problem_field:='learningActivityVersionId'; problem_reason:='pin_unavailable';
    SELECT version.module_key INTO v_module
      FROM public.learning_activity_versions version
      JOIN public.learning_activities activity ON activity.id=version.activity_id
        AND activity.tenant_id=version.tenant_id
     WHERE version.id=v_lesson.learning_activity_version_id
       AND version.tenant_id=v_course.tenant_id AND activity.owner_principal_id=p_principal
       AND activity.reusable_authored_content AND activity.archived_at IS NULL
       AND version.canonical_contract_version=1 AND version.canonical_kind='project';
    IF v_module IS NOT NULL AND NOT public.module_learning_assignable(v_module) THEN
      problem_reason:='module_unavailable';
      problem_message:='Среда этой практики недоступна для новых назначений. Выберите другую опубликованную практику.';
    END IF;
    RETURN NEXT; RETURN;
  END IF;
  FOR v_entry IN
    SELECT entry.value,entry.ordinality
      FROM jsonb_array_elements(v_lesson.blocks) WITH ORDINALITY entry(value,ordinality)
     WHERE entry.value->>'type'='manual-material' AND entry.value->>'hidden' IS DISTINCT FROM 'true'
     ORDER BY entry.ordinality
  LOOP
    IF NOT public.course_manual_material_blocks_authorized(
        p_principal,v_course.tenant_id,jsonb_build_array(v_entry.value)) THEN
      problem_block_id:=v_entry.value->>'id'; problem_field:='learningActivityVersionId';
      problem_reason:='pin_unavailable';
      problem_path:=(problem_path||' → блок '||v_entry.ordinality)::varchar;
      RETURN NEXT; RETURN;
    END IF;
  END LOOP;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.course_publish_v4(
  p_principal uuid,p_course uuid,p_expected integer,p_request varchar
)
RETURNS TABLE(
  result_code varchar,version_id uuid,version_number integer,published_at timestamptz,reused boolean,
  problem_kind varchar,problem_id uuid,problem_path varchar,problem_message varchar,
  problem_section_id uuid,problem_lesson_id uuid,problem_block_id varchar,
  problem_field varchar,problem_reason varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course public.courses%ROWTYPE; v_check record; v_result record;
BEGIN
  reused:=false;
  SELECT * INTO v_course FROM public.courses
   WHERE id=p_course AND owner_principal_id=p_principal
     AND public.learning_author_can_use_tenant(p_principal,tenant_id) FOR UPDATE;
  IF v_course.id IS NULL THEN result_code:='course_not_found'; RETURN NEXT; RETURN; END IF;
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    result_code:='invalid_request'; RETURN NEXT; RETURN;
  END IF;
  -- Exact receipts survive later draft edits, archive and capability changes
  -- of pinned material. Current course ownership/author access is checked first.
  IF EXISTS (
    SELECT 1 FROM public.audit_events event
     WHERE event.entity_id=p_course AND event.action='course.publication.confirmed'
       AND event.payload_json->>'actorPrincipalId'=p_principal::text
       AND event.payload_json->>'requestId'=p_request
  ) THEN
    SELECT * INTO v_result FROM public.course_publish_v2(p_principal,p_course,p_expected,p_request);
  ELSE
    IF v_course.draft_revision IS DISTINCT FROM p_expected THEN
      result_code:='draft_conflict'; RETURN NEXT; RETURN;
    END IF;
    SELECT * INTO v_check FROM public.course_prepublication_validation_v2(p_principal,p_course);
    IF v_check.result_code IS DISTINCT FROM 'ok' THEN
      result_code:=v_check.result_code;
      problem_kind:=v_check.problem_kind; problem_id:=v_check.problem_id;
      problem_path:=v_check.problem_path; problem_message:=v_check.problem_message;
      problem_section_id:=v_check.problem_section_id; problem_lesson_id:=v_check.problem_lesson_id;
      problem_block_id:=v_check.problem_block_id; problem_field:=v_check.problem_field;
      problem_reason:=v_check.problem_reason; RETURN NEXT; RETURN;
    END IF;
    SELECT * INTO v_result FROM public.course_publish_v2(p_principal,p_course,p_expected,p_request);
  END IF;
  result_code:=v_result.result_code; version_id:=v_result.version_id;
  version_number:=v_result.version_number; published_at:=v_result.published_at;
  reused:=v_result.reused; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.course_block_problem_field(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.course_prepublication_validation_v2(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.course_publish_v4(uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_block_problem_field(jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.course_prepublication_validation_v2(uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.course_publish_v4(uuid,uuid,integer,varchar) TO asalab_app;
