-- A pre-origin Course work row names a handout, not a Run. It is readable only
-- when that handout has exactly one Run and the viewer still has the exact
-- Participation, bilateral identity link (for Account), and Project access.
CREATE FUNCTION public.learning_course_modern_provenance(
    p_viewer_principal_id uuid, p_seat_id uuid,
    p_activity_run_id uuid, p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_scope record;
    v_start_allowed boolean := false;
    v_project_readable boolean := false;
BEGIN
    SELECT run.id, run.tenant_id, run.source_classroom_assignment_id AS assignment_id,
           run.lifecycle_status, course.status AS course_status,
           assignment.status AS assignment_status, classroom.status AS classroom_status,
           seat.id AS seat_id, seat_link.learner_identity_id,
           participation.id AS participation_id, participation.excused,
           actor.kind
      INTO v_scope
      FROM public.classroom_student_seats seat
      JOIN public.classrooms classroom
        ON classroom.tenant_id=seat.tenant_id AND classroom.id=seat.classroom_id
      JOIN public.principals actor ON actor.id=p_viewer_principal_id
      JOIN public.learner_identity_links seat_link
        ON seat_link.tenant_id=seat.tenant_id
       AND seat_link.school_id=classroom.school_id
       AND seat_link.seat_id=seat.id
       AND seat_link.link_kind='student_seat' AND seat_link.status='active'
      JOIN public.activity_runs run
        ON run.id=p_activity_run_id AND run.tenant_id=seat.tenant_id
       AND run.school_id=classroom.school_id AND run.classroom_id=seat.classroom_id
       AND run.source_kind='course'
      JOIN public.classroom_course_runs course
        ON course.tenant_id=run.tenant_id AND course.id=run.source_course_run_id
       AND course.classroom_id=seat.classroom_id
      JOIN public.classroom_course_run_lessons lesson
        ON lesson.tenant_id=run.tenant_id AND lesson.run_id=course.id
       AND lesson.id=run.source_course_lesson_id
       AND lesson.classroom_assignment_id=run.source_classroom_assignment_id
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id=run.tenant_id
       AND assignment.id=run.source_classroom_assignment_id
       AND assignment.classroom_id=seat.classroom_id
       AND assignment.course_run_id=course.id
      JOIN public.activity_participations participation
        ON participation.tenant_id=run.tenant_id
       AND participation.school_id=run.school_id
       AND participation.activity_run_id=run.id
       AND participation.learner_identity_id=seat_link.learner_identity_id
       AND participation.status IN ('assigned','active')
      LEFT JOIN public.course_enrollments enrollment
        ON enrollment.tenant_id=participation.tenant_id
       AND enrollment.school_id=participation.school_id
       AND enrollment.id=participation.source_course_enrollment_id
     WHERE seat.id=p_seat_id AND seat.status='active'
       AND (participation.source_course_enrollment_id IS NULL
            OR enrollment.status IN ('assigned','active'))
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
                   WHERE account.id=seat.account_id AND account.status='active')))
       AND (SELECT count(*) FROM public.activity_runs sibling
             WHERE sibling.tenant_id=run.tenant_id
               AND sibling.source_classroom_assignment_id=assignment.id)=1;
    IF v_scope.id IS NULL THEN
        RETURN jsonb_build_object('modernCourseRun',false,'activityRunId',NULL,
            'startAllowed',false,'projectReadable',false);
    END IF;

    v_start_allowed := v_scope.lifecycle_status='active'
        AND v_scope.course_status='open' AND v_scope.assignment_status='open'
        AND v_scope.classroom_status='active' AND NOT v_scope.excused
        AND public.learning_course_seat_visible(p_seat_id,
            (SELECT source_course_run_id FROM public.activity_runs WHERE id=v_scope.id))
        AND NOT EXISTS (
            SELECT 1 FROM public.classroom_assignment_work work
             WHERE work.tenant_id=v_scope.tenant_id
               AND work.assignment_id=v_scope.assignment_id
               AND work.seat_id=p_seat_id)
        AND NOT EXISTS (
            SELECT 1 FROM public.learning_project_origins origin
             WHERE origin.school_tenant_id=v_scope.tenant_id
               AND origin.learner_identity_id=v_scope.learner_identity_id
               AND origin.activity_run_id=v_scope.id);
    IF p_project_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.classroom_assignment_work work
             WHERE work.tenant_id=v_scope.tenant_id
               AND work.assignment_id=v_scope.assignment_id
               AND work.seat_id=p_seat_id AND work.project_id=p_project_id
               AND EXISTS (SELECT 1 FROM public.project_context_for_principal(
                   p_viewer_principal_id,p_project_id))
               AND NOT EXISTS (
                   SELECT 1 FROM public.learning_project_origins origin
                    WHERE origin.project_id=p_project_id
                       OR (origin.school_tenant_id=v_scope.tenant_id
                           AND origin.learner_identity_id=v_scope.learner_identity_id
                           AND origin.activity_run_id=v_scope.id))
        ) INTO v_project_readable;
    END IF;
    RETURN jsonb_build_object('modernCourseRun',true,'activityRunId',v_scope.id,
        'startAllowed',v_start_allowed,'projectReadable',v_project_readable);
END;
$$;

REVOKE ALL ON FUNCTION public.learning_course_modern_provenance(uuid,uuid,uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_course_modern_provenance(uuid,uuid,uuid,uuid)
    TO asalab_app;

-- Pinned Direct work predates immutable Project origins. A remembered Project
-- URL still needs its exact Seat, Participation, bilateral Account link, and
-- Project read permission; a handout projection alone is not authorization.
CREATE FUNCTION public.learning_direct_modern_project_readable(
    p_viewer_principal_id uuid, p_seat_id uuid, p_assignment_id uuid,
    p_activity_run_id uuid, p_project_id uuid
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.classroom_assignment_work work
          JOIN public.classroom_assignments assignment
            ON assignment.tenant_id=work.tenant_id
           AND assignment.id=work.assignment_id
           AND assignment.id=p_assignment_id
           AND assignment.course_run_id IS NULL
          JOIN public.classroom_student_seats seat
            ON seat.tenant_id=work.tenant_id AND seat.id=work.seat_id
           AND seat.id=p_seat_id AND seat.status='active'
           AND seat.classroom_id=assignment.classroom_id
          JOIN public.classrooms classroom
            ON classroom.tenant_id=seat.tenant_id
           AND classroom.id=seat.classroom_id
          JOIN public.activity_runs run
            ON run.tenant_id=assignment.tenant_id
           AND run.school_id=classroom.school_id
           AND run.classroom_id=assignment.classroom_id
           AND run.source_classroom_assignment_id=assignment.id
           AND run.id=p_activity_run_id AND run.source_kind='direct'
           AND (assignment.learning_activity_version_id IS NULL
                OR assignment.learning_activity_version_id=run.learning_activity_version_id)
          JOIN public.learner_identity_links seat_link
            ON seat_link.tenant_id=seat.tenant_id
           AND seat_link.school_id=classroom.school_id
           AND seat_link.seat_id=seat.id
           AND seat_link.link_kind='student_seat'
           AND seat_link.status='active'
          JOIN public.activity_participations participation
            ON participation.tenant_id=run.tenant_id
           AND participation.school_id=run.school_id
           AND participation.activity_run_id=run.id
           AND participation.learner_identity_id=seat_link.learner_identity_id
           AND participation.status IN ('assigned','active')
          JOIN public.principals actor ON actor.id=p_viewer_principal_id
         WHERE work.project_id=p_project_id
           AND public.learning_direct_assignment_seat_visible(p_seat_id,p_assignment_id)
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
                       WHERE account.id=seat.account_id AND account.status='active')))
           AND (SELECT count(*) FROM public.activity_runs sibling
                 WHERE sibling.tenant_id=run.tenant_id
                   AND sibling.source_classroom_assignment_id=assignment.id)=1
           AND NOT EXISTS (
               SELECT 1 FROM public.learning_project_origins origin
                WHERE origin.project_id=p_project_id
                   OR (origin.school_tenant_id=run.tenant_id
                       AND origin.school_id=run.school_id
                       AND origin.learner_identity_id=seat_link.learner_identity_id
                       AND origin.activity_run_id=run.id))
           AND EXISTS (SELECT 1 FROM public.project_context_for_principal(
               p_viewer_principal_id,p_project_id))
    );
$$;

REVOKE ALL ON FUNCTION public.learning_direct_modern_project_readable(uuid,uuid,uuid,uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_direct_modern_project_readable(uuid,uuid,uuid,uuid,uuid)
    TO asalab_app;
