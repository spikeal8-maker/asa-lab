-- A4-3a1: a linked Seat and Account may work on the same immutable Learning
-- Project. The origin stays owned by the principal that created it.
CREATE FUNCTION public.learning_linked_project_access(
    p_actor_principal_id uuid, p_project_id uuid
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.learning_project_origins origin
          JOIN public.projects project
            ON project.id = origin.project_id
           AND project.tenant_id = origin.project_tenant_id
           AND project.project_scope = 'personal'
           AND project.owner_principal_id = origin.owner_principal_id
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
          JOIN public.learner_identities learner
            ON learner.id = origin.learner_identity_id
           AND learner.tenant_id = origin.school_tenant_id
           AND learner.school_id = origin.school_id
           AND learner.state = 'active'
          JOIN public.classroom_student_seats seat
            ON seat.tenant_id = origin.school_tenant_id
           AND seat.classroom_id = run.classroom_id
           AND seat.status = 'active'
          JOIN public.accounts account
            ON account.id = seat.account_id AND account.status = 'active'
          JOIN public.learner_identity_links seat_link
            ON seat_link.tenant_id = origin.school_tenant_id
           AND seat_link.school_id = origin.school_id
           AND seat_link.learner_identity_id = origin.learner_identity_id
           AND seat_link.link_kind = 'student_seat'
           AND seat_link.seat_id = seat.id
           AND seat_link.status = 'active'
          JOIN public.learner_identity_links account_link
            ON account_link.tenant_id = origin.school_tenant_id
           AND account_link.school_id = origin.school_id
           AND account_link.learner_identity_id = origin.learner_identity_id
           AND account_link.link_kind = 'account'
           AND account_link.account_id = account.id
           AND account_link.status = 'active'
          JOIN public.principals owner
            ON owner.id = origin.owner_principal_id
          JOIN public.principals actor
            ON actor.id = p_actor_principal_id
         WHERE origin.project_id = p_project_id
           AND ((owner.kind = 'student_seat' AND owner.seat_id = seat.id
                 AND actor.kind = 'account' AND actor.account_id = account.id)
                OR (owner.kind = 'account' AND owner.account_id = account.id
                    AND actor.kind = 'student_seat' AND actor.seat_id = seat.id))
         FOR SHARE OF learner, seat, account, seat_link, account_link
    );
$$;

REVOKE ALL ON FUNCTION public.learning_linked_project_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_linked_project_access(uuid,uuid) TO asalab_app;

-- Carry forward the 0027 classroom/member and teacher scope branches intact.
CREATE OR REPLACE FUNCTION public.project_context_for_principal(
    p_principal_id uuid, p_project_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT project.tenant_id,
           CASE
             WHEN project.project_scope = 'classroom' THEN membership.user_id
             ELSE legacy_link.user_id
           END
      FROM public.principals principal
      JOIN public.projects project ON project.id = p_project_id
      LEFT JOIN public.classroom_memberships membership
        ON membership.tenant_id = project.tenant_id
       AND membership.classroom_id = project.classroom_id
       AND membership.account_id = principal.account_id
      LEFT JOIN public.legacy_user_account_links legacy_link
        ON legacy_link.tenant_id = project.tenant_id
       AND legacy_link.account_id = principal.account_id
       AND legacy_link.migration_state = 'active'
     WHERE principal.id = p_principal_id
       AND (
         (project.project_scope = 'personal'
          AND project.owner_principal_id = p_principal_id)
         OR
         (project.project_scope = 'classroom' AND membership.user_id IS NOT NULL)
         OR
         (project.project_scope = 'personal'
          AND project.owner_principal_id IN (
                SELECT scope.seat_principal_id
                  FROM public.teacher_seat_scope(p_principal_id) scope))
         OR
         (project.project_scope = 'personal'
          AND public.learning_linked_project_access(p_principal_id, p_project_id))
       )
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.project_context_for_principal(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_context_for_principal(uuid,uuid) TO asalab_app;

-- A linked principal reuses the origin Project; completion still owns attempt and ledger writes.
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
           course.status AS course_status
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
        IF v_run.source_course_block_id IS NULL
           OR v_participation.source_course_enrollment_id IS NULL
           OR NOT public.learning_course_seat_visible(v_seat.id, v_run.source_course_run_id)
           OR NOT EXISTS (
               SELECT 1 FROM public.classroom_course_run_lessons lesson
               CROSS JOIN LATERAL jsonb_array_elements(lesson.blocks) block
                WHERE lesson.tenant_id = v_run.tenant_id
                  AND lesson.run_id = v_run.source_course_run_id
                  AND lesson.id = v_run.source_course_lesson_id
                  AND block.value ->> 'id' = v_run.source_course_block_id
                  AND block.value ->> 'type' = 'activity'
                  AND block.value -> 'hidden' IS DISTINCT FROM 'true'::jsonb
                  AND block.value ->> 'learningActivityVersionId'
                      = v_run.learning_activity_version_id::text
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

REVOKE ALL ON FUNCTION public.learning_work_start_admit(uuid,uuid,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_work_start_admit(uuid,uuid,varchar) TO asalab_app;
