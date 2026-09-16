-- E1 course authoring closure: non-destructive archive and exact publish validation.
-- Existing CourseVersion/CourseRun history remains immutable and addressable.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS courses_owner_archive_idx
  ON public.courses(owner_principal_id, archived_at, updated_at DESC);

CREATE OR REPLACE FUNCTION public.content_is_visible(
  p_kind varchar, p_subject_id uuid, p_visibility varchar, p_owner uuid,
  p_tenant uuid, p_principal uuid, p_account uuid, p_viewer_tenant uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE
    WHEN p_kind='course' AND EXISTS (
      SELECT 1 FROM public.courses archived
       WHERE archived.id=p_subject_id AND archived.archived_at IS NOT NULL
    ) THEN p_owner=p_principal
    WHEN p_owner=p_principal THEN true
    WHEN p_visibility='public' THEN true
    WHEN p_visibility='school' THEN p_tenant=p_viewer_tenant
    WHEN p_visibility='teachers' THEN EXISTS (
      SELECT 1 FROM public.content_shares share
       WHERE share.subject_kind=p_kind AND share.subject_id=p_subject_id
         AND share.account_id=p_account
    )
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.content_is_visible(varchar,uuid,varchar,uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.content_is_visible(varchar,uuid,varchar,uuid,uuid,uuid,uuid,uuid)
  TO asalab_app;

CREATE OR REPLACE FUNCTION public.course_archive_set(
  p_principal uuid, p_course uuid, p_archived boolean, p_expected_revision integer
)
RETURNS TABLE(result_code varchar,draft_revision integer,archived_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course public.courses%ROWTYPE;
BEGIN
  SELECT * INTO v_course FROM public.courses
   WHERE id=p_course AND owner_principal_id=p_principal FOR UPDATE;
  IF v_course.id IS NULL THEN
    RETURN QUERY SELECT 'course_not_found'::varchar,NULL::integer,NULL::timestamptz; RETURN;
  END IF;
  IF v_course.draft_revision IS DISTINCT FROM p_expected_revision THEN
    RETURN QUERY SELECT 'draft_conflict'::varchar,v_course.draft_revision,v_course.archived_at; RETURN;
  END IF;
  IF (v_course.archived_at IS NOT NULL)=p_archived THEN
    RETURN QUERY SELECT 'ok'::varchar,v_course.draft_revision,v_course.archived_at; RETURN;
  END IF;
  UPDATE public.courses
     SET archived_at=CASE WHEN p_archived THEN now() ELSE NULL END, updated_at=now()
   WHERE id=p_course RETURNING * INTO v_course;
  INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
  VALUES(v_course.tenant_id,'course',p_course,
    CASE WHEN p_archived THEN 'course.archived' ELSE 'course.restored' END,
    jsonb_build_object('actorPrincipalId',p_principal,'draftRevision',v_course.draft_revision));
  RETURN QUERY SELECT 'ok'::varchar,v_course.draft_revision,v_course.archived_at;
END;
$$;
REVOKE ALL ON FUNCTION public.course_archive_set(uuid,uuid,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_archive_set(uuid,uuid,boolean,integer) TO asalab_app;

CREATE OR REPLACE FUNCTION public.course_library_list_v3(p_principal_id uuid)
RETURNS TABLE(
  id uuid,title varchar,summary varchar,visibility varchar,age_band varchar,
  section_count integer,lesson_count integer,assignment_count integer,shared_with integer,
  copied_from_course_id uuid,publication_state varchar,published_version integer,
  published_at timestamptz,created_at timestamptz,updated_at timestamptz,
  draft_revision integer,archived_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT base.id,base.title,base.summary,base.visibility,base.age_band,
         base.section_count,base.lesson_count,base.assignment_count,base.shared_with,
         base.copied_from_course_id,base.publication_state,base.published_version,
         base.published_at,base.created_at,base.updated_at,base.draft_revision,course.archived_at
    FROM public.course_library_list_v2(p_principal_id) base
    JOIN public.courses course ON course.id=base.id
   ORDER BY (course.archived_at IS NOT NULL), base.updated_at DESC, base.id;
$$;
REVOKE ALL ON FUNCTION public.course_library_list_v3(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_library_list_v3(uuid) TO asalab_app;

CREATE OR REPLACE FUNCTION public.course_prepublication_validation(
  p_principal uuid,p_course uuid
)
RETURNS TABLE(
  result_code varchar,problem_kind varchar,problem_id uuid,
  problem_path varchar,problem_message varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course record; v_problem record;
BEGIN
  SELECT id,archived_at INTO v_course FROM public.courses
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
  IF NOT EXISTS (SELECT 1 FROM public.course_lessons lesson WHERE lesson.course_id=p_course) THEN
    RETURN QUERY SELECT 'course_empty'::varchar,'course'::varchar,p_course,
      'Курс'::varchar,'Добавьте хотя бы один урок перед публикацией.'::varchar;
    RETURN;
  END IF;

  SELECT section.title AS section_title,lesson.id,lesson.title
    INTO v_problem
    FROM public.course_lessons lesson
    JOIN public.course_sections section ON section.id=lesson.section_id
   WHERE lesson.course_id=p_course
     AND NOT public.course_lesson_blocks_valid(lesson.blocks)
   ORDER BY section.position,lesson.position,lesson.id LIMIT 1;
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
   WHERE lesson.course_id=p_course AND lesson.kind='material'
     AND jsonb_array_length(lesson.blocks)=0 AND NULLIF(btrim(lesson.content),'') IS NULL
   ORDER BY section.position,lesson.position,lesson.id LIMIT 1;
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
   WHERE lesson.course_id=p_course AND lesson.kind='assignment'
     AND lesson.assignment_id IS NOT NULL
   ORDER BY section.position,lesson.position,lesson.id LIMIT 1;
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
   WHERE lesson.course_id=p_course AND lesson.kind='assignment'
     AND lesson.learning_activity_version_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.learning_activity_versions version
       JOIN public.learning_activities activity ON activity.id=version.activity_id
       WHERE version.id=lesson.learning_activity_version_id
         AND version.canonical_contract_version=1 AND version.canonical_kind='project'
         AND version.module_key IN ('electronics','three-d')
         AND activity.owner_principal_id=p_principal AND activity.reusable_authored_content
         AND activity.archived_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.learning_migration_compatibility_activity_versions compat
            WHERE compat.learning_activity_version_id=version.id
         )
     )
   ORDER BY section.position,lesson.position,lesson.id LIMIT 1;
  IF v_problem.id IS NOT NULL THEN
    RETURN QUERY SELECT 'prepublish_invalid'::varchar,'lesson'::varchar,v_problem.id,
      ('Раздел «'||v_problem.section_title||'» → урок «'||v_problem.title||'»')::varchar,
      'Закреплённый материал больше недоступен для нового выпуска. Выберите актуальную опубликованную версию.'::varchar;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::varchar,NULL::varchar,NULL::uuid,NULL::varchar,NULL::varchar;
END;
$$;
REVOKE ALL ON FUNCTION public.course_prepublication_validation(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_prepublication_validation(uuid,uuid) TO asalab_app;

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
REVOKE ALL ON FUNCTION public.course_publish_v3(uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_publish_v3(uuid,uuid,integer,varchar) TO asalab_app;
