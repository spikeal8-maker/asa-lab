-- LRN-COURSE-01 exact submission CAS and one shared direct/course Attempt path.
-- No project content is inferred from timestamps. Save A, then another-tab save B,
-- then submit expected A is rejected without an Attempt/Submission side effect.
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
BEGIN
    SELECT run.tenant_id, run.school_id, run.classroom_id,
           run.id AS activity_run_id, run.learning_activity_version_id
      INTO v_run
      FROM public.activity_runs run
     WHERE run.source_classroom_assignment_id = p_assignment_id;
    IF v_run.activity_run_id IS NULL THEN
        RETURN QUERY SELECT 'not_canonical'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    PERFORM set_config('app.tenant_id', v_run.tenant_id::text, true);

    SELECT participation.id, participation.learner_identity_id,
           participation.status, participation.source_course_enrollment_id
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
    IF v_participation.id IS NULL THEN
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

    INSERT INTO public.learning_attempts (
        tenant_id, classroom_id, classroom_assignment_id,
        learning_activity_version_id, seat_id, learner_identity_id,
        activity_participation_id, attempt_number, state
    ) VALUES (
        v_run.tenant_id, v_run.classroom_id, p_assignment_id,
        v_run.learning_activity_version_id, p_seat_id,
        v_participation.learner_identity_id, v_participation.id,
        v_attempt_number, 'in_progress'
    )
    RETURNING learning_attempts.id, learning_attempts.attempt_number,
              learning_attempts.state
         INTO v_attempt;

    RETURN QUERY SELECT 'ok'::varchar, v_participation.id, v_attempt.id,
        v_attempt.attempt_number, v_attempt.state::varchar,
        v_work.project_id, false;
END;
$$;
CREATE OR REPLACE FUNCTION learning_direct_project_submission_create(
    p_actor_principal_id uuid,
    p_seat_id uuid,
    p_assignment_id uuid,
    p_client_request_id varchar,
    p_expected_revision integer
)
RETURNS TABLE (
    result_code varchar,
    participation_id uuid,
    attempt_id uuid,
    submission_id uuid,
    attempt_number integer,
    attempt_state varchar,
    project_id uuid,
    project_version_id uuid,
    submitted_at timestamptz,
    late_state varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_run record;
    v_participation record;
    v_activation record;
    v_existing record;
    v_scope record;
    v_attempt record;
    v_project_version uuid;
    v_submission uuid;
    v_digest varchar;
    v_late varchar;
    v_submitted_at timestamptz;
BEGIN
    IF p_client_request_id IS NULL
       OR p_client_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid,
            NULL::uuid, NULL::uuid, NULL::integer, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT run.tenant_id, run.school_id, run.classroom_id,
           run.id AS activity_run_id, run.learning_activity_version_id,
           run.lifecycle_status, run.opens_at, run.due_at, run.closes_at,
           run.late_policy
      INTO v_run
      FROM public.activity_runs run
     WHERE run.source_classroom_assignment_id = p_assignment_id;
    IF v_run.activity_run_id IS NULL THEN
        RETURN QUERY SELECT 'not_canonical'::varchar, NULL::uuid,
            NULL::uuid, NULL::uuid, NULL::integer, NULL::varchar,
            NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    PERFORM set_config('app.tenant_id', v_run.tenant_id::text, true);

    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_student_seats seat
        JOIN public.principals principal ON principal.id=p_actor_principal_id
        WHERE seat.id=p_seat_id AND seat.classroom_id=v_run.classroom_id
          AND seat.tenant_id=v_run.tenant_id AND seat.status='active'
          AND ((principal.kind='student_seat' AND principal.seat_id=seat.id)
            OR (principal.kind='account' AND principal.account_id=seat.account_id))
    ) THEN
        RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,
          NULL::integer,NULL::varchar,NULL::uuid,NULL::uuid,NULL::timestamptz,NULL::varchar,false; RETURN;
    END IF;
    IF p_expected_revision IS NULL OR p_expected_revision<0 THEN
        RETURN QUERY SELECT 'expected_revision_required'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,
          NULL::integer,NULL::varchar,NULL::uuid,NULL::uuid,NULL::timestamptz,NULL::varchar,false; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_run.tenant_id::text||p_client_request_id,1110));
    SELECT submission.id, attempt.activity_participation_id,
           submission.attempt_id, attempt.attempt_number, attempt.state,
           submission.project_id, submission.project_version_id,
           submission.submitted_at, submission.late_state,
           attempt.seat_id, attempt.classroom_assignment_id, submission.payload_manifest
      INTO v_existing
      FROM public.learning_submissions submission
     JOIN public.learning_attempts attempt ON attempt.id = submission.attempt_id
     WHERE submission.client_request_id = p_client_request_id
       AND attempt.tenant_id = v_run.tenant_id;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.seat_id = p_seat_id
           AND v_existing.classroom_assignment_id = p_assignment_id
           AND v_existing.activity_participation_id IS NOT NULL
           AND (v_existing.payload_manifest->>'sourceRevision')::integer=p_expected_revision THEN
            RETURN QUERY SELECT 'ok'::varchar,
                v_existing.activity_participation_id, v_existing.attempt_id,
                v_existing.id, v_existing.attempt_number,
                v_existing.state::varchar, v_existing.project_id,
                v_existing.project_version_id, v_existing.submitted_at,
                v_existing.late_state::varchar, true;
        ELSE
            RETURN QUERY SELECT 'request_conflict'::varchar, NULL::uuid,
                NULL::uuid, NULL::uuid, NULL::integer, NULL::varchar,
                NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::varchar, false;
        END IF;
        RETURN;
    END IF;

    SELECT participation.id, participation.learner_identity_id,
           participation.status, participation.opens_at_override,
           participation.due_at_override, participation.closes_at_override,
           participation.teacher_unlocked
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
    IF v_participation.id IS NULL OR v_participation.status <> 'active' THEN
        RETURN QUERY SELECT
            CASE WHEN v_participation.status = 'withdrawn'
                 THEN 'withdrawn' ELSE 'not_started' END::varchar,
            v_participation.id, NULL::uuid, NULL::uuid, NULL::integer,
            NULL::varchar, NULL::uuid, NULL::uuid, NULL::timestamptz,
            NULL::varchar, false;
        RETURN;
    END IF;

    -- For an active participation this is a read-like authorization check:
    -- the existing command verifies the exact seat/account principal link.
    SELECT * INTO v_activation
      FROM public.activity_participation_activate(
        p_actor_principal_id, v_participation.id
      );
    IF v_activation.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_activation.result_code::varchar,
            v_participation.id, NULL::uuid, NULL::uuid, NULL::integer,
            NULL::varchar, NULL::uuid, NULL::uuid, NULL::timestamptz,
            NULL::varchar, false;
        RETURN;
    END IF;

    SELECT assignment.status AS assignment_status,
           classroom.status AS classroom_status,
           work.project_id, project.tenant_id AS project_tenant_id,
           project.owner_principal_id, draft.document_json,
           draft.updated_by, draft.updated_at, draft.revision,
           COALESCE(v_participation.opens_at_override, v_run.opens_at) AS effective_opens_at,
           COALESCE(v_participation.due_at_override, v_run.due_at) AS effective_due_at,
           COALESCE(v_participation.closes_at_override, v_run.closes_at) AS effective_closes_at
      INTO v_scope
      FROM public.classroom_assignments assignment
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id
       AND classroom.id = assignment.classroom_id
      JOIN public.classroom_assignment_work work
        ON work.tenant_id = assignment.tenant_id
       AND work.assignment_id = assignment.id
       AND work.seat_id = p_seat_id
      JOIN public.projects project ON project.id = work.project_id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id
       AND draft.project_id = project.id
     WHERE assignment.tenant_id = v_run.tenant_id
       AND assignment.id = p_assignment_id
       AND assignment.classroom_id = v_run.classroom_id
       AND (
          project.owner_principal_id = p_actor_principal_id
          OR project.owner_principal_id = public.principal_for_seat(p_seat_id)
       )
     FOR UPDATE OF work, draft;
    IF v_scope.project_id IS NULL
       OR v_scope.assignment_status <> 'open'
       OR v_scope.classroom_status <> 'active'
       OR v_run.lifecycle_status <> 'active'
       OR (v_scope.effective_opens_at IS NOT NULL AND now() < v_scope.effective_opens_at)
       OR (v_scope.effective_closes_at IS NOT NULL AND now() > v_scope.effective_closes_at)
       OR (v_scope.effective_due_at IS NOT NULL AND now() > v_scope.effective_due_at
           AND v_run.late_policy = 'block_at_due'
           AND NOT v_participation.teacher_unlocked) THEN
        RETURN QUERY SELECT 'not_available'::varchar, v_participation.id,
            NULL::uuid, NULL::uuid, NULL::integer, NULL::varchar,
            v_scope.project_id, NULL::uuid, NULL::timestamptz,
            NULL::varchar, false;
        RETURN;
    END IF;

    SELECT attempt.id, attempt.attempt_number, attempt.state
      INTO v_attempt
      FROM public.learning_attempts attempt
     WHERE attempt.activity_participation_id = v_participation.id
     ORDER BY attempt.attempt_number DESC, attempt.id DESC
     LIMIT 1
     FOR UPDATE;
    IF v_attempt.id IS NULL OR v_attempt.state <> 'in_progress' THEN
        RETURN QUERY SELECT
            CASE WHEN v_attempt.state IN ('submitted', 'evaluating')
                 THEN 'attempt_already_submitted' ELSE 'not_started' END::varchar,
            v_participation.id, v_attempt.id, NULL::uuid,
            v_attempt.attempt_number, v_attempt.state::varchar,
            v_scope.project_id, NULL::uuid, NULL::timestamptz,
            NULL::varchar, false;
        RETURN;
    END IF;

    IF v_scope.revision IS DISTINCT FROM p_expected_revision THEN
        RETURN QUERY SELECT 'project_revision_conflict'::varchar,v_participation.id,v_attempt.id,
          NULL::uuid,v_attempt.attempt_number,v_attempt.state::varchar,v_scope.project_id,NULL::uuid,
          NULL::timestamptz,NULL::varchar,false; RETURN;
    END IF;
    INSERT INTO public.project_versions (
        tenant_id, project_id, version_no, document_json, label,
        created_by, created_by_principal_id
    ) SELECT v_scope.project_tenant_id, v_scope.project_id,
             COALESCE(max(version.version_no), 0) + 1,
             v_scope.document_json,
             'Сдача, попытка ' || v_attempt.attempt_number,
             v_scope.updated_by, v_scope.owner_principal_id
        FROM public.project_versions version
       WHERE version.tenant_id = v_scope.project_tenant_id
         AND version.project_id = v_scope.project_id
    RETURNING id INTO v_project_version;

    v_digest := encode(
        public.digest(convert_to(v_scope.document_json::text, 'UTF8'), 'sha256'),
        'hex'
    );
    v_late := CASE
        WHEN v_scope.effective_due_at IS NOT NULL AND now() > v_scope.effective_due_at
        THEN 'late' ELSE 'on_time' END;

    INSERT INTO public.learning_submissions (
        tenant_id, attempt_id, project_id, project_tenant_id,
        project_version_id, payload_manifest, payload_digest,
        client_request_id, late_state
    ) VALUES (
        v_run.tenant_id, v_attempt.id, v_scope.project_id,
        v_scope.project_tenant_id, v_project_version,
        jsonb_build_object('kind', 'project', 'projectVersionId', v_project_version, 'sourceRevision',p_expected_revision),
        v_digest, p_client_request_id, v_late
    )
    RETURNING learning_submissions.id, learning_submissions.submitted_at
         INTO v_submission, v_submitted_at;

    UPDATE public.learning_attempts attempt
       SET state = 'submitted', submitted_at = v_submitted_at
     WHERE attempt.id = v_attempt.id;

    -- Compatibility projection for existing teacher counts/readers only.
    UPDATE public.classroom_assignment_work work
       SET submitted_at = v_submitted_at
     WHERE work.assignment_id = p_assignment_id
       AND work.seat_id = p_seat_id;

    RETURN QUERY SELECT 'ok'::varchar, v_participation.id, v_attempt.id,
        v_submission, v_attempt.attempt_number, 'submitted'::varchar,
        v_scope.project_id, v_project_version, v_submitted_at,
        v_late, false;
END;
$$;
-- Rolling-deploy bridge for the pre-E1 API. It never accepts client-only state:
-- the wrapper snapshots the currently saved server revision and delegates to the
-- exact 5-argument contract. A concurrent draft change is rejected by the callee.
CREATE OR REPLACE FUNCTION learning_direct_project_submission_create(
    p_actor_principal_id uuid,
    p_seat_id uuid,
    p_assignment_id uuid,
    p_client_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    participation_id uuid,
    attempt_id uuid,
    submission_id uuid,
    attempt_number integer,
    attempt_state varchar,
    project_id uuid,
    project_version_id uuid,
    submitted_at timestamptz,
    late_state varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_revision integer;
BEGIN
    SELECT draft.revision
      INTO v_revision
      FROM public.classroom_assignment_work work
      JOIN public.projects project ON project.id=work.project_id
      JOIN public.project_drafts draft
        ON draft.tenant_id=project.tenant_id AND draft.project_id=project.id
     WHERE work.assignment_id=p_assignment_id AND work.seat_id=p_seat_id;

    RETURN QUERY
    SELECT * FROM public.learning_direct_project_submission_create(
        p_actor_principal_id,p_seat_id,p_assignment_id,p_client_request_id,v_revision
    );
END;
$$;

CREATE OR REPLACE FUNCTION learning_direct_assignment_seat_visible(
    p_seat_id uuid, p_classroom_assignment_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM public.activity_runs run
         WHERE run.source_classroom_assignment_id=p_classroom_assignment_id

      ) THEN true
      ELSE EXISTS (
        SELECT 1
          FROM public.activity_runs run
          JOIN public.learner_identity_links link
            ON link.seat_id=p_seat_id AND link.status='active'
          JOIN public.activity_participations participation
            ON participation.activity_run_id=run.id
           AND participation.learner_identity_id=link.learner_identity_id
           AND participation.status IN ('assigned','active')
         WHERE run.source_classroom_assignment_id=p_classroom_assignment_id

      )
    END;
$$;
REVOKE ALL ON FUNCTION learning_direct_project_submission_create(uuid,uuid,uuid,varchar,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_direct_project_submission_create(uuid,uuid,uuid,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_direct_project_submission_create(uuid,uuid,uuid,varchar,integer) TO asalab_app;
-- Temporary rolling-deploy bridge. Revoke the 4-argument signature only after old API instances are drained.
GRANT EXECUTE ON FUNCTION learning_direct_project_submission_create(uuid,uuid,uuid,varchar) TO asalab_app;
