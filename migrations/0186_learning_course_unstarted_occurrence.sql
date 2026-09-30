-- A4: an assignment-level canonical projection cannot describe an untouched
-- sibling Course Activity after another Run on the same handout has started.
-- Prove the exact, still-unstarted Run for the current viewer before exposing
-- its workflow state. This proof does not authorize Project access or writes.
CREATE FUNCTION public.learning_course_occurrence_not_started_visible(
    p_viewer_principal_id uuid, p_seat_id uuid, p_activity_run_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.principals actor
          JOIN public.classroom_student_seats seat
            ON seat.id=p_seat_id AND seat.status='active'
          JOIN public.classrooms classroom
            ON classroom.tenant_id=seat.tenant_id
           AND classroom.id=seat.classroom_id
          JOIN public.activity_runs run
            ON run.id=p_activity_run_id AND run.tenant_id=seat.tenant_id
           AND run.school_id=classroom.school_id
           AND run.classroom_id=seat.classroom_id
           AND run.source_kind='course'
           AND run.source_course_block_id IS NOT NULL
          JOIN public.classroom_course_runs course
            ON course.tenant_id=run.tenant_id
           AND course.id=run.source_course_run_id
           AND course.classroom_id=seat.classroom_id
          JOIN public.classroom_course_run_lessons lesson
            ON lesson.tenant_id=run.tenant_id
           AND lesson.run_id=course.id
           AND lesson.id=run.source_course_lesson_id
           AND lesson.classroom_assignment_id=run.source_classroom_assignment_id
          JOIN LATERAL jsonb_array_elements(lesson.blocks) block(value)
            ON block.value ->> 'id'=run.source_course_block_id
           AND block.value ->> 'type'='activity'
           AND block.value ->> 'learningActivityVersionId'
               =run.learning_activity_version_id::text
           AND block.value -> 'hidden' IS DISTINCT FROM 'true'::jsonb
          JOIN public.classroom_assignments assignment
            ON assignment.tenant_id=run.tenant_id
           AND assignment.id=run.source_classroom_assignment_id
           AND assignment.classroom_id=seat.classroom_id
           AND assignment.course_run_id=course.id
          JOIN public.learner_identity_links seat_link
            ON seat_link.tenant_id=run.tenant_id
           AND seat_link.school_id=run.school_id
           AND seat_link.seat_id=seat.id
           AND seat_link.link_kind='student_seat'
           AND seat_link.status='active'
          JOIN public.activity_participations participation
            ON participation.tenant_id=run.tenant_id
           AND participation.school_id=run.school_id
           AND participation.activity_run_id=run.id
           AND participation.learner_identity_id=seat_link.learner_identity_id
           AND participation.status IN ('assigned','active')
           AND NOT participation.excused
          LEFT JOIN public.course_enrollments enrollment
            ON enrollment.tenant_id=participation.tenant_id
           AND enrollment.school_id=participation.school_id
           AND enrollment.id=participation.source_course_enrollment_id
         WHERE actor.id=p_viewer_principal_id
           AND ((actor.kind='student_seat' AND actor.seat_id=seat.id)
                OR (actor.kind='account' AND actor.account_id=seat.account_id
                    AND EXISTS (
                        SELECT 1 FROM public.accounts account
                        JOIN public.learner_identity_links account_link
                          ON account_link.account_id=account.id
                         AND account_link.tenant_id=seat_link.tenant_id
                         AND account_link.school_id=seat_link.school_id
                         AND account_link.learner_identity_id=seat_link.learner_identity_id
                         AND account_link.link_kind='account'
                         AND account_link.status='active'
                         WHERE account.id=seat.account_id
                           AND account.status='active')))
           AND course.status IN ('open','closed')
           AND public.learning_course_seat_visible(seat.id,course.id)
           AND (participation.source_course_enrollment_id IS NULL
                OR enrollment.status IN ('assigned','active'))
           AND NOT EXISTS (
               SELECT 1 FROM public.classroom_assignment_work work
                WHERE work.tenant_id=run.tenant_id
                  AND work.assignment_id=assignment.id
                  AND work.seat_id=seat.id)
           AND NOT EXISTS (
               SELECT 1 FROM public.learning_attempts attempt
                WHERE attempt.tenant_id=run.tenant_id
                  AND attempt.activity_participation_id=participation.id)
           AND NOT EXISTS (
               SELECT 1 FROM public.learning_project_origins origin
                WHERE origin.school_tenant_id=run.tenant_id
                  AND origin.school_id=run.school_id
                  AND origin.learner_identity_id=seat_link.learner_identity_id
                  AND origin.activity_run_id=run.id)
    );
$$;

REVOKE ALL ON FUNCTION public.learning_course_occurrence_not_started_visible(uuid,uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_course_occurrence_not_started_visible(uuid,uuid,uuid)
    TO asalab_app;
