-- A4-2b: one request identity for one exact ActivityRun. The application holds
-- one transaction around admission, Project Core draft creation, and completion.
-- The ledger is append-only and is not a second source of academic progress.
CREATE TABLE public.learning_work_start_requests (
    actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
    request_id varchar(128) NOT NULL,
    activity_run_id uuid NOT NULL,
    school_tenant_id uuid NOT NULL,
    school_id uuid NOT NULL,
    participation_id uuid NOT NULL,
    project_tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_principal_id, request_id),
    FOREIGN KEY (school_tenant_id, school_id, activity_run_id)
        REFERENCES public.activity_runs(tenant_id, school_id, id),
    FOREIGN KEY (school_tenant_id, school_id, participation_id)
        REFERENCES public.activity_participations(tenant_id, school_id, id),
    FOREIGN KEY (project_tenant_id, project_id)
        REFERENCES public.projects(tenant_id, id),
    FOREIGN KEY (school_tenant_id, attempt_id)
        REFERENCES public.learning_attempts(tenant_id, id),
    CONSTRAINT learning_work_start_request_format CHECK
        (request_id ~ '^[A-Za-z0-9._:-]{8,128}$')
);

CREATE FUNCTION public.learning_work_start_requests_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'learning work start evidence is immutable';
END;
$$;
CREATE TRIGGER learning_work_start_requests_immutable
    BEFORE UPDATE OR DELETE ON public.learning_work_start_requests
    FOR EACH ROW EXECUTE FUNCTION public.learning_work_start_requests_guard();

REVOKE ALL ON public.learning_work_start_requests FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_work_start_requests_guard() FROM PUBLIC, asalab_app;
ALTER TABLE public.learning_work_start_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_work_start_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_work_start_requests_tenant ON public.learning_work_start_requests
    USING (school_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (school_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Admission locks the participation, so two tabs cannot each allocate a
-- Project. It performs no Project or Attempt write. All subsequent statements
-- must use the same transaction and treat a denial as ROLLBACK.
CREATE FUNCTION public.learning_work_start_admit(
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
       AND v_existing.owner_principal_id <> p_actor_principal_id THEN
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

CREATE FUNCTION public.learning_work_start_complete(
    p_actor_principal_id uuid, p_activity_run_id uuid,
    p_request_id varchar, p_project_id uuid
)
RETURNS TABLE (
    result_code varchar, participation_id uuid, attempt_id uuid,
    attempt_number integer, attempt_state varchar, project_id uuid, reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_admit record;
    v_run public.activity_runs%ROWTYPE;
    v_participation public.activity_participations%ROWTYPE;
    v_attempt record;
    v_next integer;
    v_prior uuid;
    v_effective jsonb;
    v_limit integer;
    v_reused boolean;
    v_activation record;
BEGIN
    SELECT * INTO v_admit FROM public.learning_work_start_admit(
        p_actor_principal_id, p_activity_run_id, p_request_id);
    IF v_admit.result_code = 'replay' THEN
        SELECT attempt.attempt_number, attempt.state INTO v_attempt
          FROM public.learning_attempts attempt
         WHERE attempt.id = v_admit.existing_attempt_id;
        RETURN QUERY SELECT 'ok'::varchar, v_admit.participation_id,
            v_admit.existing_attempt_id, v_attempt.attempt_number,
            v_attempt.state::varchar, v_admit.existing_project_id, true;
        RETURN;
    END IF;
    IF v_admit.result_code <> 'ok' THEN
        RAISE EXCEPTION 'learning start denied: %', v_admit.result_code
            USING ERRCODE = 'PZ001';
    END IF;
    IF p_project_id IS NULL OR (v_admit.existing_project_id IS NOT NULL
        AND v_admit.existing_project_id <> p_project_id) THEN
        RAISE EXCEPTION 'learning start project conflict' USING ERRCODE = 'PZ001';
    END IF;
    SELECT * INTO v_run FROM public.activity_runs run
     WHERE run.id = p_activity_run_id;
    SELECT * INTO v_participation FROM public.activity_participations participation
     WHERE participation.id = v_admit.participation_id FOR UPDATE;
    IF v_participation.source_course_enrollment_id IS NOT NULL THEN
        SELECT * INTO v_activation FROM public.course_enrollment_activate(
            p_actor_principal_id, v_participation.source_course_enrollment_id);
        IF v_activation.result_code <> 'ok' THEN
            RAISE EXCEPTION 'learning start enrollment unavailable'
                USING ERRCODE = 'PZ001';
        END IF;
    END IF;
    SELECT * INTO v_activation FROM public.activity_participation_activate(
        p_actor_principal_id, v_participation.id);
    IF v_activation.result_code <> 'ok' THEN
        RAISE EXCEPTION 'learning start participation unavailable'
            USING ERRCODE = 'PZ001';
    END IF;

    IF v_admit.existing_project_id IS NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.projects project
            JOIN public.project_drafts draft
              ON draft.tenant_id = project.tenant_id
             AND draft.project_id = project.id
           WHERE project.id = p_project_id
             AND project.tenant_id = v_admit.project_tenant_id
             AND project.owner_principal_id = p_actor_principal_id
             AND project.project_scope = 'personal'
             AND project.status = 'active'
             AND project.module_key = v_admit.module_key
             AND project.idempotency_key = 'learning:' || v_participation.id::text
             -- The no-origin path may only attach rows inserted by this Start
             -- transaction. A prior generic Project can share the key and
             -- fingerprint, and an UPDATE can change xmin but not created_at.
             AND project.xmin = pg_current_xact_id()::xid
             AND draft.xmin = pg_current_xact_id()::xid
             AND project.created_at = transaction_timestamp()
        ) THEN
            RAISE EXCEPTION 'learning start project was not created by Project Core'
                USING ERRCODE = 'PZ001';
        END IF;
        INSERT INTO public.learning_project_origins (
            project_id, project_tenant_id, participation_id,
            school_tenant_id, school_id, learner_identity_id,
            activity_run_id, learning_activity_version_id, source_kind,
            source_course_run_id, source_course_lesson_id,
            source_course_block_id, owner_principal_id
        ) VALUES (
            p_project_id, v_admit.project_tenant_id, v_participation.id,
            v_run.tenant_id, v_run.school_id, v_participation.learner_identity_id,
            v_run.id, v_run.learning_activity_version_id, v_run.source_kind,
            v_run.source_course_run_id, v_run.source_course_lesson_id,
            v_run.source_course_block_id, p_actor_principal_id
        );
    END IF;
    SELECT attempt.id, attempt.attempt_number, attempt.state,
           (SELECT result.review_decision
              FROM public.assessment_results result
             WHERE result.attempt_id = attempt.id
             ORDER BY result.revision_number DESC LIMIT 1) AS review_decision
      INTO v_attempt FROM public.learning_attempts attempt
     WHERE attempt.activity_participation_id = v_participation.id
     ORDER BY attempt.attempt_number DESC LIMIT 1;
    v_reused := v_attempt.id IS NOT NULL AND NOT (
        v_attempt.state = 'closed'
        AND v_attempt.review_decision = 'changes_requested');
    IF NOT v_reused THEN
        SELECT COALESCE(max(attempt.attempt_number), 0) + 1 INTO v_next
          FROM public.learning_attempts attempt
         WHERE attempt.activity_participation_id = v_participation.id;
        v_effective := public.learning_effective_conditions_internal(
            v_run.id, v_participation.id);
        v_limit := (v_effective#>>'{values,attemptLimit}')::integer
            + v_participation.extra_attempts;
        IF v_next > v_limit THEN
            RAISE EXCEPTION 'learning start attempt limit reached' USING ERRCODE = 'PZ001';
        END IF;
        IF v_attempt.state = 'closed'
           AND v_attempt.review_decision = 'changes_requested' THEN
            v_prior := v_attempt.id;
        END IF;
        INSERT INTO public.learning_attempts (
            tenant_id, classroom_id, classroom_assignment_id,
            learning_activity_version_id, seat_id, learner_identity_id,
            activity_participation_id, attempt_number, state,
            revision_of_attempt_id, effective_conditions_at_start
        ) VALUES (
            v_run.tenant_id, v_run.classroom_id,
            v_run.source_classroom_assignment_id,
            v_run.learning_activity_version_id, v_admit.seat_id,
            v_participation.learner_identity_id, v_participation.id,
            v_next, 'in_progress', v_prior, v_effective
        ) RETURNING learning_attempts.id, learning_attempts.attempt_number,
                    learning_attempts.state INTO v_attempt;
    END IF;
    INSERT INTO public.learning_work_start_requests (
        actor_principal_id, request_id, activity_run_id,
        school_tenant_id, school_id, participation_id,
        project_tenant_id, project_id, attempt_id
    ) VALUES (
        p_actor_principal_id, p_request_id, v_run.id,
        v_run.tenant_id, v_run.school_id, v_participation.id,
        v_admit.project_tenant_id, p_project_id, v_attempt.id
    );
    RETURN QUERY SELECT 'ok'::varchar, v_participation.id, v_attempt.id,
        v_attempt.attempt_number, v_attempt.state::varchar, p_project_id,
        v_reused;
END;
$$;

REVOKE ALL ON FUNCTION public.learning_work_start_admit(uuid,uuid,varchar)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_work_start_complete(uuid,uuid,varchar,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_work_start_admit(uuid,uuid,varchar)
    TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_work_start_complete(uuid,uuid,varchar,uuid)
    TO asalab_app;
