-- LRN-M1-003: one persistent ActivityRun for direct and course delivery.
--
-- Existing classroom assignments remain the compatibility handout identity.
-- Existing Attempts and learner readers are deliberately not cut over here.

CREATE UNIQUE INDEX classrooms_learning_school_identity_idx
    ON classrooms (tenant_id, school_id, id);
CREATE UNIQUE INDEX classroom_assignments_learning_identity_idx
    ON classroom_assignments (tenant_id, classroom_id, id);
CREATE UNIQUE INDEX classroom_course_run_lessons_learning_identity_idx
    ON classroom_course_run_lessons (tenant_id, run_id, id);
CREATE UNIQUE INDEX grading_scheme_versions_learning_identity_idx
    ON grading_scheme_versions (tenant_id, school_id, id);

CREATE OR REPLACE FUNCTION activity_run_policy_snapshot_valid(
    p_snapshot jsonb,
    p_late_policy varchar
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_explicit jsonb;
    v_sources jsonb;
    v_key text;
BEGIN
    IF jsonb_typeof(p_snapshot) <> 'object'
       OR (p_snapshot - ARRAY['contractVersion', 'explicit', 'sources']) <> '{}'::jsonb
       OR p_snapshot ->> 'contractVersion' <> '1'
       OR jsonb_typeof(p_snapshot -> 'explicit') <> 'object'
       OR jsonb_typeof(p_snapshot -> 'sources') <> 'object' THEN
        RETURN false;
    END IF;

    v_explicit := p_snapshot -> 'explicit';
    v_sources := p_snapshot -> 'sources';
    IF (v_explicit - ARRAY['attemptLimit', 'timeLimitMinutes', 'latePolicy']) <> '{}'::jsonb
       OR (v_sources - ARRAY['attemptLimit', 'timeLimitMinutes', 'latePolicy']) <> '{}'::jsonb THEN
        RETURN false;
    END IF;

    FOREACH v_key IN ARRAY ARRAY['attemptLimit', 'timeLimitMinutes', 'latePolicy'] LOOP
        IF (v_explicit ? v_key) <> (v_sources ? v_key) THEN RETURN false; END IF;
        IF v_sources ? v_key
           AND v_sources ->> v_key <> 'activity_run_explicit' THEN
            RETURN false;
        END IF;
    END LOOP;

    IF v_explicit ? 'attemptLimit'
       AND (jsonb_typeof(v_explicit -> 'attemptLimit') <> 'number'
            OR v_explicit ->> 'attemptLimit' !~ '^[0-9]+$'
            OR (v_explicit ->> 'attemptLimit')::integer NOT BETWEEN 1 AND 100) THEN
        RETURN false;
    END IF;
    IF v_explicit ? 'timeLimitMinutes'
       AND (jsonb_typeof(v_explicit -> 'timeLimitMinutes') <> 'number'
            OR v_explicit ->> 'timeLimitMinutes' !~ '^[0-9]+$'
            OR (v_explicit ->> 'timeLimitMinutes')::integer NOT BETWEEN 1 AND 10080) THEN
        RETURN false;
    END IF;
    IF p_late_policy IS NULL THEN
        IF v_explicit ? 'latePolicy' THEN RETURN false; END IF;
    ELSIF jsonb_typeof(v_explicit -> 'latePolicy') <> 'string'
          OR v_explicit ->> 'latePolicy' <> p_late_policy THEN
        RETURN false;
    END IF;
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

CREATE TABLE activity_runs (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                    uuid NOT NULL REFERENCES tenants(id),
    school_id                    uuid NOT NULL,
    classroom_id                 uuid NOT NULL,
    learning_activity_version_id uuid NOT NULL,
    source_kind                  varchar(16) NOT NULL,
    source_classroom_assignment_id uuid NOT NULL,
    source_course_run_id         uuid,
    source_course_lesson_id      uuid,
    lifecycle_status             varchar(16) NOT NULL DEFAULT 'active',
    opens_at                     timestamptz,
    due_at                       timestamptz,
    closes_at                    timestamptz,
    late_policy                  varchar(32),
    grading_scheme_version_id    uuid,
    runtime_policy_snapshot      jsonb NOT NULL,
    created_by_principal_id      uuid NOT NULL REFERENCES principals(id),
    creation_request_id          varchar(128) NOT NULL,
    creation_request_digest      varchar(64) NOT NULL,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    closed_at                    timestamptz,
    cancelled_at                 timestamptz,
    archived_at                  timestamptz,
    updated_at                   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (source_classroom_assignment_id),
    UNIQUE (tenant_id, created_by_principal_id, creation_request_id),
    FOREIGN KEY (tenant_id, school_id, classroom_id)
        REFERENCES classrooms(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, learning_activity_version_id)
        REFERENCES learning_activity_versions(tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id, source_classroom_assignment_id)
        REFERENCES classroom_assignments(tenant_id, classroom_id, id),
    FOREIGN KEY (tenant_id, source_course_run_id)
        REFERENCES classroom_course_runs(tenant_id, id),
    FOREIGN KEY (tenant_id, source_course_run_id, source_course_lesson_id)
        REFERENCES classroom_course_run_lessons(tenant_id, run_id, id),
    FOREIGN KEY (tenant_id, school_id, grading_scheme_version_id)
        REFERENCES grading_scheme_versions(tenant_id, school_id, id),
    CONSTRAINT activity_runs_source_kind_check
        CHECK (source_kind IN ('direct', 'course')),
    CONSTRAINT activity_runs_source_shape_check CHECK (
        (source_kind = 'direct'
         AND source_course_run_id IS NULL
         AND source_course_lesson_id IS NULL)
        OR
        (source_kind = 'course'
         AND source_course_run_id IS NOT NULL
         AND source_course_lesson_id IS NOT NULL)
    ),
    CONSTRAINT activity_runs_lifecycle_status_check
        CHECK (lifecycle_status IN ('active', 'closed', 'cancelled', 'archived')),
    CONSTRAINT activity_runs_dates_check CHECK (
        (opens_at IS NULL OR due_at IS NULL OR opens_at <= due_at)
        AND (due_at IS NULL OR closes_at IS NULL OR due_at <= closes_at)
        AND (opens_at IS NULL OR closes_at IS NULL OR opens_at <= closes_at)
    ),
    CONSTRAINT activity_runs_late_policy_check CHECK (
        late_policy IS NULL OR late_policy IN (
            'allow_mark_late', 'block_at_due', 'allow_until_close'
        )
    ),
    CONSTRAINT activity_runs_request_check
        CHECK (creation_request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
    CONSTRAINT activity_runs_digest_check
        CHECK (creation_request_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT activity_runs_policy_snapshot_check
        CHECK (activity_run_policy_snapshot_valid(runtime_policy_snapshot, late_policy)),
    CONSTRAINT activity_runs_transition_timestamps_check CHECK (
        (lifecycle_status = 'active'
         AND closed_at IS NULL AND cancelled_at IS NULL AND archived_at IS NULL)
        OR
        (lifecycle_status = 'closed'
         AND closed_at IS NOT NULL AND cancelled_at IS NULL AND archived_at IS NULL)
        OR
        (lifecycle_status = 'cancelled'
         AND cancelled_at IS NOT NULL AND closed_at IS NULL AND archived_at IS NULL)
        OR
        (lifecycle_status = 'archived'
         AND closed_at IS NOT NULL AND cancelled_at IS NULL AND archived_at IS NOT NULL)
    )
);

CREATE INDEX activity_runs_classroom_status_idx
    ON activity_runs (tenant_id, classroom_id, lifecycle_status, created_at DESC, id);
CREATE INDEX activity_runs_activity_version_idx
    ON activity_runs (tenant_id, learning_activity_version_id, created_at DESC, id);
CREATE UNIQUE INDEX activity_runs_course_lesson_once_idx
    ON activity_runs (source_course_run_id, source_course_lesson_id)
    WHERE source_kind = 'course';

CREATE OR REPLACE FUNCTION activity_run_lineage_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_assignment record;
    v_activity record;
    v_course record;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'activity run history is append-preserved';
    END IF;

    SELECT assignment.tenant_id, assignment.classroom_id, assignment.course_run_id,
           assignment.status,
           classroom.school_id
      INTO v_assignment
      FROM public.classroom_assignments assignment
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id
       AND classroom.id = assignment.classroom_id
     WHERE assignment.id = NEW.source_classroom_assignment_id;
    IF v_assignment.tenant_id IS NULL
       OR NEW.tenant_id <> v_assignment.tenant_id
       OR NEW.classroom_id <> v_assignment.classroom_id
       OR NEW.school_id <> v_assignment.school_id THEN
        RAISE EXCEPTION 'activity run handout/classroom school lineage is incoherent';
    END IF;
    IF TG_OP = 'INSERT' AND v_assignment.status <> 'open' THEN
        RAISE EXCEPTION 'activity run requires an open compatibility handout';
    END IF;

    SELECT version.tenant_id, activity.owner_principal_id,
           activity.reusable_authored_content, version.canonical_contract_version,
           compatibility.learning_activity_version_id AS compatibility_id
      INTO v_activity
      FROM public.learning_activity_versions version
      JOIN public.learning_activities activity
        ON activity.tenant_id = version.tenant_id
       AND activity.id = version.activity_id
      LEFT JOIN public.learning_migration_compatibility_activity_versions compatibility
        ON compatibility.tenant_id = version.tenant_id
       AND compatibility.learning_activity_version_id = version.id
     WHERE version.id = NEW.learning_activity_version_id;
    IF v_activity.tenant_id IS NULL
       OR v_activity.tenant_id <> NEW.tenant_id
       OR v_activity.owner_principal_id <> NEW.created_by_principal_id
       OR v_activity.reusable_authored_content IS DISTINCT FROM true
       OR v_activity.canonical_contract_version IS DISTINCT FROM 1
       OR v_activity.compatibility_id IS NOT NULL THEN
        RAISE EXCEPTION 'activity run requires owner canonical reusable LAV v1';
    END IF;

    IF NEW.source_kind = 'direct' THEN
        IF v_assignment.course_run_id IS NOT NULL THEN
            RAISE EXCEPTION 'direct activity run cannot use a course handout';
        END IF;
    ELSE
        SELECT run.tenant_id, run.classroom_id, run.status,
               lesson.classroom_assignment_id
          INTO v_course
          FROM public.classroom_course_runs run
          JOIN public.classroom_course_run_lessons lesson
            ON lesson.tenant_id = run.tenant_id
           AND lesson.run_id = run.id
           AND lesson.id = NEW.source_course_lesson_id
           AND lesson.kind = 'assignment'
         WHERE run.id = NEW.source_course_run_id;
        IF v_course.tenant_id IS NULL
           OR v_course.tenant_id <> NEW.tenant_id
           OR v_course.classroom_id <> NEW.classroom_id
           OR (TG_OP = 'INSERT' AND v_course.status <> 'open')
           OR v_course.classroom_assignment_id <> NEW.source_classroom_assignment_id
           OR v_assignment.course_run_id <> NEW.source_course_run_id THEN
            RAISE EXCEPTION 'course activity run provenance is incoherent';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id
           OR NEW.tenant_id <> OLD.tenant_id
           OR NEW.school_id <> OLD.school_id
           OR NEW.classroom_id <> OLD.classroom_id
           OR NEW.learning_activity_version_id <> OLD.learning_activity_version_id
           OR NEW.source_kind <> OLD.source_kind
           OR NEW.source_classroom_assignment_id <> OLD.source_classroom_assignment_id
           OR NEW.source_course_run_id IS DISTINCT FROM OLD.source_course_run_id
           OR NEW.source_course_lesson_id IS DISTINCT FROM OLD.source_course_lesson_id
           OR NEW.opens_at IS DISTINCT FROM OLD.opens_at
           OR NEW.due_at IS DISTINCT FROM OLD.due_at
           OR NEW.closes_at IS DISTINCT FROM OLD.closes_at
           OR NEW.late_policy IS DISTINCT FROM OLD.late_policy
           OR NEW.grading_scheme_version_id IS DISTINCT FROM OLD.grading_scheme_version_id
           OR NEW.runtime_policy_snapshot <> OLD.runtime_policy_snapshot
           OR NEW.created_by_principal_id <> OLD.created_by_principal_id
           OR NEW.creation_request_id <> OLD.creation_request_id
           OR NEW.creation_request_digest <> OLD.creation_request_digest
           OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'activity run identity, content and policy pins are immutable';
        END IF;
        IF NEW.lifecycle_status <> OLD.lifecycle_status
           AND NOT (
               (OLD.lifecycle_status = 'active'
                AND NEW.lifecycle_status IN ('closed', 'cancelled'))
               OR (OLD.lifecycle_status = 'closed'
                   AND NEW.lifecycle_status = 'archived')
           ) THEN
            RAISE EXCEPTION 'invalid activity run transition % -> %',
                            OLD.lifecycle_status, NEW.lifecycle_status;
        END IF;
        IF NEW.lifecycle_status = OLD.lifecycle_status AND (
            NEW.closed_at IS DISTINCT FROM OLD.closed_at
            OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
            OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
        ) THEN
            RAISE EXCEPTION 'activity run transition evidence is immutable';
        END IF;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER activity_runs_lineage_lifecycle_guard
    BEFORE INSERT OR UPDATE OR DELETE ON activity_runs
    FOR EACH ROW EXECUTE FUNCTION activity_run_lineage_lifecycle_guard();

REVOKE ALL ON activity_runs FROM PUBLIC, asalab_app;
ALTER TABLE activity_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_runs_tenant ON activity_runs
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION activity_run_create(
    p_actor_principal_id uuid,
    p_classroom_assignment_id uuid,
    p_learning_activity_version_id uuid,
    p_source_kind varchar,
    p_source_course_run_id uuid,
    p_source_course_lesson_id uuid,
    p_opens_at timestamptz,
    p_due_at timestamptz,
    p_closes_at timestamptz,
    p_late_policy varchar,
    p_grading_scheme_version_id uuid,
    p_runtime_policy_explicit jsonb,
    p_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    activity_run_id uuid,
    lifecycle_status varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source record;
    v_version record;
    v_existing public.activity_runs%ROWTYPE;
    v_run public.activity_runs%ROWTYPE;
    v_explicit jsonb := COALESCE(p_runtime_policy_explicit, '{}'::jsonb);
    v_sources jsonb := '{}'::jsonb;
    v_snapshot jsonb;
    v_digest varchar;
    v_key text;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF p_source_kind NOT IN ('direct', 'course')
       OR (p_source_kind = 'direct'
           AND (p_source_course_run_id IS NOT NULL OR p_source_course_lesson_id IS NOT NULL))
       OR (p_source_kind = 'course'
           AND (p_source_course_run_id IS NULL OR p_source_course_lesson_id IS NULL)) THEN
        RETURN QUERY SELECT 'invalid_source'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF (p_opens_at IS NOT NULL AND p_due_at IS NOT NULL AND p_opens_at > p_due_at)
       OR (p_due_at IS NOT NULL AND p_closes_at IS NOT NULL AND p_due_at > p_closes_at)
       OR (p_opens_at IS NOT NULL AND p_closes_at IS NOT NULL AND p_opens_at > p_closes_at) THEN
        RETURN QUERY SELECT 'invalid_dates'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF p_late_policy IS NOT NULL
       AND p_late_policy NOT IN ('allow_mark_late', 'block_at_due', 'allow_until_close') THEN
        RETURN QUERY SELECT 'invalid_late_policy'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF jsonb_typeof(v_explicit) <> 'object'
       OR (v_explicit - ARRAY['attemptLimit', 'timeLimitMinutes']) <> '{}'::jsonb THEN
        RETURN QUERY SELECT 'invalid_runtime_policy'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF p_late_policy IS NOT NULL THEN
        v_explicit := v_explicit || jsonb_build_object('latePolicy', p_late_policy);
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_explicit) LOOP
        v_sources := v_sources || jsonb_build_object(v_key, 'activity_run_explicit');
    END LOOP;
    v_snapshot := jsonb_build_object(
        'contractVersion', 1,
        'explicit', v_explicit,
        'sources', v_sources
    );
    IF NOT public.activity_run_policy_snapshot_valid(v_snapshot, p_late_policy) THEN
        RETURN QUERY SELECT 'invalid_runtime_policy'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT assignment.tenant_id, assignment.classroom_id, assignment.course_run_id,
           classroom.school_id, membership.user_id
      INTO v_source
      FROM public.classroom_assignments assignment
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id
       AND classroom.id = assignment.classroom_id
       AND classroom.status = 'active'
      JOIN public.principals principal
        ON principal.id = p_actor_principal_id
       AND principal.kind = 'account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = assignment.tenant_id
       AND membership.classroom_id = assignment.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
     WHERE assignment.id = p_classroom_assignment_id
       AND assignment.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
       AND assignment.status = 'open';
    IF v_source.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT version.id, activity.owner_principal_id,
           activity.reusable_authored_content, version.canonical_contract_version,
           compatibility.learning_activity_version_id AS compatibility_id
      INTO v_version
      FROM public.learning_activity_versions version
      JOIN public.learning_activities activity
        ON activity.tenant_id = version.tenant_id
       AND activity.id = version.activity_id
      LEFT JOIN public.learning_migration_compatibility_activity_versions compatibility
        ON compatibility.tenant_id = version.tenant_id
       AND compatibility.learning_activity_version_id = version.id
     WHERE version.id = p_learning_activity_version_id
       AND version.tenant_id = v_source.tenant_id;
    IF v_version.id IS NULL
       OR v_version.owner_principal_id <> p_actor_principal_id THEN
        RETURN QUERY SELECT 'activity_version_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF v_version.reusable_authored_content IS DISTINCT FROM true
       OR v_version.canonical_contract_version IS DISTINCT FROM 1
       OR v_version.compatibility_id IS NOT NULL THEN
        RETURN QUERY SELECT 'compatibility_version_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    IF p_source_kind = 'direct' AND v_source.course_run_id IS NOT NULL THEN
        RETURN QUERY SELECT 'source_conflict'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF p_source_kind = 'course' AND NOT EXISTS (
        SELECT 1
          FROM public.classroom_course_runs run
          JOIN public.classroom_course_run_lessons lesson
            ON lesson.tenant_id = run.tenant_id
           AND lesson.run_id = run.id
           AND lesson.id = p_source_course_lesson_id
           AND lesson.kind = 'assignment'
           AND lesson.classroom_assignment_id = p_classroom_assignment_id
         WHERE run.id = p_source_course_run_id
           AND run.tenant_id = v_source.tenant_id
           AND run.classroom_id = v_source.classroom_id
           AND run.status = 'open'
           AND v_source.course_run_id = run.id
    ) THEN
        RETURN QUERY SELECT 'course_source_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    IF p_grading_scheme_version_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.grading_scheme_versions scheme
         WHERE scheme.id = p_grading_scheme_version_id
           AND scheme.tenant_id = v_source.tenant_id
           AND scheme.school_id = v_source.school_id
    ) THEN
        RETURN QUERY SELECT 'grading_scheme_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    v_digest := public.learning_activity_snapshot_digest(jsonb_build_object(
        'classroomAssignmentId', p_classroom_assignment_id,
        'learningActivityVersionId', p_learning_activity_version_id,
        'sourceKind', p_source_kind,
        'sourceCourseRunId', p_source_course_run_id,
        'sourceCourseLessonId', p_source_course_lesson_id,
        'opensAt', p_opens_at,
        'dueAt', p_due_at,
        'closesAt', p_closes_at,
        'latePolicy', p_late_policy,
        'gradingSchemeVersionId', p_grading_scheme_version_id,
        'runtimePolicySnapshot', v_snapshot
    ));
    PERFORM pg_advisory_xact_lock(hashtextextended(p_classroom_assignment_id::text, 9103));

    SELECT * INTO v_existing
      FROM public.activity_runs run
     WHERE run.tenant_id = v_source.tenant_id
       AND run.created_by_principal_id = p_actor_principal_id
       AND run.creation_request_id = p_request_id;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.creation_request_digest <> v_digest THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar,
                                NULL::uuid, NULL::varchar, false;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_existing.id,
                                v_existing.lifecycle_status, true;
        END IF;
        RETURN;
    END IF;

    SELECT * INTO v_existing FROM public.activity_runs run
     WHERE run.source_classroom_assignment_id = p_classroom_assignment_id;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.creation_request_digest <> v_digest THEN
            RETURN QUERY SELECT 'source_conflict'::varchar,
                                NULL::uuid, NULL::varchar, false;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_existing.id,
                                v_existing.lifecycle_status, true;
        END IF;
        RETURN;
    END IF;

    INSERT INTO public.activity_runs (
        tenant_id, school_id, classroom_id, learning_activity_version_id,
        source_kind, source_classroom_assignment_id, source_course_run_id,
        source_course_lesson_id, opens_at, due_at, closes_at, late_policy,
        grading_scheme_version_id, runtime_policy_snapshot,
        created_by_principal_id, creation_request_id, creation_request_digest
    ) VALUES (
        v_source.tenant_id, v_source.school_id, v_source.classroom_id,
        p_learning_activity_version_id, p_source_kind, p_classroom_assignment_id,
        p_source_course_run_id, p_source_course_lesson_id, p_opens_at, p_due_at,
        p_closes_at, p_late_policy, p_grading_scheme_version_id, v_snapshot,
        p_actor_principal_id, p_request_id, v_digest
    ) RETURNING * INTO v_run;

    INSERT INTO public.audit_events (
        tenant_id, actor_user_id, entity_type, entity_id, action, payload_json
    ) VALUES (
        v_run.tenant_id, v_source.user_id, 'activity_run', v_run.id,
        'activity_run.created', jsonb_build_object(
            'actorPrincipalId', p_actor_principal_id,
            'sourceKind', v_run.source_kind,
            'classroomAssignmentId', v_run.source_classroom_assignment_id,
            'learningActivityVersionId', v_run.learning_activity_version_id
        )
    );
    RETURN QUERY SELECT 'ok'::varchar, v_run.id, v_run.lifecycle_status, false;
END;
$$;

CREATE OR REPLACE FUNCTION activity_run_transition(
    p_actor_principal_id uuid,
    p_activity_run_id uuid,
    p_target_status varchar
)
RETURNS TABLE (
    result_code varchar,
    activity_run_id uuid,
    lifecycle_status varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_run public.activity_runs%ROWTYPE;
    v_actor_user uuid;
BEGIN
    SELECT run.*
      INTO v_run
      FROM public.activity_runs run
      JOIN public.principals principal
        ON principal.id = p_actor_principal_id
       AND principal.kind = 'account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = run.tenant_id
       AND membership.classroom_id = run.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
     WHERE run.id = p_activity_run_id
       AND run.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     FOR UPDATE OF run;
    IF v_run.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    SELECT membership.user_id INTO v_actor_user
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = v_run.tenant_id
       AND membership.classroom_id = v_run.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
     WHERE principal.id = p_actor_principal_id;
    IF p_target_status = v_run.lifecycle_status THEN
        RETURN QUERY SELECT 'ok'::varchar, v_run.id, v_run.lifecycle_status, true;
        RETURN;
    END IF;
    IF NOT ((v_run.lifecycle_status = 'active' AND p_target_status IN ('closed', 'cancelled'))
            OR (v_run.lifecycle_status = 'closed' AND p_target_status = 'archived')) THEN
        RETURN QUERY SELECT 'invalid_transition'::varchar,
                            v_run.id, v_run.lifecycle_status, false;
        RETURN;
    END IF;

    UPDATE public.activity_runs run
       SET lifecycle_status = p_target_status,
           closed_at = CASE WHEN p_target_status = 'closed' THEN now() ELSE run.closed_at END,
           cancelled_at = CASE WHEN p_target_status = 'cancelled' THEN now() ELSE run.cancelled_at END,
           archived_at = CASE WHEN p_target_status = 'archived' THEN now() ELSE run.archived_at END
     WHERE run.id = v_run.id
    RETURNING * INTO v_run;
    INSERT INTO public.audit_events (
        tenant_id, actor_user_id, entity_type, entity_id, action, payload_json
    ) VALUES (
        v_run.tenant_id, v_actor_user, 'activity_run', v_run.id,
        'activity_run.' || p_target_status,
        jsonb_build_object('actorPrincipalId', p_actor_principal_id)
    );
    RETURN QUERY SELECT 'ok'::varchar, v_run.id, v_run.lifecycle_status, false;
END;
$$;

CREATE OR REPLACE FUNCTION activity_run_base_availability(
    p_actor_principal_id uuid,
    p_activity_run_id uuid,
    p_as_of timestamptz
)
RETURNS TABLE (
    result_code varchar,
    lifecycle_status varchar,
    availability_status varchar,
    is_late boolean,
    can_start boolean,
    can_submit boolean,
    explicit_late_policy varchar,
    policy_resolution_required boolean,
    parent_limited boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_run record;
BEGIN
    IF p_as_of IS NULL THEN
        RETURN QUERY SELECT 'invalid_as_of'::varchar, NULL::varchar, NULL::varchar,
                            false, false, false, NULL::varchar, false, false;
        RETURN;
    END IF;
    SELECT run.*, parent.status AS parent_status,
           handout.status AS handout_status
      INTO v_run
      FROM public.activity_runs run
      JOIN public.principals principal
        ON principal.id = p_actor_principal_id
       AND principal.kind = 'account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = run.tenant_id
       AND membership.classroom_id = run.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
      LEFT JOIN public.classroom_course_runs parent
        ON parent.tenant_id = run.tenant_id
       AND parent.id = run.source_course_run_id
      JOIN public.classroom_assignments handout
        ON handout.tenant_id = run.tenant_id
       AND handout.id = run.source_classroom_assignment_id
     WHERE run.id = p_activity_run_id
       AND run.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    IF v_run.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::varchar, NULL::varchar,
                            false, false, false, NULL::varchar, false, false;
        RETURN;
    END IF;
    IF v_run.lifecycle_status <> 'active' THEN
        RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                            v_run.lifecycle_status, false, false, false,
                            v_run.late_policy, false, false;
        RETURN;
    END IF;
    IF v_run.handout_status <> 'open' THEN
        RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                            'handout_closed'::varchar, false, false, false,
                            v_run.late_policy, false, true;
        RETURN;
    END IF;
    IF v_run.source_kind = 'course' AND v_run.parent_status <> 'open' THEN
        RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                            'parent_closed'::varchar, false, false, false,
                            v_run.late_policy, false, true;
        RETURN;
    END IF;
    IF v_run.opens_at IS NOT NULL AND p_as_of < v_run.opens_at THEN
        RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                            'scheduled'::varchar, false, false, false,
                            v_run.late_policy, false, false;
        RETURN;
    END IF;
    IF v_run.closes_at IS NOT NULL AND p_as_of > v_run.closes_at THEN
        RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                            'closed_by_time'::varchar, false, false, false,
                            v_run.late_policy, false, false;
        RETURN;
    END IF;
    IF v_run.due_at IS NOT NULL AND p_as_of > v_run.due_at THEN
        IF v_run.late_policy = 'block_at_due' THEN
            RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                                'closed_by_due'::varchar, true, false, false,
                                v_run.late_policy, false, false;
        ELSIF v_run.late_policy IS NULL THEN
            RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                                'open'::varchar, true, NULL::boolean, NULL::boolean,
                                NULL::varchar, true, false;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                                'open'::varchar, true, true, true,
                                v_run.late_policy, false, false;
        END IF;
        RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar, v_run.lifecycle_status,
                        'open'::varchar, false, true, true,
                        v_run.late_policy, false, false;
END;
$$;

REVOKE ALL ON FUNCTION activity_run_create(
    uuid, uuid, uuid, varchar, uuid, uuid, timestamptz, timestamptz,
    timestamptz, varchar, uuid, jsonb, varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_run_transition(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_run_base_availability(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activity_run_create(
    uuid, uuid, uuid, varchar, uuid, uuid, timestamptz, timestamptz,
    timestamptz, varchar, uuid, jsonb, varchar
) TO asalab_app;
GRANT EXECUTE ON FUNCTION activity_run_transition(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION activity_run_base_availability(uuid, uuid, timestamptz) TO asalab_app;
