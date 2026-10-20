-- A8.1: exact, read-only teacher navigation from a frozen Course lesson to its
-- ActivityRuns. Reuse the class staff authority; organization membership alone
-- does not grant access. Closed runs/archived classes retain readable history.
CREATE FUNCTION public.learning_course_teacher_activity_occurrences(
    p_actor_principal uuid,
    p_classroom uuid
)
RETURNS TABLE (
    run_id uuid,
    lesson_id uuid,
    block_id varchar,
    activity_run_id uuid,
    classroom_assignment_id uuid,
    learning_activity_version_id uuid,
    title varchar,
    goal varchar,
    module_key varchar,
    assignment_scope_exact boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT course_run.id, lesson.id, runtime.source_course_block_id,
           runtime.id, assignment.id, version.id, version.title, version.goal,
           version.module_key,
           NOT EXISTS (
               SELECT 1 FROM public.activity_runs sibling
                WHERE sibling.tenant_id = runtime.tenant_id
                  AND sibling.source_classroom_assignment_id = assignment.id
                  AND sibling.id <> runtime.id
           )
      FROM public.principals actor
      JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
      CROSS JOIN LATERAL public.classroom_teacher_access_any(actor.account_id, p_classroom) access
      JOIN public.tenants tenant ON tenant.id = access.tenant_id AND tenant.status = 'active'
      JOIN public.classrooms classroom
        ON classroom.id = p_classroom AND classroom.tenant_id = access.tenant_id
      JOIN public.classroom_course_runs course_run
        ON course_run.classroom_id = classroom.id AND course_run.tenant_id = classroom.tenant_id
      JOIN public.course_versions course_version ON course_version.id = course_run.course_version_id
       AND course_version.course_id = course_run.course_id
      JOIN public.classroom_course_run_lessons lesson
        ON lesson.run_id = course_run.id AND lesson.tenant_id = course_run.tenant_id
      CROSS JOIN LATERAL jsonb_array_elements(course_version.outline -> 'sections') frozen_section
      CROSS JOIN LATERAL jsonb_array_elements(frozen_section -> 'lessons') frozen_lesson
      JOIN public.activity_runs runtime
        ON runtime.tenant_id = course_run.tenant_id AND runtime.classroom_id = classroom.id
       AND runtime.school_id = classroom.school_id AND runtime.source_kind = 'course'
       AND runtime.source_course_run_id = course_run.id
       AND runtime.source_course_lesson_id = lesson.id
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = runtime.tenant_id
       AND assignment.classroom_id = classroom.id
       AND assignment.course_run_id = course_run.id
       AND assignment.id = runtime.source_classroom_assignment_id
      JOIN public.learning_activity_versions version
        ON version.tenant_id = runtime.tenant_id AND version.id = runtime.learning_activity_version_id
     WHERE actor.id = p_actor_principal
       AND frozen_section ->> 'sourceSectionId' = lesson.source_section_id::text
       AND frozen_lesson ->> 'sourceLessonId' = lesson.source_lesson_id::text
       AND (
           (runtime.source_course_block_id IS NULL
            AND lesson.kind = 'assignment'
            AND lesson.classroom_assignment_id = assignment.id
            AND frozen_lesson ->> 'learningActivityVersionId' = version.id::text)
           OR
           (runtime.source_course_block_id IS NOT NULL AND EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(lesson.blocks) block
                 JOIN jsonb_array_elements(frozen_lesson -> 'blocks') frozen_block
                   ON frozen_block ->> 'id' = block ->> 'id'
                WHERE block ->> 'type' = 'activity'
                  AND frozen_block ->> 'type' = 'activity'
                  AND block ->> 'id' = runtime.source_course_block_id
                  AND block -> 'hidden' IS DISTINCT FROM 'true'::jsonb
                  AND frozen_block -> 'hidden' IS DISTINCT FROM 'true'::jsonb
                  AND block ->> 'learningActivityVersionId' = version.id::text
                  AND frozen_block ->> 'learningActivityVersionId' = version.id::text
           ))
       )
     ORDER BY course_run.id, lesson.section_position, lesson.lesson_position,
              runtime.source_course_block_id NULLS FIRST, runtime.id;
$$;

REVOKE ALL ON FUNCTION public.learning_course_teacher_activity_occurrences(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_course_teacher_activity_occurrences(uuid, uuid) TO asalab_app;
