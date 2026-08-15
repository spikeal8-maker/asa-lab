-- Tinkercad-like Classroom Core: durable class metadata, hashed join codes,
-- teacher-managed StudentSeats and email-free learner sessions.

ALTER TABLE classrooms
    ADD COLUMN IF NOT EXISTS age_band varchar(32) NOT NULL DEFAULT 'mixed',
    ADD COLUMN IF NOT EXISTS topic_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS safe_mode_default boolean NOT NULL DEFAULT true;

ALTER TABLE classrooms DROP CONSTRAINT IF EXISTS classrooms_age_band_check;
ALTER TABLE classrooms
    ADD CONSTRAINT classrooms_age_band_check
    CHECK (age_band IN ('6-8', '9-10', '11-12', '13-15', '16-18', 'mixed'));

CREATE TABLE IF NOT EXISTS classroom_join_codes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    classroom_id uuid NOT NULL,
    token_hash   varchar(64) NOT NULL,
    version      integer NOT NULL CHECK (version > 0),
    status       varchar(16) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'revoked')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    UNIQUE (tenant_id, classroom_id, version),
    UNIQUE (token_hash),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS classroom_join_codes_one_active_idx
    ON classroom_join_codes (tenant_id, classroom_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS classroom_student_seats (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES tenants(id),
    classroom_id            uuid NOT NULL,
    display_label           varchar(120) NOT NULL,
    login_handle            varchar(32) NOT NULL,
    normalized_login_handle varchar(32) NOT NULL,
    safe_mode               boolean NOT NULL DEFAULT true,
    status                  varchar(16) NOT NULL DEFAULT 'issued'
                            CHECK (status IN ('issued', 'active', 'suspended', 'removed')),
    last_active_at          timestamptz,
    created_by              uuid NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, classroom_id, normalized_login_handle),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS classroom_student_seats_roster_idx
    ON classroom_student_seats (tenant_id, classroom_id, status, display_label);

CREATE TABLE IF NOT EXISTS classroom_student_sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seat_id      uuid NOT NULL REFERENCES classroom_student_seats(id),
    token_hash   varchar(64) NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS classroom_student_sessions_active_idx
    ON classroom_student_sessions (seat_id, expires_at) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT ON classroom_join_codes TO asalab_app;
GRANT SELECT ON classroom_student_seats TO asalab_app;

ALTER TABLE classroom_join_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_join_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_student_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_student_seats FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classroom_join_codes_tenant ON classroom_join_codes;
CREATE POLICY classroom_join_codes_tenant ON classroom_join_codes
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS classroom_student_seats_tenant ON classroom_student_seats;
CREATE POLICY classroom_student_seats_tenant ON classroom_student_seats
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION classroom_teacher_summary(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    title varchar,
    status varchar,
    age_band varchar,
    topic_keys text[],
    safe_mode_default boolean,
    created_at timestamptz,
    join_code_version integer,
    join_code_status varchar,
    student_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, jc.version, jc.status,
           count(s.id) FILTER (WHERE s.status <> 'removed')::integer
      FROM public.classrooms c
      JOIN public.classroom_memberships owner_membership
        ON owner_membership.tenant_id = c.tenant_id
       AND owner_membership.classroom_id = c.id
       AND owner_membership.user_id = p_teacher_user_id
       AND owner_membership.member_role = 'owner'
      LEFT JOIN LATERAL (
          SELECT code.version, code.status
            FROM public.classroom_join_codes code
           WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
           ORDER BY code.version DESC
           LIMIT 1
      ) jc ON true
      LEFT JOIN public.classroom_student_seats s
        ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
     WHERE c.tenant_id = p_tenant_id AND c.id = p_classroom_id
     GROUP BY c.id, jc.version, jc.status;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_roster(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    display_label varchar,
    login_handle varchar,
    safe_mode boolean,
    status varchar,
    last_active_at timestamptz,
    created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s
     WHERE s.tenant_id = p_tenant_id
       AND s.classroom_id = p_classroom_id
       AND s.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.tenant_id = p_tenant_id
              AND m.classroom_id = p_classroom_id
              AND m.user_id = p_teacher_user_id
              AND m.member_role = 'owner')
     ORDER BY lower(s.display_label), s.id;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_add_seat(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid,
    p_display_label varchar,
    p_login_handle varchar,
    p_safe_mode boolean
)
RETURNS TABLE (
    id uuid,
    display_label varchar,
    login_handle varchar,
    safe_mode boolean,
    status varchar,
    last_active_at timestamptz,
    created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.tenant_id = p_tenant_id
           AND m.classroom_id = p_classroom_id
           AND m.user_id = p_teacher_user_id
           AND m.member_role = 'owner')
    THEN
        RAISE EXCEPTION 'classroom unavailable';
    END IF;

    INSERT INTO public.classroom_student_seats
        (tenant_id, classroom_id, display_label, login_handle,
         normalized_login_handle, safe_mode, created_by)
    VALUES
        (p_tenant_id, p_classroom_id, trim(p_display_label), lower(trim(p_login_handle)),
         lower(trim(p_login_handle)), p_safe_mode, p_teacher_user_id)
    RETURNING classroom_student_seats.id INTO v_id;

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (p_tenant_id, p_teacher_user_id, 'student_seat', v_id,
         'classroom.student_seat_created',
         jsonb_build_object('classroomId', p_classroom_id,
                            'safeMode', p_safe_mode));

    RETURN QUERY
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s WHERE s.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_update_seat(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid,
    p_display_label varchar,
    p_login_handle varchar,
    p_safe_mode boolean,
    p_status varchar
)
RETURNS TABLE (
    id uuid,
    display_label varchar,
    login_handle varchar,
    safe_mode boolean,
    status varchar,
    last_active_at timestamptz,
    created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer := 0;
BEGIN
    IF p_status NOT IN ('issued', 'active', 'suspended') THEN
        RAISE EXCEPTION 'invalid seat status';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.tenant_id = p_tenant_id
           AND m.classroom_id = p_classroom_id
           AND m.user_id = p_teacher_user_id
           AND m.member_role = 'owner')
    THEN
        RAISE EXCEPTION 'classroom unavailable';
    END IF;

    UPDATE public.classroom_student_seats s
       SET display_label = trim(p_display_label),
           login_handle = lower(trim(p_login_handle)),
           normalized_login_handle = lower(trim(p_login_handle)),
           safe_mode = p_safe_mode,
           status = p_status,
           updated_at = now()
     WHERE s.tenant_id = p_tenant_id
       AND s.classroom_id = p_classroom_id
       AND s.id = p_seat_id
       AND s.status <> 'removed';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'student seat unavailable'; END IF;

    IF p_status = 'suspended' THEN
        UPDATE public.classroom_student_sessions ss
           SET revoked_at = now()
          FROM public.classroom_student_seats s
         WHERE ss.seat_id = s.id AND s.id = p_seat_id AND ss.revoked_at IS NULL;
    END IF;

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (p_tenant_id, p_teacher_user_id, 'student_seat', p_seat_id,
         'classroom.student_seat_updated',
         jsonb_build_object('classroomId', p_classroom_id,
                            'safeMode', p_safe_mode, 'status', p_status));

    RETURN QUERY
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s WHERE s.id = p_seat_id;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_remove_seat(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.tenant_id = p_tenant_id
           AND m.classroom_id = p_classroom_id
           AND m.user_id = p_teacher_user_id
           AND m.member_role = 'owner')
    THEN
        RAISE EXCEPTION 'classroom unavailable';
    END IF;

    UPDATE public.classroom_student_seats s
       SET status = 'removed', updated_at = now()
     WHERE s.tenant_id = p_tenant_id
       AND s.classroom_id = p_classroom_id
       AND s.id = p_seat_id
       AND s.status <> 'removed';
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    UPDATE public.classroom_student_sessions ss
       SET revoked_at = now()
      FROM public.classroom_student_seats s
     WHERE ss.seat_id = s.id AND s.id = p_seat_id AND ss.revoked_at IS NULL;

    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (p_tenant_id, p_teacher_user_id, 'student_seat', p_seat_id,
             'classroom.student_seat_removed',
             jsonb_build_object('classroomId', p_classroom_id));
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_rotate_join_code(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid,
    p_token_hash varchar,
    p_version integer
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.tenant_id = p_tenant_id
           AND m.classroom_id = p_classroom_id
           AND m.user_id = p_teacher_user_id
           AND m.member_role = 'owner')
    THEN
        RAISE EXCEPTION 'classroom unavailable';
    END IF;

    UPDATE public.classroom_join_codes
       SET status = 'revoked', revoked_at = now()
     WHERE tenant_id = p_tenant_id AND classroom_id = p_classroom_id
       AND status = 'active';
    INSERT INTO public.classroom_join_codes
        (tenant_id, classroom_id, token_hash, version, status)
    VALUES (p_tenant_id, p_classroom_id, p_token_hash, p_version, 'active');
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (p_tenant_id, p_teacher_user_id, 'classroom', p_classroom_id,
         'classroom.join_code_rotated', jsonb_build_object('version', p_version));
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_update_policy(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid,
    p_safe_mode_default boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.tenant_id = p_tenant_id
           AND m.classroom_id = p_classroom_id
           AND m.user_id = p_teacher_user_id
           AND m.member_role = 'owner')
    THEN
        RAISE EXCEPTION 'classroom unavailable';
    END IF;
    UPDATE public.classrooms
       SET safe_mode_default = p_safe_mode_default
     WHERE tenant_id = p_tenant_id AND id = p_classroom_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (p_tenant_id, p_teacher_user_id, 'classroom', p_classroom_id,
             'classroom.safe_mode_updated',
             jsonb_build_object('safeModeDefault', p_safe_mode_default));
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_revoke_join_code(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_classroom_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.tenant_id = p_tenant_id
           AND m.classroom_id = p_classroom_id
           AND m.user_id = p_teacher_user_id
           AND m.member_role = 'owner')
    THEN
        RAISE EXCEPTION 'classroom unavailable';
    END IF;
    UPDATE public.classroom_join_codes
       SET status = 'revoked', revoked_at = now()
     WHERE tenant_id = p_tenant_id AND classroom_id = p_classroom_id
       AND status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (p_tenant_id, p_teacher_user_id, 'classroom', p_classroom_id,
             'classroom.join_code_revoked', '{}'::jsonb);
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_public_resolve_join_code(p_token_hash varchar)
RETURNS TABLE (
    tenant_id uuid,
    classroom_id uuid,
    classroom_title varchar,
    teacher_display_name varchar,
    safe_mode_default boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.tenant_id, c.id, c.title, u.display_name, c.safe_mode_default
      FROM public.classroom_join_codes jc
      JOIN public.classrooms c
        ON c.tenant_id = jc.tenant_id AND c.id = jc.classroom_id
      JOIN public.users u
        ON u.tenant_id = c.tenant_id AND u.id = c.created_by
     WHERE jc.token_hash = p_token_hash
       AND jc.status = 'active'
       AND c.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION classroom_student_seat_sign_in(
    p_token_hash varchar,
    p_login_handle varchar,
    p_session_token_hash varchar,
    p_ttl_hours integer
)
RETURNS TABLE (
    seat_id uuid,
    classroom_id uuid,
    classroom_title varchar,
    display_label varchar,
    teacher_display_name varchar,
    safe_mode boolean,
    expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_seat_id uuid;
    v_classroom_id uuid;
    v_classroom_title varchar;
    v_display_label varchar;
    v_teacher_display_name varchar;
    v_safe_mode boolean;
    v_expires_at timestamptz;
BEGIN
    SELECT s.id, c.id, c.title, s.display_label, u.display_name,
           (c.safe_mode_default OR s.safe_mode)
      INTO v_seat_id, v_classroom_id, v_classroom_title, v_display_label,
           v_teacher_display_name, v_safe_mode
      FROM public.classroom_join_codes jc
      JOIN public.classrooms c
        ON c.tenant_id = jc.tenant_id AND c.id = jc.classroom_id
      JOIN public.users u
        ON u.tenant_id = c.tenant_id AND u.id = c.created_by
      JOIN public.classroom_student_seats s
        ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
     WHERE jc.token_hash = p_token_hash
       AND jc.status = 'active'
       AND c.status = 'active'
       AND s.normalized_login_handle = lower(trim(p_login_handle))
       AND s.status IN ('issued', 'active')
     LIMIT 1
     FOR UPDATE OF s;
    IF v_seat_id IS NULL THEN RETURN; END IF;

    v_expires_at := now() + make_interval(hours => p_ttl_hours);
    INSERT INTO public.classroom_student_sessions
        (seat_id, token_hash, expires_at)
    VALUES (v_seat_id, p_session_token_hash, v_expires_at);
    UPDATE public.classroom_student_seats
       SET status = 'active', last_active_at = now(), updated_at = now()
     WHERE id = v_seat_id;

    RETURN QUERY SELECT v_seat_id, v_classroom_id, v_classroom_title,
                        v_display_label, v_teacher_display_name,
                        v_safe_mode, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_student_session_context(p_session_token_hash varchar)
RETURNS TABLE (
    seat_id uuid,
    classroom_id uuid,
    classroom_title varchar,
    display_label varchar,
    teacher_display_name varchar,
    safe_mode boolean,
    expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session_id uuid;
BEGIN
    UPDATE public.classroom_student_sessions ss
       SET last_seen_at = now()
     WHERE ss.token_hash = p_session_token_hash
       AND ss.revoked_at IS NULL
       AND ss.expires_at > now()
    RETURNING ss.id INTO v_session_id;
    IF v_session_id IS NULL THEN RETURN; END IF;

    RETURN QUERY
    SELECT s.id, c.id, c.title, s.display_label, u.display_name,
           (c.safe_mode_default OR s.safe_mode), ss.expires_at
      FROM public.classroom_student_sessions ss
      JOIN public.classroom_student_seats s ON s.id = ss.seat_id
      JOIN public.classrooms c
        ON c.tenant_id = s.tenant_id AND c.id = s.classroom_id
      JOIN public.users u
        ON u.tenant_id = c.tenant_id AND u.id = c.created_by
     WHERE ss.id = v_session_id
       AND s.status = 'active'
       AND c.status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION classroom_student_session_revoke(p_session_token_hash varchar)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.classroom_student_sessions
       SET revoked_at = now()
     WHERE token_hash = p_session_token_hash AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION classroom_teacher_summary(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_roster(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_add_seat(uuid, uuid, uuid, varchar, varchar, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_update_seat(uuid, uuid, uuid, uuid, varchar, varchar, boolean, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_remove_seat(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_rotate_join_code(uuid, uuid, uuid, varchar, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_update_policy(uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_revoke_join_code(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_public_resolve_join_code(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_student_seat_sign_in(varchar, varchar, varchar, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_student_session_context(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_student_session_revoke(varchar) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_teacher_summary(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_roster(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_add_seat(uuid, uuid, uuid, varchar, varchar, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_update_seat(uuid, uuid, uuid, uuid, varchar, varchar, boolean, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_remove_seat(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_rotate_join_code(uuid, uuid, uuid, varchar, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_update_policy(uuid, uuid, uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_revoke_join_code(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_public_resolve_join_code(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_student_seat_sign_in(varchar, varchar, varchar, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_student_session_context(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_student_session_revoke(varchar) TO asalab_app;
