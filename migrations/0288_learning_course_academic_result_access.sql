-- LRN-UX-02 P1: authorize published academic results independently of
-- Project-origin and editable Project bytes. Immutable migration 0267 is unchanged.
CREATE FUNCTION public.learning_course_academic_result_visible(
    p_viewer_principal_id uuid, p_seat_id uuid, p_activity_run_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.principals viewer
          JOIN public.classroom_student_seats seat
            ON seat.id = p_seat_id AND seat.status = 'active'
          JOIN public.classrooms classroom
            ON classroom.tenant_id = seat.tenant_id
           AND classroom.id = seat.classroom_id
          JOIN public.activity_runs run
            ON run.id = p_activity_run_id
           AND run.tenant_id = seat.tenant_id
           AND run.school_id = classroom.school_id
           AND run.classroom_id = seat.classroom_id
           AND run.source_kind = 'course'
           AND run.source_course_block_id IS NOT NULL
          JOIN public.classroom_course_runs course
            ON course.id = run.source_course_run_id
           AND course.tenant_id = run.tenant_id
           AND course.classroom_id = seat.classroom_id
          JOIN public.classroom_course_run_lessons lesson
            ON lesson.id = run.source_course_lesson_id
           AND lesson.tenant_id = run.tenant_id
           AND lesson.run_id = course.id
          JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(lesson.blocks) = 'array'
              THEN lesson.blocks ELSE '[]'::jsonb END
          ) block(value)
            ON block.value ->> 'id' = run.source_course_block_id
           AND block.value ->> 'type' = 'activity'
           AND block.value ->> 'learningActivityVersionId'
               = run.learning_activity_version_id::text
           AND block.value -> 'hidden' IS DISTINCT FROM 'true'::jsonb
          JOIN public.classroom_assignments assignment
            ON assignment.id = run.source_classroom_assignment_id
           AND assignment.tenant_id = run.tenant_id
           AND assignment.classroom_id = seat.classroom_id
           AND assignment.course_run_id = course.id
          JOIN public.learner_identity_links seat_link
            ON seat_link.tenant_id = run.tenant_id
           AND seat_link.school_id = run.school_id
           AND seat_link.seat_id = seat.id
           AND seat_link.link_kind = 'student_seat'
           AND seat_link.status = 'active'
          JOIN public.activity_participations participation
            ON participation.tenant_id = run.tenant_id
           AND participation.school_id = run.school_id
           AND participation.activity_run_id = run.id
           AND participation.learner_identity_id = seat_link.learner_identity_id
           AND participation.status IN ('assigned', 'active')
          JOIN public.course_enrollments enrollment
            ON enrollment.id = participation.source_course_enrollment_id
           AND enrollment.tenant_id = run.tenant_id
           AND enrollment.school_id = run.school_id
           AND enrollment.course_run_id = course.id
           AND enrollment.learner_identity_id = seat_link.learner_identity_id
           AND enrollment.status IN ('assigned', 'active')
         WHERE viewer.id = p_viewer_principal_id
           AND ((viewer.kind = 'student_seat' AND viewer.seat_id = seat.id)
                OR (viewer.kind = 'account' AND viewer.account_id = seat.account_id
                    AND EXISTS (
                        SELECT 1
                          FROM public.accounts account
                          JOIN public.learner_identity_links account_link
                            ON account_link.account_id = account.id
                           AND account_link.tenant_id = run.tenant_id
                           AND account_link.school_id = run.school_id
                           AND account_link.learner_identity_id =
                               seat_link.learner_identity_id
                           AND account_link.link_kind = 'account'
                           AND account_link.status = 'active'
                         WHERE account.id = seat.account_id
                           AND account.status = 'active')))
           AND course.status IN ('open', 'closed')
           AND public.learning_course_seat_visible(seat.id, course.id)
           AND (SELECT count(*) FROM public.activity_runs sibling
                 WHERE sibling.tenant_id = run.tenant_id
                   AND sibling.source_course_run_id = course.id
                   AND sibling.source_course_lesson_id = lesson.id
                   AND sibling.source_course_block_id = run.source_course_block_id) = 1
    );
$$;

REVOKE ALL ON FUNCTION public.learning_course_academic_result_visible(uuid, uuid, uuid)
    FROM PUBLIC, asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_course_academic_result_visible(uuid, uuid, uuid)
    TO asalab_app;
