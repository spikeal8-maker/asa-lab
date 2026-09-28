-- A2a: resolve the sample of one pinned Course Activity occurrence. The URL is
-- only a locator; every byte request repeats current learner authorization.
CREATE FUNCTION learning_course_activity_sample_url_for_viewer(
    p_activity_run_id uuid, p_account_id uuid, p_seat_id uuid
)
RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT ('/api/class-join/course-activities/' || runtime.id::text || '/sample')::varchar
      FROM public.activity_runs runtime
      JOIN public.classroom_course_runs course
        ON course.tenant_id = runtime.tenant_id
       AND course.id = runtime.source_course_run_id
       AND course.classroom_id = runtime.classroom_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = runtime.tenant_id
       AND classroom.id = runtime.classroom_id
      JOIN public.classroom_course_run_lessons lesson
        ON lesson.tenant_id = runtime.tenant_id
       AND lesson.run_id = course.id
       AND lesson.id = runtime.source_course_lesson_id
      JOIN LATERAL jsonb_array_elements(lesson.blocks) AS block(value) ON
           block.value ->> 'id' = runtime.source_course_block_id
       AND block.value ->> 'type' = 'activity'
       AND block.value ->> 'learningActivityVersionId' = runtime.learning_activity_version_id::text
       AND block.value -> 'hidden' IS DISTINCT FROM 'true'::jsonb
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = runtime.tenant_id
       AND assignment.id = runtime.source_classroom_assignment_id
       AND assignment.classroom_id = runtime.classroom_id
       AND assignment.course_run_id = course.id
      JOIN public.classroom_student_seats seat
        ON seat.tenant_id = runtime.tenant_id
       AND seat.classroom_id = runtime.classroom_id
       AND seat.status = 'active'
       AND ((p_seat_id IS NOT NULL AND seat.id = p_seat_id)
            OR (p_account_id IS NOT NULL AND seat.account_id = p_account_id))
      JOIN public.learning_activity_versions version
        ON version.tenant_id = runtime.tenant_id
       AND version.id = runtime.learning_activity_version_id
       AND version.canonical_contract_version = 1
      JOIN public.learning_activity_version_media media
        ON media.tenant_id = version.tenant_id
       AND media.activity_version_id = version.id
       AND media.role = 'sample'
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = assignment.id
       AND work.seat_id = seat.id
      LEFT JOIN public.learner_identity_links link
        ON link.tenant_id = runtime.tenant_id
       AND link.school_id = runtime.school_id
       AND link.seat_id = seat.id
       AND link.link_kind = 'student_seat'
       AND link.status = 'active'
      LEFT JOIN public.activity_participations participation
        ON participation.tenant_id = runtime.tenant_id
       AND participation.school_id = runtime.school_id
       AND participation.activity_run_id = runtime.id
       AND participation.learner_identity_id = link.learner_identity_id
      LEFT JOIN public.course_enrollments enrollment
        ON enrollment.tenant_id = runtime.tenant_id
       AND enrollment.school_id = runtime.school_id
       AND enrollment.course_run_id = course.id
       AND enrollment.learner_identity_id = link.learner_identity_id
       AND enrollment.id = participation.source_course_enrollment_id
      LEFT JOIN LATERAL (
          SELECT (public.learning_effective_conditions_internal(
              runtime.id, participation.id
          )#>>'{values,opensAt}')::timestamptz AS opens_at
           WHERE participation.id IS NOT NULL
      ) conditions ON true
     WHERE runtime.id = p_activity_run_id
       AND runtime.source_kind = 'course'
       AND runtime.source_course_block_id IS NOT NULL
       AND runtime.lifecycle_status IN ('active', 'closed', 'archived')
       AND course.status IN ('open', 'closed')
       AND (classroom.status = 'active'
            OR (classroom.status = 'archived' AND work.project_id IS NOT NULL))
       AND num_nonnulls(p_account_id, p_seat_id) = 1
       -- A bound project keeps its exact historical sample. Every unstarted
       -- byte request must pass the current, exact participation and its
       -- effective run/individual opening time, including operational edits.
       AND (work.project_id IS NOT NULL OR (
           classroom.status = 'active'
           AND course.status = 'open'
           AND assignment.status = 'open'
           AND runtime.lifecycle_status = 'active'
           AND public.learning_course_seat_visible(seat.id, course.id)
           AND participation.status IN ('assigned', 'active')
           AND (participation.source_course_enrollment_id IS NULL
                OR enrollment.status IN ('assigned', 'active'))
           AND (conditions.opens_at IS NULL OR conditions.opens_at <= now())
       ))
     LIMIT 1;
$$;

CREATE FUNCTION learning_course_activity_sample_for_viewer(
    p_activity_run_id uuid, p_account_id uuid, p_seat_id uuid
)
RETURNS TABLE (sample_bytes bytea, sample_content_type varchar, content_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT media.bytes, media.content_type::varchar, media.content_hash::varchar
      FROM public.activity_runs runtime
      JOIN public.learning_activity_version_media media
        ON media.tenant_id = runtime.tenant_id
       AND media.activity_version_id = runtime.learning_activity_version_id
       AND media.role = 'sample'
     WHERE runtime.id = p_activity_run_id
       AND public.learning_course_activity_sample_url_for_viewer(
           p_activity_run_id, p_account_id, p_seat_id
       ) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION learning_course_activity_sample_url_for_viewer(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_course_activity_sample_for_viewer(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_course_activity_sample_url_for_viewer(uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_course_activity_sample_for_viewer(uuid,uuid,uuid) TO asalab_app;
