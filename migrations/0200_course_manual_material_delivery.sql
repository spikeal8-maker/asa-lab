-- Exact published manual material within an owner-authored CourseVersion.
CREATE OR REPLACE FUNCTION public.course_lesson_blocks_valid(p_blocks jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_blocks) > 40 OR octet_length(p_blocks::text) > 60000 THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_blocks) block
         WHERE jsonb_typeof(block) <> 'object'
            OR coalesce(block ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,80}$'
            OR coalesce(block ->> 'type', '') NOT IN (
                'paragraph', 'heading', 'callout', 'image', 'video', 'audio', 'file',
                'code', 'formula', 'table', 'divider', 'activity', 'manual-material'
            )
            OR (block ? 'hidden' AND coalesce(jsonb_typeof(block -> 'hidden'), '') <> 'boolean')
            OR CASE block ->> 'type'
                WHEN 'paragraph' THEN
                    block - ARRAY['id','type','text','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(block ->> 'text') > 12000
                WHEN 'heading' THEN
                    block - ARRAY['id','type','text','level','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 300
                    OR coalesce(block ->> 'level', '') NOT IN ('2', '3')
                WHEN 'callout' THEN
                    block - ARRAY['id','type','text','tone','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 3000
                    OR coalesce(block ->> 'tone', '') NOT IN ('note', 'tip', 'warning')
                WHEN 'image' THEN
                    block - ARRAY['id','type','url','alt','caption','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'alt' AND coalesce(jsonb_typeof(block -> 'alt'), '') <> 'string')
                    OR length(coalesce(block ->> 'alt', '')) > 300
                    OR (block ? 'caption'
                        AND coalesce(jsonb_typeof(block -> 'caption'), '') <> 'string')
                    OR length(coalesce(block ->> 'caption', '')) > 600
                WHEN 'video' THEN
                    block - ARRAY['id','type','url','title','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'title'
                        AND coalesce(jsonb_typeof(block -> 'title'), '') <> 'string')
                    OR length(coalesce(block ->> 'title', '')) > 300
                WHEN 'audio' THEN
                    block - ARRAY['id','type','url','title','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'title'
                        AND coalesce(jsonb_typeof(block -> 'title'), '') <> 'string')
                    OR length(coalesce(block ->> 'title', '')) > 300
                WHEN 'file' THEN
                    block - ARRAY['id','type','url','label','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR coalesce(jsonb_typeof(block -> 'label'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'label', ''))) = 0
                    OR length(block ->> 'label') > 300
                WHEN 'code' THEN
                    block - ARRAY['id','type','text','language','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(block ->> 'text') > 20000
                    OR (
                        block ? 'language'
                        AND (
                            coalesce(jsonb_typeof(block -> 'language'), '') <> 'string'
                            OR coalesce(block ->> 'language', '') !~ '^[A-Za-z0-9][A-Za-z0-9_+.#-]{0,79}$'
                        )
                    )
                WHEN 'formula' THEN
                    block - ARRAY['id','type','text','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 4000
                WHEN 'table' THEN
                    block - ARRAY['id','type','rows','hidden'] <> '{}'::jsonb
                    OR NOT public.course_lesson_table_rows_valid(block -> 'rows')
                WHEN 'divider' THEN
                    block - ARRAY['id','type','hidden'] <> '{}'::jsonb
                WHEN 'activity' THEN
                    block - ARRAY['id','type','learningActivityVersionId','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'learningActivityVersionId'), '') <> 'string'
                    OR coalesce(block ->> 'learningActivityVersionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                WHEN 'manual-material' THEN
                    block - ARRAY['id','type','learningActivityVersionId','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'learningActivityVersionId'), '') <> 'string'
                    OR coalesce(block ->> 'learningActivityVersionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                ELSE true
              END
    ) THEN RETURN false; END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_blocks) block
         GROUP BY block ->> 'id'
        HAVING count(*) > 1
    ) THEN RETURN false; END IF;

    RETURN true;
END;
$$;

CREATE FUNCTION public.course_manual_material_blocks_authorized(
  p_principal uuid, p_tenant uuid, p_blocks jsonb
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_block jsonb;
BEGIN
  IF NOT public.course_lesson_blocks_valid(p_blocks) THEN RETURN false; END IF;
  FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks)
      WHERE value->>'type'='manual-material' LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.learning_activity_versions version
      JOIN public.learning_activities activity ON activity.id=version.activity_id
        AND activity.tenant_id=version.tenant_id
      WHERE version.id=(v_block->>'learningActivityVersionId')::uuid
        AND version.tenant_id=p_tenant AND version.canonical_contract_version=1
        AND version.canonical_kind='manual' AND version.module_key IS NULL
        AND version.blocks_snapshot_present AND version.published_at IS NOT NULL
        AND activity.owner_principal_id=p_principal
        AND activity.reusable_authored_content AND activity.authoring_origin='canonical'
        AND activity.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.learning_migration_compatibility_activity_versions compat
                        WHERE compat.learning_activity_version_id=version.id)
    ) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION public.course_lesson_manual_material_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course record;
BEGIN
  IF NEW.blocks IS NULL OR jsonb_typeof(NEW.blocks)<>'array'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.blocks) block
                    WHERE block->>'type'='manual-material') THEN RETURN NEW; END IF;
  SELECT tenant_id,owner_principal_id INTO v_course FROM public.courses WHERE id=NEW.course_id;
  IF v_course.tenant_id IS NULL OR NOT public.course_manual_material_blocks_authorized(
      v_course.owner_principal_id,v_course.tenant_id,NEW.blocks) THEN
    RAISE EXCEPTION 'course manual material exact version is unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER course_lessons_manual_material_guard
  BEFORE INSERT OR UPDATE ON public.course_lessons
  FOR EACH ROW EXECUTE FUNCTION public.course_lesson_manual_material_guard();

-- A CourseRun pins a CourseVersion. The lesson block is looked up in its
-- materialized snapshot; this proof never follows the author's latest draft.
ALTER TABLE public.classroom_course_runs ADD COLUMN opens_at timestamptz;

CREATE FUNCTION public.learning_course_manual_material_for_viewer(
  p_run uuid,p_lesson uuid,p_block varchar,p_account uuid,p_seat uuid
) RETURNS TABLE(version_id uuid,version_number integer,content_digest varchar,
                title varchar,blocks jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT version.id,version.version_number,version.content_digest,
         version.title,version.blocks
    FROM public.classroom_course_runs run
    JOIN public.classrooms classroom ON classroom.id=run.classroom_id
      AND classroom.tenant_id=run.tenant_id AND classroom.status='active'
    JOIN public.classroom_course_run_lessons lesson ON lesson.run_id=run.id
      AND lesson.tenant_id=run.tenant_id AND lesson.id=p_lesson
    JOIN LATERAL jsonb_array_elements(lesson.blocks) block(value) ON
      block.value->>'id'=p_block AND block.value->>'type'='manual-material'
      AND block.value->>'hidden' IS DISTINCT FROM 'true'
      AND block.value->>'learningActivityVersionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    JOIN public.learning_activity_versions version ON
      version.id=(block.value->>'learningActivityVersionId')::uuid
      AND version.tenant_id=run.tenant_id AND version.canonical_contract_version=1
      AND version.canonical_kind='manual' AND version.module_key IS NULL
      AND version.blocks_snapshot_present AND version.published_at IS NOT NULL
    JOIN public.classroom_student_seats seat ON seat.classroom_id=run.classroom_id
      AND seat.tenant_id=run.tenant_id AND seat.status='active'
      AND (seat.id=p_seat OR p_account IS NOT NULL)
   WHERE run.id=p_run AND num_nonnulls(p_account,p_seat)=1
     AND (run.opens_at IS NULL OR run.opens_at<=now())
     AND public.learning_course_seat_visible(seat.id,run.id)
     AND (p_account IS NULL OR EXISTS (
       SELECT 1 FROM public.accounts account
       JOIN public.learner_identity_links account_link ON account_link.account_id=account.id
         AND account_link.tenant_id=run.tenant_id AND account_link.school_id=classroom.school_id
         AND account_link.link_kind='account' AND account_link.status='active'
       JOIN public.learner_identity_links seat_link ON seat_link.learner_identity_id=account_link.learner_identity_id
         AND seat_link.tenant_id=account_link.tenant_id AND seat_link.school_id=account_link.school_id
         AND seat_link.link_kind='student_seat' AND seat_link.status='active'
         AND seat_link.seat_id=seat.id
       WHERE account.id=p_account AND account.status='active'
     ))
     AND public.learning_safe_task_blocks_valid(version.blocks)
   LIMIT 1;
$$;

CREATE FUNCTION public.learning_course_manual_media_for_viewer(
  p_run uuid,p_lesson uuid,p_block varchar,p_account uuid,p_seat uuid,
  p_role varchar,p_hash varchar
) RETURNS TABLE(media_bytes bytea,content_type varchar,content_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT media.bytes,media.content_type::varchar,media.content_hash::varchar
    FROM public.learning_course_manual_material_for_viewer(
      p_run,p_lesson,p_block,p_account,p_seat) material
    JOIN public.learning_activity_versions version ON version.id=material.version_id
    JOIN public.learning_activity_version_media media ON
      media.tenant_id=version.tenant_id AND media.activity_version_id=version.id
      AND media.role=p_role AND media.content_hash=p_hash
   WHERE p_role IN ('task-image','task-file')
     AND version.blocks @> jsonb_build_array(jsonb_build_object(
       'type',CASE WHEN p_role='task-image' THEN 'image' ELSE 'file' END,
       'contentHash',p_hash))
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.course_manual_material_blocks_authorized(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_manual_material_blocks_authorized(uuid,uuid,jsonb) TO asalab_app;
REVOKE ALL ON FUNCTION public.course_lesson_manual_material_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_course_manual_material_for_viewer(uuid,uuid,varchar,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_course_manual_media_for_viewer(uuid,uuid,varchar,uuid,uuid,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_course_manual_material_for_viewer(uuid,uuid,varchar,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_course_manual_media_for_viewer(uuid,uuid,varchar,uuid,uuid,varchar,varchar) TO asalab_app;

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
