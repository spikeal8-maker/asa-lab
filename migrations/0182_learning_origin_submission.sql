-- A4-3b: submit only the current Attempt of one immutable Project origin.
-- The legacy handout writer remains available for historical work, but is never
-- called here: two Course blocks may share its classroom assignment.
CREATE FUNCTION public.learning_origin_project_submission_create(
    p_actor_principal_id uuid, p_project_id uuid,
    p_client_request_id varchar, p_expected_revision integer
)
RETURNS TABLE (
    result_code varchar, participation_id uuid, activity_run_id uuid,
    attempt_id uuid, submission_id uuid, attempt_number integer,
    attempt_state varchar, project_id uuid, project_version_id uuid,
    submitted_at timestamptz, late_state varchar, reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_scope record;
    v_account_link boolean;
    v_course_status varchar;
    v_read record;
    v_existing record;
    v_attempt record;
    v_draft record;
    v_effective jsonb;
    v_capable boolean;
    v_version uuid;
    v_submission uuid;
    v_submitted_at timestamptz;
    v_late varchar;
    v_digest varchar;
    v_prior_tenant text;
BEGIN
    IF p_actor_principal_id IS NULL OR p_project_id IS NULL
       OR p_client_request_id IS NULL
       OR p_client_request_id !~ '^[A-Za-z0-9._:-]{8,128}$'
       OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
        result_code := 'invalid_request'; RETURN NEXT; RETURN;
    END IF;

    -- Lock the immutable origin and its current learner linkage before reading
    -- a request key. An unauthorized caller receives no work identifiers.
    SELECT origin.project_id, origin.project_tenant_id, origin.school_tenant_id,
           origin.school_id, origin.learner_identity_id, origin.participation_id,
           origin.activity_run_id, origin.learning_activity_version_id,
           origin.source_kind, origin.source_course_run_id,
           origin.source_course_lesson_id, origin.source_course_block_id,
           origin.owner_principal_id, project.module_key,
           project.status AS project_status, run.classroom_id,
           run.source_classroom_assignment_id, run.lifecycle_status,
           participation.status AS participation_status,
           participation.excused, participation.teacher_unlocked,
           assignment.status AS assignment_status,
           classroom.status AS classroom_status,
           seat.id AS seat_id, seat.account_id AS seat_account_id,
           actor.kind AS actor_kind, owner.kind AS owner_kind
      INTO v_scope
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
      JOIN public.principals actor ON actor.id = p_actor_principal_id
      JOIN public.principals owner ON owner.id = origin.owner_principal_id
      JOIN public.classroom_student_seats seat
        ON seat.tenant_id = origin.school_tenant_id
       AND seat.classroom_id = run.classroom_id
       AND seat.status = 'active'
       AND ((actor.kind = 'student_seat' AND actor.seat_id = seat.id)
            OR (actor.kind = 'account' AND actor.account_id = seat.account_id))
       AND ((owner.kind = 'student_seat' AND owner.seat_id = seat.id)
            OR (owner.kind = 'account' AND owner.account_id = seat.account_id))
      JOIN public.learner_identity_links seat_link
        ON seat_link.tenant_id = origin.school_tenant_id
       AND seat_link.school_id = origin.school_id
       AND seat_link.learner_identity_id = origin.learner_identity_id
       AND seat_link.link_kind = 'student_seat'
       AND seat_link.seat_id = seat.id AND seat_link.status = 'active'
     WHERE origin.project_id = p_project_id
       AND EXISTS (SELECT 1 FROM public.project_context_for_principal(
           p_actor_principal_id, p_project_id))
     FOR UPDATE OF participation
     FOR SHARE OF origin, project, run, version, assignment, classroom,
                  learner, actor, owner, seat, seat_link;
    IF v_scope.project_id IS NULL THEN
        result_code := 'forbidden'; RETURN NEXT; RETURN;
    END IF;
    IF v_scope.actor_kind = 'account' OR v_scope.owner_kind = 'account' THEN
        SELECT true INTO v_account_link
          FROM public.accounts account
          JOIN public.learner_identity_links account_link
            ON account_link.account_id = account.id
           AND account_link.tenant_id = v_scope.school_tenant_id
           AND account_link.school_id = v_scope.school_id
           AND account_link.learner_identity_id = v_scope.learner_identity_id
           AND account_link.link_kind = 'account'
           AND account_link.status = 'active'
         WHERE account.id = v_scope.seat_account_id
           AND account.status = 'active'
         FOR SHARE OF account, account_link;
        IF v_account_link IS DISTINCT FROM true THEN
            result_code := 'forbidden'; RETURN NEXT; RETURN;
        END IF;
    END IF;
    IF v_scope.source_kind = 'course' THEN
        SELECT course.status INTO v_course_status
          FROM public.classroom_course_runs course
          JOIN public.classroom_course_run_lessons lesson
            ON lesson.id = v_scope.source_course_lesson_id
           AND lesson.tenant_id = v_scope.school_tenant_id
           AND lesson.run_id = course.id
          JOIN public.activity_participations participation
            ON participation.id = v_scope.participation_id
          JOIN public.course_enrollments enrollment
            ON enrollment.id = participation.source_course_enrollment_id
           AND enrollment.tenant_id = v_scope.school_tenant_id
           AND enrollment.school_id = v_scope.school_id
           AND enrollment.course_run_id = course.id
           AND enrollment.learner_identity_id = v_scope.learner_identity_id
           AND enrollment.status IN ('assigned', 'active')
         WHERE course.id = v_scope.source_course_run_id
           AND course.tenant_id = v_scope.school_tenant_id
           AND course.classroom_id = v_scope.classroom_id
         FOR SHARE OF course, lesson, enrollment;
        IF v_course_status IS NULL THEN
            result_code := 'forbidden'; RETURN NEXT; RETURN;
        END IF;
    ELSIF v_scope.source_kind <> 'direct' THEN
        result_code := 'forbidden'; RETURN NEXT; RETURN;
    END IF;

    -- The A4-3a2 reader verifies the exact visible Direct/Course occurrence,
    -- current bilateral links and Project access. Never infer from a handout.
    SELECT count(*) AS matches, (array_agg(reader.context))[1] AS context
      INTO v_read
      FROM public.learning_origin_work_context_for_project(
          p_actor_principal_id, p_project_id) reader;
    IF v_read.matches <> 1
       OR v_read.context->>'participationId' IS DISTINCT FROM v_scope.participation_id::text
       OR v_read.context->>'activityRunId' IS DISTINCT FROM v_scope.activity_run_id::text
       OR v_read.context->>'learningActivityVersionId'
          IS DISTINCT FROM v_scope.learning_activity_version_id::text THEN
        result_code := 'forbidden'; RETURN NEXT; RETURN;
    END IF;

    -- The request key is school-tenant scoped and serialized across Projects.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        v_scope.school_tenant_id::text || ':' || p_client_request_id, 182));
    SELECT submission.id, submission.attempt_id, submission.project_id,
           submission.project_tenant_id, submission.project_version_id,
           submission.submitted_at, submission.late_state,
           submission.payload_manifest, attempt.attempt_number,
           attempt.activity_participation_id
      INTO v_existing
      FROM public.learning_submissions submission
      JOIN public.learning_attempts attempt ON attempt.id = submission.attempt_id
     WHERE submission.tenant_id = v_scope.school_tenant_id
       AND submission.client_request_id = p_client_request_id;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.project_id IS DISTINCT FROM p_project_id
           OR v_existing.project_tenant_id IS DISTINCT FROM v_scope.project_tenant_id
           OR v_existing.activity_participation_id IS DISTINCT FROM v_scope.participation_id
           OR (v_existing.payload_manifest->>'sourceRevision')::integer
              IS DISTINCT FROM p_expected_revision THEN
            result_code := 'request_conflict'; RETURN NEXT; RETURN;
        END IF;
        result_code := 'ok'; participation_id := v_scope.participation_id;
        activity_run_id := v_scope.activity_run_id;
        attempt_id := v_existing.attempt_id; submission_id := v_existing.id;
        attempt_number := v_existing.attempt_number;
        attempt_state := 'submitted'; project_id := p_project_id;
        project_version_id := v_existing.project_version_id;
        submitted_at := v_existing.submitted_at;
        late_state := v_existing.late_state; reused := true;
        RETURN NEXT; RETURN;
    END IF;

    SELECT capability.editable_evidence AND capability.submit_project_version
      INTO v_capable FROM public.module_learning_capabilities capability
     WHERE capability.module_key = v_scope.module_key FOR SHARE;
    IF v_scope.project_status <> 'active'
       OR v_scope.participation_status <> 'active' OR v_scope.excused
       OR v_scope.lifecycle_status <> 'active'
       OR v_scope.assignment_status <> 'open'
       OR v_scope.classroom_status <> 'active'
       OR (v_scope.source_kind = 'course' AND v_course_status <> 'open')
       OR v_capable IS DISTINCT FROM true THEN
        result_code := 'not_available'; RETURN NEXT; RETURN;
    END IF;
    v_effective := public.learning_effective_conditions_internal(
        v_scope.activity_run_id, v_scope.participation_id);
    IF v_effective IS NULL OR
       (v_effective#>>'{values,opensAt}')::timestamptz > now()
       OR (v_effective#>>'{values,closesAt}')::timestamptz < now()
       OR ((v_effective#>>'{values,dueAt}')::timestamptz < now()
           AND v_effective#>>'{values,latePolicy}' = 'block_at_due'
           AND v_effective->>'teacherUnlocked' IS DISTINCT FROM 'true') THEN
        result_code := 'not_available'; RETURN NEXT; RETURN;
    END IF;

    SELECT attempt.* INTO v_attempt
      FROM public.learning_attempts attempt
     WHERE attempt.activity_participation_id = v_scope.participation_id
     ORDER BY attempt.attempt_number DESC, attempt.id DESC
     LIMIT 1 FOR UPDATE;
    IF v_attempt.id IS NULL THEN
        result_code := 'not_started'; RETURN NEXT; RETURN;
    END IF;
    IF v_attempt.tenant_id <> v_scope.school_tenant_id
       OR v_attempt.classroom_id <> v_scope.classroom_id
       OR v_attempt.classroom_assignment_id <> v_scope.source_classroom_assignment_id
       OR v_attempt.learner_identity_id <> v_scope.learner_identity_id
       OR v_attempt.seat_id <> v_scope.seat_id
       OR v_attempt.learning_activity_version_id <> v_scope.learning_activity_version_id
       OR v_read.context->>'attemptId' IS DISTINCT FROM v_attempt.id::text THEN
        result_code := 'forbidden'; RETURN NEXT; RETURN;
    END IF;
    IF v_attempt.state <> 'in_progress' OR EXISTS (
        SELECT 1 FROM public.learning_submissions submission
         WHERE submission.attempt_id = v_attempt.id) THEN
        result_code := CASE WHEN v_attempt.state IN ('submitted', 'evaluating')
            THEN 'attempt_already_submitted' ELSE 'not_available' END;
        RETURN NEXT; RETURN;
    END IF;

    SELECT draft.revision, draft.document_json, draft.updated_by
      INTO v_draft FROM public.project_drafts draft
     WHERE draft.project_id = p_project_id
       AND draft.tenant_id = v_scope.project_tenant_id
     FOR UPDATE;
    IF v_draft.revision IS DISTINCT FROM p_expected_revision THEN
        result_code := 'project_revision_conflict'; RETURN NEXT; RETURN;
    END IF;

    -- One function call is one PostgreSQL statement: any failure after the
    -- version insert rolls back the version, Submission and Attempt update.
    v_prior_tenant := current_setting('app.tenant_id', true);
    PERFORM set_config('app.tenant_id', v_scope.project_tenant_id::text, true);
    INSERT INTO public.project_versions (
        tenant_id, project_id, version_no, document_json, label,
        created_by, created_by_principal_id
    ) SELECT v_scope.project_tenant_id, p_project_id,
             COALESCE(max(version.version_no), 0) + 1,
             v_draft.document_json,
             'Сдача, попытка ' || v_attempt.attempt_number,
             v_draft.updated_by, p_actor_principal_id
        FROM public.project_versions version
       WHERE version.tenant_id = v_scope.project_tenant_id
         AND version.project_id = p_project_id
    RETURNING id INTO v_version;
    v_digest := encode(public.digest(
        convert_to(v_draft.document_json::text, 'UTF8'), 'sha256'), 'hex');
    v_late := CASE WHEN (v_effective#>>'{values,dueAt}')::timestamptz < now()
                   THEN 'late' ELSE 'on_time' END;
    PERFORM set_config('app.tenant_id', v_scope.school_tenant_id::text, true);
    INSERT INTO public.learning_submissions (
        tenant_id, attempt_id, project_id, project_tenant_id,
        project_version_id, payload_manifest, payload_digest,
        client_request_id, late_state
    ) VALUES (
        v_scope.school_tenant_id, v_attempt.id, p_project_id,
        v_scope.project_tenant_id, v_version,
        jsonb_build_object('kind', 'project', 'projectVersionId', v_version,
            'sourceRevision', p_expected_revision, 'moduleKey', v_scope.module_key,
            'schemaVersion', v_draft.document_json->'schemaVersion'),
        v_digest, p_client_request_id, v_late
    ) RETURNING id, learning_submissions.submitted_at
      INTO v_submission, v_submitted_at;
    UPDATE public.learning_attempts attempt
       SET state = 'submitted', submitted_at = v_submitted_at
     WHERE attempt.id = v_attempt.id AND attempt.state = 'in_progress';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'learning submission attempt changed' USING ERRCODE = 'PZ001';
    END IF;
    PERFORM set_config('app.tenant_id', COALESCE(v_prior_tenant, ''), true);

    result_code := 'ok'; participation_id := v_scope.participation_id;
    activity_run_id := v_scope.activity_run_id;
    attempt_id := v_attempt.id; submission_id := v_submission;
    attempt_number := v_attempt.attempt_number; attempt_state := 'submitted';
    project_id := p_project_id; project_version_id := v_version;
    submitted_at := v_submitted_at; late_state := v_late; reused := false;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.learning_origin_project_submission_create(
    uuid,uuid,varchar,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_origin_project_submission_create(
    uuid,uuid,varchar,integer) TO asalab_app;
