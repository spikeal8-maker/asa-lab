-- Preserve the active Start/assignment visibility predicates while admitting
-- only an already-originated terminal Direct or Course work item. Every
-- historical branch still requires the exact origin, Participation, Attempt,
-- version, Course lesson/block and currently active Seat/Account identity links.
-- This is a read projection for archive/restore; Start and submit keep their
-- active-only admission checks.
-- Evaluate immutable-origin Project access once for the requested Project
-- before joining the full work projection. This preserves both prior access
-- predicates and the exact context/evidence shape.
CREATE OR REPLACE FUNCTION public.learning_origin_work_context_for_project(
    p_viewer_principal_id uuid, p_project_id uuid
)
RETURNS TABLE (context jsonb, evidence jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH authorized_project AS MATERIALIZED (
      SELECT origin.project_id
        FROM public.learning_project_origins origin
        JOIN public.projects project
          ON project.id = origin.project_id
         AND project.tenant_id = origin.project_tenant_id
         AND project.owner_principal_id = origin.owner_principal_id
         AND project.project_scope = 'personal'
       WHERE origin.project_id = p_project_id
         AND EXISTS (SELECT 1 FROM public.project_context_for_principal(
             p_viewer_principal_id, p_project_id))
         AND (origin.owner_principal_id = p_viewer_principal_id
              OR public.learning_linked_project_access(p_viewer_principal_id, p_project_id))
    ), exact_work AS (
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
        FROM authorized_project authorized
        JOIN public.learning_project_origins origin
          ON origin.project_id = authorized.project_id
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
       WHERE origin.project_id = p_project_id
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
               AND (public.learning_direct_assignment_seat_visible(
                      seat.id, assignment.id)
                    OR participation.status = 'withdrawn'
                    OR run.lifecycle_status IN ('cancelled', 'archived')))
              OR (run.source_kind = 'course'
                  AND course.id IS NOT NULL AND lesson.id IS NOT NULL
                  AND assignment.course_run_id = course.id
                  AND EXISTS (
                    SELECT 1 FROM public.course_enrollments enrollment
                     WHERE enrollment.id = participation.source_course_enrollment_id
                       AND enrollment.tenant_id = origin.school_tenant_id
                       AND enrollment.school_id = origin.school_id
                       AND enrollment.course_run_id = course.id
                       AND enrollment.learner_identity_id = origin.learner_identity_id
                       AND ((public.learning_course_seat_visible(seat.id, course.id)
                             AND enrollment.status IN ('assigned', 'active'))
                            OR participation.status = 'withdrawn'
                            OR run.lifecycle_status IN ('cancelled', 'archived')))
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

-- A5-C: learner-only presentation preference for an exact immutable original.
-- Absence means active. No Project status or academic evidence is changed.
CREATE TABLE public.learning_project_archive (
    project_id uuid PRIMARY KEY REFERENCES public.learning_project_origins(project_id),
    archived_at timestamptz NOT NULL DEFAULT now(),
    archived_by_principal_id uuid NOT NULL REFERENCES public.principals(id)
);
REVOKE ALL ON public.learning_project_archive FROM PUBLIC, asalab_app;
ALTER TABLE public.learning_project_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_project_archive FORCE ROW LEVEL SECURITY;
-- Only owner-defined functions can reach this table; the runtime role has no
-- table privileges. The functions perform viewer and lineage checks.
CREATE POLICY learning_project_archive_definer ON public.learning_project_archive
  USING (true) WITH CHECK (true);

-- A later learner action/review invalidates the old presentation preference.
-- In particular a resubmission must stay visible while it awaits review.
CREATE FUNCTION public.learning_project_archive_bucket(
    p_viewer_principal_id uuid,p_project_id uuid)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  WITH work AS (
    SELECT origin.participation_id, origin.activity_run_id,
           part.status AS participation_status, run.lifecycle_status AS run_status,
           archive.archived_at
      FROM public.learning_project_origins origin
      JOIN public.activity_participations part ON part.id = origin.participation_id
      JOIN public.activity_runs run ON run.id = origin.activity_run_id
     LEFT JOIN public.learning_project_archive archive ON archive.project_id = origin.project_id
     WHERE origin.project_id = p_project_id
       AND EXISTS (SELECT 1 FROM public.project_context_for_principal(
         p_viewer_principal_id,p_project_id))
       AND (origin.owner_principal_id = p_viewer_principal_id
         OR public.learning_linked_project_access(p_viewer_principal_id,p_project_id))
  ), latest AS (
    SELECT work.*, attempt.id AS attempt_id, attempt.state AS attempt_state,
           attempt.started_at, attempt.submitted_at,
           review.review_decision, review.review_at
      FROM work
      LEFT JOIN LATERAL (
        SELECT item.id,item.state,item.started_at,item.submitted_at
          FROM public.learning_attempts item
         WHERE item.activity_participation_id = work.participation_id
         ORDER BY item.attempt_number DESC,item.id DESC LIMIT 1
      ) attempt ON true
      LEFT JOIN LATERAL (
        SELECT item.review_decision,item.published_at AS review_at
          FROM public.assessment_results item
         WHERE item.attempt_id = attempt.id
         ORDER BY item.revision_number DESC LIMIT 1
      ) review ON true
  )
  SELECT CASE
    WHEN archived_at IS NOT NULL
      AND (started_at IS NULL OR started_at <= archived_at)
      AND (submitted_at IS NULL OR submitted_at <= archived_at)
      AND (review_at IS NULL OR review_at <= archived_at)
      AND (participation_status = 'withdrawn'
        OR run_status IN ('cancelled','archived')
        OR (attempt_state = 'closed' AND review_decision IS NOT NULL
          AND review_decision <> 'changes_requested'))
      THEN 'learning_archive'
    WHEN participation_status = 'withdrawn'
      OR run_status IN ('cancelled','archived')
      OR (attempt_state = 'closed' AND review_decision IS NOT NULL
          AND review_decision <> 'changes_requested')
      THEN 'completed'
    ELSE 'active'
  END FROM latest;
$$;
REVOKE ALL ON FUNCTION public.learning_project_archive_bucket(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_project_archive_bucket(uuid,uuid) TO asalab_app;

-- The caller never writes the preference table. This command is serialized on
-- the Project row, checks the exact viewer-scoped origin reader, and rechecks
-- the terminal policy inside the same transaction before any change.
CREATE FUNCTION public.learning_project_archive_set(
    p_viewer_principal_id uuid,p_project_id uuid,p_archive boolean)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_context jsonb;
  v_evidence jsonb;
  v_bucket text;
BEGIN
  PERFORM 1 FROM public.projects project
   WHERE project.id = p_project_id AND project.status = 'active'
   FOR UPDATE OF project;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  -- Official review locks Participation before Attempt. Read the exact state
  -- after those locks, so archive cannot be acknowledged from stale review.
  PERFORM 1 FROM public.activity_participations participation
    JOIN public.learning_project_origins origin
      ON origin.participation_id = participation.id
   WHERE origin.project_id = p_project_id FOR UPDATE OF participation;
  PERFORM 1 FROM public.learning_attempts attempt
    JOIN public.learning_project_origins origin
      ON origin.participation_id = attempt.activity_participation_id
   WHERE origin.project_id = p_project_id
   ORDER BY attempt.attempt_number DESC,attempt.id DESC LIMIT 1
   FOR UPDATE OF attempt;
  SELECT exact.context,exact.evidence INTO v_context,v_evidence
    FROM public.learning_origin_work_context_for_project(
      p_viewer_principal_id,p_project_id) exact;
  IF v_context IS NULL OR v_evidence IS NULL
     OR v_context->>'seatStatus' <> 'active'
     OR v_context->>'classroomStatus' <> 'active'
     OR v_evidence->'attempt' IS NULL
     OR v_evidence->'attempt' = 'null'::jsonb THEN
    RETURN 'denied';
  END IF;
  v_bucket := public.learning_project_archive_bucket(
    p_viewer_principal_id,p_project_id);
  IF p_archive THEN
    IF v_bucket NOT IN ('completed','learning_archive') OR v_bucket IS NULL
       OR v_bucket = 'learning_archive' THEN
      RETURN CASE WHEN v_bucket = 'learning_archive' THEN 'learning_archive' ELSE 'denied' END;
    END IF;
    INSERT INTO public.learning_project_archive(project_id,archived_at,archived_by_principal_id)
      VALUES(p_project_id,clock_timestamp(),p_viewer_principal_id)
      ON CONFLICT(project_id) DO UPDATE SET
        archived_at = EXCLUDED.archived_at,
        archived_by_principal_id = EXCLUDED.archived_by_principal_id;
    RETURN 'learning_archive';
  END IF;
  DELETE FROM public.learning_project_archive WHERE project_id = p_project_id;
  RETURN 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.learning_project_archive_set(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_project_archive_set(uuid,uuid,boolean) TO asalab_app;

-- Keep the original reader signature for historical callers. The list API
-- uses this ten-argument form so the collection predicate precedes LIMIT.
-- A5-B: an Account may list a linked Seat's exact immutable-origin Project,
-- even when its Project tenant differs from the Account's active workspace.
-- This reader returns only card fields and reuses the exact linked access
-- predicate; the app role has no direct origin-table privilege.
CREATE FUNCTION public.learning_linked_account_project_list(
    p_viewer_principal_id uuid, p_status text, p_module text,
    p_search text, p_exclude_games boolean, p_sort text,
    p_after_id uuid, p_after_value text, p_limit integer, p_collection text
)
RETURNS TABLE (project jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH linked AS MATERIALIZED (
      SELECT DISTINCT origin.project_id
        FROM public.learning_project_origins origin
        JOIN public.principals actor ON actor.id = p_viewer_principal_id
          AND actor.kind = 'account'
        JOIN public.learner_identity_links account_link
          ON account_link.account_id = actor.account_id
         AND account_link.tenant_id = origin.school_tenant_id
         AND account_link.school_id = origin.school_id
         AND account_link.learner_identity_id = origin.learner_identity_id
         AND account_link.link_kind = 'account'
         AND account_link.status = 'active'
       WHERE public.learning_linked_project_access(
         p_viewer_principal_id, origin.project_id)
    )
    SELECT jsonb_build_object(
        'id', p.id,
        'project_scope', p.project_scope,
        'classroom_id', p.classroom_id,
        'module_key', p.module_key,
        'title', p.title,
        'status', p.status,
        'created_at', p.created_at,
        'updated_at', d.updated_at,
        'preview_json', d.preview_json,
        'preview_digest', d.preview_digest,
        'snapshot_revision', s.source_revision,
        'copied_from_project_id', p.copied_from_project_id,
        'copied_from_author', p.copied_from_author,
        'copied_from_title', p.copied_from_title,
        'copied_at', p.copied_at,
        'description', p.description,
        'tags', p.tags,
        'license', p.license
    )
      FROM linked
      JOIN public.projects p ON p.id = linked.project_id
      JOIN public.project_drafts d ON d.tenant_id = p.tenant_id
        AND d.project_id = p.id
      LEFT JOIN public.project_snapshots s ON s.tenant_id = p.tenant_id
        AND s.project_id = p.id
     WHERE EXISTS (
         SELECT 1 FROM public.project_context_for_principal(
           p_viewer_principal_id, p.id))
       AND p.project_scope = 'personal'
       AND p.status = p_status
       AND ((p_collection IS NULL AND COALESCE(public.learning_project_archive_bucket(p_viewer_principal_id,p.id),'active') <> 'learning_archive')
            OR (p_collection IS NOT NULL AND public.learning_project_archive_bucket(p_viewer_principal_id,p.id) = p_collection))
       AND (p_module IS NULL OR p.module_key = p_module)
       AND (p_search IS NULL OR strpos(lower(p.title),lower(p_search)) > 0)
       AND (NOT p_exclude_games OR p.module_key NOT IN ('chess','checkers'))
       AND (p_after_id IS NULL OR CASE p_sort
            WHEN 'title' THEN (p.title COLLATE "C",p.id) >
              (p_after_value COLLATE "C",p_after_id)
            WHEN 'oldest' THEN
              (date_trunc('milliseconds',d.updated_at),p.id) >
              (p_after_value::timestamptz,p_after_id)
            WHEN 'recent' THEN
              (date_trunc('milliseconds',d.updated_at),p.id) <
              (p_after_value::timestamptz,p_after_id)
            ELSE false END)
       AND p_sort IN ('recent','oldest','title')
       AND p_limit BETWEEN 1 AND 100
     ORDER BY
       CASE WHEN p_sort = 'title' THEN p.title COLLATE "C" END ASC,
       CASE WHEN p_sort = 'oldest' THEN date_trunc('milliseconds',d.updated_at) END ASC,
       CASE WHEN p_sort = 'recent' THEN date_trunc('milliseconds',d.updated_at) END DESC,
       CASE WHEN p_sort IN ('title','oldest') THEN p.id END ASC,
       CASE WHEN p_sort = 'recent' THEN p.id END DESC
     LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.learning_linked_account_project_list(
    uuid,text,text,text,boolean,text,uuid,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_linked_account_project_list(
    uuid,text,text,text,boolean,text,uuid,text,integer,text) TO asalab_app;
