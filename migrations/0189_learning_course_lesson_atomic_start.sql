-- A4 Course lesson repair: an authored assignment lesson has an exact Run and
-- Participation even though it is not a Course Activity block. Keep NULL block
-- only for this lesson shape; the new Start checks the pinned lesson, handout,
-- module, enrollment and unique Run in one transaction.
ALTER TABLE public.learning_project_origins
    DROP CONSTRAINT learning_project_origins_source_shape_check;
ALTER TABLE public.learning_project_origins
    ADD CONSTRAINT learning_project_origins_source_shape_check CHECK (
        (source_kind = 'direct' AND source_course_run_id IS NULL
         AND source_course_lesson_id IS NULL AND source_course_block_id IS NULL)
        OR (source_kind = 'course' AND source_course_run_id IS NOT NULL
            AND source_course_lesson_id IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION public.learning_work_start_admit(
    p_actor_principal_id uuid, p_activity_run_id uuid, p_request_id varchar
)
RETURNS TABLE (
    result_code varchar, participation_id uuid, module_key varchar,
    project_tenant_id uuid, existing_project_id uuid, existing_attempt_id uuid,
    seat_id uuid, school_tenant_id uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_actor record;
    v_run record;
    v_seat record;
    v_participation public.activity_participations%ROWTYPE;
    v_existing record;
    v_replay_origin record;
    v_attempt record;
    v_effective jsonb;
    v_limit integer;
    v_next integer;
    v_project_tenant uuid;
    v_capable boolean;
BEGIN
    IF p_actor_principal_id IS NULL OR p_activity_run_id IS NULL
       OR p_request_id IS NULL
       OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        p_actor_principal_id::text || ':' || p_request_id, 0));

    SELECT principal.kind, principal.account_id, principal.seat_id
      INTO v_actor FROM public.principals principal
     WHERE principal.id = p_actor_principal_id;
    IF v_actor.kind NOT IN ('student_seat', 'account') THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    SELECT run.tenant_id, run.school_id, run.classroom_id,
           run.learning_activity_version_id, run.source_kind,
           run.source_classroom_assignment_id, run.source_course_run_id,
           run.source_course_lesson_id, run.source_course_block_id,
           run.lifecycle_status, version.module_key,
           classroom.status AS classroom_status,
           assignment.status AS handout_status,
           assignment.course_run_id AS handout_course_run_id,
           course.status AS course_status,
           pinned_course.outline AS course_outline
      INTO v_run
      FROM public.activity_runs run
      JOIN public.learning_activity_versions version
        ON version.tenant_id = run.tenant_id
       AND version.id = run.learning_activity_version_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = run.tenant_id
       AND classroom.id = run.classroom_id
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = run.tenant_id
       AND assignment.id = run.source_classroom_assignment_id
      LEFT JOIN public.classroom_course_runs course
        ON course.tenant_id = run.tenant_id
       AND course.id = run.source_course_run_id
      LEFT JOIN public.course_versions pinned_course
        ON pinned_course.tenant_id = course.tenant_id
       AND pinned_course.course_id = course.course_id
       AND pinned_course.id = course.course_version_id
     WHERE run.id = p_activity_run_id
     FOR SHARE OF run;
    IF v_run.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    PERFORM set_config('app.tenant_id', v_run.tenant_id::text, true);
    -- Keep a capability revocation from racing this transaction's start.
    SELECT capability.creatable AND capability.assignable
           AND capability.editable_evidence AND capability.submit_project_version
      INTO v_capable FROM public.module_learning_capabilities capability
     WHERE capability.module_key = v_run.module_key FOR SHARE;

    SELECT active_seat.id, active_seat.account_id
      INTO v_seat
      FROM public.classroom_student_seats active_seat
     WHERE active_seat.tenant_id = v_run.tenant_id
       AND active_seat.classroom_id = v_run.classroom_id
       AND active_seat.status = 'active'
       AND ((v_actor.kind = 'student_seat' AND active_seat.id = v_actor.seat_id)
            OR (v_actor.kind = 'account' AND active_seat.account_id = v_actor.account_id))
     ORDER BY active_seat.id LIMIT 1 FOR SHARE OF active_seat;
    IF v_seat.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    SELECT participation.* INTO v_participation
      FROM public.activity_participations participation
      JOIN public.learner_identity_links seat_link
        ON seat_link.tenant_id = participation.tenant_id
       AND seat_link.school_id = participation.school_id
       AND seat_link.learner_identity_id = participation.learner_identity_id
       AND seat_link.link_kind = 'student_seat'
       AND seat_link.seat_id = v_seat.id AND seat_link.status = 'active'
     WHERE participation.tenant_id = v_run.tenant_id
       AND participation.school_id = v_run.school_id
       AND participation.activity_run_id = p_activity_run_id
       AND (v_actor.kind = 'student_seat' OR EXISTS (
           SELECT 1 FROM public.learner_identity_links account_link
            WHERE account_link.tenant_id = participation.tenant_id
              AND account_link.school_id = participation.school_id
              AND account_link.learner_identity_id = participation.learner_identity_id
              AND account_link.link_kind = 'account'
              AND account_link.account_id = v_actor.account_id
              AND account_link.status = 'active'
       ))
     FOR UPDATE OF participation;
    IF v_participation.id IS NULL OR v_participation.status = 'withdrawn'
       OR v_participation.excused THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF v_run.source_kind = 'direct' THEN
        IF NOT public.learning_direct_assignment_seat_visible(
            v_seat.id, v_run.source_classroom_assignment_id) THEN
            RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
                NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
    ELSIF v_run.source_kind = 'course' THEN
        IF v_participation.source_course_enrollment_id IS NULL
           OR v_run.handout_course_run_id IS DISTINCT FROM v_run.source_course_run_id
           OR NOT public.learning_course_seat_visible(v_seat.id, v_run.source_course_run_id)
           OR NOT EXISTS (
               SELECT 1 FROM public.classroom_course_run_lessons lesson
                WHERE lesson.tenant_id = v_run.tenant_id
                  AND lesson.run_id = v_run.source_course_run_id
                  AND lesson.id = v_run.source_course_lesson_id
                  AND ((v_run.source_course_block_id IS NULL
                        AND lesson.kind = 'assignment'
                        AND lesson.classroom_assignment_id = v_run.source_classroom_assignment_id
                        AND lesson.module_key = v_run.module_key
                        AND (SELECT count(*)
                               FROM jsonb_array_elements(v_run.course_outline->'sections') section
                               CROSS JOIN LATERAL jsonb_array_elements(section->'lessons') pinned_lesson
                              WHERE section->>'sourceSectionId' = lesson.source_section_id::text
                                AND pinned_lesson->>'sourceLessonId' = lesson.source_lesson_id::text
                                AND pinned_lesson->>'kind' = 'assignment'
                                AND pinned_lesson->>'learningActivityVersionId' =
                                    v_run.learning_activity_version_id::text) = 1
                        AND NOT EXISTS (
                            SELECT 1 FROM public.classroom_assignment_work work
                             WHERE work.tenant_id = v_run.tenant_id
                               AND work.assignment_id = v_run.source_classroom_assignment_id
                               AND work.seat_id = v_seat.id)
                        AND (SELECT count(*) FROM public.activity_runs sibling
                              WHERE sibling.source_classroom_assignment_id =
                                    v_run.source_classroom_assignment_id) = 1)
                    OR (v_run.source_course_block_id IS NOT NULL
                        AND EXISTS (
                            SELECT 1 FROM jsonb_array_elements(lesson.blocks) block
                             WHERE block ->> 'id' = v_run.source_course_block_id
                               AND block ->> 'type' = 'activity'
                               AND block -> 'hidden' IS DISTINCT FROM 'true'::jsonb
                               AND block ->> 'learningActivityVersionId'
                                   = v_run.learning_activity_version_id::text)))
           ) THEN
            RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
                NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
    ELSE
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    SELECT request.activity_run_id, request.project_id, request.attempt_id,
           request.project_tenant_id INTO v_existing
      FROM public.learning_work_start_requests request
     WHERE request.actor_principal_id = p_actor_principal_id
       AND request.request_id = p_request_id;
    IF v_existing.activity_run_id IS NOT NULL THEN
        IF v_existing.activity_run_id <> p_activity_run_id THEN
            RETURN QUERY SELECT 'request_conflict'::varchar, NULL::uuid,
                NULL::varchar, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        ELSE
            -- Idempotency never bypasses today's exact Project access. In
            -- particular, an old Seat request cannot reveal an Account-owned
            -- Project after their bilateral learner link is revoked.
            SELECT origin.project_id, origin.project_tenant_id,
                   origin.owner_principal_id INTO v_replay_origin
              FROM public.learning_project_origins origin
             WHERE origin.participation_id = v_participation.id;
            IF v_replay_origin.project_id IS DISTINCT FROM v_existing.project_id
               OR v_replay_origin.project_tenant_id IS DISTINCT FROM
                  v_existing.project_tenant_id
               OR (v_replay_origin.owner_principal_id <> p_actor_principal_id
                   AND NOT public.learning_linked_project_access(
                       p_actor_principal_id, v_replay_origin.project_id)) THEN
                RETURN QUERY SELECT 'project_access_denied'::varchar,
                    NULL::uuid, NULL::varchar, NULL::uuid, NULL::uuid,
                    NULL::uuid, NULL::uuid, NULL::uuid;
                RETURN;
            END IF;
            RETURN QUERY SELECT 'replay'::varchar, v_participation.id,
                v_run.module_key::varchar, v_existing.project_tenant_id,
                v_existing.project_id, v_existing.attempt_id, v_seat.id,
                v_run.tenant_id;
        END IF;
        RETURN;
    END IF;

    IF v_capable IS DISTINCT FROM true
       OR v_run.lifecycle_status <> 'active'
       OR v_run.classroom_status <> 'active'
       OR v_run.handout_status <> 'open'
       OR (v_run.source_kind = 'course' AND v_run.course_status <> 'open') THEN
        RETURN QUERY SELECT 'not_available'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF v_participation.source_course_enrollment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.course_enrollments enrollment
         WHERE enrollment.id = v_participation.source_course_enrollment_id
           AND enrollment.tenant_id = v_run.tenant_id
           AND enrollment.status IN ('assigned', 'active')
    ) THEN
        RETURN QUERY SELECT 'not_available'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    v_effective := public.learning_effective_conditions_internal(
        p_activity_run_id, v_participation.id);
    IF (v_effective#>>'{values,opensAt}')::timestamptz > now()
       OR (v_effective#>>'{values,closesAt}')::timestamptz < now()
       OR ((v_effective#>>'{values,dueAt}')::timestamptz < now()
            AND v_effective#>>'{values,latePolicy}' = 'block_at_due'
            AND NOT v_participation.teacher_unlocked) THEN
        RETURN QUERY SELECT 'not_available'::varchar, NULL::uuid, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    SELECT origin.project_id, origin.project_tenant_id,
           origin.owner_principal_id, project.status AS project_status
      INTO v_existing
      FROM public.learning_project_origins origin
      JOIN public.projects project ON project.id = origin.project_id
     WHERE origin.participation_id = v_participation.id;
    IF v_existing.project_id IS NOT NULL AND v_existing.project_status <> 'active' THEN
        RETURN QUERY SELECT 'not_available'::varchar,
            NULL::uuid, NULL::varchar, NULL::uuid, NULL::uuid, NULL::uuid,
            NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF v_existing.project_id IS NOT NULL
       AND v_existing.owner_principal_id <> p_actor_principal_id
       AND NOT public.learning_linked_project_access(
           p_actor_principal_id, v_existing.project_id) THEN
        RETURN QUERY SELECT 'project_access_denied'::varchar,
            NULL::uuid, NULL::varchar, NULL::uuid, NULL::uuid, NULL::uuid,
            NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF v_existing.project_id IS NULL AND EXISTS (
        SELECT 1 FROM public.learning_attempts attempt
         WHERE attempt.activity_participation_id = v_participation.id
    ) THEN
        RETURN QUERY SELECT 'legacy_work_without_origin'::varchar,
            NULL::uuid, NULL::varchar, NULL::uuid, NULL::uuid, NULL::uuid,
            NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    -- A personal workspace is needed only to create a new Account Project.
    -- A linked legacy Account may reuse an existing Seat-owned origin.
    IF v_existing.project_id IS NULL THEN
        IF v_actor.kind = 'account' THEN
            SELECT workspace.tenant_id INTO v_project_tenant
              FROM public.auth_personal_workspace(v_actor.account_id) workspace;
        ELSE
            v_project_tenant := v_run.tenant_id;
        END IF;
        IF v_project_tenant IS NULL THEN
            RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
                NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
    END IF;
    SELECT attempt.id, attempt.state, attempt.attempt_number,
           (SELECT result.review_decision
              FROM public.assessment_results result
             WHERE result.attempt_id = attempt.id
             ORDER BY result.revision_number DESC LIMIT 1) AS review_decision
      INTO v_attempt
      FROM public.learning_attempts attempt
     WHERE attempt.activity_participation_id = v_participation.id
     ORDER BY attempt.attempt_number DESC LIMIT 1;
    IF v_attempt.id IS NOT NULL AND (
        v_attempt.state NOT IN ('in_progress', 'submitted', 'evaluating', 'closed')
        OR (v_attempt.state = 'closed'
            AND v_attempt.review_decision IS DISTINCT FROM 'changes_requested')
    ) THEN
        RETURN QUERY SELECT 'not_available'::varchar, NULL::uuid,
            NULL::varchar, NULL::uuid, NULL::uuid, NULL::uuid,
            NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF v_attempt.id IS NULL OR
       (v_attempt.state = 'closed' AND v_attempt.review_decision = 'changes_requested') THEN
        SELECT COALESCE(max(attempt.attempt_number), 0) + 1 INTO v_next
          FROM public.learning_attempts attempt
         WHERE attempt.activity_participation_id = v_participation.id;
        v_limit := (v_effective#>>'{values,attemptLimit}')::integer
            + v_participation.extra_attempts;
        IF v_next > v_limit THEN
            RETURN QUERY SELECT 'attempt_limit_reached'::varchar,
                NULL::uuid, NULL::varchar, NULL::uuid, NULL::uuid, NULL::uuid,
                NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar, v_participation.id,
        v_run.module_key::varchar,
        COALESCE(v_existing.project_tenant_id, v_project_tenant),
        v_existing.project_id, NULL::uuid, v_seat.id, v_run.tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.learning_origin_work_context_for_project(
    p_viewer_principal_id uuid, p_project_id uuid
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
        LEFT JOIN public.course_versions pinned_course
          ON pinned_course.id = course.course_version_id
         AND pinned_course.tenant_id = origin.school_tenant_id
         AND pinned_course.course_id = course.course_id
        LEFT JOIN public.classroom_course_run_lessons lesson
          ON lesson.id = run.source_course_lesson_id
         AND lesson.tenant_id = origin.school_tenant_id
         AND lesson.run_id = course.id
        JOIN public.project_drafts draft
          ON draft.project_id = project.id AND draft.tenant_id = project.tenant_id
        LEFT JOIN public.project_snapshots snapshot
          ON snapshot.project_id = project.id AND snapshot.tenant_id = project.tenant_id
       WHERE origin.project_id = p_project_id
         AND EXISTS (SELECT 1 FROM public.project_context_for_principal(
             p_viewer_principal_id, p_project_id))
         AND (origin.owner_principal_id = p_viewer_principal_id
              OR public.learning_linked_project_access(p_viewer_principal_id, p_project_id))
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
                        AND (SELECT count(*)
                               FROM jsonb_array_elements(pinned_course.outline->'sections') section
                               CROSS JOIN LATERAL jsonb_array_elements(section->'lessons') pinned_lesson
                              WHERE section->>'sourceSectionId' = lesson.source_section_id::text
                                AND pinned_lesson->>'sourceLessonId' = lesson.source_lesson_id::text
                                AND pinned_lesson->>'kind' = 'assignment'
                                AND pinned_lesson->>'learningActivityVersionId' = version.id::text) = 1)
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
