CREATE OR REPLACE FUNCTION learning_direct_project_attempt_start(
    p_actor_principal_id uuid,
    p_seat_id uuid,
    p_assignment_id uuid,
    p_project_id uuid
)
RETURNS TABLE (
    result_code varchar,
    participation_id uuid,
    attempt_id uuid,
    attempt_number integer,
    attempt_state varchar,
    project_id uuid,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_run record;
    v_participation record;
    v_activation record;
    v_work record;
    v_attempt record;
    v_attempt_number integer;
    v_attempt_limit integer;
    v_revision_of uuid;
BEGIN
    SELECT run.tenant_id, run.school_id, run.classroom_id,
           run.id AS activity_run_id, run.learning_activity_version_id,
           COALESCE((run.runtime_policy_snapshot#>>'{explicit,attemptLimit}')::integer,
             (version.policy_snapshot#>>'{attemptPolicy,maxAttempts}')::integer,1) AS attempt_limit
      INTO v_run
      FROM public.activity_runs run
      JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
     WHERE run.source_classroom_assignment_id = p_assignment_id;
    IF v_run.activity_run_id IS NULL THEN
        RETURN QUERY SELECT 'not_canonical'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    PERFORM set_config('app.tenant_id', v_run.tenant_id::text, true);

    SELECT participation.id, participation.learner_identity_id,
           participation.status, participation.extra_attempts, participation.excused, participation.source_course_enrollment_id
      INTO v_participation
      FROM public.classroom_student_seats seat
      JOIN public.learner_identity_links link
        ON link.tenant_id = v_run.tenant_id
       AND link.school_id = v_run.school_id
       AND link.link_kind = 'student_seat'
       AND link.seat_id = seat.id
       AND link.status = 'active'
      JOIN public.activity_participations participation
        ON participation.tenant_id = v_run.tenant_id
       AND participation.school_id = v_run.school_id
       AND participation.activity_run_id = v_run.activity_run_id
       AND participation.learner_identity_id = link.learner_identity_id
     WHERE seat.id = p_seat_id
       AND seat.tenant_id = v_run.tenant_id
       AND seat.classroom_id = v_run.classroom_id
       AND seat.status = 'active';
    IF v_participation.id IS NULL OR v_participation.excused THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    IF v_participation.source_course_enrollment_id IS NOT NULL THEN
        SELECT * INTO v_activation FROM public.course_enrollment_activate(
            p_actor_principal_id,v_participation.source_course_enrollment_id);
        IF v_activation.result_code<>'ok' THEN
            RETURN QUERY SELECT v_activation.result_code::varchar, v_participation.id,
              NULL::uuid,NULL::integer,NULL::varchar,NULL::uuid,false; RETURN;
        END IF;
    END IF;
    SELECT * INTO v_activation
      FROM public.activity_participation_activate(
        p_actor_principal_id, v_participation.id
      );
    IF v_activation.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_activation.result_code::varchar,
            v_participation.id, NULL::uuid, NULL::integer,
            v_participation.status::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    SELECT * INTO v_work
      FROM public.classroom_assignment_work_start(
        p_seat_id, p_assignment_id, p_project_id
      );
    IF v_work.project_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, v_participation.id,
            NULL::uuid, NULL::integer, NULL::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    -- One row lock serializes retry/concurrent start for this participation.
    PERFORM 1 FROM public.activity_participations participation
     WHERE participation.id = v_participation.id FOR UPDATE;

    SELECT attempt.id, attempt.attempt_number, attempt.state
      INTO v_attempt
      FROM public.learning_attempts attempt
     WHERE attempt.activity_participation_id = v_participation.id
       AND attempt.state IN ('in_progress', 'submitted', 'evaluating')
     ORDER BY attempt.attempt_number DESC, attempt.id DESC
     LIMIT 1;
    IF v_attempt.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_participation.id, v_attempt.id,
            v_attempt.attempt_number, v_attempt.state::varchar,
            v_work.project_id, true;
        RETURN;
    END IF;

    SELECT COALESCE(max(attempt.attempt_number), 0) + 1
      INTO v_attempt_number
      FROM public.learning_attempts attempt
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id;

    v_attempt_limit:=v_run.attempt_limit+v_participation.extra_attempts;
    IF v_attempt_number>v_attempt_limit THEN
      RETURN QUERY SELECT 'attempt_limit_reached'::varchar,v_participation.id,NULL::uuid,
        NULL::integer,NULL::varchar,v_work.project_id,false; RETURN;
    END IF;
    SELECT prior.id INTO v_revision_of FROM public.learning_attempts prior
      WHERE prior.activity_participation_id=v_participation.id AND prior.state='changes_requested'
      ORDER BY prior.attempt_number DESC LIMIT 1;
    INSERT INTO public.learning_attempts (
        tenant_id, classroom_id, classroom_assignment_id,
        learning_activity_version_id, seat_id, learner_identity_id,
        activity_participation_id, attempt_number, state, revision_of_attempt_id
    ) VALUES (
        v_run.tenant_id, v_run.classroom_id, p_assignment_id,
        v_run.learning_activity_version_id, p_seat_id,
        v_participation.learner_identity_id, v_participation.id,
        v_attempt_number, 'in_progress', v_revision_of
    )
    RETURNING learning_attempts.id, learning_attempts.attempt_number,
              learning_attempts.state
         INTO v_attempt;

    RETURN QUERY SELECT 'ok'::varchar, v_participation.id, v_attempt.id,
        v_attempt.attempt_number, v_attempt.state::varchar,
        v_work.project_id, false;
END;
$$;
