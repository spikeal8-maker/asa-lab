CREATE OR REPLACE FUNCTION learning_canonical_evidence_internal(
    p_classroom_id uuid,
    p_seat_id uuid DEFAULT NULL,
    p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (evidence jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'tenantId', assignment.tenant_id,
        'schoolId', classroom.school_id,
        'classroomId', classroom.id,
        'classroomAssignmentId', assignment.id,
        'kind', CASE
            WHEN assignment.quiz_version_id IS NOT NULL THEN 'quiz'
            WHEN assignment.course_run_id IS NOT NULL THEN 'course_project'
            ELSE 'direct_project'
        END,
        'dueAt', COALESCE(participation.due_at_override,run.due_at,assignment.due_at),
        'activityRunId', run.id,
        'participation', CASE WHEN run.id IS NULL THEN NULL ELSE jsonb_build_object(
          'applicable',participation.id IS NOT NULL,'status',COALESCE(participation.status,'assigned'),
          'excused',COALESCE(participation.excused,false)) END,
        'assignmentStatus', assignment.status,
        'seatId', seat.id,
        'accountId', seat.account_id,
        'principalId', seat_principal.id,
        'learnerId', learner_link.learner_identity_id,
        'identityResolution', CASE
            WHEN learner_link.learner_identity_id IS NOT NULL THEN 'learner_identity'
            ELSE 'seat_compatibility'
        END,
        'seatStatus', seat.status,
        'classroomAccess', CASE WHEN classroom.status = 'active' THEN 'active' ELSE 'ended' END,
        'legacyWork', CASE WHEN work.id IS NULL THEN NULL ELSE jsonb_build_object(
            'projectId', work.project_id,
            'startedAt', work.started_at,
            'submittedAt', work.submitted_at
        ) END,
        'courseProgressPresent', assignment.course_run_id IS NOT NULL,
        'attempt', CASE WHEN attempt.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', attempt.id,
            'attemptNumber', attempt.attempt_number,
            'state', attempt.state,
            'startedAt', attempt.started_at,
            'submittedAt', attempt.submitted_at,
            'lateState', submission.late_state
        ) END,
        'selectedAttemptExists', CASE WHEN run.id IS NOT NULL THEN canonical_selection.attempt_id IS NOT NULL ELSE selected_attempt.id IS NOT NULL END,
        'resultSelectionSource', CASE WHEN run.id IS NOT NULL THEN 'canonical' WHEN grade.id IS NULL THEN 'none' ELSE 'gradebook_pointer' END,
        'selectedAttemptId', CASE WHEN run.id IS NOT NULL THEN canonical_selection.attempt_id ELSE grade.accepted_attempt_id END,
        'selectedRevision',CASE WHEN run.id IS NULL OR canonical_result.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id',canonical_result.id,'attemptId',canonical_result.attempt_id,'rawPoints',canonical_result.raw_points,
          'maxPoints',canonical_result.max_points,'percentageBasisPoints',canonical_result.percentage_basis_points,
          'displayGrade',NULL,'completionValue',canonical_result.completion_value,
          'outcome',canonical_result.outcome,'publishedAt',canonical_result.published_at) END,
        'selectedResult', CASE WHEN selected_result.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', selected_result.id,
            'attemptId', selected_result.attempt_id,
            'rawPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.raw_points END,
            'maxPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.max_points END,
            'percentageBasisPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.percentage_basis_points END,
            'displayGrade', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE
                COALESCE(public.grade_label_for_classroom(assignment.classroom_id, selected_result.percentage_basis_points),
                    CASE selected_result.outcome WHEN 'passed' THEN 'Зачёт' WHEN 'failed' THEN 'Не зачтено' END)
            END,
            'outcome', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.outcome END,
            'publishedAt', selected_result.published_at
        ) END,
        'selectionConflict', CASE
            WHEN run.id IS NOT NULL THEN CASE WHEN participation.teacher_selected_attempt_id IS NOT NULL AND canonical_selection.attempt_id IS NULL THEN 'selected_attempt_missing' ELSE NULL END
            WHEN grade.id IS NULL THEN NULL
            WHEN selected_attempt.id IS NULL THEN 'selected_attempt_missing'
            WHEN selected_result.id IS NULL THEN 'selected_result_missing'
            WHEN selected_attempt.classroom_assignment_id <> assignment.id
              OR selected_attempt.seat_id <> seat.id
              OR selected_attempt.tenant_id <> assignment.tenant_id THEN 'pointer_scope_mismatch'
            WHEN selected_result.attempt_id <> grade.accepted_attempt_id THEN 'attempt_result_mismatch'
            ELSE NULL
        END,
        'validUnselectedResultCount', CASE WHEN run.id IS NOT NULL THEN 0 ELSE (
            SELECT count(*)::integer
              FROM public.learning_attempts candidate_attempt
              JOIN public.assessment_results candidate_result
                ON candidate_result.attempt_id = candidate_attempt.id
             WHERE candidate_attempt.classroom_assignment_id = assignment.id
               AND candidate_attempt.seat_id = seat.id
               AND (grade.assessment_result_id IS NULL OR candidate_result.id <> grade.assessment_result_id)
        ) END,
        'compatibilityGradingUnknown', compatibility.grading_semantics = 'unknown',
        'reusableAuthoredContent', COALESCE(compatibility.reusable_authored_content, true)
    )
      FROM public.classroom_assignments assignment
      JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
      JOIN public.classroom_student_seats seat ON seat.classroom_id = assignment.classroom_id
      LEFT JOIN public.principals seat_principal ON seat_principal.seat_id = seat.id
      LEFT JOIN public.learner_identity_links learner_link
        ON learner_link.seat_id = seat.id
       AND learner_link.tenant_id = assignment.tenant_id
       AND learner_link.school_id = classroom.school_id
       AND learner_link.status = 'active'
      LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=assignment.id
      LEFT JOIN public.activity_participations participation ON participation.activity_run_id=run.id
        AND participation.learner_identity_id=learner_link.learner_identity_id
      LEFT JOIN LATERAL public.learning_selected_result_internal(participation.id) canonical_selection ON true
      LEFT JOIN public.assessment_results canonical_result ON canonical_result.id=canonical_selection.result_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = assignment.id AND work.seat_id = seat.id
      LEFT JOIN LATERAL (
          SELECT current_attempt.*
            FROM public.learning_attempts current_attempt
           WHERE current_attempt.classroom_assignment_id = assignment.id
             AND current_attempt.seat_id = seat.id
           ORDER BY current_attempt.attempt_number DESC, current_attempt.id DESC
           LIMIT 1
      ) attempt ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
      LEFT JOIN public.gradebook_entries grade
        ON grade.classroom_assignment_id = assignment.id AND grade.seat_id = seat.id
      LEFT JOIN public.learning_attempts selected_attempt ON selected_attempt.id = grade.accepted_attempt_id
      LEFT JOIN public.assessment_results selected_result ON selected_result.id = grade.assessment_result_id
      LEFT JOIN public.learning_migration_compatibility_activity_versions compatibility
        ON compatibility.classroom_assignment_id = assignment.id
     WHERE assignment.classroom_id = p_classroom_id
       AND (p_seat_id IS NULL OR seat.id = p_seat_id)
       AND (p_include_inactive OR seat.status = 'active')
     ORDER BY assignment.created_at, assignment.id, seat.display_label, seat.id;
$$;
