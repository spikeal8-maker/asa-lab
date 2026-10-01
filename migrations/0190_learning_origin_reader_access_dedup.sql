-- Batch exact-origin projection for learner lists. The authorization predicates
-- are the same as the singleton reader in 0189, except that each candidate
-- Project is processed by one set-based SQL statement. For a personal Project,
-- owner-or-active-linked access already implies project_context_for_principal;
-- the general check repeated the expensive linked scan for every list row.
-- The helper is callable only inside these SECURITY DEFINER entrypoints.
CREATE OR REPLACE FUNCTION public.learning_origin_work_context_for_project_ids(
    p_viewer_principal_id uuid, p_project_ids uuid[]
)
RETURNS TABLE (context jsonb, evidence jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH exact_work AS (
      SELECT origin.*, project.module_key AS project_module_key,
             participation.status AS participation_status,
             participation.excused AS participation_excused,
             participation.teacher_selected_attempt_id,
             run.classroom_id, run.source_classroom_assignment_id,
             run.lifecycle_status, run.source_kind AS run_source_kind,
             run.source_course_run_id AS run_course_id,
             run.source_course_lesson_id AS run_lesson_id,
             run.source_course_block_id AS run_block_id,
             run.learning_activity_version_id AS run_version_id,
             version.version_number, version.content_digest,
             version.title, version.instructions, version.goal,
             version.goal_snapshot_present, version.blocks,
             version.blocks_snapshot_present, version.canonical_contract_version,
             assignment.status AS assignment_status,
             classroom.status AS classroom_status, classroom.title AS classroom_title,
             course.status AS course_status, course.title AS course_title,
             lesson.title AS lesson_title, seat.id AS seat_id,
             seat.account_id AS seat_account_id, seat.status AS seat_status,
             seat_principal.id AS seat_principal_id,
             draft.updated_at AS draft_updated_at,
             snapshot.source_revision AS snapshot_revision,
             public.learning_effective_conditions_internal(run.id, participation.id)
               AS effective_conditions
        FROM public.learning_project_origins origin
        JOIN public.projects project
          ON project.id = origin.project_id
         AND project.tenant_id = origin.project_tenant_id
         AND project.owner_principal_id = origin.owner_principal_id
         AND project.project_scope = 'personal'
        JOIN public.activity_participations participation
          ON participation.id = origin.participation_id
         AND participation.tenant_id = origin.school_tenant_id
         AND participation.school_id = origin.school_id
         AND participation.learner_identity_id = origin.learner_identity_id
         AND participation.activity_run_id = origin.activity_run_id
        JOIN public.activity_runs run
          ON run.id = origin.activity_run_id
         AND run.tenant_id = origin.school_tenant_id
         AND run.school_id = origin.school_id
         AND run.learning_activity_version_id = origin.learning_activity_version_id
         AND run.source_kind = origin.source_kind
         AND run.source_course_run_id IS NOT DISTINCT FROM origin.source_course_run_id
         AND run.source_course_lesson_id IS NOT DISTINCT FROM origin.source_course_lesson_id
         AND run.source_course_block_id IS NOT DISTINCT FROM origin.source_course_block_id
        JOIN public.learning_activity_versions version
          ON version.id = origin.learning_activity_version_id
         AND version.tenant_id = origin.school_tenant_id
         AND version.module_key = project.module_key
        JOIN public.classroom_assignments assignment
          ON assignment.id = run.source_classroom_assignment_id
         AND assignment.tenant_id = origin.school_tenant_id
         AND assignment.classroom_id = run.classroom_id
        JOIN public.classrooms classroom
          ON classroom.id = run.classroom_id
         AND classroom.tenant_id = origin.school_tenant_id
         AND classroom.school_id = origin.school_id
        JOIN public.learner_identities learner
          ON learner.id = origin.learner_identity_id
         AND learner.tenant_id = origin.school_tenant_id
         AND learner.school_id = origin.school_id
         AND learner.state = 'active'
        JOIN public.principals viewer ON viewer.id = p_viewer_principal_id
        JOIN public.classroom_student_seats seat
          ON seat.tenant_id = origin.school_tenant_id
         AND seat.classroom_id = run.classroom_id
         AND seat.status = 'active'
         AND ((viewer.kind = 'student_seat' AND viewer.seat_id = seat.id)
              OR (viewer.kind = 'account' AND viewer.account_id = seat.account_id))
        JOIN public.learner_identity_links seat_link
          ON seat_link.tenant_id = origin.school_tenant_id
         AND seat_link.school_id = origin.school_id
         AND seat_link.learner_identity_id = origin.learner_identity_id
         AND seat_link.link_kind = 'student_seat'
         AND seat_link.seat_id = seat.id AND seat_link.status = 'active'
        LEFT JOIN public.principals seat_principal ON seat_principal.seat_id = seat.id
        LEFT JOIN public.classroom_course_runs course
          ON course.id = run.source_course_run_id
         AND course.tenant_id = origin.school_tenant_id
         AND course.classroom_id = run.classroom_id
        LEFT JOIN public.classroom_course_run_lessons lesson
          ON lesson.id = run.source_course_lesson_id
         AND lesson.tenant_id = origin.school_tenant_id
         AND lesson.run_id = course.id
        JOIN public.project_drafts draft
          ON draft.project_id = project.id AND draft.tenant_id = project.tenant_id
        LEFT JOIN public.project_snapshots snapshot
          ON snapshot.project_id = project.id AND snapshot.tenant_id = project.tenant_id
       WHERE origin.project_id = ANY(p_project_ids)
         AND (origin.owner_principal_id = p_viewer_principal_id
              OR public.learning_linked_project_access(p_viewer_principal_id, origin.project_id))
         AND (viewer.kind = 'student_seat' OR EXISTS (
             SELECT 1 FROM public.accounts account
             JOIN public.learner_identity_links account_link
               ON account_link.account_id = account.id
              AND account_link.tenant_id = origin.school_tenant_id
              AND account_link.school_id = origin.school_id
              AND account_link.learner_identity_id = origin.learner_identity_id
              AND account_link.link_kind = 'account'
              AND account_link.status = 'active'
             WHERE account.id = viewer.account_id AND account.status = 'active'))
         AND ((run.source_kind = 'direct'
               AND run.source_course_run_id IS NULL
               AND run.source_course_lesson_id IS NULL
               AND run.source_course_block_id IS NULL
               AND assignment.course_run_id IS NULL
               AND public.learning_direct_assignment_seat_visible(
                   seat.id, assignment.id))
              OR (run.source_kind = 'course'
                  AND course.id IS NOT NULL AND lesson.id IS NOT NULL
                  AND assignment.course_run_id = course.id
                  AND public.learning_course_seat_visible(seat.id, course.id)
                  AND EXISTS (
                    SELECT 1 FROM public.course_enrollments enrollment
                     WHERE enrollment.id = participation.source_course_enrollment_id
                       AND enrollment.tenant_id = origin.school_tenant_id
                       AND enrollment.school_id = origin.school_id
                       AND enrollment.course_run_id = course.id
                       AND enrollment.learner_identity_id = origin.learner_identity_id
                       AND enrollment.status IN ('assigned', 'active'))
                  AND ((run.source_course_block_id IS NULL
                        AND lesson.kind = 'assignment'
                        AND lesson.classroom_assignment_id = run.source_classroom_assignment_id
                        AND lesson.module_key = version.module_key
                        AND public.learning_course_assignment_lesson_pinned(run.id))
                    OR (run.source_course_block_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(lesson.blocks) block
                         WHERE block->>'id' = run.source_course_block_id
                           AND block->>'type' = 'activity'
                           AND block->'hidden' IS DISTINCT FROM 'true'::jsonb
                           AND block->>'learningActivityVersionId' = version.id::text)))))
    ), with_attempt AS (
      SELECT work.*, attempt.id AS attempt_id,
             attempt.attempt_number, attempt.state AS attempt_state,
             attempt.revision_of_attempt_id, attempt.started_at,
             attempt.submitted_at AS attempt_submitted_at,
             review.review_decision, submission.id AS submission_id,
             submission.project_version_id AS submitted_project_version_id,
             submission.submitted_at AS submission_submitted_at,
             submission.late_state, selected_attempt.id AS selected_attempt_id,
             selected.attempt_id AS selected_candidate_attempt_id,
             result.id AS selected_result_id, result.raw_points,
             result.max_points, result.percentage_basis_points,
             result.completion_value, result.outcome,
             result.published_at
        FROM exact_work work
        JOIN LATERAL (
          SELECT item.* FROM public.learning_attempts item
           WHERE item.activity_participation_id = work.participation_id
             AND item.tenant_id = work.school_tenant_id
             AND item.learner_identity_id = work.learner_identity_id
             AND item.classroom_id = work.classroom_id
             AND item.classroom_assignment_id = work.source_classroom_assignment_id
             AND item.seat_id = work.seat_id
             AND item.learning_activity_version_id = work.learning_activity_version_id
           ORDER BY item.attempt_number DESC, item.id DESC LIMIT 1
        ) attempt ON true
        LEFT JOIN LATERAL (
          SELECT item.review_decision FROM public.assessment_results item
           WHERE item.attempt_id = attempt.id
           ORDER BY item.revision_number DESC LIMIT 1
        ) review ON true
        LEFT JOIN public.learning_submissions submission
          ON submission.attempt_id = attempt.id
         AND submission.tenant_id = work.school_tenant_id
         AND submission.project_id = work.project_id
         AND submission.project_tenant_id = work.project_tenant_id
        LEFT JOIN LATERAL public.learning_selected_result_internal(work.participation_id)
          selected ON true
        LEFT JOIN public.learning_attempts selected_attempt
          ON selected_attempt.id = selected.attempt_id
         AND selected_attempt.activity_participation_id = work.participation_id
         AND selected_attempt.tenant_id = work.school_tenant_id
         AND selected_attempt.learner_identity_id = work.learner_identity_id
         AND selected_attempt.classroom_id = work.classroom_id
         AND selected_attempt.classroom_assignment_id = work.source_classroom_assignment_id
         AND selected_attempt.seat_id = work.seat_id
         AND selected_attempt.learning_activity_version_id = work.learning_activity_version_id
        LEFT JOIN public.assessment_results result
          ON result.id = selected.result_id
         AND result.attempt_id = selected_attempt.id
    )
    SELECT jsonb_build_object(
        'projectId', work.project_id,
        'seatId', work.seat_id,
        'classroomAssignmentId', work.source_classroom_assignment_id,
        'activityRunId', work.activity_run_id,
        'participationId', work.participation_id,
        'learningActivityVersionId', work.learning_activity_version_id,
        'assignmentVersionId', NULL,
        'runVersionId', work.run_version_id,
        'versionNumber', work.version_number,
        'contentDigest', work.content_digest,
        'sourceKind', work.source_kind,
        'courseRunId', work.run_course_id,
        'courseLessonId', work.run_lesson_id,
        'courseBlockId', work.run_block_id,
        'title', work.title,
        'brief', work.instructions,
        'goal', CASE WHEN work.goal_snapshot_present THEN work.goal ELSE NULL END,
        'blocks', work.blocks,
        'blocksSnapshotPresent', work.blocks_snapshot_present,
        'moduleKey', work.project_module_key,
        'sampleImage', CASE WHEN work.source_kind = 'direct'
          AND work.canonical_contract_version = 1
          AND EXISTS (SELECT 1 FROM public.learning_activity_version_media media
            WHERE media.activity_version_id = work.learning_activity_version_id
              AND media.role = 'sample')
          THEN '/api/assignments/activity-versions/' ||
               work.learning_activity_version_id::text || '/sample'
          ELSE NULL END,
        'dueAt', work.effective_conditions#>'{values,dueAt}',
        'assignmentStatus', work.assignment_status,
        'runStatus', work.lifecycle_status,
        'courseStatus', work.course_status,
        'classroomStatus', work.classroom_status,
        'seatStatus', work.seat_status,
        'participationStatus', work.participation_status,
        'participationExcused', work.participation_excused,
        'effectiveConditions', work.effective_conditions,
        'submittedAt', CASE WHEN work.attempt_state = 'closed'
          AND work.review_decision = 'changes_requested' THEN NULL
          ELSE work.submission_submitted_at END,
        'snapshotRevision', work.snapshot_revision,
        'updatedAt', work.draft_updated_at,
        'attemptId', work.attempt_id,
        'attemptNumber', work.attempt_number,
        'submissionId', work.submission_id,
        'submittedProjectVersionId', work.submitted_project_version_id,
        'classroomTitle', work.classroom_title,
        'courseTitle', work.course_title,
        'lessonTitle', work.lesson_title
    ), jsonb_build_object(
        'tenantId', work.school_tenant_id,
        'schoolId', work.school_id,
        'classroomId', work.classroom_id,
        'classroomAssignmentId', work.source_classroom_assignment_id,
        'kind', CASE WHEN work.source_kind = 'course'
          THEN 'course_project' ELSE 'direct_project' END,
        'dueAt', work.effective_conditions#>'{values,dueAt}',
        'assignmentStatus', work.assignment_status,
        'seatId', work.seat_id,
        'accountId', work.seat_account_id,
        'principalId', work.seat_principal_id,
        'learnerId', work.learner_identity_id,
        'identityResolution', 'learner_identity',
        'seatStatus', work.seat_status,
        'classroomAccess', CASE WHEN work.classroom_status = 'active'
          THEN 'active' ELSE 'ended' END,
        'legacyWork', NULL,
        'courseProgressPresent', work.source_kind = 'course',
        'attempt', CASE WHEN work.attempt_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', work.attempt_id,
          'attemptNumber', work.attempt_number,
          'revisionOfAttemptId', work.revision_of_attempt_id,
          'state', work.attempt_state,
          'reviewDecision', work.review_decision,
          'startedAt', work.started_at,
          'submittedAt', work.attempt_submitted_at,
          'lateState', work.late_state) END,
        'selectedAttemptExists', work.selected_attempt_id IS NOT NULL,
        'activityRunId', work.activity_run_id,
        'participation', jsonb_build_object(
          'applicable', true, 'status', work.participation_status,
          'excused', work.participation_excused),
        'selectedRevision', CASE WHEN work.selected_result_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', work.selected_result_id,
            'attemptId', work.selected_attempt_id,
            'rawPoints', work.raw_points,
            'maxPoints', work.max_points,
            'percentageBasisPoints', work.percentage_basis_points,
            'displayGrade', public.learning_grade_label_for_run(
              work.activity_run_id, work.percentage_basis_points),
            'completionValue', work.completion_value,
            'outcome', work.outcome,
            'publishedAt', work.published_at) END,
        'resultSelectionSource', 'canonical',
        'selectedAttemptId', work.selected_attempt_id,
        'selectedResult', NULL,
        'selectionConflict', CASE WHEN work.selected_candidate_attempt_id IS NOT NULL
          AND work.selected_attempt_id IS NULL THEN 'pointer_scope_mismatch'
          WHEN work.teacher_selected_attempt_id IS NOT NULL
          AND work.selected_attempt_id IS NULL THEN 'selected_attempt_missing'
          ELSE NULL END,
        'validUnselectedResultCount', 0,
        'compatibilityGradingUnknown', false,
        'reusableAuthoredContent', true,
        'projectId', work.project_id
    ) FROM with_attempt work;
$$;

REVOKE ALL ON FUNCTION public.learning_origin_work_context_for_project_ids(uuid,uuid[])
    FROM PUBLIC;

-- Materialize the same origin candidates, then project all of one actor's
-- Projects in one reader call. Match the returned exact IDs back to each
-- candidate exactly as the old per-row LATERAL reader did.
CREATE OR REPLACE FUNCTION public.learning_origin_learner_list(
    p_seat_id uuid, p_account_id uuid
)
RETURNS TABLE (context jsonb, evidence jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH candidates AS MATERIALIZED (
      SELECT actor.id AS actor_id, seat.id AS seat_id,
             origin.project_id, origin.participation_id, origin.activity_run_id
        FROM public.classroom_student_seats seat
        JOIN public.principals actor
          ON (p_seat_id IS NOT NULL AND actor.kind = 'student_seat'
              AND actor.seat_id = seat.id)
          OR (p_account_id IS NOT NULL AND actor.kind = 'account'
              AND actor.account_id = seat.account_id)
        JOIN public.learner_identity_links seat_link
          ON seat_link.tenant_id = seat.tenant_id
         AND seat_link.seat_id = seat.id
         AND seat_link.link_kind = 'student_seat'
         AND seat_link.status = 'active'
        JOIN public.learning_project_origins origin
          ON origin.school_tenant_id = seat.tenant_id
         AND origin.school_id = seat_link.school_id
         AND origin.learner_identity_id = seat_link.learner_identity_id
        JOIN public.activity_runs run
          ON run.id = origin.activity_run_id
         AND run.tenant_id = origin.school_tenant_id
         AND run.classroom_id = seat.classroom_id
       WHERE num_nonnulls(p_seat_id, p_account_id) = 1
         AND seat.status = 'active'
         AND ((p_seat_id IS NOT NULL AND seat.id = p_seat_id)
              OR (p_account_id IS NOT NULL AND seat.account_id = p_account_id))
    ), actors AS (
      SELECT actor_id, array_agg(project_id) AS project_ids
        FROM candidates GROUP BY actor_id
    )
    SELECT reader.context, reader.evidence
      FROM actors actor
      CROSS JOIN LATERAL public.learning_origin_work_context_for_project_ids(
          actor.actor_id, actor.project_ids) reader
      JOIN candidates candidate
        ON candidate.actor_id = actor.actor_id
       AND reader.context->>'projectId' = candidate.project_id::text
       AND reader.context->>'seatId' = candidate.seat_id::text
       AND reader.context->>'participationId' = candidate.participation_id::text
       AND reader.context->>'activityRunId' = candidate.activity_run_id::text;
$$;

REVOKE ALL ON FUNCTION public.learning_origin_learner_list(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_origin_learner_list(uuid,uuid) TO asalab_app;
