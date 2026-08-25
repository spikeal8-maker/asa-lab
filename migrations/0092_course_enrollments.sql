-- ASA Learning M1 CourseEnrollment primitive.
--
-- This migration is additive and intentionally performs no backfill. Existing
-- classroom CourseRun readers remain seat/account based until later audience
-- and materialization tasks explicitly cut them over.

CREATE TABLE course_enrollments (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  uuid NOT NULL REFERENCES tenants(id),
    school_id                  uuid NOT NULL,
    course_run_id              uuid NOT NULL,
    learner_identity_id        uuid NOT NULL,
    status                     varchar(16) NOT NULL DEFAULT 'assigned',
    assigned_at                timestamptz NOT NULL DEFAULT now(),
    activated_at               timestamptz,
    withdrawn_at               timestamptz,
    assigned_by_principal_id   uuid NOT NULL REFERENCES principals(id),
    activated_by_principal_id  uuid REFERENCES principals(id),
    withdrawn_by_principal_id  uuid REFERENCES principals(id),
    assignment_source          varchar(32) NOT NULL DEFAULT 'teacher_command',
    activation_source          varchar(48),
    withdrawal_source          varchar(32),
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, school_id, id),
    UNIQUE (course_run_id, learner_identity_id),
    FOREIGN KEY (tenant_id, course_run_id)
        REFERENCES classroom_course_runs(tenant_id, id),
    FOREIGN KEY (tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    CONSTRAINT course_enrollments_status_check
        CHECK (status IN ('assigned', 'active', 'withdrawn')),
    CONSTRAINT course_enrollments_assignment_source_check
        CHECK (assignment_source = 'teacher_command'),
    CONSTRAINT course_enrollments_activation_source_check
        CHECK (activation_source IS NULL OR activation_source = 'meaningful_learner_interaction'),
    CONSTRAINT course_enrollments_withdrawal_source_check
        CHECK (withdrawal_source IS NULL OR withdrawal_source = 'teacher_command'),
    CONSTRAINT course_enrollments_lifecycle_check CHECK (
        (status = 'assigned'
         AND activated_at IS NULL
         AND activated_by_principal_id IS NULL
         AND activation_source IS NULL
         AND withdrawn_at IS NULL
         AND withdrawn_by_principal_id IS NULL
         AND withdrawal_source IS NULL)
        OR
        (status = 'active'
         AND activated_at IS NOT NULL
         AND activated_by_principal_id IS NOT NULL
         AND activation_source IS NOT NULL
         AND withdrawn_at IS NULL
         AND withdrawn_by_principal_id IS NULL
         AND withdrawal_source IS NULL)
        OR
        (status = 'withdrawn'
         AND withdrawn_at IS NOT NULL
         AND withdrawn_by_principal_id IS NOT NULL
         AND withdrawal_source IS NOT NULL
         AND (
             (activated_at IS NULL
              AND activated_by_principal_id IS NULL
              AND activation_source IS NULL)
             OR
             (activated_at IS NOT NULL
              AND activated_by_principal_id IS NOT NULL
              AND activation_source IS NOT NULL)
         ))
    )
);

CREATE INDEX course_enrollments_run_status_idx
    ON course_enrollments (tenant_id, course_run_id, status, assigned_at, id);
CREATE INDEX course_enrollments_learner_status_idx
    ON course_enrollments
       (tenant_id, school_id, learner_identity_id, status, assigned_at, id);

CREATE OR REPLACE FUNCTION course_enrollment_lineage_lifecycle_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_school uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'course enrollment history is append-preserved';
    END IF;

    SELECT run.tenant_id, classroom.school_id
      INTO v_tenant, v_school
      FROM public.classroom_course_runs run
      JOIN public.classrooms classroom
        ON classroom.tenant_id = run.tenant_id
       AND classroom.id = run.classroom_id
     WHERE run.id = NEW.course_run_id;

    IF v_tenant IS NULL
       OR NEW.tenant_id <> v_tenant
       OR NEW.school_id <> v_school THEN
        RAISE EXCEPTION 'course enrollment run school lineage is incoherent';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id
           OR NEW.tenant_id <> OLD.tenant_id
           OR NEW.school_id <> OLD.school_id
           OR NEW.course_run_id <> OLD.course_run_id
           OR NEW.learner_identity_id <> OLD.learner_identity_id
           OR NEW.assigned_at <> OLD.assigned_at
           OR NEW.assigned_by_principal_id <> OLD.assigned_by_principal_id
           OR NEW.assignment_source <> OLD.assignment_source
           OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'course enrollment identity and assignment provenance are immutable';
        END IF;

        IF NEW.status <> OLD.status
           AND NOT (
               (OLD.status = 'assigned' AND NEW.status IN ('active', 'withdrawn'))
               OR (OLD.status = 'active' AND NEW.status = 'withdrawn')
           ) THEN
            RAISE EXCEPTION 'invalid course enrollment transition % -> %', OLD.status, NEW.status;
        END IF;

        IF NEW.status = OLD.status AND (
            NEW.activated_at IS DISTINCT FROM OLD.activated_at
            OR NEW.activated_by_principal_id IS DISTINCT FROM OLD.activated_by_principal_id
            OR NEW.activation_source IS DISTINCT FROM OLD.activation_source
            OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
            OR NEW.withdrawn_by_principal_id IS DISTINCT FROM OLD.withdrawn_by_principal_id
            OR NEW.withdrawal_source IS DISTINCT FROM OLD.withdrawal_source
        ) THEN
            RAISE EXCEPTION 'course enrollment transition provenance is immutable';
        END IF;

        NEW.updated_at := now();
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER course_enrollments_lineage_lifecycle_guard
    BEFORE INSERT OR UPDATE OR DELETE ON course_enrollments
    FOR EACH ROW EXECUTE FUNCTION course_enrollment_lineage_lifecycle_guard();

REVOKE ALL ON course_enrollments FROM PUBLIC, asalab_app;
ALTER TABLE course_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrollments FORCE ROW LEVEL SECURITY;

CREATE POLICY course_enrollments_tenant ON course_enrollments
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION course_enrollment_assign(
    p_actor_principal_id uuid,
    p_course_run_id uuid,
    p_learner_identity_id uuid
)
RETURNS TABLE (
    result_code varchar,
    enrollment_id uuid,
    enrollment_status varchar,
    assigned_at timestamptz,
    activated_at timestamptz,
    withdrawn_at timestamptz,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_school uuid;
    v_classroom uuid;
    v_actor_user uuid;
    v_enrollment public.course_enrollments%ROWTYPE;
    v_created boolean := false;
BEGIN
    SELECT run.tenant_id, classroom.school_id, run.classroom_id, legacy.user_id
      INTO v_tenant, v_school, v_classroom, v_actor_user
      FROM public.classroom_course_runs run
      JOIN public.classrooms classroom
        ON classroom.tenant_id = run.tenant_id
       AND classroom.id = run.classroom_id
      JOIN public.principals principal
        ON principal.id = p_actor_principal_id
       AND principal.kind = 'account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = run.tenant_id
       AND membership.classroom_id = run.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
      LEFT JOIN public.legacy_user_account_links legacy
        ON legacy.tenant_id = run.tenant_id
       AND legacy.principal_id = principal.id
       AND legacy.migration_state = 'active'
     WHERE run.id = p_course_run_id
       AND run.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
       AND classroom.status = 'active';

    IF v_tenant IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
                            NULL::timestamptz, NULL::timestamptz,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.learner_identities learner
         WHERE learner.tenant_id = v_tenant
           AND learner.school_id = v_school
           AND learner.id = p_learner_identity_id
           AND learner.state = 'active'
    ) THEN
        RETURN QUERY SELECT 'learner_not_found'::varchar, NULL::uuid, NULL::varchar,
                            NULL::timestamptz, NULL::timestamptz,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    INSERT INTO public.course_enrollments (
        tenant_id, school_id, course_run_id, learner_identity_id,
        assigned_by_principal_id
    ) VALUES (
        v_tenant, v_school, p_course_run_id, p_learner_identity_id,
        p_actor_principal_id
    )
    ON CONFLICT (course_run_id, learner_identity_id) DO NOTHING
    RETURNING * INTO v_enrollment;

    IF v_enrollment.id IS NOT NULL THEN
        v_created := true;
        INSERT INTO public.audit_events (
            tenant_id, actor_user_id, entity_type, entity_id, action, payload_json
        ) VALUES (
            v_tenant, v_actor_user, 'course_enrollment', v_enrollment.id,
            'course_enrollment.assigned',
            jsonb_build_object(
                'actorPrincipalId', p_actor_principal_id,
                'source', 'teacher_command',
                'courseRunId', p_course_run_id,
                'learnerIdentityId', p_learner_identity_id
            )
        );
    ELSE
        SELECT * INTO v_enrollment
          FROM public.course_enrollments enrollment
         WHERE enrollment.course_run_id = p_course_run_id
           AND enrollment.learner_identity_id = p_learner_identity_id;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_enrollment.id, v_enrollment.status,
                        v_enrollment.assigned_at, v_enrollment.activated_at,
                        v_enrollment.withdrawn_at, NOT v_created;
END;
$$;

CREATE OR REPLACE FUNCTION course_enrollment_activate(
    p_actor_principal_id uuid,
    p_enrollment_id uuid
)
RETURNS TABLE (
    result_code varchar,
    enrollment_id uuid,
    enrollment_status varchar,
    assigned_at timestamptz,
    activated_at timestamptz,
    withdrawn_at timestamptz,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_enrollment public.course_enrollments%ROWTYPE;
    v_classroom uuid;
    v_actor_user uuid;
BEGIN
    SELECT enrollment.*
      INTO v_enrollment
      FROM public.course_enrollments enrollment
      JOIN public.classroom_course_runs run
        ON run.tenant_id = enrollment.tenant_id
       AND run.id = enrollment.course_run_id
     WHERE enrollment.id = p_enrollment_id
       AND enrollment.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     FOR UPDATE OF enrollment;

    IF v_enrollment.id IS NOT NULL THEN
        SELECT run.classroom_id INTO v_classroom
          FROM public.classroom_course_runs run
         WHERE run.tenant_id = v_enrollment.tenant_id
           AND run.id = v_enrollment.course_run_id;
    END IF;

    IF v_enrollment.id IS NULL OR NOT EXISTS (
        SELECT 1
          FROM public.principals principal
          JOIN public.learner_identity_links link
            ON link.tenant_id = v_enrollment.tenant_id
           AND link.school_id = v_enrollment.school_id
           AND link.learner_identity_id = v_enrollment.learner_identity_id
           AND link.status = 'active'
         WHERE principal.id = p_actor_principal_id
           AND (
               (principal.kind = 'student_seat'
                AND link.link_kind = 'student_seat'
                AND link.seat_id = principal.seat_id
                AND EXISTS (
                    SELECT 1 FROM public.classroom_student_seats seat
                     WHERE seat.id = principal.seat_id
                       AND seat.tenant_id = v_enrollment.tenant_id
                       AND seat.classroom_id = v_classroom
                       AND seat.status = 'active'
                ))
               OR
               (principal.kind = 'account'
                AND link.link_kind = 'account'
                AND link.account_id = principal.account_id
                AND EXISTS (
                    SELECT 1 FROM public.classroom_student_seats seat
                     WHERE seat.account_id = principal.account_id
                       AND seat.tenant_id = v_enrollment.tenant_id
                       AND seat.classroom_id = v_classroom
                       AND seat.status = 'active'
                ))
           )
    ) THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
                            NULL::timestamptz, NULL::timestamptz,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    IF v_enrollment.status = 'withdrawn' THEN
        RETURN QUERY SELECT 'withdrawn'::varchar, v_enrollment.id,
                            v_enrollment.status, v_enrollment.assigned_at,
                            v_enrollment.activated_at, v_enrollment.withdrawn_at, true;
        RETURN;
    END IF;

    IF v_enrollment.status = 'active' THEN
        RETURN QUERY SELECT 'ok'::varchar, v_enrollment.id, v_enrollment.status,
                            v_enrollment.assigned_at, v_enrollment.activated_at,
                            v_enrollment.withdrawn_at, true;
        RETURN;
    END IF;

    SELECT legacy.user_id INTO v_actor_user
      FROM public.principals principal
      LEFT JOIN public.legacy_user_account_links legacy
        ON legacy.tenant_id = v_enrollment.tenant_id
       AND legacy.account_id = principal.account_id
       AND legacy.migration_state = 'active'
     WHERE principal.id = p_actor_principal_id;

    UPDATE public.course_enrollments enrollment
       SET status = 'active',
           activated_at = now(),
           activated_by_principal_id = p_actor_principal_id,
           activation_source = 'meaningful_learner_interaction'
     WHERE enrollment.id = v_enrollment.id
       AND enrollment.status = 'assigned'
    RETURNING * INTO v_enrollment;

    INSERT INTO public.audit_events (
        tenant_id, actor_user_id, entity_type, entity_id, action, payload_json
    ) VALUES (
        v_enrollment.tenant_id, v_actor_user, 'course_enrollment', v_enrollment.id,
        'course_enrollment.activated',
        jsonb_build_object(
            'actorPrincipalId', p_actor_principal_id,
            'source', 'meaningful_learner_interaction'
        )
    );

    RETURN QUERY SELECT 'ok'::varchar, v_enrollment.id, v_enrollment.status,
                        v_enrollment.assigned_at, v_enrollment.activated_at,
                        v_enrollment.withdrawn_at, false;
END;
$$;

CREATE OR REPLACE FUNCTION course_enrollment_withdraw(
    p_actor_principal_id uuid,
    p_enrollment_id uuid
)
RETURNS TABLE (
    result_code varchar,
    enrollment_id uuid,
    enrollment_status varchar,
    assigned_at timestamptz,
    activated_at timestamptz,
    withdrawn_at timestamptz,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_enrollment public.course_enrollments%ROWTYPE;
    v_actor_user uuid;
BEGIN
    SELECT enrollment.*
      INTO v_enrollment
      FROM public.course_enrollments enrollment
      JOIN public.classroom_course_runs run
        ON run.tenant_id = enrollment.tenant_id
       AND run.id = enrollment.course_run_id
      JOIN public.principals principal
        ON principal.id = p_actor_principal_id
       AND principal.kind = 'account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = run.tenant_id
       AND membership.classroom_id = run.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
     WHERE enrollment.id = p_enrollment_id
       AND enrollment.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     FOR UPDATE OF enrollment;

    IF v_enrollment.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar,
                            NULL::timestamptz, NULL::timestamptz,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    IF v_enrollment.status = 'withdrawn' THEN
        RETURN QUERY SELECT 'ok'::varchar, v_enrollment.id, v_enrollment.status,
                            v_enrollment.assigned_at, v_enrollment.activated_at,
                            v_enrollment.withdrawn_at, true;
        RETURN;
    END IF;

    SELECT legacy.user_id INTO v_actor_user
      FROM public.legacy_user_account_links legacy
     WHERE legacy.tenant_id = v_enrollment.tenant_id
       AND legacy.principal_id = p_actor_principal_id
       AND legacy.migration_state = 'active';

    UPDATE public.course_enrollments enrollment
       SET status = 'withdrawn',
           withdrawn_at = now(),
           withdrawn_by_principal_id = p_actor_principal_id,
           withdrawal_source = 'teacher_command'
     WHERE enrollment.id = v_enrollment.id
       AND enrollment.status IN ('assigned', 'active')
    RETURNING * INTO v_enrollment;

    INSERT INTO public.audit_events (
        tenant_id, actor_user_id, entity_type, entity_id, action, payload_json
    ) VALUES (
        v_enrollment.tenant_id, v_actor_user, 'course_enrollment', v_enrollment.id,
        'course_enrollment.withdrawn',
        jsonb_build_object(
            'actorPrincipalId', p_actor_principal_id,
            'source', 'teacher_command'
        )
    );

    RETURN QUERY SELECT 'ok'::varchar, v_enrollment.id, v_enrollment.status,
                        v_enrollment.assigned_at, v_enrollment.activated_at,
                        v_enrollment.withdrawn_at, false;
END;
$$;

REVOKE ALL ON FUNCTION course_enrollment_assign(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_enrollment_activate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_enrollment_withdraw(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_enrollment_assign(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_enrollment_activate(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_enrollment_withdraw(uuid, uuid) TO asalab_app;
