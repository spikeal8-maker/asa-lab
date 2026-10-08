-- Learning A6-01: scheduled class sessions and attendance foundation.
--
-- A ClassSession is a concrete conducted/scheduled lesson inside one classroom.
-- It inherits school and academic-period lineage from that classroom. Attendance
-- is keyed by canonical learner_identity so Account and StudentSeat learners use
-- one history. Runtime access is function-only; direct table grants stay closed.

CREATE TABLE class_sessions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    school_id             uuid NOT NULL,
    academic_period_id    uuid NOT NULL,
    classroom_id          uuid NOT NULL,
    created_by_account_id uuid NOT NULL REFERENCES accounts(id),
    topic                 varchar(255) NOT NULL,
    agenda                text,
    starts_at             timestamptz NOT NULL,
    ends_at               timestamptz NOT NULL,
    school_timezone       varchar(64) NOT NULL,
    status                varchar(16) NOT NULL DEFAULT 'planned',
    started_at            timestamptz,
    completed_at          timestamptz,
    cancelled_at          timestamptz,
    idempotency_key       varchar(128) NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, school_id, id),
    UNIQUE (classroom_id, idempotency_key),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools(tenant_id, id),
    FOREIGN KEY (tenant_id, academic_period_id) REFERENCES academic_periods(tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms(tenant_id, id),
    CONSTRAINT class_sessions_time_check CHECK (ends_at > starts_at),
    CONSTRAINT class_sessions_topic_check CHECK (length(trim(topic)) BETWEEN 1 AND 255),
    CONSTRAINT class_sessions_timezone_check CHECK (length(trim(school_timezone)) BETWEEN 1 AND 64),
    CONSTRAINT class_sessions_status_check CHECK (status IN ('planned','live','completed','cancelled')),
    CONSTRAINT class_sessions_lifecycle_check CHECK (
        (status = 'planned' AND started_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL)
        OR (status = 'live' AND started_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL)
        OR (status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
    )
);
CREATE INDEX class_sessions_classroom_time_idx
    ON class_sessions(tenant_id, classroom_id, starts_at, id);

CREATE TABLE class_session_activity_versions (
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    school_id          uuid NOT NULL,
    class_session_id   uuid NOT NULL,
    activity_version_id uuid NOT NULL REFERENCES learning_activity_versions(id),
    position           integer NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (class_session_id, activity_version_id),
    UNIQUE (class_session_id, position),
    FOREIGN KEY (tenant_id, school_id, class_session_id)
        REFERENCES class_sessions(tenant_id, school_id, id),
    CONSTRAINT class_session_activity_position_check CHECK (position > 0)
);

CREATE TABLE class_session_attendance (
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    school_id             uuid NOT NULL,
    class_session_id      uuid NOT NULL,
    learner_identity_id   uuid NOT NULL,
    attendance_state      varchar(16) NOT NULL,
    note                  varchar(1000),
    marked_by_account_id  uuid NOT NULL REFERENCES accounts(id),
    marked_at             timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (class_session_id, learner_identity_id),
    FOREIGN KEY (tenant_id, school_id, class_session_id)
        REFERENCES class_sessions(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    CONSTRAINT class_session_attendance_state_check
        CHECK (attendance_state IN ('present','absent','late','excused')),
    CONSTRAINT class_session_attendance_note_check
        CHECK (note IS NULL OR length(note) <= 1000)
);
CREATE INDEX class_session_attendance_learner_idx
    ON class_session_attendance(tenant_id, school_id, learner_identity_id, marked_at DESC);

REVOKE ALL ON class_sessions, class_session_activity_versions, class_session_attendance
    FROM PUBLIC, asalab_app;
ALTER TABLE class_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE class_session_activity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_session_activity_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE class_session_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_session_attendance FORCE ROW LEVEL SECURITY;

CREATE POLICY class_sessions_tenant ON class_sessions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY class_session_activity_versions_tenant ON class_session_activity_versions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY class_session_attendance_tenant ON class_session_attendance
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION class_session_create(
    p_account uuid,
    p_classroom uuid,
    p_topic varchar,
    p_agenda text,
    p_starts_at timestamptz,
    p_ends_at timestamptz,
    p_school_timezone varchar,
    p_idempotency_key varchar
) RETURNS TABLE(result_code varchar, class_session_id uuid, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_class record;
    v_existing uuid;
    v_session uuid;
BEGIN
    IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at
       OR NULLIF(trim(p_topic), '') IS NULL OR length(trim(p_topic)) > 255
       OR NULLIF(trim(p_school_timezone), '') IS NULL OR length(trim(p_school_timezone)) > 64
       OR NULLIF(trim(p_idempotency_key), '') IS NULL OR length(p_idempotency_key) > 128
       OR length(COALESCE(p_agenda, '')) > 20000 THEN
        RETURN QUERY SELECT 'invalid_request'::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    SELECT c.tenant_id, c.school_id, c.academic_period_id, access.user_id
      INTO v_class
      FROM public.classrooms c
      CROSS JOIN LATERAL public.classroom_teacher_access(p_account, c.id) access
      JOIN public.accounts account ON account.id = p_account AND account.status = 'active'
     WHERE c.id = p_classroom
       AND c.status = 'active'
       AND access.tenant_id = c.tenant_id
       AND EXISTS (
           SELECT 1 FROM public.capability_grants grant_row
            WHERE grant_row.account_id = p_account
              AND grant_row.capability = 'educator'
              AND grant_row.state IN ('provisional','verified')
       );
    IF v_class.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'classroom_not_found'::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_classroom::text || ':' || p_idempotency_key, 1400));
    SELECT session.id INTO v_existing
      FROM public.class_sessions session
     WHERE session.classroom_id = p_classroom
       AND session.idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing, true;
        RETURN;
    END IF;

    INSERT INTO public.class_sessions(
        tenant_id, school_id, academic_period_id, classroom_id,
        created_by_account_id, topic, agenda, starts_at, ends_at,
        school_timezone, idempotency_key
    ) VALUES (
        v_class.tenant_id, v_class.school_id, v_class.academic_period_id, p_classroom,
        p_account, trim(p_topic), NULLIF(trim(COALESCE(p_agenda, '')), ''),
        p_starts_at, p_ends_at, trim(p_school_timezone), p_idempotency_key
    ) RETURNING id INTO v_session;

    INSERT INTO public.audit_events(tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES (
        v_class.tenant_id, v_class.user_id, 'class_session', v_session, 'class_session.created',
        jsonb_build_object('classroomId', p_classroom, 'startsAt', p_starts_at,
                           'endsAt', p_ends_at, 'timezone', trim(p_school_timezone))
    );
    RETURN QUERY SELECT 'ok'::varchar, v_session, false;
END;
$$;

CREATE OR REPLACE FUNCTION class_session_transition(
    p_account uuid,
    p_class_session uuid,
    p_target_status varchar
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session record;
    v_user uuid;
BEGIN
    SELECT session.*, access.user_id
      INTO v_session
      FROM public.class_sessions session
      JOIN public.classrooms classroom ON classroom.tenant_id = session.tenant_id AND classroom.id = session.classroom_id
      CROSS JOIN LATERAL public.classroom_teacher_access(p_account, classroom.id) access
     WHERE session.id = p_class_session
       AND classroom.status = 'active'
       AND access.tenant_id = session.tenant_id
     FOR UPDATE OF session;
    IF v_session.id IS NULL THEN RETURN 'not_found'; END IF;
    v_user := v_session.user_id;

    IF (v_session.status = 'planned' AND p_target_status = 'live') THEN
        UPDATE public.class_sessions SET status='live',started_at=now(),updated_at=now() WHERE id=p_class_session;
    ELSIF (v_session.status = 'live' AND p_target_status = 'completed') THEN
        UPDATE public.class_sessions SET status='completed',completed_at=now(),updated_at=now() WHERE id=p_class_session;
    ELSIF (v_session.status IN ('planned','live') AND p_target_status = 'cancelled') THEN
        UPDATE public.class_sessions SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE id=p_class_session;
    ELSIF v_session.status = p_target_status THEN
        RETURN 'ok';
    ELSE
        RETURN 'invalid_transition';
    END IF;

    INSERT INTO public.audit_events(tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES (v_session.tenant_id, v_user, 'class_session', p_class_session, 'class_session.status_changed',
            jsonb_build_object('from', v_session.status, 'to', p_target_status));
    RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION class_session_activity_attach(
    p_account uuid,
    p_class_session uuid,
    p_activity_version uuid,
    p_position integer
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session record;
BEGIN
    IF p_position IS NULL OR p_position < 1 THEN RETURN 'invalid_request'; END IF;
    SELECT session.* INTO v_session
      FROM public.class_sessions session
      JOIN public.classrooms classroom ON classroom.tenant_id=session.tenant_id AND classroom.id=session.classroom_id
      CROSS JOIN LATERAL public.classroom_teacher_access(p_account,classroom.id) access
     WHERE session.id=p_class_session AND classroom.status='active' AND access.tenant_id=session.tenant_id;
    IF v_session.id IS NULL THEN RETURN 'not_found'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.learning_activity_versions version
         WHERE version.id=p_activity_version AND version.tenant_id=v_session.tenant_id
    ) THEN RETURN 'activity_not_found'; END IF;
    INSERT INTO public.class_session_activity_versions(tenant_id,school_id,class_session_id,activity_version_id,position)
    VALUES(v_session.tenant_id,v_session.school_id,p_class_session,p_activity_version,p_position)
    ON CONFLICT(class_session_id,activity_version_id) DO UPDATE SET position=excluded.position;
    RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION class_session_attendance_mark(
    p_account uuid,
    p_class_session uuid,
    p_learner_identity uuid,
    p_attendance_state varchar,
    p_note varchar
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session record;
    v_user uuid;
    v_previous varchar;
BEGIN
    IF p_attendance_state NOT IN ('present','absent','late','excused')
       OR length(COALESCE(p_note,'')) > 1000 THEN RETURN 'invalid_request'; END IF;
    SELECT session.*, access.user_id INTO v_session
      FROM public.class_sessions session
      JOIN public.classrooms classroom ON classroom.tenant_id=session.tenant_id AND classroom.id=session.classroom_id
      CROSS JOIN LATERAL public.classroom_teacher_access(p_account,classroom.id) access
     WHERE session.id=p_class_session AND classroom.status='active' AND access.tenant_id=session.tenant_id;
    IF v_session.id IS NULL THEN RETURN 'not_found'; END IF;
    v_user := v_session.user_id;
    IF v_session.status = 'cancelled' THEN RETURN 'session_cancelled'; END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.learner_identity_links link
          JOIN public.classroom_student_seats seat ON seat.id=link.seat_id
         WHERE link.tenant_id=v_session.tenant_id
           AND link.school_id=v_session.school_id
           AND link.learner_identity_id=p_learner_identity
           AND link.status='active'
           AND link.link_kind='student_seat'
           AND seat.classroom_id=v_session.classroom_id
           AND seat.status <> 'removed'
    ) THEN RETURN 'learner_not_in_class'; END IF;

    SELECT attendance.attendance_state INTO v_previous
      FROM public.class_session_attendance attendance
     WHERE attendance.class_session_id=p_class_session
       AND attendance.learner_identity_id=p_learner_identity;

    INSERT INTO public.class_session_attendance(
        tenant_id,school_id,class_session_id,learner_identity_id,attendance_state,
        note,marked_by_account_id,marked_at,updated_at
    ) VALUES (
        v_session.tenant_id,v_session.school_id,p_class_session,p_learner_identity,
        p_attendance_state,NULLIF(trim(COALESCE(p_note,'')),''),p_account,now(),now()
    ) ON CONFLICT(class_session_id,learner_identity_id) DO UPDATE SET
        attendance_state=excluded.attendance_state,note=excluded.note,
        marked_by_account_id=excluded.marked_by_account_id,marked_at=now(),updated_at=now();

    INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES(v_session.tenant_id,v_user,'class_session_attendance',p_learner_identity,'class_session.attendance_marked',
      jsonb_build_object('classSessionId',p_class_session,'from',v_previous,'to',p_attendance_state));
    RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION class_sessions_for_teacher(p_account uuid,p_classroom uuid)
RETURNS TABLE(
    id uuid,topic varchar,agenda text,starts_at timestamptz,ends_at timestamptz,
    school_timezone varchar,status varchar,started_at timestamptz,
    completed_at timestamptz,cancelled_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT session.id,session.topic,session.agenda,session.starts_at,session.ends_at,
           session.school_timezone,session.status,session.started_at,
           session.completed_at,session.cancelled_at
      FROM public.class_sessions session
      JOIN public.classrooms classroom ON classroom.tenant_id=session.tenant_id AND classroom.id=session.classroom_id
      CROSS JOIN LATERAL public.classroom_teacher_access_any(p_account,classroom.id) access
     WHERE classroom.id=p_classroom AND access.tenant_id=session.tenant_id
     ORDER BY session.starts_at DESC,session.id;
$$;

REVOKE ALL ON FUNCTION class_session_create(uuid,uuid,varchar,text,timestamptz,timestamptz,varchar,varchar),
    class_session_transition(uuid,uuid,varchar),class_session_activity_attach(uuid,uuid,uuid,integer),
    class_session_attendance_mark(uuid,uuid,uuid,varchar,varchar),class_sessions_for_teacher(uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION class_session_create(uuid,uuid,varchar,text,timestamptz,timestamptz,varchar,varchar),
    class_session_transition(uuid,uuid,varchar),class_session_activity_attach(uuid,uuid,uuid,integer),
    class_session_attendance_mark(uuid,uuid,uuid,varchar,varchar),class_sessions_for_teacher(uuid,uuid)
    TO asalab_app;
