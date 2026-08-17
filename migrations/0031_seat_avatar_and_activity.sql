-- A learner has a face, and a register that tells the truth about when they
-- were here.
--
-- Two things were wrong, and both are about a class seat being a person rather
-- than a row. First, the seat's last activity was written once, at sign-in, and
-- never again: a child who typed the code at nine and worked until eleven was
-- reported to their teacher as last seen at nine. The session row was being
-- touched on every request all along; the seat was not.
--
-- Second, a seat had no picture. Every account gets one from the built-in set;
-- a learner got a grey letter. The picture is now a property of the seat, which
-- both the teacher and the learner can change — and when it has never been
-- chosen, the client draws one from the same set, keyed by the seat, so a class
-- of thirty looks like thirty people from the first minute.

ALTER TABLE classroom_student_seats
    ADD COLUMN IF NOT EXISTS avatar_key varchar(48);

-- Only names from the built-in set. A seat picks a picture, it does not upload
-- one: children in a class do not need a way to publish a photograph of
-- themselves, and safe mode would have to police it if they did.
ALTER TABLE classroom_student_seats DROP CONSTRAINT IF EXISTS classroom_student_seats_avatar_key_check;
ALTER TABLE classroom_student_seats
    ADD CONSTRAINT classroom_student_seats_avatar_key_check
    CHECK (avatar_key IS NULL OR avatar_key ~ '^asa-avatar-[0-9]{2}$');

-- ── The seat's own clock ────────────────────────────────────────────────────
--
-- Every request a learner makes passes through here, so the seat is refreshed
-- from the same place the session is. The write is skipped unless the stored
-- value is a minute old: a register accurate to the minute is accurate enough
-- for a teacher walking between desks, and this runs on every poll.
DROP FUNCTION IF EXISTS classroom_student_session_context(varchar);
CREATE OR REPLACE FUNCTION classroom_student_session_context(p_session_token_hash varchar)
RETURNS TABLE (
    seat_id uuid,
    classroom_id uuid,
    classroom_title varchar,
    display_label varchar,
    teacher_display_name varchar,
    safe_mode boolean,
    avatar_key varchar,
    expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session_id uuid;
    v_seat_id uuid;
BEGIN
    UPDATE public.classroom_student_sessions ss
       SET last_seen_at = now()
     WHERE ss.token_hash = p_session_token_hash
       AND ss.revoked_at IS NULL
       AND ss.expires_at > now()
    RETURNING ss.id, ss.seat_id INTO v_session_id, v_seat_id;
    IF v_session_id IS NULL THEN RETURN; END IF;

    UPDATE public.classroom_student_seats s
       SET last_active_at = now()
     WHERE s.id = v_seat_id
       AND (s.last_active_at IS NULL OR s.last_active_at < now() - interval '1 minute');

    RETURN QUERY
    SELECT s.id, c.id, c.title, s.display_label, u.display_name,
           (c.safe_mode_default OR s.safe_mode), s.avatar_key, ss.expires_at
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

-- ── The picture, everywhere a seat is read ──────────────────────────────────

-- Sign-in carries it too, so a learner sees their own face on the first screen
-- rather than a stand-in that changes when the page is next loaded.
DROP FUNCTION IF EXISTS classroom_student_seat_sign_in(varchar, varchar, varchar, integer);
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
    avatar_key varchar,
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
    v_avatar_key varchar;
    v_expires_at timestamptz;
BEGIN
    SELECT s.id, c.id, c.title, s.display_label, u.display_name,
           (c.safe_mode_default OR s.safe_mode), s.avatar_key
      INTO v_seat_id, v_classroom_id, v_classroom_title, v_display_label,
           v_teacher_display_name, v_safe_mode, v_avatar_key
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
                        v_safe_mode, v_avatar_key, v_expires_at;
END;
$$;

DROP FUNCTION IF EXISTS classroom_management_roster(uuid, uuid);
CREATE OR REPLACE FUNCTION classroom_management_roster(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    display_label varchar,
    login_handle varchar,
    safe_mode boolean,
    status varchar,
    avatar_key varchar,
    last_active_at timestamptz,
    created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status, s.avatar_key,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s
     WHERE s.classroom_id = p_classroom_id
       AND s.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = s.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY lower(s.display_label), s.id;
$$;

DROP FUNCTION IF EXISTS classroom_management_add_seat(uuid, uuid, varchar, varchar, boolean);
CREATE OR REPLACE FUNCTION classroom_management_add_seat(
    p_account_id uuid,
    p_classroom_id uuid,
    p_display_label varchar,
    p_login_handle varchar,
    p_safe_mode boolean
)
RETURNS TABLE (
    id uuid, display_label varchar, login_handle varchar, safe_mode boolean,
    status varchar, avatar_key varchar, last_active_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_seat_id uuid;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    INSERT INTO public.classroom_student_seats
        (tenant_id, classroom_id, display_label, login_handle,
         normalized_login_handle, safe_mode, created_by)
    VALUES
        (v_access.tenant_id, p_classroom_id, trim(p_display_label), lower(trim(p_login_handle)),
         lower(trim(p_login_handle)), p_safe_mode, v_access.user_id)
    RETURNING classroom_student_seats.id INTO v_seat_id;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'student_seat', v_seat_id,
         'classroom.student_seat_created',
         jsonb_build_object('classroomId', p_classroom_id, 'safeMode', p_safe_mode,
                            'teacherRole', v_access.teacher_role));
    RETURN QUERY
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status, s.avatar_key,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s WHERE s.id = v_seat_id;
END;
$$;

DROP FUNCTION IF EXISTS classroom_management_update_seat(uuid, uuid, uuid, varchar, varchar, boolean, varchar);
CREATE OR REPLACE FUNCTION classroom_management_update_seat(
    p_account_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid,
    p_display_label varchar,
    p_login_handle varchar,
    p_safe_mode boolean,
    p_status varchar,
    p_avatar_key varchar
)
RETURNS TABLE (
    id uuid, display_label varchar, login_handle varchar, safe_mode boolean,
    status varchar, avatar_key varchar, last_active_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_updated integer := 0;
BEGIN
    IF p_status NOT IN ('issued', 'active', 'suspended') THEN RAISE EXCEPTION 'invalid seat status'; END IF;
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classroom_student_seats s
       SET display_label = trim(p_display_label),
           login_handle = lower(trim(p_login_handle)),
           normalized_login_handle = lower(trim(p_login_handle)),
           safe_mode = p_safe_mode, status = p_status,
           avatar_key = p_avatar_key, updated_at = now()
     WHERE s.tenant_id = v_access.tenant_id
       AND s.classroom_id = p_classroom_id
       AND s.id = p_seat_id AND s.status <> 'removed';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'student seat unavailable'; END IF;
    IF p_status = 'suspended' THEN
        UPDATE public.classroom_student_sessions ss SET revoked_at = now()
          FROM public.classroom_student_seats s
         WHERE ss.seat_id = s.id AND s.id = p_seat_id AND ss.revoked_at IS NULL;
    END IF;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'student_seat', p_seat_id,
         'classroom.student_seat_updated',
         jsonb_build_object('classroomId', p_classroom_id, 'safeMode', p_safe_mode,
                            'status', p_status, 'avatarKey', p_avatar_key,
                            'teacherRole', v_access.teacher_role));
    RETURN QUERY
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status, s.avatar_key,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s WHERE s.id = p_seat_id;
END;
$$;

-- The learner choosing their own. Reached with a seat session rather than a
-- teacher's account, so the seat proves itself: no account id is involved and
-- nothing outside this one row can be touched.
CREATE OR REPLACE FUNCTION classroom_seat_avatar_set(
    p_seat_id uuid,
    p_avatar_key varchar
)
RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_classroom uuid;
BEGIN
    UPDATE public.classroom_student_seats s
       SET avatar_key = p_avatar_key, updated_at = now()
     WHERE s.id = p_seat_id AND s.status = 'active'
    RETURNING s.tenant_id, s.classroom_id INTO v_tenant, v_classroom;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_tenant, NULL, 'student_seat', p_seat_id, 'classroom.student_seat_avatar_changed',
         jsonb_build_object('classroomId', v_classroom, 'avatarKey', p_avatar_key));
    RETURN p_avatar_key;
END;
$$;

REVOKE ALL ON FUNCTION classroom_student_seat_sign_in(varchar, varchar, varchar, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_student_session_context(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_roster(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_add_seat(uuid, uuid, varchar, varchar, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_update_seat(uuid, uuid, uuid, varchar, varchar, boolean, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_avatar_set(uuid, varchar) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_student_seat_sign_in(varchar, varchar, varchar, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_student_session_context(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_roster(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_add_seat(uuid, uuid, varchar, varchar, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_update_seat(uuid, uuid, uuid, varchar, varchar, boolean, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_avatar_set(uuid, varchar) TO asalab_app;
