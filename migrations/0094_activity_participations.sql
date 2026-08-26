-- LRN-M1-004: one school-safe ActivityParticipation per ActivityRun/LearnerIdentity.
-- Additive only: no backfill and no Attempt/Submission/Result reader or writer cutover.

CREATE UNIQUE INDEX activity_runs_participation_school_identity_idx
    ON activity_runs (tenant_id, school_id, id);

CREATE TABLE activity_participations (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                    uuid NOT NULL REFERENCES tenants(id),
    school_id                    uuid NOT NULL,
    activity_run_id              uuid NOT NULL,
    learner_identity_id          uuid NOT NULL,
    source_course_enrollment_id  uuid,
    status                       varchar(16) NOT NULL DEFAULT 'assigned',
    assigned_at                  timestamptz NOT NULL DEFAULT now(),
    activated_at                 timestamptz,
    withdrawn_at                 timestamptz,
    assigned_by_principal_id     uuid NOT NULL REFERENCES principals(id),
    activated_by_principal_id    uuid REFERENCES principals(id),
    withdrawn_by_principal_id    uuid REFERENCES principals(id),
    assignment_source            varchar(32) NOT NULL DEFAULT 'teacher_command',
    activation_source            varchar(48),
    withdrawal_source            varchar(32),
    extra_attempts               integer NOT NULL DEFAULT 0,
    time_limit_override_seconds  integer,
    opens_at_override            timestamptz,
    due_at_override              timestamptz,
    closes_at_override           timestamptz,
    teacher_unlocked             boolean NOT NULL DEFAULT false,
    excused                      boolean NOT NULL DEFAULT false,
    excused_reason               text,
    excused_by_principal_id      uuid REFERENCES principals(id),
    excused_at                   timestamptz,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    updated_at                   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, school_id, id),
    UNIQUE (activity_run_id, learner_identity_id),
    FOREIGN KEY (tenant_id, school_id, activity_run_id)
        REFERENCES activity_runs(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, source_course_enrollment_id)
        REFERENCES course_enrollments(tenant_id, school_id, id),
    CONSTRAINT activity_participations_status_check
        CHECK (status IN ('assigned', 'active', 'withdrawn')),
    CONSTRAINT activity_participations_source_check
        CHECK (assignment_source = 'teacher_command'
               AND (activation_source IS NULL
                    OR activation_source = 'meaningful_learner_interaction')
               AND (withdrawal_source IS NULL OR withdrawal_source = 'teacher_command')),
    CONSTRAINT activity_participations_lifecycle_check CHECK (
        (status = 'assigned'
         AND activated_at IS NULL AND activated_by_principal_id IS NULL
         AND activation_source IS NULL
         AND withdrawn_at IS NULL AND withdrawn_by_principal_id IS NULL
         AND withdrawal_source IS NULL)
        OR
        (status = 'active'
         AND activated_at IS NOT NULL AND activated_by_principal_id IS NOT NULL
         AND activation_source IS NOT NULL
         AND withdrawn_at IS NULL AND withdrawn_by_principal_id IS NULL
         AND withdrawal_source IS NULL)
        OR
        (status = 'withdrawn'
         AND withdrawn_at IS NOT NULL AND withdrawn_by_principal_id IS NOT NULL
         AND withdrawal_source IS NOT NULL)
    ),
    CONSTRAINT activity_participations_extra_attempts_check CHECK (extra_attempts >= 0),
    CONSTRAINT activity_participations_time_limit_check
        CHECK (time_limit_override_seconds IS NULL OR time_limit_override_seconds > 0),
    CONSTRAINT activity_participations_dates_check CHECK (
        (opens_at_override IS NULL OR due_at_override IS NULL
         OR opens_at_override <= due_at_override)
        AND (due_at_override IS NULL OR closes_at_override IS NULL
             OR due_at_override <= closes_at_override)
        AND (opens_at_override IS NULL OR closes_at_override IS NULL
             OR opens_at_override <= closes_at_override)
    ),
    CONSTRAINT activity_participations_excused_check CHECK (
        (NOT excused AND excused_reason IS NULL
         AND excused_by_principal_id IS NULL AND excused_at IS NULL)
        OR
        (excused AND excused_by_principal_id IS NOT NULL AND excused_at IS NOT NULL)
    )
);

CREATE INDEX activity_participations_run_status_idx
    ON activity_participations (tenant_id, activity_run_id, status, assigned_at, id);
CREATE INDEX activity_participations_learner_status_idx
    ON activity_participations
       (tenant_id, school_id, learner_identity_id, status, assigned_at, id);

CREATE OR REPLACE FUNCTION activity_participation_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_run record;
    v_enrollment record;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'activity participation history is append-preserved';
    END IF;

    SELECT run.tenant_id, run.school_id, run.source_kind, run.source_course_run_id
      INTO v_run FROM public.activity_runs run WHERE run.id = NEW.activity_run_id;
    IF v_run.tenant_id IS NULL OR NEW.tenant_id <> v_run.tenant_id
       OR NEW.school_id <> v_run.school_id THEN
        RAISE EXCEPTION 'activity participation run school lineage is incoherent';
    END IF;

    IF v_run.source_kind = 'direct' AND NEW.source_course_enrollment_id IS NOT NULL THEN
        RAISE EXCEPTION 'direct activity participation cannot use a course enrollment';
    END IF;
    IF NEW.source_course_enrollment_id IS NOT NULL THEN
        SELECT enrollment.tenant_id, enrollment.school_id, enrollment.course_run_id,
               enrollment.learner_identity_id, enrollment.status
          INTO v_enrollment
          FROM public.course_enrollments enrollment
         WHERE enrollment.id = NEW.source_course_enrollment_id;
        IF v_enrollment.tenant_id IS NULL
           OR v_enrollment.tenant_id <> NEW.tenant_id
           OR v_enrollment.school_id <> NEW.school_id
           OR v_enrollment.course_run_id <> v_run.source_course_run_id
           OR v_enrollment.learner_identity_id <> NEW.learner_identity_id
           OR (TG_OP = 'INSERT' AND v_enrollment.status = 'withdrawn') THEN
            RAISE EXCEPTION 'activity participation course enrollment provenance is incoherent';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id
           OR NEW.school_id <> OLD.school_id
           OR NEW.activity_run_id <> OLD.activity_run_id
           OR NEW.learner_identity_id <> OLD.learner_identity_id
           OR NEW.source_course_enrollment_id IS DISTINCT FROM OLD.source_course_enrollment_id
           OR NEW.assigned_at <> OLD.assigned_at
           OR NEW.assigned_by_principal_id <> OLD.assigned_by_principal_id
           OR NEW.assignment_source <> OLD.assignment_source
           OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'activity participation identity and assignment provenance are immutable';
        END IF;
        IF NEW.status <> OLD.status AND NOT (
            (OLD.status = 'assigned' AND NEW.status IN ('active', 'withdrawn'))
            OR (OLD.status = 'active' AND NEW.status = 'withdrawn')
        ) THEN
            RAISE EXCEPTION 'invalid activity participation transition % -> %', OLD.status, NEW.status;
        END IF;
        IF NEW.status = OLD.status AND (
            NEW.activated_at IS DISTINCT FROM OLD.activated_at
            OR NEW.activated_by_principal_id IS DISTINCT FROM OLD.activated_by_principal_id
            OR NEW.activation_source IS DISTINCT FROM OLD.activation_source
            OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
            OR NEW.withdrawn_by_principal_id IS DISTINCT FROM OLD.withdrawn_by_principal_id
            OR NEW.withdrawal_source IS DISTINCT FROM OLD.withdrawal_source
        ) THEN
            RAISE EXCEPTION 'activity participation transition provenance is immutable';
        END IF;
        IF OLD.excused AND NOT NEW.excused THEN
            RAISE EXCEPTION 'activity participation excuse is one-way in M1-004';
        END IF;
        IF OLD.excused AND (
            NEW.excused_reason IS DISTINCT FROM OLD.excused_reason
            OR NEW.excused_by_principal_id IS DISTINCT FROM OLD.excused_by_principal_id
            OR NEW.excused_at IS DISTINCT FROM OLD.excused_at
        ) THEN
            RAISE EXCEPTION 'activity participation excuse evidence is immutable';
        END IF;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER activity_participations_guard
    BEFORE INSERT OR UPDATE OR DELETE ON activity_participations
    FOR EACH ROW EXECUTE FUNCTION activity_participation_guard();

REVOKE ALL ON activity_participations FROM PUBLIC, asalab_app;
ALTER TABLE activity_participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_participations FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_participations_tenant ON activity_participations
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION activity_participation_assign(
    p_actor_principal_id uuid,
    p_activity_run_id uuid,
    p_learner_identity_id uuid,
    p_source_course_enrollment_id uuid DEFAULT NULL
)
RETURNS TABLE (result_code varchar, participation_id uuid,
               participation_status varchar, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_context record;
    v_participation public.activity_participations%ROWTYPE;
    v_created boolean := false;
BEGIN
    SELECT run.tenant_id, run.school_id, run.classroom_id, run.source_kind,
           run.source_course_run_id, membership.user_id AS actor_user_id
      INTO v_context
      FROM public.activity_runs run
      JOIN public.classrooms classroom
        ON classroom.tenant_id = run.tenant_id AND classroom.id = run.classroom_id
       AND classroom.status = 'active'
      JOIN public.principals principal
        ON principal.id = p_actor_principal_id AND principal.kind = 'account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = run.tenant_id
       AND membership.classroom_id = run.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
     WHERE run.id = p_activity_run_id
       AND run.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    IF v_context.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.learner_identities learner
         WHERE learner.tenant_id = v_context.tenant_id
           AND learner.school_id = v_context.school_id
           AND learner.id = p_learner_identity_id AND learner.state = 'active'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.learner_identity_links link
        JOIN public.classroom_student_seats seat ON seat.id = link.seat_id
         WHERE link.tenant_id = v_context.tenant_id
           AND link.school_id = v_context.school_id
           AND link.learner_identity_id = p_learner_identity_id
           AND link.link_kind = 'student_seat' AND link.status = 'active'
           AND seat.tenant_id = v_context.tenant_id
           AND seat.classroom_id = v_context.classroom_id AND seat.status = 'active'
    ) THEN
        RETURN QUERY SELECT 'learner_not_available'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF v_context.source_kind = 'direct' AND p_source_course_enrollment_id IS NOT NULL THEN
        RETURN QUERY SELECT 'course_enrollment_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF p_source_course_enrollment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.course_enrollments enrollment
         WHERE enrollment.id = p_source_course_enrollment_id
           AND enrollment.tenant_id = v_context.tenant_id
           AND enrollment.school_id = v_context.school_id
           AND enrollment.course_run_id = v_context.source_course_run_id
           AND enrollment.learner_identity_id = p_learner_identity_id
           AND enrollment.status IN ('assigned', 'active')
    ) THEN
        RETURN QUERY SELECT 'course_enrollment_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    INSERT INTO public.activity_participations (
        tenant_id, school_id, activity_run_id, learner_identity_id,
        source_course_enrollment_id, assigned_by_principal_id
    ) VALUES (
        v_context.tenant_id, v_context.school_id, p_activity_run_id,
        p_learner_identity_id, p_source_course_enrollment_id, p_actor_principal_id
    ) ON CONFLICT (activity_run_id, learner_identity_id) DO NOTHING
    RETURNING * INTO v_participation;
    IF v_participation.id IS NOT NULL THEN
        v_created := true;
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES (v_context.tenant_id, v_context.actor_user_id,
                'activity_participation', v_participation.id,
                'participation.assigned',
                jsonb_build_object('actorPrincipalId',p_actor_principal_id,
                    'activityRunId',p_activity_run_id,
                    'learnerIdentityId',p_learner_identity_id,
                    'sourceCourseEnrollmentId',p_source_course_enrollment_id));
    ELSE
        SELECT * INTO v_participation FROM public.activity_participations participation
         WHERE participation.activity_run_id = p_activity_run_id
           AND participation.learner_identity_id = p_learner_identity_id;
        IF v_participation.source_course_enrollment_id
           IS DISTINCT FROM p_source_course_enrollment_id THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar,
                                v_participation.id, v_participation.status, true;
            RETURN;
        END IF;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar, v_participation.id,
                        v_participation.status, NOT v_created;
END;
$$;

CREATE OR REPLACE FUNCTION activity_participation_activate(
    p_actor_principal_id uuid, p_participation_id uuid
)
RETURNS TABLE (result_code varchar, participation_id uuid,
               participation_status varchar, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_participation public.activity_participations%ROWTYPE;
    v_run record;
BEGIN
    SELECT * INTO v_participation FROM public.activity_participations participation
     WHERE participation.id = p_participation_id
       AND participation.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     FOR UPDATE;
    IF v_participation.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar, false; RETURN;
    END IF;
    SELECT run.*, assignment.status AS handout_status,
           classroom.status AS classroom_status,
           course.status AS course_status
      INTO v_run FROM public.activity_runs run
      JOIN public.classrooms classroom
        ON classroom.tenant_id=run.tenant_id AND classroom.id=run.classroom_id
      JOIN public.classroom_assignments assignment
        ON assignment.id=run.source_classroom_assignment_id
      LEFT JOIN public.classroom_course_runs course
        ON course.id=run.source_course_run_id
     WHERE run.id=v_participation.activity_run_id;
    IF NOT EXISTS (
        SELECT 1 FROM public.principals principal
        JOIN public.learner_identity_links link
          ON link.tenant_id=v_participation.tenant_id
         AND link.school_id=v_participation.school_id
         AND link.learner_identity_id=v_participation.learner_identity_id
         AND link.status='active'
       WHERE principal.id=p_actor_principal_id AND (
          (principal.kind='student_seat' AND link.link_kind='student_seat'
           AND link.seat_id=principal.seat_id AND EXISTS (
             SELECT 1 FROM public.classroom_student_seats seat
              WHERE seat.id=principal.seat_id AND seat.tenant_id=v_participation.tenant_id
                AND seat.classroom_id=v_run.classroom_id AND seat.status='active'))
          OR
          (principal.kind='account' AND link.link_kind='account'
           AND link.account_id=principal.account_id AND EXISTS (
             SELECT 1 FROM public.classroom_student_seats seat
              WHERE seat.account_id=principal.account_id
                AND seat.tenant_id=v_participation.tenant_id
                AND seat.classroom_id=v_run.classroom_id AND seat.status='active'))
       )
    ) THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar, false; RETURN;
    END IF;
    IF v_participation.status='withdrawn' THEN
        RETURN QUERY SELECT 'withdrawn'::varchar, v_participation.id,
                            v_participation.status, true; RETURN;
    END IF;
    IF v_participation.status='active' THEN
        RETURN QUERY SELECT 'ok'::varchar, v_participation.id,
                            v_participation.status, true; RETURN;
    END IF;
    IF v_run.lifecycle_status<>'active' OR v_run.classroom_status<>'active'
       OR v_run.handout_status<>'open'
       OR (v_run.source_kind='course' AND v_run.course_status<>'open') THEN
        RETURN QUERY SELECT 'not_available'::varchar, v_participation.id,
                            v_participation.status, false; RETURN;
    END IF;
    IF v_participation.source_course_enrollment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.course_enrollments enrollment
         WHERE enrollment.id=v_participation.source_course_enrollment_id
           AND enrollment.status='active'
    ) THEN
        RETURN QUERY SELECT 'enrollment_not_active'::varchar, v_participation.id,
                            v_participation.status, false; RETURN;
    END IF;
    IF COALESCE(v_participation.opens_at_override,v_run.opens_at) > now()
       OR COALESCE(v_participation.closes_at_override,v_run.closes_at) < now()
       OR (COALESCE(v_participation.due_at_override,v_run.due_at) < now()
           AND (v_run.late_policy IS NULL OR v_run.late_policy='block_at_due')) THEN
        RETURN QUERY SELECT 'not_available'::varchar, v_participation.id,
                            v_participation.status, false; RETURN;
    END IF;
    UPDATE public.activity_participations participation SET
        status='active', activated_at=now(),
        activated_by_principal_id=p_actor_principal_id,
        activation_source='meaningful_learner_interaction'
     WHERE participation.id=v_participation.id RETURNING * INTO v_participation;
    INSERT INTO public.audit_events
        (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES (v_participation.tenant_id,NULL,'activity_participation',v_participation.id,
            'participation.activated',
            jsonb_build_object('actorPrincipalId',p_actor_principal_id,
                               'source','meaningful_learner_interaction'));
    RETURN QUERY SELECT 'ok'::varchar,v_participation.id,v_participation.status,false;
END;
$$;

CREATE OR REPLACE FUNCTION activity_participation_withdraw(
    p_actor_principal_id uuid, p_participation_id uuid
)
RETURNS TABLE (result_code varchar, participation_id uuid,
               participation_status varchar, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_participation public.activity_participations%ROWTYPE; v_actor_user uuid;
BEGIN
    SELECT participation.* INTO v_participation
      FROM public.activity_participations participation
      JOIN public.activity_runs run ON run.id=participation.activity_run_id
      JOIN public.principals principal ON principal.id=p_actor_principal_id
                                     AND principal.kind='account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=run.tenant_id AND membership.classroom_id=run.classroom_id
       AND membership.account_id=principal.account_id
       AND membership.member_role IN ('owner','co_teacher')
     WHERE participation.id=p_participation_id
       AND participation.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
     FOR UPDATE OF participation;
    IF v_participation.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::varchar,false; RETURN;
    END IF;
    IF v_participation.status='withdrawn' THEN
        RETURN QUERY SELECT 'ok'::varchar,v_participation.id,v_participation.status,true; RETURN;
    END IF;
    SELECT membership.user_id INTO v_actor_user
      FROM public.activity_runs run
      JOIN public.principals principal ON principal.id=p_actor_principal_id
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=run.tenant_id AND membership.classroom_id=run.classroom_id
       AND membership.account_id=principal.account_id
     WHERE run.id=v_participation.activity_run_id;
    UPDATE public.activity_participations participation SET
        status='withdrawn',withdrawn_at=now(),
        withdrawn_by_principal_id=p_actor_principal_id,withdrawal_source='teacher_command'
     WHERE participation.id=v_participation.id RETURNING * INTO v_participation;
    INSERT INTO public.audit_events
      (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES (v_participation.tenant_id,v_actor_user,'activity_participation',v_participation.id,
            'participation.withdrawn',
            jsonb_build_object('actorPrincipalId',p_actor_principal_id,'source','teacher_command'));
    RETURN QUERY SELECT 'ok'::varchar,v_participation.id,v_participation.status,false;
END;
$$;

CREATE OR REPLACE FUNCTION activity_participation_set_overrides(
    p_actor_principal_id uuid, p_participation_id uuid, p_extra_attempts integer,
    p_time_limit_override_seconds integer, p_opens_at_override timestamptz,
    p_due_at_override timestamptz, p_closes_at_override timestamptz,
    p_teacher_unlocked boolean
)
RETURNS TABLE (result_code varchar, participation_id uuid, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_participation public.activity_participations%ROWTYPE; v_actor_user uuid;
BEGIN
    IF p_extra_attempts IS NULL OR p_extra_attempts<0
       OR (p_time_limit_override_seconds IS NOT NULL AND p_time_limit_override_seconds<=0)
       OR (p_opens_at_override IS NOT NULL AND p_due_at_override IS NOT NULL
           AND p_opens_at_override>p_due_at_override)
       OR (p_due_at_override IS NOT NULL AND p_closes_at_override IS NOT NULL
           AND p_due_at_override>p_closes_at_override)
       OR (p_opens_at_override IS NOT NULL AND p_closes_at_override IS NOT NULL
           AND p_opens_at_override>p_closes_at_override) THEN
        RETURN QUERY SELECT 'invalid_overrides'::varchar,NULL::uuid,false; RETURN;
    END IF;
    SELECT participation.* INTO v_participation
      FROM public.activity_participations participation
      JOIN public.activity_runs run ON run.id=participation.activity_run_id
      JOIN public.principals principal ON principal.id=p_actor_principal_id
                                     AND principal.kind='account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=run.tenant_id AND membership.classroom_id=run.classroom_id
       AND membership.account_id=principal.account_id
       AND membership.member_role IN ('owner','co_teacher')
     WHERE participation.id=p_participation_id
       AND participation.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
     FOR UPDATE OF participation;
    IF v_participation.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,false; RETURN;
    END IF;
    SELECT membership.user_id INTO v_actor_user
      FROM public.activity_runs run
      JOIN public.principals principal ON principal.id=p_actor_principal_id
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=run.tenant_id AND membership.classroom_id=run.classroom_id
       AND membership.account_id=principal.account_id
     WHERE run.id=v_participation.activity_run_id;
    IF v_participation.extra_attempts=p_extra_attempts
       AND v_participation.time_limit_override_seconds IS NOT DISTINCT FROM p_time_limit_override_seconds
       AND v_participation.opens_at_override IS NOT DISTINCT FROM p_opens_at_override
       AND v_participation.due_at_override IS NOT DISTINCT FROM p_due_at_override
       AND v_participation.closes_at_override IS NOT DISTINCT FROM p_closes_at_override
       AND v_participation.teacher_unlocked=p_teacher_unlocked THEN
        RETURN QUERY SELECT 'ok'::varchar,v_participation.id,true; RETURN;
    END IF;
    UPDATE public.activity_participations participation SET
      extra_attempts=p_extra_attempts,
      time_limit_override_seconds=p_time_limit_override_seconds,
      opens_at_override=p_opens_at_override,due_at_override=p_due_at_override,
      closes_at_override=p_closes_at_override,teacher_unlocked=p_teacher_unlocked
     WHERE participation.id=v_participation.id;
    INSERT INTO public.audit_events
      (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES (v_participation.tenant_id,v_actor_user,'activity_participation',v_participation.id,
            'participation.override_changed',
            jsonb_build_object('actorPrincipalId',p_actor_principal_id,
              'extraAttempts',p_extra_attempts,'timeLimitOverrideSeconds',p_time_limit_override_seconds,
              'opensAtOverride',p_opens_at_override,'dueAtOverride',p_due_at_override,
              'closesAtOverride',p_closes_at_override,'teacherUnlocked',p_teacher_unlocked));
    RETURN QUERY SELECT 'ok'::varchar,v_participation.id,false;
END;
$$;

CREATE OR REPLACE FUNCTION activity_participation_excuse(
    p_actor_principal_id uuid, p_participation_id uuid, p_reason text DEFAULT NULL
)
RETURNS TABLE (result_code varchar, participation_id uuid, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_participation public.activity_participations%ROWTYPE; v_actor_user uuid;
BEGIN
    SELECT participation.* INTO v_participation
      FROM public.activity_participations participation
      JOIN public.activity_runs run ON run.id=participation.activity_run_id
      JOIN public.principals principal ON principal.id=p_actor_principal_id
                                     AND principal.kind='account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=run.tenant_id AND membership.classroom_id=run.classroom_id
       AND membership.account_id=principal.account_id
       AND membership.member_role IN ('owner','co_teacher')
     WHERE participation.id=p_participation_id
       AND participation.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
     FOR UPDATE OF participation;
    IF v_participation.id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,false; RETURN;
    END IF;
    SELECT membership.user_id INTO v_actor_user
      FROM public.activity_runs run
      JOIN public.principals principal ON principal.id=p_actor_principal_id
      JOIN public.classroom_memberships membership
        ON membership.tenant_id=run.tenant_id AND membership.classroom_id=run.classroom_id
       AND membership.account_id=principal.account_id
     WHERE run.id=v_participation.activity_run_id;
    IF v_participation.excused THEN
        RETURN QUERY SELECT 'ok'::varchar,v_participation.id,true; RETURN;
    END IF;
    UPDATE public.activity_participations participation SET
      excused=true,excused_reason=NULLIF(trim(p_reason),''),
      excused_by_principal_id=p_actor_principal_id,excused_at=now()
     WHERE participation.id=v_participation.id RETURNING * INTO v_participation;
    INSERT INTO public.audit_events
      (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES (v_participation.tenant_id,v_actor_user,'activity_participation',v_participation.id,
            'participation.excused',
            jsonb_build_object('actorPrincipalId',p_actor_principal_id,'reason',v_participation.excused_reason));
    RETURN QUERY SELECT 'ok'::varchar,v_participation.id,false;
END;
$$;

CREATE OR REPLACE FUNCTION activity_participation_completion_status(
    p_actor_principal_id uuid, p_participation_id uuid
)
RETURNS TABLE (result_code varchar, participation_id uuid,
               completion_status varchar, evidence_reason varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_allowed boolean;
BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public.activity_participations participation
      JOIN public.activity_runs run ON run.id=participation.activity_run_id
      JOIN public.principals principal ON principal.id=p_actor_principal_id
     WHERE participation.id=p_participation_id
       AND participation.tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
       AND (EXISTS (
          SELECT 1 FROM public.classroom_memberships membership
           WHERE principal.kind='account' AND membership.tenant_id=run.tenant_id
             AND membership.classroom_id=run.classroom_id
             AND membership.account_id=principal.account_id
             AND membership.member_role IN ('owner','co_teacher'))
        OR EXISTS (
          SELECT 1 FROM public.learner_identity_links link
          LEFT JOIN public.classroom_student_seats seat ON seat.id=link.seat_id
           WHERE link.tenant_id=participation.tenant_id
             AND link.school_id=participation.school_id
             AND link.learner_identity_id=participation.learner_identity_id
             AND link.status='active' AND (
               (principal.kind='student_seat' AND link.seat_id=principal.seat_id
                AND seat.classroom_id=run.classroom_id AND seat.status='active')
               OR (principal.kind='account' AND link.account_id=principal.account_id))))
    ) INTO v_allowed;
    IF NOT v_allowed THEN
      RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::varchar,NULL::varchar; RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,p_participation_id,'not_available'::varchar,
      'canonical_attempt_result_lineage_not_available'::varchar;
END;
$$;

REVOKE ALL ON FUNCTION activity_participation_assign(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_participation_activate(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_participation_withdraw(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_participation_set_overrides(uuid,uuid,integer,integer,timestamptz,timestamptz,timestamptz,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_participation_excuse(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION activity_participation_completion_status(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activity_participation_assign(uuid,uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION activity_participation_activate(uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION activity_participation_withdraw(uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION activity_participation_set_overrides(uuid,uuid,integer,integer,timestamptz,timestamptz,timestamptz,boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION activity_participation_excuse(uuid,uuid,text) TO asalab_app;
GRANT EXECUTE ON FUNCTION activity_participation_completion_status(uuid,uuid) TO asalab_app;
