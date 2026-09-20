-- E1-FIX-11D3a: block-aware ActivityRun creation.
-- Legacy course occurrences keep source_course_block_id = NULL and legacy provenance.
-- Block occurrences identify one run + run lesson + block id without materializing CourseVersion.
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
           OR v_assignment.course_run_id <> NEW.source_course_run_id
           OR (
               NEW.source_course_block_id IS NULL
               AND v_course.classroom_assignment_id <> NEW.source_classroom_assignment_id
           ) THEN
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
    p_request_id varchar,
    p_source_course_block_id varchar
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
    v_course record;
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
           AND (p_source_course_run_id IS NOT NULL
                OR p_source_course_lesson_id IS NOT NULL
                OR p_source_course_block_id IS NOT NULL))
       OR (p_source_kind = 'course'
           AND (p_source_course_run_id IS NULL
                OR p_source_course_lesson_id IS NULL
                OR (p_source_course_block_id IS NOT NULL
                    AND p_source_course_block_id !~ '^[A-Za-z0-9_-]{1,80}$'))) THEN
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
           assignment.status AS assignment_status,
           classroom.school_id, classroom.status AS classroom_status,
           membership.user_id
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
       AND assignment.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid;
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
    IF p_source_kind = 'course' THEN
        SELECT run.status, lesson.classroom_assignment_id
          INTO v_course
          FROM public.classroom_course_runs run
          JOIN public.classroom_course_run_lessons lesson
            ON lesson.tenant_id = run.tenant_id
           AND lesson.run_id = run.id
           AND lesson.id = p_source_course_lesson_id
           AND lesson.kind = 'assignment'
         WHERE run.id = p_source_course_run_id
           AND run.tenant_id = v_source.tenant_id
           AND run.classroom_id = v_source.classroom_id
           AND v_source.course_run_id = run.id;
        IF v_course.status IS NULL
           OR (p_source_course_block_id IS NULL
               AND v_course.classroom_assignment_id <> p_classroom_assignment_id) THEN
            RETURN QUERY SELECT 'course_source_forbidden'::varchar,
                                NULL::uuid, NULL::varchar, false;
            RETURN;
        END IF;
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
    ) || CASE
        WHEN p_source_course_block_id IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('sourceCourseBlockId', p_source_course_block_id)
    END);
    PERFORM pg_advisory_xact_lock(hashtextextended(
        CASE
            WHEN p_source_course_block_id IS NULL THEN p_classroom_assignment_id::text
            ELSE p_source_course_run_id::text || ':' ||
                 p_source_course_lesson_id::text || ':' || p_source_course_block_id
        END,
        9103
    ));

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

    IF p_source_course_block_id IS NULL THEN
        SELECT * INTO v_existing
          FROM public.activity_runs run
         WHERE run.source_classroom_assignment_id = p_classroom_assignment_id
           AND run.source_course_block_id IS NULL;
    ELSE
        SELECT * INTO v_existing
          FROM public.activity_runs run
         WHERE run.source_kind = 'course'
           AND run.source_course_run_id = p_source_course_run_id
           AND run.source_course_lesson_id = p_source_course_lesson_id
           AND run.source_course_block_id = p_source_course_block_id;
    END IF;
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

    IF v_source.classroom_status <> 'active'
       OR v_source.assignment_status <> 'open' THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF p_source_kind = 'course' AND v_course.status <> 'open' THEN
        RETURN QUERY SELECT 'course_source_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    INSERT INTO public.activity_runs (
        tenant_id, school_id, classroom_id, learning_activity_version_id,
        source_kind, source_classroom_assignment_id, source_course_run_id,
        source_course_lesson_id, source_course_block_id,
        opens_at, due_at, closes_at, late_policy,
        grading_scheme_version_id, runtime_policy_snapshot,
        created_by_principal_id, creation_request_id, creation_request_digest
    ) VALUES (
        v_source.tenant_id, v_source.school_id, v_source.classroom_id,
        p_learning_activity_version_id, p_source_kind, p_classroom_assignment_id,
        p_source_course_run_id, p_source_course_lesson_id, p_source_course_block_id,
        p_opens_at, p_due_at,
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
            'sourceCourseBlockId', v_run.source_course_block_id,
            'learningActivityVersionId', v_run.learning_activity_version_id
        )
    );
    RETURN QUERY SELECT 'ok'::varchar, v_run.id, v_run.lifecycle_status, false;
END;
$$;



CREATE OR REPLACE FUNCTION public.activity_run_create(
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
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
    SELECT * FROM public.activity_run_create(
        p_actor_principal_id,
        p_classroom_assignment_id,
        p_learning_activity_version_id,
        p_source_kind,
        p_source_course_run_id,
        p_source_course_lesson_id,
        p_opens_at,
        p_due_at,
        p_closes_at,
        p_late_policy,
        p_grading_scheme_version_id,
        p_runtime_policy_explicit,
        p_request_id,
        NULL::varchar
    );
$$;

REVOKE ALL ON FUNCTION public.activity_run_create(
    uuid,uuid,uuid,varchar,uuid,uuid,timestamptz,timestamptz,
    timestamptz,varchar,uuid,jsonb,varchar,varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activity_run_create(
    uuid,uuid,uuid,varchar,uuid,uuid,timestamptz,timestamptz,
    timestamptz,varchar,uuid,jsonb,varchar,varchar
) TO asalab_app;
REVOKE ALL ON FUNCTION public.activity_run_create(
    uuid,uuid,uuid,varchar,uuid,uuid,timestamptz,timestamptz,
    timestamptz,varchar,uuid,jsonb,varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activity_run_create(
    uuid,uuid,uuid,varchar,uuid,uuid,timestamptz,timestamptz,
    timestamptz,varchar,uuid,jsonb,varchar
) TO asalab_app;
