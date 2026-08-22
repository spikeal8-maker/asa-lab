-- Learning assessment foundation.
--
-- This migration deliberately starts with project assignments already used by
-- classrooms and course runs.  It replaces the mutable `submitted_at` fact as
-- the source of truth with an immutable attempt -> submission -> result chain.

CREATE TABLE IF NOT EXISTS learning_activities (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    owner_principal_id  uuid NOT NULL REFERENCES principals(id),
    scope_kind          varchar(16) NOT NULL DEFAULT 'school',
    activity_type       varchar(24) NOT NULL,
    title               varchar(255) NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    archived_at         timestamptz,
    UNIQUE (tenant_id, id),
    CONSTRAINT learning_activities_scope_check
        CHECK (scope_kind IN ('personal', 'school')),
    CONSTRAINT learning_activities_type_check
        CHECK (activity_type IN ('project', 'quiz', 'open_response', 'composite')),
    CONSTRAINT learning_activities_title_check CHECK (length(trim(title)) > 0)
);

CREATE TABLE IF NOT EXISTS learning_activity_versions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    activity_id         uuid NOT NULL,
    version_number      integer NOT NULL,
    title               varchar(255) NOT NULL,
    instructions        varchar(12000),
    activity_type       varchar(24) NOT NULL,
    module_key          varchar(64),
    max_points          integer NOT NULL,
    scoring_policy      jsonb NOT NULL DEFAULT '{"kind":"manual"}'::jsonb,
    rubric_snapshot     jsonb,
    content_digest      varchar(64) NOT NULL,
    published_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (activity_id, version_number),
    FOREIGN KEY (tenant_id, activity_id)
        REFERENCES learning_activities(tenant_id, id),
    CONSTRAINT learning_activity_versions_number_check CHECK (version_number > 0),
    CONSTRAINT learning_activity_versions_points_check CHECK (max_points > 0),
    CONSTRAINT learning_activity_versions_type_check
        CHECK (activity_type IN ('project', 'quiz', 'open_response', 'composite')),
    CONSTRAINT learning_activity_versions_module_check CHECK (
        (activity_type = 'project' AND module_key IS NOT NULL)
        OR activity_type <> 'project'
    )
);

-- A classroom handout points at one frozen activity version. Existing
-- handouts are upgraded lazily on their first immutable submission.
CREATE TABLE IF NOT EXISTS classroom_activity_versions (
    tenant_id                    uuid NOT NULL REFERENCES tenants(id),
    classroom_assignment_id      uuid PRIMARY KEY,
    learning_activity_version_id uuid NOT NULL,
    assigned_at                  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, classroom_assignment_id),
    FOREIGN KEY (tenant_id, classroom_assignment_id)
        REFERENCES classroom_assignments(tenant_id, id),
    FOREIGN KEY (tenant_id, learning_activity_version_id)
        REFERENCES learning_activity_versions(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS learning_attempts (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                    uuid NOT NULL REFERENCES tenants(id),
    classroom_id                 uuid NOT NULL,
    classroom_assignment_id      uuid NOT NULL,
    learning_activity_version_id uuid NOT NULL,
    seat_id                      uuid NOT NULL REFERENCES classroom_student_seats(id),
    attempt_number               integer NOT NULL,
    state                        varchar(24) NOT NULL DEFAULT 'in_progress',
    started_at                   timestamptz NOT NULL DEFAULT now(),
    submitted_at                 timestamptz,
    evaluated_at                 timestamptz,
    invalidated_at               timestamptz,
    invalidation_reason          varchar(1000),
    UNIQUE (tenant_id, id),
    UNIQUE (classroom_assignment_id, seat_id, attempt_number),
    FOREIGN KEY (tenant_id, classroom_id)
        REFERENCES classrooms(tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_assignment_id)
        REFERENCES classroom_assignments(tenant_id, id),
    FOREIGN KEY (tenant_id, learning_activity_version_id)
        REFERENCES learning_activity_versions(tenant_id, id),
    CONSTRAINT learning_attempts_number_check CHECK (attempt_number > 0),
    CONSTRAINT learning_attempts_state_check CHECK (
        state IN ('in_progress', 'submitted', 'evaluating', 'accepted',
                  'changes_requested', 'incomplete', 'excused', 'invalidated')
    ),
    CONSTRAINT learning_attempts_invalidation_check CHECK (
        (state = 'invalidated' AND invalidated_at IS NOT NULL
                               AND length(trim(invalidation_reason)) > 0)
        OR state <> 'invalidated'
    )
);

CREATE INDEX IF NOT EXISTS learning_attempts_assignment_idx
    ON learning_attempts (tenant_id, classroom_assignment_id, seat_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS learning_attempts_review_idx
    ON learning_attempts (tenant_id, classroom_id, state, submitted_at DESC);

CREATE TABLE IF NOT EXISTS learning_submissions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES tenants(id),
    attempt_id        uuid NOT NULL,
    project_id        uuid NOT NULL,
    project_version_id uuid NOT NULL REFERENCES project_versions(id),
    payload_manifest  jsonb NOT NULL,
    payload_digest    varchar(64) NOT NULL,
    client_request_id varchar(128) NOT NULL,
    late_state        varchar(16) NOT NULL DEFAULT 'on_time',
    submitted_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (attempt_id),
    UNIQUE (tenant_id, client_request_id),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES learning_attempts(tenant_id, id),
    FOREIGN KEY (tenant_id, project_id)
        REFERENCES projects(tenant_id, id),
    CONSTRAINT learning_submissions_digest_check
        CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT learning_submissions_request_check
        CHECK (client_request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
    CONSTRAINT learning_submissions_late_check
        CHECK (late_state IN ('on_time', 'late', 'excused'))
);

CREATE TABLE IF NOT EXISTS learning_evaluations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    attempt_id            uuid NOT NULL,
    evaluator_kind        varchar(16) NOT NULL,
    evaluator_principal_id uuid REFERENCES principals(id),
    status                varchar(24) NOT NULL,
    points                integer,
    max_points            integer NOT NULL,
    feedback              varchar(8000),
    evidence              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES learning_attempts(tenant_id, id),
    CONSTRAINT learning_evaluations_kind_check
        CHECK (evaluator_kind IN ('automatic', 'teacher')),
    CONSTRAINT learning_evaluations_status_check
        CHECK (status IN ('needs_review', 'completed', 'infrastructure_failed', 'invalid')),
    CONSTRAINT learning_evaluations_points_check CHECK (
        max_points > 0 AND (points IS NULL OR points BETWEEN 0 AND max_points)
    )
);

CREATE TABLE IF NOT EXISTS assessment_results (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              uuid NOT NULL REFERENCES tenants(id),
    attempt_id             uuid NOT NULL,
    raw_points             integer,
    max_points             integer NOT NULL,
    percentage_basis_points integer,
    outcome                varchar(24) NOT NULL,
    grade_value            varchar(32),
    auto_points            integer NOT NULL DEFAULT 0,
    manual_points          integer NOT NULL DEFAULT 0,
    adjustment_points      integer NOT NULL DEFAULT 0,
    evaluator_principal_id uuid REFERENCES principals(id),
    feedback               varchar(8000),
    published_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (attempt_id),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES learning_attempts(tenant_id, id),
    CONSTRAINT assessment_results_outcome_check
        CHECK (outcome IN ('passed', 'failed', 'incomplete', 'excused')),
    CONSTRAINT assessment_results_points_check CHECK (
        max_points > 0
        AND (raw_points IS NULL OR raw_points BETWEEN 0 AND max_points)
        AND (percentage_basis_points IS NULL
             OR percentage_basis_points BETWEEN 0 AND 10000)
    )
);

CREATE TABLE IF NOT EXISTS gradebook_entries (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES tenants(id),
    school_id               uuid NOT NULL,
    academic_period_id      uuid NOT NULL,
    classroom_id            uuid NOT NULL,
    classroom_assignment_id uuid NOT NULL,
    seat_id                 uuid NOT NULL REFERENCES classroom_student_seats(id),
    accepted_attempt_id     uuid NOT NULL,
    assessment_result_id    uuid NOT NULL,
    published_by_principal_id uuid NOT NULL REFERENCES principals(id),
    published_at            timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (classroom_assignment_id, seat_id),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools(tenant_id, id),
    FOREIGN KEY (tenant_id, academic_period_id)
        REFERENCES academic_periods(tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id)
        REFERENCES classrooms(tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_assignment_id)
        REFERENCES classroom_assignments(tenant_id, id),
    FOREIGN KEY (tenant_id, accepted_attempt_id)
        REFERENCES learning_attempts(tenant_id, id),
    FOREIGN KEY (tenant_id, assessment_result_id)
        REFERENCES assessment_results(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS grade_change_events (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    gradebook_entry_id    uuid NOT NULL,
    assessment_result_id  uuid NOT NULL,
    actor_principal_id    uuid NOT NULL REFERENCES principals(id),
    event_kind            varchar(24) NOT NULL,
    reason                varchar(1000) NOT NULL,
    snapshot              jsonb NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, gradebook_entry_id)
        REFERENCES gradebook_entries(tenant_id, id),
    FOREIGN KEY (tenant_id, assessment_result_id)
        REFERENCES assessment_results(tenant_id, id),
    CONSTRAINT grade_change_events_kind_check
        CHECK (event_kind IN ('published', 'corrected', 'invalidated')),
    CONSTRAINT grade_change_events_reason_check CHECK (length(trim(reason)) > 0)
);

-- Immutable evidence may only be superseded by a later explicit object; the
-- first release does not expose superseding yet, so updates and deletes fail.
CREATE OR REPLACE FUNCTION learning_immutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS learning_activity_versions_immutable ON learning_activity_versions;
CREATE TRIGGER learning_activity_versions_immutable
    BEFORE UPDATE OR DELETE ON learning_activity_versions
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS learning_submissions_immutable ON learning_submissions;
CREATE TRIGGER learning_submissions_immutable
    BEFORE UPDATE OR DELETE ON learning_submissions
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS learning_evaluations_immutable ON learning_evaluations;
CREATE TRIGGER learning_evaluations_immutable
    BEFORE UPDATE OR DELETE ON learning_evaluations
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS assessment_results_immutable ON assessment_results;
CREATE TRIGGER assessment_results_immutable
    BEFORE UPDATE OR DELETE ON assessment_results
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS grade_change_events_immutable ON grade_change_events;
CREATE TRIGGER grade_change_events_immutable
    BEFORE UPDATE OR DELETE ON grade_change_events
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();

-- Create the frozen project submission. Repeating a request id returns the
-- original evidence and never creates another attempt or project checkpoint.
CREATE OR REPLACE FUNCTION learning_project_submission_create(
    p_seat_id uuid,
    p_assignment_id uuid,
    p_client_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
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
    v_scope record;
    v_activity uuid;
    v_version uuid;
    v_attempt uuid;
    v_attempt_number integer;
    v_project_version uuid;
    v_submission uuid;
    v_digest varchar;
    v_late varchar;
    v_submitted_at timestamptz;
    v_existing record;
BEGIN
    IF p_client_request_id IS NULL
       OR p_client_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, NULL::uuid,
            NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT submission.id, submission.attempt_id, attempt.attempt_number,
           attempt.state, submission.project_id, submission.project_version_id,
           submission.submitted_at, submission.late_state
      INTO v_existing
      FROM public.learning_submissions submission
      JOIN public.learning_attempts attempt ON attempt.id = submission.attempt_id
     WHERE submission.client_request_id = p_client_request_id
       AND attempt.seat_id = p_seat_id
       AND attempt.classroom_assignment_id = p_assignment_id;
    IF v_existing.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing.attempt_id, v_existing.id,
            v_existing.attempt_number, v_existing.state, v_existing.project_id,
            v_existing.project_version_id, v_existing.submitted_at,
            v_existing.late_state, true;
        RETURN;
    END IF;

    SELECT work.tenant_id, assignment.classroom_id, classroom.school_id,
           classroom.academic_period_id,
           COALESCE(task.title, lesson.assignment_title) AS title,
           COALESCE(task.brief, lesson.assignment_brief) AS instructions,
           COALESCE(task.module_key, lesson.module_key) AS module_key,
           assignment.due_at, assignment.status, work.project_id,
           project.owner_principal_id, draft.document_json, draft.updated_by
      INTO v_scope
      FROM public.classroom_assignment_work work
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = work.tenant_id AND assignment.id = work.assignment_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id
       AND classroom.id = assignment.classroom_id
      JOIN public.classroom_student_seats seat ON seat.id = work.seat_id
      JOIN public.projects project
        ON project.tenant_id = work.tenant_id AND project.id = work.project_id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id AND draft.project_id = project.id
      LEFT JOIN public.classroom_course_run_lessons lesson
        ON lesson.classroom_assignment_id = assignment.id
      LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
     WHERE work.seat_id = p_seat_id
       AND work.assignment_id = p_assignment_id
       AND seat.status = 'active'
       AND assignment.status = 'open'
       AND project.owner_principal_id = (
           SELECT principal.id FROM public.principals principal
            WHERE principal.seat_id = p_seat_id
       )
     FOR UPDATE OF work, draft;
    IF v_scope.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'assignment_unavailable'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, NULL::uuid,
            NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT mapping.learning_activity_version_id
      INTO v_version
      FROM public.classroom_activity_versions mapping
     WHERE mapping.classroom_assignment_id = p_assignment_id;
    IF v_version IS NULL THEN
        INSERT INTO public.learning_activities (
            tenant_id, owner_principal_id, scope_kind, activity_type, title
        ) VALUES (
            v_scope.tenant_id,
            COALESCE(
                (SELECT task.owner_principal_id FROM public.teacher_assignments task
                  WHERE task.id = (SELECT assignment_id FROM public.classroom_assignments
                                    WHERE id = p_assignment_id)),
                (SELECT run.assigned_by_principal_id
                   FROM public.classroom_course_run_lessons lesson
                   JOIN public.classroom_course_runs run ON run.id = lesson.run_id
                  WHERE lesson.classroom_assignment_id = p_assignment_id),
                v_scope.owner_principal_id
            ),
            'school', 'project', v_scope.title
        ) RETURNING id INTO v_activity;
        v_digest := encode(digest(convert_to(
            concat_ws(E'\n', v_scope.title, v_scope.instructions, v_scope.module_key, '100'),
            'UTF8'), 'sha256'), 'hex');
        INSERT INTO public.learning_activity_versions (
            tenant_id, activity_id, version_number, title, instructions,
            activity_type, module_key, max_points, scoring_policy, content_digest
        ) VALUES (
            v_scope.tenant_id, v_activity, 1, v_scope.title, v_scope.instructions,
            'project', v_scope.module_key, 100,
            '{"kind":"manual","scale":"integer","passThreshold":60}'::jsonb,
            v_digest
        ) RETURNING id INTO v_version;
        INSERT INTO public.classroom_activity_versions (
            tenant_id, classroom_assignment_id, learning_activity_version_id
        ) VALUES (v_scope.tenant_id, p_assignment_id, v_version);
    END IF;

    SELECT attempt.state
      INTO v_existing
      FROM public.learning_attempts attempt
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id
     ORDER BY attempt.attempt_number DESC
     LIMIT 1;
    IF v_existing.state IS NOT NULL
       AND v_existing.state <> 'changes_requested' THEN
        RETURN QUERY SELECT 'attempt_already_submitted'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, v_existing.state::varchar, v_scope.project_id, NULL::uuid,
            NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT COALESCE(max(attempt.attempt_number), 0) + 1
      INTO v_attempt_number
      FROM public.learning_attempts attempt
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id;

    INSERT INTO public.project_versions (
        tenant_id, project_id, version_no, document_json, label,
        created_by, created_by_principal_id
    ) SELECT v_scope.tenant_id, v_scope.project_id,
             COALESCE(max(version.version_no), 0) + 1,
             v_scope.document_json,
             'Сдача, попытка ' || v_attempt_number,
             v_scope.updated_by, v_scope.owner_principal_id
        FROM public.project_versions version
       WHERE version.tenant_id = v_scope.tenant_id
         AND version.project_id = v_scope.project_id
    RETURNING id INTO v_project_version;

    INSERT INTO public.learning_attempts (
        tenant_id, classroom_id, classroom_assignment_id,
        learning_activity_version_id, seat_id, attempt_number,
        state, submitted_at
    ) VALUES (
        v_scope.tenant_id, v_scope.classroom_id, p_assignment_id,
        v_version, p_seat_id, v_attempt_number, 'evaluating', now()
    ) RETURNING id INTO v_attempt;

    v_digest := encode(digest(convert_to(v_scope.document_json::text, 'UTF8'), 'sha256'), 'hex');
    v_late := CASE WHEN v_scope.due_at IS NOT NULL AND now() > v_scope.due_at
                   THEN 'late' ELSE 'on_time' END;
    INSERT INTO public.learning_submissions (
        tenant_id, attempt_id, project_id, project_version_id,
        payload_manifest, payload_digest, client_request_id, late_state
    ) VALUES (
        v_scope.tenant_id, v_attempt, v_scope.project_id, v_project_version,
        jsonb_build_object('kind', 'project', 'projectVersionId', v_project_version),
        v_digest, p_client_request_id, v_late
    ) RETURNING id, learning_submissions.submitted_at INTO v_submission, v_submitted_at;

    INSERT INTO public.learning_evaluations (
        tenant_id, attempt_id, evaluator_kind, status, max_points, evidence
    ) VALUES (
        v_scope.tenant_id, v_attempt, 'automatic', 'needs_review', 100,
        jsonb_build_object('submissionDigest', v_digest)
    );

    -- Compatibility only. Canonical readers use learning_attempts/submissions.
    UPDATE public.classroom_assignment_work
       SET submitted_at = v_submitted_at
     WHERE assignment_id = p_assignment_id AND seat_id = p_seat_id;

    RETURN QUERY SELECT 'ok'::varchar, v_attempt, v_submission,
        v_attempt_number, 'evaluating'::varchar, v_scope.project_id,
        v_project_version, v_submitted_at, v_late, false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_attempt_review(
    p_account_id uuid,
    p_reviewer_principal_id uuid,
    p_classroom_id uuid,
    p_attempt_id uuid,
    p_decision varchar,
    p_points integer,
    p_feedback varchar,
    p_reason varchar
)
RETURNS TABLE (
    result_code varchar,
    assessment_result_id uuid,
    gradebook_entry_id uuid,
    attempt_state varchar,
    percentage_basis_points integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_attempt record;
    v_result uuid;
    v_gradebook uuid;
    v_percentage integer;
    v_outcome varchar;
BEGIN
    SELECT * INTO v_access
      FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN
        RETURN QUERY SELECT 'classroom_not_found'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_decision NOT IN ('accepted', 'changes_requested', 'incomplete', 'excused') THEN
        RETURN QUERY SELECT 'invalid_decision'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_feedback IS NOT NULL AND length(p_feedback) > 8000 THEN
        RETURN QUERY SELECT 'invalid_feedback'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;

    SELECT attempt.*, version.max_points, classroom.school_id,
           classroom.academic_period_id, principal.id AS reviewer_principal_id
      INTO v_attempt
      FROM public.learning_attempts attempt
      JOIN public.learning_activity_versions version
        ON version.id = attempt.learning_activity_version_id
      JOIN public.classrooms classroom ON classroom.id = attempt.classroom_id
      JOIN public.principals principal
        ON principal.id = p_reviewer_principal_id
       AND principal.account_id = p_account_id
     WHERE attempt.id = p_attempt_id
       AND attempt.classroom_id = p_classroom_id
       AND attempt.tenant_id = v_access.tenant_id
     FOR UPDATE OF attempt;
    IF v_attempt.id IS NULL THEN
        RETURN QUERY SELECT 'attempt_not_found'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF v_attempt.state <> 'evaluating' THEN
        RETURN QUERY SELECT 'invalid_transition'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_decision = 'changes_requested' THEN
        UPDATE public.learning_attempts
           SET state = 'changes_requested', evaluated_at = now()
         WHERE id = p_attempt_id;
        INSERT INTO public.learning_evaluations (
            tenant_id, attempt_id, evaluator_kind, evaluator_principal_id,
            status, points, max_points, feedback
        ) VALUES (
            v_attempt.tenant_id, p_attempt_id, 'teacher',
            v_attempt.reviewer_principal_id, 'completed', NULL,
            v_attempt.max_points, p_feedback
        );
        UPDATE public.classroom_assignment_work
           SET submitted_at = NULL
         WHERE assignment_id = v_attempt.classroom_assignment_id
           AND seat_id = v_attempt.seat_id;
        RETURN QUERY SELECT 'ok'::varchar, NULL::uuid, NULL::uuid,
            'changes_requested'::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_decision = 'accepted' AND
       (p_points IS NULL OR p_points < 0 OR p_points > v_attempt.max_points) THEN
        RETURN QUERY SELECT 'invalid_points'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_decision IN ('incomplete', 'excused') AND p_reason IS NULL THEN
        RETURN QUERY SELECT 'reason_required'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;

    v_outcome := CASE
        WHEN p_decision = 'accepted' AND p_points * 100 >= v_attempt.max_points * 60
            THEN 'passed'
        WHEN p_decision = 'accepted' THEN 'failed'
        ELSE p_decision
    END;
    v_percentage := CASE WHEN p_points IS NULL THEN NULL
                         ELSE (p_points * 10000) / v_attempt.max_points END;

    INSERT INTO public.learning_evaluations (
        tenant_id, attempt_id, evaluator_kind, evaluator_principal_id,
        status, points, max_points, feedback
    ) VALUES (
        v_attempt.tenant_id, p_attempt_id, 'teacher',
        v_attempt.reviewer_principal_id, 'completed', p_points,
        v_attempt.max_points, p_feedback
    );
    INSERT INTO public.assessment_results (
        tenant_id, attempt_id, raw_points, max_points,
        percentage_basis_points, outcome, manual_points,
        evaluator_principal_id, feedback
    ) VALUES (
        v_attempt.tenant_id, p_attempt_id, p_points, v_attempt.max_points,
        v_percentage, v_outcome, COALESCE(p_points, 0),
        v_attempt.reviewer_principal_id, p_feedback
    ) RETURNING id INTO v_result;
    UPDATE public.learning_attempts
       SET state = p_decision, evaluated_at = now()
     WHERE id = p_attempt_id;

    INSERT INTO public.gradebook_entries (
        tenant_id, school_id, academic_period_id, classroom_id,
        classroom_assignment_id, seat_id, accepted_attempt_id,
        assessment_result_id, published_by_principal_id
    ) VALUES (
        v_attempt.tenant_id, v_attempt.school_id, v_attempt.academic_period_id,
        p_classroom_id, v_attempt.classroom_assignment_id, v_attempt.seat_id,
        p_attempt_id, v_result, v_attempt.reviewer_principal_id
    )
    ON CONFLICT (classroom_assignment_id, seat_id) DO UPDATE
       SET accepted_attempt_id = EXCLUDED.accepted_attempt_id,
           assessment_result_id = EXCLUDED.assessment_result_id,
           published_by_principal_id = EXCLUDED.published_by_principal_id,
           published_at = now(), updated_at = now()
    RETURNING id INTO v_gradebook;
    INSERT INTO public.grade_change_events (
        tenant_id, gradebook_entry_id, assessment_result_id,
        actor_principal_id, event_kind, reason, snapshot
    ) VALUES (
        v_attempt.tenant_id, v_gradebook, v_result,
        v_attempt.reviewer_principal_id, 'published',
        COALESCE(NULLIF(trim(p_reason), ''), 'Первичная публикация результата'),
        jsonb_build_object('points', p_points, 'maxPoints', v_attempt.max_points,
                           'percentageBasisPoints', v_percentage, 'outcome', v_outcome)
    );

    RETURN QUERY SELECT 'ok'::varchar, v_result, v_gradebook,
        p_decision::varchar, v_percentage;
END;
$$;

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
           COALESCE(task.title, lesson.assignment_title),
           attempt.id, attempt.attempt_number, attempt.state,
           submission.submitted_at, result.raw_points, result.max_points,
           result.percentage_basis_points, result.outcome, result.feedback,
           result.published_at
      FROM public.classroom_student_seats seat
      CROSS JOIN public.classroom_assignments assignment
      LEFT JOIN public.classroom_course_run_lessons lesson
        ON lesson.classroom_assignment_id = assignment.id
      LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
      LEFT JOIN LATERAL (
          SELECT latest.* FROM public.learning_attempts latest
           WHERE latest.classroom_assignment_id = assignment.id
             AND latest.seat_id = seat.id
           ORDER BY latest.attempt_number DESC LIMIT 1
      ) attempt ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
      LEFT JOIN public.gradebook_entries grade
        ON grade.classroom_assignment_id = assignment.id AND grade.seat_id = seat.id
      LEFT JOIN public.assessment_results result ON result.id = grade.assessment_result_id
     WHERE assignment.classroom_id = p_classroom_id
       AND seat.classroom_id = p_classroom_id
       AND seat.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships membership
            WHERE membership.account_id = p_account_id
              AND membership.classroom_id = p_classroom_id
              AND membership.tenant_id = assignment.tenant_id
              AND membership.member_role IN ('owner', 'co_teacher')
       )
     ORDER BY assignment.created_at, seat.display_label, seat.id;
$$;

REVOKE ALL ON learning_activities, learning_activity_versions,
    classroom_activity_versions, learning_attempts, learning_submissions,
    learning_evaluations, assessment_results, gradebook_entries,
    grade_change_events FROM PUBLIC, asalab_app;

ALTER TABLE learning_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_activities FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_activity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_activity_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_activity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_activity_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_results FORCE ROW LEVEL SECURITY;
ALTER TABLE gradebook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gradebook_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE grade_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_change_events FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'learning_activities', 'learning_activity_versions',
        'classroom_activity_versions', 'learning_attempts',
        'learning_submissions', 'learning_evaluations', 'assessment_results',
        'gradebook_entries', 'grade_change_events'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I', table_name, table_name);
        EXECUTE format(
            'CREATE POLICY %I_tenant ON public.%I USING '
            || '(tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
            || 'WITH CHECK '
            || '(tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name, table_name
        );
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION learning_project_submission_create(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_attempt_review(
    uuid, uuid, uuid, uuid, varchar, integer, varchar, varchar
)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_gradebook_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_project_submission_create(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_attempt_review(
    uuid, uuid, uuid, uuid, varchar, integer, varchar, varchar
) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_gradebook_list(uuid, uuid) TO asalab_app;
