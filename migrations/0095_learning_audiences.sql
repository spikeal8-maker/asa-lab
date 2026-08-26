-- LRN-M1-005: one canonical audience contract for CourseRun and direct
-- ActivityRun delivery. Additive only: no historical audience backfill and no
-- Attempt/Submission/Result/Gradebook cutover.

ALTER TABLE course_enrollments
    DROP CONSTRAINT course_enrollments_assignment_source_check,
    DROP CONSTRAINT course_enrollments_withdrawal_source_check,
    ADD CONSTRAINT course_enrollments_assignment_source_check CHECK (
        assignment_source IN ('teacher_command', 'whole_class_dynamic', 'named_snapshot')
    ),
    ADD CONSTRAINT course_enrollments_withdrawal_source_check CHECK (
        withdrawal_source IS NULL OR withdrawal_source IN (
            'teacher_command', 'classroom_membership_ended', 'named_member_removed'
        )
    );

ALTER TABLE activity_participations
    DROP CONSTRAINT activity_participations_source_check,
    ADD CONSTRAINT activity_participations_source_check CHECK (
        assignment_source IN ('teacher_command', 'whole_class_dynamic', 'named_snapshot')
        AND (activation_source IS NULL
             OR activation_source = 'meaningful_learner_interaction')
        AND (withdrawal_source IS NULL OR withdrawal_source IN (
            'teacher_command', 'classroom_membership_ended', 'named_member_removed'
        ))
    );

CREATE TABLE learning_audience_definitions (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  uuid NOT NULL REFERENCES tenants(id),
    school_id                  uuid NOT NULL,
    classroom_id               uuid NOT NULL,
    target_kind                varchar(24) NOT NULL,
    target_course_run_id       uuid,
    target_activity_run_id     uuid,
    audience_type              varchar(24) NOT NULL,
    mode                       varchar(16) NOT NULL,
    status                     varchar(16) NOT NULL DEFAULT 'active',
    created_by_principal_id    uuid NOT NULL REFERENCES principals(id),
    creation_request_id        varchar(128) NOT NULL,
    creation_request_digest    varchar(64) NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    ended_at                   timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, school_id, id),
    UNIQUE (tenant_id, created_by_principal_id, creation_request_id),
    FOREIGN KEY (tenant_id, school_id, classroom_id)
        REFERENCES classrooms(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, target_course_run_id)
        REFERENCES classroom_course_runs(tenant_id, id),
    FOREIGN KEY (tenant_id, school_id, target_activity_run_id)
        REFERENCES activity_runs(tenant_id, school_id, id),
    CONSTRAINT learning_audiences_target_kind_check
        CHECK (target_kind IN ('course_run', 'activity_run')),
    CONSTRAINT learning_audiences_target_shape_check CHECK (
        (target_kind = 'course_run'
         AND target_course_run_id IS NOT NULL AND target_activity_run_id IS NULL)
        OR
        (target_kind = 'activity_run'
         AND target_activity_run_id IS NOT NULL AND target_course_run_id IS NULL)
    ),
    CONSTRAINT learning_audiences_type_check
        CHECK (audience_type IN ('whole_class', 'named_learners')),
    CONSTRAINT learning_audiences_mode_check CHECK (
        (audience_type = 'whole_class' AND mode = 'dynamic')
        OR (audience_type = 'named_learners' AND mode = 'snapshot')
    ),
    CONSTRAINT learning_audiences_status_check
        CHECK (status IN ('active', 'ended')),
    CONSTRAINT learning_audiences_lifecycle_check CHECK (
        (status = 'active' AND ended_at IS NULL)
        OR (status = 'ended' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT learning_audiences_request_check
        CHECK (creation_request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
    CONSTRAINT learning_audiences_digest_check
        CHECK (creation_request_digest ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX learning_audiences_one_course_target_idx
    ON learning_audience_definitions (target_course_run_id)
    WHERE target_course_run_id IS NOT NULL;
CREATE UNIQUE INDEX learning_audiences_one_activity_target_idx
    ON learning_audience_definitions (target_activity_run_id)
    WHERE target_activity_run_id IS NOT NULL;
CREATE INDEX learning_audiences_classroom_dynamic_idx
    ON learning_audience_definitions
       (tenant_id, classroom_id, status, audience_type, mode, id);

CREATE TABLE learning_audience_operations (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                uuid NOT NULL REFERENCES tenants(id),
    school_id                uuid NOT NULL,
    audience_id              uuid NOT NULL,
    learner_identity_id      uuid,
    operation_kind           varchar(40) NOT NULL,
    request_id               varchar(160) NOT NULL,
    request_digest           varchar(64) NOT NULL,
    result_code              varchar(48) NOT NULL,
    actor_principal_id       uuid REFERENCES principals(id),
    source_seat_id           uuid REFERENCES classroom_student_seats(id),
    created_at               timestamptz NOT NULL DEFAULT now(),
    completed_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (audience_id, request_id),
    FOREIGN KEY (tenant_id, school_id, audience_id)
        REFERENCES learning_audience_definitions(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    CONSTRAINT learning_audience_operations_kind_check CHECK (
        operation_kind IN (
            'initial_materialization', 'dynamic_learner_materialized',
            'named_member_added', 'named_member_removed',
            'classroom_membership_ended', 'rejoin_rejected'
        )
    ),
    CONSTRAINT learning_audience_operations_result_check CHECK (
        result_code IN (
            'completed', 'already_satisfied', 'withdrawn',
            'rejoin_requires_explicit_policy'
        )
    ),
    CONSTRAINT learning_audience_operations_request_check
        CHECK (request_id ~ '^[A-Za-z0-9._:-]{8,160}$'),
    CONSTRAINT learning_audience_operations_digest_check
        CHECK (request_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE learning_audience_named_members (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  uuid NOT NULL REFERENCES tenants(id),
    school_id                  uuid NOT NULL,
    audience_id                uuid NOT NULL,
    learner_identity_id        uuid NOT NULL,
    added_by_principal_id      uuid NOT NULL REFERENCES principals(id),
    added_by_operation_id      uuid NOT NULL,
    added_at                   timestamptz NOT NULL DEFAULT now(),
    removed_by_principal_id    uuid REFERENCES principals(id),
    removed_by_operation_id    uuid,
    removed_at                 timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (audience_id, learner_identity_id),
    FOREIGN KEY (tenant_id, school_id, audience_id)
        REFERENCES learning_audience_definitions(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, added_by_operation_id)
        REFERENCES learning_audience_operations(tenant_id, id),
    FOREIGN KEY (tenant_id, removed_by_operation_id)
        REFERENCES learning_audience_operations(tenant_id, id),
    CONSTRAINT learning_audience_named_members_remove_check CHECK (
        (removed_at IS NULL AND removed_by_principal_id IS NULL
                            AND removed_by_operation_id IS NULL)
        OR
        (removed_at IS NOT NULL AND removed_by_principal_id IS NOT NULL
                                AND removed_by_operation_id IS NOT NULL)
    )
);

CREATE TABLE learning_audience_membership_claims (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  uuid NOT NULL REFERENCES tenants(id),
    school_id                  uuid NOT NULL,
    audience_id                uuid NOT NULL,
    learner_identity_id        uuid NOT NULL,
    course_enrollment_id       uuid,
    activity_participation_id  uuid,
    ownership_kind             varchar(24) NOT NULL,
    created_by_operation_id    uuid NOT NULL,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    ended_by_operation_id      uuid,
    ended_reason               varchar(40),
    ended_at                   timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (audience_id, learner_identity_id),
    FOREIGN KEY (tenant_id, school_id, audience_id)
        REFERENCES learning_audience_definitions(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, course_enrollment_id)
        REFERENCES course_enrollments(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, activity_participation_id)
        REFERENCES activity_participations(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, created_by_operation_id)
        REFERENCES learning_audience_operations(tenant_id, id),
    FOREIGN KEY (tenant_id, ended_by_operation_id)
        REFERENCES learning_audience_operations(tenant_id, id),
    CONSTRAINT learning_audience_claims_target_shape_check CHECK (
        (course_enrollment_id IS NOT NULL AND activity_participation_id IS NULL)
        OR (course_enrollment_id IS NULL AND activity_participation_id IS NOT NULL)
    ),
    CONSTRAINT learning_audience_claims_ownership_check
        CHECK (ownership_kind IN ('audience_owned', 'independent')),
    CONSTRAINT learning_audience_claims_end_check CHECK (
        (ended_at IS NULL AND ended_by_operation_id IS NULL AND ended_reason IS NULL)
        OR
        (ended_at IS NOT NULL AND ended_by_operation_id IS NOT NULL
                                AND ended_reason IN (
                                    'named_member_removed',
                                    'classroom_membership_ended'
                                ))
    )
);

CREATE INDEX learning_audience_claims_membership_idx
    ON learning_audience_membership_claims
       (tenant_id, school_id, learner_identity_id, ended_at, audience_id);

CREATE OR REPLACE FUNCTION learning_audience_definition_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_target record;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audience definitions are append-preserved';
    END IF;
    IF NEW.target_kind = 'course_run' THEN
        SELECT run.tenant_id, run.classroom_id, classroom.school_id
          INTO v_target
          FROM public.classroom_course_runs run
          JOIN public.classrooms classroom
            ON classroom.tenant_id = run.tenant_id AND classroom.id = run.classroom_id
         WHERE run.id = NEW.target_course_run_id;
    ELSE
        SELECT run.tenant_id, run.classroom_id, run.school_id
          INTO v_target
          FROM public.activity_runs run
         WHERE run.id = NEW.target_activity_run_id;
    END IF;
    IF v_target.tenant_id IS NULL OR v_target.tenant_id <> NEW.tenant_id
       OR v_target.school_id <> NEW.school_id
       OR v_target.classroom_id <> NEW.classroom_id THEN
        RAISE EXCEPTION 'audience target lineage is incoherent';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
           OR NEW.school_id <> OLD.school_id
           OR NEW.classroom_id <> OLD.classroom_id
           OR NEW.target_kind <> OLD.target_kind
           OR NEW.target_course_run_id IS DISTINCT FROM OLD.target_course_run_id
           OR NEW.target_activity_run_id IS DISTINCT FROM OLD.target_activity_run_id
           OR NEW.audience_type <> OLD.audience_type OR NEW.mode <> OLD.mode
           OR NEW.created_by_principal_id <> OLD.created_by_principal_id
           OR NEW.creation_request_id <> OLD.creation_request_id
           OR NEW.creation_request_digest <> OLD.creation_request_digest
           OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'audience identity, target, type, mode and provenance are immutable';
        END IF;
        IF NOT (OLD.status = 'active' AND NEW.status = 'ended')
           AND NEW.status <> OLD.status THEN
            RAISE EXCEPTION 'invalid audience lifecycle transition';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER learning_audience_definitions_guard
    BEFORE INSERT OR UPDATE OR DELETE ON learning_audience_definitions
    FOR EACH ROW EXECUTE FUNCTION learning_audience_definition_guard();

CREATE OR REPLACE FUNCTION learning_audience_append_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'audience evidence is append-preserved';
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'learning_audience_operations' THEN
        RAISE EXCEPTION 'audience operations are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'learning_audience_named_members' THEN
        IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
           OR NEW.school_id <> OLD.school_id OR NEW.audience_id <> OLD.audience_id
           OR NEW.learner_identity_id <> OLD.learner_identity_id
           OR NEW.added_by_principal_id <> OLD.added_by_principal_id
           OR NEW.added_by_operation_id <> OLD.added_by_operation_id
           OR NEW.added_at <> OLD.added_at OR OLD.removed_at IS NOT NULL THEN
            RAISE EXCEPTION 'named audience member add/removal evidence is immutable';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'learning_audience_membership_claims' THEN
        IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
           OR NEW.school_id <> OLD.school_id OR NEW.audience_id <> OLD.audience_id
           OR NEW.learner_identity_id <> OLD.learner_identity_id
           OR NEW.course_enrollment_id IS DISTINCT FROM OLD.course_enrollment_id
           OR NEW.activity_participation_id IS DISTINCT FROM OLD.activity_participation_id
           OR NEW.ownership_kind <> OLD.ownership_kind
           OR NEW.created_by_operation_id <> OLD.created_by_operation_id
           OR NEW.created_at <> OLD.created_at OR OLD.ended_at IS NOT NULL THEN
            RAISE EXCEPTION 'audience claim identity and history are immutable';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER learning_audience_operations_guard
    BEFORE UPDATE OR DELETE ON learning_audience_operations
    FOR EACH ROW EXECUTE FUNCTION learning_audience_append_guard();
CREATE TRIGGER learning_audience_named_members_guard
    BEFORE UPDATE OR DELETE ON learning_audience_named_members
    FOR EACH ROW EXECUTE FUNCTION learning_audience_append_guard();
CREATE TRIGGER learning_audience_claims_guard
    BEFORE UPDATE OR DELETE ON learning_audience_membership_claims
    FOR EACH ROW EXECUTE FUNCTION learning_audience_append_guard();

REVOKE ALL ON learning_audience_definitions FROM PUBLIC, asalab_app;
REVOKE ALL ON learning_audience_operations FROM PUBLIC, asalab_app;
REVOKE ALL ON learning_audience_named_members FROM PUBLIC, asalab_app;
REVOKE ALL ON learning_audience_membership_claims FROM PUBLIC, asalab_app;
ALTER TABLE learning_audience_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_audience_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_audience_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_audience_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_audience_named_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_audience_named_members FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_audience_membership_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_audience_membership_claims FORCE ROW LEVEL SECURITY;

CREATE POLICY learning_audience_definitions_tenant ON learning_audience_definitions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY learning_audience_operations_tenant ON learning_audience_operations
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY learning_audience_named_members_tenant ON learning_audience_named_members
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY learning_audience_claims_tenant ON learning_audience_membership_claims
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Resolve/create the stable school learner for every new or changed seat. This
-- is operational identity creation for a current classroom event, not a
-- fabricated historical audience backfill.
CREATE OR REPLACE FUNCTION learning_audience_ensure_seat_identity(p_seat_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_seat record;
    v_learner uuid;
    v_account_learner uuid;
BEGIN
    SELECT seat.tenant_id, seat.account_id, classroom.school_id
      INTO v_seat
      FROM public.classroom_student_seats seat
      JOIN public.classrooms classroom
        ON classroom.tenant_id = seat.tenant_id AND classroom.id = seat.classroom_id
     WHERE seat.id = p_seat_id
     FOR UPDATE OF seat;
    IF v_seat.tenant_id IS NULL THEN RETURN NULL; END IF;

    SELECT link.learner_identity_id INTO v_learner
      FROM public.learner_identity_links link
     WHERE link.seat_id = p_seat_id AND link.status = 'active';
    IF v_seat.account_id IS NOT NULL THEN
        SELECT link.learner_identity_id INTO v_account_learner
          FROM public.learner_identity_links link
         WHERE link.school_id = v_seat.school_id
           AND link.account_id = v_seat.account_id AND link.status = 'active';
    END IF;
    IF v_learner IS NOT NULL AND v_account_learner IS NOT NULL
       AND v_learner <> v_account_learner THEN
        RAISE EXCEPTION 'seat/account learner identity conflict';
    END IF;
    v_learner := COALESCE(v_learner, v_account_learner, gen_random_uuid());
    INSERT INTO public.learner_identities (id, tenant_id, school_id)
    VALUES (v_learner, v_seat.tenant_id, v_seat.school_id)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.learner_identity_links
        (id, tenant_id, school_id, learner_identity_id, link_kind, seat_id)
    VALUES (gen_random_uuid(), v_seat.tenant_id, v_seat.school_id,
            v_learner, 'student_seat', p_seat_id)
    ON CONFLICT DO NOTHING;
    IF v_seat.account_id IS NOT NULL THEN
        INSERT INTO public.learner_identity_links
            (id, tenant_id, school_id, learner_identity_id, link_kind, account_id)
        VALUES (gen_random_uuid(), v_seat.tenant_id, v_seat.school_id,
                v_learner, 'account', v_seat.account_id)
        ON CONFLICT DO NOTHING;
        SELECT link.learner_identity_id INTO v_account_learner
          FROM public.learner_identity_links link
         WHERE link.school_id = v_seat.school_id
           AND link.account_id = v_seat.account_id AND link.status = 'active';
        IF v_account_learner <> v_learner THEN
            RAISE EXCEPTION 'account learner identity conflict';
        END IF;
    END IF;
    RETURN v_learner;
END;
$$;

CREATE OR REPLACE FUNCTION learning_audience_materialize_set(
    p_audience_id uuid,
    p_operation_id uuid,
    p_learner_ids uuid[]
)
RETURNS TABLE (created_count integer, independent_count integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_audience public.learning_audience_definitions%ROWTYPE;
    v_created integer := 0;
    v_independent integer := 0;
BEGIN
    SELECT * INTO v_audience FROM public.learning_audience_definitions audience
     WHERE audience.id = p_audience_id AND audience.status = 'active' FOR UPDATE;
    IF v_audience.id IS NULL THEN RAISE EXCEPTION 'audience unavailable'; END IF;

    IF v_audience.target_kind = 'course_run' THEN
        WITH wanted AS (
            SELECT DISTINCT learner_id
              FROM unnest(COALESCE(p_learner_ids, ARRAY[]::uuid[])) learner_id
        ), inserted AS (
            INSERT INTO public.course_enrollments
                (tenant_id, school_id, course_run_id, learner_identity_id,
                 assigned_by_principal_id, assignment_source)
            SELECT v_audience.tenant_id, v_audience.school_id,
                   v_audience.target_course_run_id, wanted.learner_id,
                   v_audience.created_by_principal_id,
                   CASE v_audience.audience_type WHEN 'whole_class'
                        THEN 'whole_class_dynamic' ELSE 'named_snapshot' END
              FROM wanted
            ON CONFLICT (course_run_id, learner_identity_id) DO NOTHING
            RETURNING id, learner_identity_id
        ), resolved AS (
            SELECT inserted.learner_identity_id AS learner_id, inserted.id,
                   true AS was_created FROM inserted
            UNION ALL
            SELECT wanted.learner_id, enrollment.id, false AS was_created
              FROM wanted
              JOIN public.course_enrollments enrollment
                ON enrollment.course_run_id = v_audience.target_course_run_id
               AND enrollment.learner_identity_id = wanted.learner_id
             WHERE NOT EXISTS (SELECT 1 FROM inserted
                                WHERE inserted.learner_identity_id=wanted.learner_id)
        )
        INSERT INTO public.learning_audience_membership_claims
            (tenant_id, school_id, audience_id, learner_identity_id,
             course_enrollment_id, ownership_kind, created_by_operation_id)
        SELECT v_audience.tenant_id, v_audience.school_id, v_audience.id,
               resolved.learner_id, resolved.id,
               CASE WHEN resolved.was_created THEN 'audience_owned'
                    ELSE 'independent' END,
               p_operation_id
          FROM resolved
        ON CONFLICT (audience_id, learner_identity_id) DO NOTHING;
    ELSE
        WITH wanted AS (
            SELECT DISTINCT learner_id
              FROM unnest(COALESCE(p_learner_ids, ARRAY[]::uuid[])) learner_id
        ), inserted AS (
            INSERT INTO public.activity_participations
                (tenant_id, school_id, activity_run_id, learner_identity_id,
                 assigned_by_principal_id, assignment_source)
            SELECT v_audience.tenant_id, v_audience.school_id,
                   v_audience.target_activity_run_id, wanted.learner_id,
                   v_audience.created_by_principal_id,
                   CASE v_audience.audience_type WHEN 'whole_class'
                        THEN 'whole_class_dynamic' ELSE 'named_snapshot' END
              FROM wanted
            ON CONFLICT (activity_run_id, learner_identity_id) DO NOTHING
            RETURNING id, learner_identity_id
        ), resolved AS (
            SELECT inserted.learner_identity_id AS learner_id, inserted.id,
                   true AS was_created FROM inserted
            UNION ALL
            SELECT wanted.learner_id, participation.id, false AS was_created
              FROM wanted
              JOIN public.activity_participations participation
                ON participation.activity_run_id = v_audience.target_activity_run_id
               AND participation.learner_identity_id = wanted.learner_id
             WHERE NOT EXISTS (SELECT 1 FROM inserted
                                WHERE inserted.learner_identity_id=wanted.learner_id)
        )
        INSERT INTO public.learning_audience_membership_claims
            (tenant_id, school_id, audience_id, learner_identity_id,
             activity_participation_id, ownership_kind, created_by_operation_id)
        SELECT v_audience.tenant_id, v_audience.school_id, v_audience.id,
               resolved.learner_id, resolved.id,
               CASE WHEN resolved.was_created THEN 'audience_owned'
                    ELSE 'independent' END,
               p_operation_id
          FROM resolved
        ON CONFLICT (audience_id, learner_identity_id) DO NOTHING;
    END IF;

    SELECT count(*) FILTER (WHERE ownership_kind = 'audience_owned')::integer,
           count(*) FILTER (WHERE ownership_kind = 'independent')::integer
      INTO v_created, v_independent
      FROM public.learning_audience_membership_claims
     WHERE created_by_operation_id = p_operation_id;

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    SELECT v_audience.tenant_id, membership.user_id, 'learning_audience',
           claim.audience_id, 'audience.learner_materialized',
           jsonb_build_object(
             'audienceId', claim.audience_id,
             'operationId', p_operation_id,
             'learnerIdentityId', claim.learner_identity_id,
             'ownershipKind', claim.ownership_kind,
             'targetKind', v_audience.target_kind,
             'courseEnrollmentId', claim.course_enrollment_id,
             'activityParticipationId', claim.activity_participation_id)
      FROM public.learning_audience_membership_claims claim
      JOIN public.principals principal
        ON principal.id = v_audience.created_by_principal_id
      LEFT JOIN public.classroom_memberships membership
        ON membership.tenant_id = v_audience.tenant_id
       AND membership.classroom_id = v_audience.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
     WHERE claim.created_by_operation_id = p_operation_id;

    RETURN QUERY SELECT COALESCE(v_created, 0), COALESCE(v_independent, 0);
END;
$$;

CREATE OR REPLACE FUNCTION learning_audience_create(
    p_actor_principal_id uuid,
    p_target_kind varchar,
    p_target_id uuid,
    p_audience_type varchar,
    p_mode varchar,
    p_named_learner_ids uuid[],
    p_request_id varchar
)
RETURNS TABLE (result_code varchar, audience_id uuid, created_count integer,
               independent_count integer, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_context record;
    v_audience public.learning_audience_definitions%ROWTYPE;
    v_operation uuid;
    v_learner_ids uuid[];
    v_digest varchar;
    v_counts record;
    v_actor_user uuid;
BEGIN
    IF p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$'
       OR p_target_kind NOT IN ('course_run', 'activity_run')
       OR p_audience_type NOT IN ('whole_class', 'named_learners')
       OR NOT ((p_audience_type = 'whole_class' AND p_mode = 'dynamic')
               OR (p_audience_type = 'named_learners' AND p_mode = 'snapshot')) THEN
        RETURN QUERY SELECT 'invalid_request'::varchar, NULL::uuid, 0, 0, false; RETURN;
    END IF;
    IF p_target_kind = 'course_run' THEN
        SELECT run.tenant_id, classroom.school_id, run.classroom_id, run.status,
               membership.user_id, NULL::varchar AS source_kind
          INTO v_context
          FROM public.classroom_course_runs run
          JOIN public.classrooms classroom
            ON classroom.tenant_id = run.tenant_id AND classroom.id = run.classroom_id
          JOIN public.principals principal
            ON principal.id = p_actor_principal_id AND principal.kind = 'account'
          JOIN public.classroom_memberships membership
            ON membership.tenant_id = run.tenant_id
           AND membership.classroom_id = run.classroom_id
           AND membership.account_id = principal.account_id
           AND membership.member_role IN ('owner', 'co_teacher')
         WHERE run.id = p_target_id
           AND run.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           AND classroom.status = 'active';
    ELSE
        SELECT run.tenant_id, run.school_id, run.classroom_id,
               (CASE WHEN run.lifecycle_status = 'active'
                          AND assignment.status = 'open'
                          AND run.source_kind = 'direct' THEN 'open' ELSE 'closed' END)::varchar AS status,
               membership.user_id, run.source_kind
          INTO v_context
          FROM public.activity_runs run
          JOIN public.classrooms classroom
            ON classroom.tenant_id = run.tenant_id AND classroom.id = run.classroom_id
          JOIN public.classroom_assignments assignment
            ON assignment.id = run.source_classroom_assignment_id
          JOIN public.principals principal
            ON principal.id = p_actor_principal_id AND principal.kind = 'account'
          JOIN public.classroom_memberships membership
            ON membership.tenant_id = run.tenant_id
           AND membership.classroom_id = run.classroom_id
           AND membership.account_id = principal.account_id
           AND membership.member_role IN ('owner', 'co_teacher')
         WHERE run.id = p_target_id
           AND run.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           AND classroom.status = 'active';
        IF v_context.tenant_id IS NOT NULL AND v_context.source_kind = 'course' THEN
            RETURN QUERY SELECT 'course_activity_inherits_course_audience'::varchar,
                                NULL::uuid, 0, 0, false; RETURN;
        END IF;
    END IF;
    IF v_context.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, 0, 0, false; RETURN;
    END IF;
    IF v_context.status <> 'open' THEN
        RETURN QUERY SELECT 'target_closed'::varchar, NULL::uuid, 0, 0, false; RETURN;
    END IF;

    -- M0 owns historical identity convergence. M1-005 creates identity only as
    -- part of this current, explicit audience operation; it does not scan or
    -- mutate unrelated classrooms.
    PERFORM public.learning_audience_ensure_seat_identity(seat.id)
      FROM public.classroom_student_seats seat
     WHERE seat.tenant_id = v_context.tenant_id
       AND seat.classroom_id = v_context.classroom_id
       AND seat.status IN ('issued', 'active');

    IF p_audience_type = 'whole_class' THEN
        IF COALESCE(cardinality(p_named_learner_ids), 0) <> 0 THEN
            RETURN QUERY SELECT 'invalid_request'::varchar, NULL::uuid, 0, 0, false; RETURN;
        END IF;
        SELECT COALESCE(array_agg(DISTINCT link.learner_identity_id), ARRAY[]::uuid[])
          INTO v_learner_ids
          FROM public.classroom_student_seats seat
          JOIN public.learner_identity_links link
            ON link.seat_id = seat.id AND link.status = 'active'
          JOIN public.learner_identities learner
            ON learner.id = link.learner_identity_id AND learner.state = 'active'
         WHERE seat.tenant_id = v_context.tenant_id
           AND seat.classroom_id = v_context.classroom_id
           AND seat.status IN ('issued', 'active');
    ELSE
        IF p_named_learner_ids IS NULL OR cardinality(p_named_learner_ids) = 0
           OR cardinality(p_named_learner_ids) <>
              (SELECT count(DISTINCT learner_id) FROM unnest(p_named_learner_ids) learner_id)
           OR EXISTS (
                SELECT 1 FROM unnest(p_named_learner_ids) learner_id
                 WHERE NOT EXISTS (
                    SELECT 1 FROM public.classroom_student_seats seat
                    JOIN public.learner_identity_links link
                      ON link.seat_id = seat.id AND link.status = 'active'
                   WHERE seat.tenant_id = v_context.tenant_id
                     AND seat.classroom_id = v_context.classroom_id
                     AND seat.status IN ('issued', 'active')
                     AND link.learner_identity_id = learner_id)) THEN
            RETURN QUERY SELECT 'named_learner_ineligible'::varchar,
                                NULL::uuid, 0, 0, false; RETURN;
        END IF;
        SELECT array_agg(DISTINCT learner_id ORDER BY learner_id)
          INTO v_learner_ids FROM unnest(p_named_learner_ids) learner_id;
    END IF;

    v_digest := encode(public.digest(convert_to(concat_ws('|', p_target_kind, p_target_id::text,
        p_audience_type, p_mode,
        COALESCE((SELECT string_agg(x::text, ',' ORDER BY x::text)
                    FROM unnest(v_learner_ids) x), '')), 'UTF8'), 'sha256'), 'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended(
        v_context.tenant_id::text || ':' || p_actor_principal_id::text || ':' || p_request_id, 0));
    SELECT * INTO v_audience FROM public.learning_audience_definitions audience
     WHERE audience.tenant_id = v_context.tenant_id
       AND audience.created_by_principal_id = p_actor_principal_id
       AND audience.creation_request_id = p_request_id;
    IF v_audience.id IS NOT NULL THEN
        IF v_audience.creation_request_digest <> v_digest THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar,
                                v_audience.id, 0, 0, true; RETURN;
        END IF;
        SELECT count(*) FILTER (WHERE ownership_kind='audience_owned')::integer AS created_count,
               count(*) FILTER (WHERE ownership_kind='independent')::integer AS independent_count
          INTO v_counts FROM public.learning_audience_membership_claims claim
         WHERE claim.audience_id = v_audience.id;
        RETURN QUERY SELECT 'ok'::varchar, v_audience.id,
            COALESCE(v_counts.created_count, 0),
            COALESCE(v_counts.independent_count, 0), true; RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_target_kind || ':' || p_target_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.learning_audience_definitions audience
                WHERE (p_target_kind='course_run' AND audience.target_course_run_id=p_target_id)
                   OR (p_target_kind='activity_run' AND audience.target_activity_run_id=p_target_id)) THEN
        RETURN QUERY SELECT 'target_has_audience'::varchar, NULL::uuid, 0, 0, false; RETURN;
    END IF;
    INSERT INTO public.learning_audience_definitions
        (tenant_id, school_id, classroom_id, target_kind,
         target_course_run_id, target_activity_run_id, audience_type, mode,
         created_by_principal_id, creation_request_id, creation_request_digest)
    VALUES (v_context.tenant_id, v_context.school_id, v_context.classroom_id,
            p_target_kind,
            CASE WHEN p_target_kind='course_run' THEN p_target_id END,
            CASE WHEN p_target_kind='activity_run' THEN p_target_id END,
            p_audience_type, p_mode, p_actor_principal_id, p_request_id, v_digest)
    RETURNING * INTO v_audience;
    v_operation := gen_random_uuid();
    INSERT INTO public.learning_audience_operations
        (id,tenant_id,school_id,audience_id,operation_kind,request_id,
         request_digest,result_code,actor_principal_id)
    VALUES (v_operation,v_context.tenant_id,v_context.school_id,v_audience.id,
            'initial_materialization','initial:'||p_request_id,v_digest,
            'completed',p_actor_principal_id);
    IF p_audience_type = 'named_learners' THEN
        INSERT INTO public.learning_audience_named_members
            (tenant_id,school_id,audience_id,learner_identity_id,
             added_by_principal_id,added_by_operation_id)
        SELECT v_context.tenant_id,v_context.school_id,v_audience.id,learner_id,
               p_actor_principal_id,v_operation FROM unnest(v_learner_ids) learner_id;
    END IF;
    SELECT * INTO v_counts FROM public.learning_audience_materialize_set(
        v_audience.id, v_operation, v_learner_ids);
    INSERT INTO public.audit_events
        (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES (v_context.tenant_id,v_context.user_id,'learning_audience',v_audience.id,
            'audience.created',jsonb_build_object(
              'audienceId',v_audience.id,'targetKind',p_target_kind,
              'targetId',p_target_id,'audienceType',p_audience_type,'mode',p_mode,
              'operationId',v_operation,'createdCount',v_counts.created_count,
              'independentCount',v_counts.independent_count));
    RETURN QUERY SELECT 'ok'::varchar,v_audience.id,v_counts.created_count,
                        v_counts.independent_count,false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_audience_named_add(
    p_actor_principal_id uuid, p_audience_id uuid,
    p_learner_identity_id uuid, p_request_id varchar
)
RETURNS TABLE (result_code varchar, member_id uuid, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_audience record; v_member record; v_operation record; v_op_id uuid;
        v_digest varchar; v_counts record;
BEGIN
    SELECT audience.*, membership.user_id AS actor_user_id,
           COALESCE(course.status,
             CASE WHEN activity.lifecycle_status='active' AND handout.status='open'
                  THEN 'open' ELSE 'closed' END::varchar) AS target_status
      INTO v_audience FROM public.learning_audience_definitions audience
      JOIN public.principals principal ON principal.id=p_actor_principal_id AND principal.kind='account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=audience.tenant_id AND membership.classroom_id=audience.classroom_id
       AND membership.account_id=principal.account_id AND membership.member_role IN ('owner','co_teacher')
      LEFT JOIN public.classroom_course_runs course ON course.id=audience.target_course_run_id
      LEFT JOIN public.activity_runs activity ON activity.id=audience.target_activity_run_id
      LEFT JOIN public.classroom_assignments handout ON handout.id=activity.source_classroom_assignment_id
     WHERE audience.id=p_audience_id AND audience.status='active'
       AND audience.audience_type='named_learners'
       AND audience.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
    IF v_audience.id IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,false; RETURN; END IF;
    IF v_audience.target_status <> 'open' THEN RETURN QUERY SELECT 'target_closed'::varchar,NULL::uuid,false; RETURN; END IF;
    IF p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' OR NOT EXISTS (
        SELECT 1 FROM public.classroom_student_seats seat
        JOIN public.learner_identity_links link ON link.seat_id=seat.id AND link.status='active'
       WHERE seat.tenant_id=v_audience.tenant_id AND seat.classroom_id=v_audience.classroom_id
         AND seat.status IN ('issued','active') AND link.learner_identity_id=p_learner_identity_id
    ) THEN RETURN QUERY SELECT 'named_learner_ineligible'::varchar,NULL::uuid,false; RETURN; END IF;
    v_digest:=encode(public.digest(convert_to('named_add|'||p_audience_id::text||'|'||p_learner_identity_id::text,'UTF8'),'sha256'),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended(p_audience_id::text||':'||p_request_id,0));
    SELECT * INTO v_operation FROM public.learning_audience_operations operation
     WHERE operation.audience_id=p_audience_id AND operation.request_id=p_request_id;
    IF v_operation.id IS NOT NULL THEN
      IF v_operation.request_digest<>v_digest THEN RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,true; RETURN; END IF;
      SELECT * INTO v_member FROM public.learning_audience_named_members member
       WHERE member.audience_id=p_audience_id AND member.learner_identity_id=p_learner_identity_id;
      RETURN QUERY SELECT v_operation.result_code,v_member.id,true; RETURN;
    END IF;
    SELECT * INTO v_member FROM public.learning_audience_named_members member
     WHERE member.audience_id=p_audience_id AND member.learner_identity_id=p_learner_identity_id FOR UPDATE;
    IF v_member.removed_at IS NOT NULL THEN
      RETURN QUERY SELECT 'rejoin_requires_explicit_policy'::varchar,v_member.id,false; RETURN;
    ELSIF v_member.id IS NOT NULL THEN RETURN QUERY SELECT 'ok'::varchar,v_member.id,true; RETURN; END IF;
    v_op_id:=gen_random_uuid();
    INSERT INTO public.learning_audience_operations
      (id,tenant_id,school_id,audience_id,learner_identity_id,operation_kind,
       request_id,request_digest,result_code,actor_principal_id)
    VALUES(v_op_id,v_audience.tenant_id,v_audience.school_id,p_audience_id,p_learner_identity_id,
      'named_member_added',p_request_id,v_digest,'completed',p_actor_principal_id);
    INSERT INTO public.learning_audience_named_members
      (tenant_id,school_id,audience_id,learner_identity_id,added_by_principal_id,added_by_operation_id)
    VALUES(v_audience.tenant_id,v_audience.school_id,p_audience_id,p_learner_identity_id,
      p_actor_principal_id,v_op_id) RETURNING * INTO v_member;
    SELECT * INTO v_counts FROM public.learning_audience_materialize_set(
      p_audience_id,v_op_id,ARRAY[p_learner_identity_id]);
    INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES(v_audience.tenant_id,v_audience.actor_user_id,'learning_audience',p_audience_id,
      'audience.named_member_added',jsonb_build_object('audienceId',p_audience_id,
       'learnerIdentityId',p_learner_identity_id,'operationId',v_op_id));
    RETURN QUERY SELECT 'ok'::varchar,v_member.id,false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_audience_named_remove(
    p_actor_principal_id uuid, p_audience_id uuid,
    p_learner_identity_id uuid, p_request_id varchar
)
RETURNS TABLE (result_code varchar, member_id uuid, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_audience record; v_member record; v_claim record; v_operation record;
        v_op_id uuid; v_digest varchar;
BEGIN
    SELECT audience.*, membership.user_id AS actor_user_id INTO v_audience
      FROM public.learning_audience_definitions audience
      JOIN public.principals principal ON principal.id=p_actor_principal_id AND principal.kind='account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=audience.tenant_id AND membership.classroom_id=audience.classroom_id
       AND membership.account_id=principal.account_id AND membership.member_role IN ('owner','co_teacher')
     WHERE audience.id=p_audience_id AND audience.status='active'
       AND audience.audience_type='named_learners'
       AND audience.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid;
    IF v_audience.id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
      RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,false; RETURN; END IF;
    v_digest:=encode(public.digest(convert_to('named_remove|'||p_audience_id::text||'|'||p_learner_identity_id::text,'UTF8'),'sha256'),'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended(p_audience_id::text||':'||p_request_id,0));
    SELECT * INTO v_operation FROM public.learning_audience_operations operation
     WHERE operation.audience_id=p_audience_id AND operation.request_id=p_request_id;
    IF v_operation.id IS NOT NULL THEN
      IF v_operation.request_digest<>v_digest THEN RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,true; RETURN; END IF;
      SELECT * INTO v_member FROM public.learning_audience_named_members member
       WHERE member.audience_id=p_audience_id AND member.learner_identity_id=p_learner_identity_id;
      RETURN QUERY SELECT 'ok'::varchar,v_member.id,true; RETURN;
    END IF;
    SELECT * INTO v_member FROM public.learning_audience_named_members member
     WHERE member.audience_id=p_audience_id AND member.learner_identity_id=p_learner_identity_id FOR UPDATE;
    IF v_member.id IS NULL THEN RETURN QUERY SELECT 'member_not_found'::varchar,NULL::uuid,false; RETURN;
    ELSIF v_member.removed_at IS NOT NULL THEN RETURN QUERY SELECT 'ok'::varchar,v_member.id,true; RETURN; END IF;
    v_op_id:=gen_random_uuid();
    INSERT INTO public.learning_audience_operations
      (id,tenant_id,school_id,audience_id,learner_identity_id,operation_kind,
       request_id,request_digest,result_code,actor_principal_id)
    VALUES(v_op_id,v_audience.tenant_id,v_audience.school_id,p_audience_id,p_learner_identity_id,
      'named_member_removed',p_request_id,v_digest,'withdrawn',p_actor_principal_id);
    UPDATE public.learning_audience_named_members SET removed_at=now(),
      removed_by_principal_id=p_actor_principal_id,removed_by_operation_id=v_op_id
     WHERE id=v_member.id RETURNING * INTO v_member;
    SELECT * INTO v_claim FROM public.learning_audience_membership_claims claim
     WHERE claim.audience_id=p_audience_id AND claim.learner_identity_id=p_learner_identity_id
       AND claim.ended_at IS NULL FOR UPDATE;
    IF v_claim.ownership_kind='audience_owned' THEN
      IF v_claim.course_enrollment_id IS NOT NULL THEN
        UPDATE public.course_enrollments SET status='withdrawn',withdrawn_at=now(),
          withdrawn_by_principal_id=p_actor_principal_id,withdrawal_source='named_member_removed'
         WHERE id=v_claim.course_enrollment_id AND status IN ('assigned','active');
      ELSE
        UPDATE public.activity_participations SET status='withdrawn',withdrawn_at=now(),
          withdrawn_by_principal_id=p_actor_principal_id,withdrawal_source='named_member_removed'
         WHERE id=v_claim.activity_participation_id AND status IN ('assigned','active');
      END IF;
    END IF;
    UPDATE public.learning_audience_membership_claims SET ended_at=now(),
      ended_by_operation_id=v_op_id,ended_reason='named_member_removed'
     WHERE id=v_claim.id;
    INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES(v_audience.tenant_id,v_audience.actor_user_id,'learning_audience',p_audience_id,
      'audience.named_member_removed',jsonb_build_object('audienceId',p_audience_id,
       'learnerIdentityId',p_learner_identity_id,'operationId',v_op_id,
       'ownershipKind',v_claim.ownership_kind));
    RETURN QUERY SELECT 'ok'::varchar,v_member.id,false;
END;
$$;

-- Durable, set-based lifecycle hook. All current and future seat writers pass
-- through this physical boundary.
CREATE OR REPLACE FUNCTION learning_audience_sync_seat_event()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_learner uuid; v_school uuid; v_eligible boolean;
BEGIN
    SELECT classroom.school_id INTO v_school FROM public.classrooms classroom
     WHERE classroom.tenant_id=NEW.tenant_id AND classroom.id=NEW.classroom_id;
    v_eligible:=NEW.status IN ('issued','active');
    SELECT link.learner_identity_id INTO v_learner
      FROM public.learner_identity_links link
     WHERE link.seat_id=NEW.id AND link.status='active';
    IF v_learner IS NULL AND v_eligible AND EXISTS (
      SELECT 1 FROM public.learning_audience_definitions audience
       WHERE audience.tenant_id=NEW.tenant_id AND audience.classroom_id=NEW.classroom_id
         AND audience.status='active' AND audience.audience_type='whole_class'
         AND audience.mode='dynamic'
    ) THEN
      v_learner:=public.learning_audience_ensure_seat_identity(NEW.id);
    END IF;
    IF v_learner IS NULL THEN RETURN NEW; END IF;

    IF v_eligible THEN
      -- Rejoin is explicit: an ended claim is never recreated or reactivated.
      INSERT INTO public.learning_audience_operations
        (tenant_id,school_id,audience_id,learner_identity_id,operation_kind,
         request_id,request_digest,result_code,source_seat_id)
      SELECT audience.tenant_id,audience.school_id,audience.id,v_learner,'rejoin_rejected',
        'rejoin:'||v_learner::text,
        encode(public.digest(convert_to('rejoin|'||audience.id::text||'|'||v_learner::text,'UTF8'),'sha256'),'hex'),
        'rejoin_requires_explicit_policy',NEW.id
       FROM public.learning_audience_definitions audience
       JOIN public.learning_audience_membership_claims claim
         ON claim.audience_id=audience.id AND claim.learner_identity_id=v_learner
        AND claim.ended_at IS NOT NULL
      WHERE audience.tenant_id=NEW.tenant_id AND audience.classroom_id=NEW.classroom_id
        AND audience.status='active' AND audience.audience_type='whole_class'
      ON CONFLICT (audience_id,request_id) DO NOTHING;

      WITH eligible_audiences AS (
        SELECT audience.* FROM public.learning_audience_definitions audience
         WHERE audience.tenant_id=NEW.tenant_id AND audience.classroom_id=NEW.classroom_id
           AND audience.status='active' AND audience.audience_type='whole_class'
           AND audience.mode='dynamic'
           AND NOT EXISTS (SELECT 1 FROM public.learning_audience_membership_claims claim
             WHERE claim.audience_id=audience.id AND claim.learner_identity_id=v_learner)
           AND ((audience.target_kind='course_run' AND EXISTS (
              SELECT 1 FROM public.classroom_course_runs run
               WHERE run.id=audience.target_course_run_id AND run.status='open'))
             OR (audience.target_kind='activity_run' AND EXISTS (
              SELECT 1 FROM public.activity_runs run
              JOIN public.classroom_assignments handout ON handout.id=run.source_classroom_assignment_id
               WHERE run.id=audience.target_activity_run_id AND run.source_kind='direct'
                 AND run.lifecycle_status='active' AND handout.status='open')))
      ), operations AS (
        INSERT INTO public.learning_audience_operations
          (tenant_id,school_id,audience_id,learner_identity_id,operation_kind,
           request_id,request_digest,result_code,source_seat_id)
        SELECT audience.tenant_id,audience.school_id,audience.id,v_learner,
          'dynamic_learner_materialized','dynamic:'||v_learner::text,
          encode(public.digest(convert_to('dynamic|'||audience.id::text||'|'||v_learner::text,'UTF8'),'sha256'),'hex'),
          'completed',NEW.id FROM eligible_audiences audience
        ON CONFLICT (audience_id,request_id) DO NOTHING
        RETURNING *
      ), inserted AS (
        INSERT INTO public.course_enrollments
          (tenant_id,school_id,course_run_id,learner_identity_id,
           assigned_by_principal_id,assignment_source)
        SELECT audience.tenant_id,audience.school_id,audience.target_course_run_id,
          v_learner,audience.created_by_principal_id,'whole_class_dynamic'
         FROM eligible_audiences audience JOIN operations op ON op.audience_id=audience.id
        WHERE audience.target_kind='course_run'
        ON CONFLICT (course_run_id,learner_identity_id) DO NOTHING
        RETURNING id,course_run_id
      )
      INSERT INTO public.learning_audience_membership_claims
        (tenant_id,school_id,audience_id,learner_identity_id,course_enrollment_id,
         ownership_kind,created_by_operation_id)
      SELECT audience.tenant_id,audience.school_id,audience.id,v_learner,inserted.id,
        'audience_owned',op.id
       FROM eligible_audiences audience JOIN operations op ON op.audience_id=audience.id
       JOIN inserted ON inserted.course_run_id=audience.target_course_run_id
      WHERE audience.target_kind='course_run'
      UNION ALL
      SELECT audience.tenant_id,audience.school_id,audience.id,v_learner,enrollment.id,
        'independent',op.id
       FROM eligible_audiences audience JOIN operations op ON op.audience_id=audience.id
       JOIN public.course_enrollments enrollment
         ON enrollment.course_run_id=audience.target_course_run_id
        AND enrollment.learner_identity_id=v_learner
      WHERE audience.target_kind='course_run'
        AND NOT EXISTS (SELECT 1 FROM inserted
                         WHERE inserted.course_run_id=audience.target_course_run_id)
      ON CONFLICT (audience_id,learner_identity_id) DO NOTHING;

      WITH eligible_audiences AS (
        SELECT audience.* FROM public.learning_audience_definitions audience
         WHERE audience.tenant_id=NEW.tenant_id AND audience.classroom_id=NEW.classroom_id
           AND audience.status='active' AND audience.audience_type='whole_class'
           AND audience.mode='dynamic' AND audience.target_kind='activity_run'
           AND NOT EXISTS (SELECT 1 FROM public.learning_audience_membership_claims claim
             WHERE claim.audience_id=audience.id AND claim.learner_identity_id=v_learner)
           AND EXISTS (SELECT 1 FROM public.activity_runs run
             JOIN public.classroom_assignments handout ON handout.id=run.source_classroom_assignment_id
            WHERE run.id=audience.target_activity_run_id AND run.source_kind='direct'
              AND run.lifecycle_status='active' AND handout.status='open')
      ), operations AS (
        SELECT operation.* FROM public.learning_audience_operations operation
        JOIN eligible_audiences audience ON audience.id=operation.audience_id
         WHERE operation.request_id='dynamic:'||v_learner::text
      ), inserted AS (
        INSERT INTO public.activity_participations
          (tenant_id,school_id,activity_run_id,learner_identity_id,
           assigned_by_principal_id,assignment_source)
        SELECT audience.tenant_id,audience.school_id,audience.target_activity_run_id,
          v_learner,audience.created_by_principal_id,'whole_class_dynamic'
         FROM eligible_audiences audience JOIN operations op ON op.audience_id=audience.id
        ON CONFLICT (activity_run_id,learner_identity_id) DO NOTHING
        RETURNING id,activity_run_id
      )
      INSERT INTO public.learning_audience_membership_claims
        (tenant_id,school_id,audience_id,learner_identity_id,activity_participation_id,
         ownership_kind,created_by_operation_id)
      SELECT audience.tenant_id,audience.school_id,audience.id,v_learner,inserted.id,
        'audience_owned',op.id
       FROM eligible_audiences audience JOIN operations op ON op.audience_id=audience.id
       JOIN inserted ON inserted.activity_run_id=audience.target_activity_run_id
      UNION ALL
      SELECT audience.tenant_id,audience.school_id,audience.id,v_learner,participation.id,
        'independent',op.id
       FROM eligible_audiences audience JOIN operations op ON op.audience_id=audience.id
       JOIN public.activity_participations participation
         ON participation.activity_run_id=audience.target_activity_run_id
        AND participation.learner_identity_id=v_learner
       WHERE NOT EXISTS (SELECT 1 FROM inserted
                          WHERE inserted.activity_run_id=audience.target_activity_run_id)
      ON CONFLICT (audience_id,learner_identity_id) DO NOTHING;

      IF TG_OP='INSERT'
         OR (OLD.status NOT IN ('issued','active')
             AND NOT EXISTS (SELECT 1 FROM public.learning_audience_membership_claims claim
               JOIN public.learning_audience_definitions audience ON audience.id=claim.audience_id
              WHERE audience.classroom_id=NEW.classroom_id
                AND claim.learner_identity_id=v_learner AND claim.ended_at IS NOT NULL)) THEN
        INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
        SELECT operation.tenant_id,membership.user_id,'learning_audience',operation.audience_id,
          'audience.dynamic_learner_materialized',jsonb_build_object(
            'audienceId',operation.audience_id,'learnerIdentityId',v_learner,
            'operationId',operation.id,'sourceSeatId',NEW.id)
         FROM public.learning_audience_operations operation
         JOIN public.learning_audience_definitions audience ON audience.id=operation.audience_id
         JOIN public.principals principal ON principal.id=audience.created_by_principal_id
         LEFT JOIN public.classroom_memberships membership
           ON membership.tenant_id=audience.tenant_id AND membership.classroom_id=audience.classroom_id
          AND membership.account_id=principal.account_id AND membership.member_role IN ('owner','co_teacher')
        WHERE operation.source_seat_id=NEW.id AND operation.operation_kind='dynamic_learner_materialized';
      END IF;
    ELSE
      IF TG_OP='UPDATE' AND OLD.status NOT IN ('issued','active') THEN
        RETURN NEW;
      END IF;
      IF EXISTS (SELECT 1 FROM public.classroom_student_seats seat
                 JOIN public.learner_identity_links link ON link.seat_id=seat.id AND link.status='active'
                WHERE seat.tenant_id=NEW.tenant_id AND seat.classroom_id=NEW.classroom_id
                  AND seat.status IN ('issued','active') AND link.learner_identity_id=v_learner) THEN
        RETURN NEW;
      END IF;
      WITH operations AS (
        INSERT INTO public.learning_audience_operations
          (tenant_id,school_id,audience_id,learner_identity_id,operation_kind,
           request_id,request_digest,result_code,actor_principal_id,source_seat_id)
        SELECT audience.tenant_id,audience.school_id,audience.id,v_learner,
          'classroom_membership_ended','leave:'||v_learner::text,
          encode(public.digest(convert_to('leave|'||audience.id::text||'|'||v_learner::text,'UTF8'),'sha256'),'hex'),
          'withdrawn',audience.created_by_principal_id,NEW.id
         FROM public.learning_audience_definitions audience
         JOIN public.learning_audience_membership_claims claim
           ON claim.audience_id=audience.id AND claim.learner_identity_id=v_learner
          AND claim.ended_at IS NULL
        WHERE audience.tenant_id=NEW.tenant_id AND audience.classroom_id=NEW.classroom_id
          AND audience.status='active'
        ON CONFLICT (audience_id,request_id) DO NOTHING RETURNING *
      )
      UPDATE public.course_enrollments enrollment SET status='withdrawn',withdrawn_at=now(),
        withdrawn_by_principal_id=operation.actor_principal_id,
        withdrawal_source='classroom_membership_ended'
       FROM operations operation
       JOIN public.learning_audience_membership_claims claim
         ON claim.audience_id=operation.audience_id AND claim.learner_identity_id=v_learner
        AND claim.ownership_kind='audience_owned' AND claim.ended_at IS NULL
      WHERE enrollment.id=claim.course_enrollment_id AND enrollment.status IN ('assigned','active');
      UPDATE public.activity_participations participation SET status='withdrawn',withdrawn_at=now(),
        withdrawn_by_principal_id=operation.actor_principal_id,
        withdrawal_source='classroom_membership_ended'
       FROM public.learning_audience_operations operation
       JOIN public.learning_audience_membership_claims claim
         ON claim.audience_id=operation.audience_id AND claim.learner_identity_id=v_learner
        AND claim.ownership_kind='audience_owned' AND claim.ended_at IS NULL
      WHERE operation.source_seat_id=NEW.id AND operation.operation_kind='classroom_membership_ended'
        AND participation.id=claim.activity_participation_id
        AND participation.status IN ('assigned','active');
      UPDATE public.learning_audience_membership_claims claim SET ended_at=now(),
        ended_by_operation_id=operation.id,ended_reason='classroom_membership_ended'
       FROM public.learning_audience_operations operation
      WHERE operation.source_seat_id=NEW.id AND operation.operation_kind='classroom_membership_ended'
        AND claim.audience_id=operation.audience_id AND claim.learner_identity_id=v_learner
        AND claim.ended_at IS NULL;
      INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
      SELECT operation.tenant_id,membership.user_id,'learning_audience',operation.audience_id,
        'audience.learner_withdrawn',jsonb_build_object('audienceId',operation.audience_id,
          'learnerIdentityId',v_learner,'operationId',operation.id,'sourceSeatId',NEW.id)
       FROM public.learning_audience_operations operation
       JOIN public.learning_audience_definitions audience ON audience.id=operation.audience_id
       JOIN public.principals principal ON principal.id=audience.created_by_principal_id
       LEFT JOIN public.classroom_memberships membership
         ON membership.tenant_id=audience.tenant_id AND membership.classroom_id=audience.classroom_id
        AND membership.account_id=principal.account_id AND membership.member_role IN ('owner','co_teacher')
      WHERE operation.source_seat_id=NEW.id AND operation.operation_kind='classroom_membership_ended';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER classroom_student_seats_learning_audience_sync
    AFTER INSERT OR UPDATE OF status, account_id ON classroom_student_seats
    FOR EACH ROW EXECUTE FUNCTION learning_audience_sync_seat_event();

CREATE OR REPLACE FUNCTION learning_audience_diagnostic(
    p_actor_principal_id uuid, p_audience_id uuid
)
RETURNS TABLE (result_code varchar, audience_id uuid, active_claims integer,
               ended_claims integer, owned_claims integer, independent_claims integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.learning_audience_definitions audience
    JOIN public.principals principal ON principal.id=p_actor_principal_id AND principal.kind='account'
    JOIN public.classroom_memberships membership
      ON membership.tenant_id=audience.tenant_id AND membership.classroom_id=audience.classroom_id
     AND membership.account_id=principal.account_id AND membership.member_role IN ('owner','co_teacher')
   WHERE audience.id=p_audience_id
     AND audience.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
  ) THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,0,0,0,0; RETURN; END IF;
  RETURN QUERY SELECT 'ok'::varchar,p_audience_id,
    count(*) FILTER(WHERE claim.ended_at IS NULL)::integer,
    count(*) FILTER(WHERE claim.ended_at IS NOT NULL)::integer,
    count(*) FILTER(WHERE claim.ownership_kind='audience_owned')::integer,
    count(*) FILTER(WHERE claim.ownership_kind='independent')::integer
   FROM public.learning_audience_membership_claims claim WHERE claim.audience_id=p_audience_id;
END;
$$;

REVOKE ALL ON FUNCTION learning_audience_ensure_seat_identity(uuid) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_audience_materialize_set(uuid,uuid,uuid[]) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_audience_sync_seat_event() FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_audience_create(uuid,varchar,uuid,varchar,varchar,uuid[],varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_audience_named_add(uuid,uuid,uuid,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_audience_named_remove(uuid,uuid,uuid,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_audience_diagnostic(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_audience_create(uuid,varchar,uuid,varchar,varchar,uuid[],varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_audience_named_add(uuid,uuid,uuid,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_audience_named_remove(uuid,uuid,uuid,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_audience_diagnostic(uuid,uuid) TO asalab_app;
