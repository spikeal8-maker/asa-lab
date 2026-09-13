CREATE OR REPLACE FUNCTION classroom_gradebook_list(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    seat_id uuid,
    display_label varchar,
    assignment_id uuid,
    assignment_title varchar,
    attempt_id uuid,
    attempt_number integer,
    attempt_state varchar,
    submitted_at timestamptz,
    raw_points integer,
    max_points integer,
    percentage_basis_points integer,
    outcome varchar,
    feedback varchar,
    published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id, seat.display_label, assignment.id,
           COALESCE(version.title, task.title, lesson.assignment_title, quiz.title),
           attempt.id, attempt.attempt_number, attempt.state,
           submission.submitted_at, result.raw_points, result.max_points,
           result.percentage_basis_points, result.outcome, result.feedback,
           result.published_at
      FROM public.classroom_student_seats seat
      CROSS JOIN public.classroom_assignments assignment
      LEFT JOIN public.classroom_course_run_lessons lesson
        ON lesson.classroom_assignment_id = assignment.id
      LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
      LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=assignment.id
      LEFT JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
      LEFT JOIN public.learner_identity_links link ON link.seat_id=seat.id AND link.status='active'
        AND link.school_id=run.school_id AND link.tenant_id=run.tenant_id
      LEFT JOIN public.activity_participations part ON part.activity_run_id=run.id AND part.learner_identity_id=link.learner_identity_id
      LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
      LEFT JOIN public.quiz_versions quiz ON quiz.id = assignment.quiz_version_id
      LEFT JOIN LATERAL (
          SELECT latest.* FROM public.learning_attempts latest
           WHERE latest.classroom_assignment_id = assignment.id
             AND latest.seat_id = seat.id
           ORDER BY latest.attempt_number DESC LIMIT 1
      ) attempt ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
      LEFT JOIN public.gradebook_entries grade
        ON grade.classroom_assignment_id = assignment.id AND grade.seat_id = seat.id
      LEFT JOIN public.assessment_results result ON result.id = CASE WHEN run.id IS NOT NULL THEN selected.result_id ELSE grade.assessment_result_id END
     WHERE assignment.classroom_id = p_classroom_id
       AND seat.classroom_id = p_classroom_id
       AND (seat.status <> 'removed' OR attempt.id IS NOT NULL)
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships membership
            WHERE membership.account_id = p_account_id
              AND membership.classroom_id = p_classroom_id
              AND membership.tenant_id = assignment.tenant_id
              AND membership.member_role IN ('owner', 'co_teacher')
       )
     ORDER BY assignment.created_at, seat.display_label, seat.id;
$$;
