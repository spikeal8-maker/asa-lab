-- E1 StudentSeat public identity hardening.
-- Public/learner surfaces must use the Account profile display name and never
-- fall back to the legacy users.email-shaped display value.

CREATE OR REPLACE FUNCTION public.classroom_teacher_public_display_name(
  p_tenant_id uuid,
  p_user_id uuid
)
RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN btrim(profile.display_name) <> ''
       AND position('@' IN profile.display_name) = 0
        THEN btrim(profile.display_name)
      ELSE NULL
    END
      FROM public.legacy_user_account_links link
      JOIN public.profiles profile ON profile.account_id = link.account_id
     WHERE link.tenant_id = p_tenant_id
       AND link.user_id = p_user_id
       AND link.migration_state = 'active'
     LIMIT 1
  ), 'Преподаватель')::varchar;
$$;
REVOKE ALL ON FUNCTION public.classroom_teacher_public_display_name(uuid,uuid)
  FROM PUBLIC, asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_public_resolve_join_code(p_token_hash varchar)
RETURNS TABLE (
  tenant_id uuid,
  classroom_id uuid,
  classroom_title varchar,
  teacher_display_name varchar,
  safe_mode_default boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT c.tenant_id,
         c.id,
         c.title,
         public.classroom_teacher_public_display_name(c.tenant_id, c.created_by),
         c.safe_mode_default
    FROM public.classroom_join_codes code
    JOIN public.classrooms c
      ON c.tenant_id = code.tenant_id AND c.id = code.classroom_id
   WHERE code.token_hash = p_token_hash
     AND code.status = 'active'
     AND c.status = 'active'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.classroom_public_resolve_join_code(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_public_resolve_join_code(varchar) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_seat_sign_in(
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
  SELECT seat.id,
         classroom.id,
         classroom.title,
         seat.display_label,
         public.classroom_teacher_public_display_name(classroom.tenant_id, classroom.created_by),
         (classroom.safe_mode_default OR seat.safe_mode),
         seat.avatar_key
    INTO v_seat_id, v_classroom_id, v_classroom_title, v_display_label,
         v_teacher_display_name, v_safe_mode, v_avatar_key
    FROM public.classroom_join_codes code
    JOIN public.classrooms classroom
      ON classroom.tenant_id = code.tenant_id AND classroom.id = code.classroom_id
    JOIN public.classroom_student_seats seat
      ON seat.tenant_id = classroom.tenant_id AND seat.classroom_id = classroom.id
   WHERE code.token_hash = p_token_hash
     AND code.status = 'active'
     AND classroom.status = 'active'
     AND seat.normalized_login_handle = lower(trim(p_login_handle))
     AND seat.status IN ('issued', 'active')
   LIMIT 1
   FOR UPDATE OF seat;
  IF v_seat_id IS NULL THEN RETURN; END IF;

  v_expires_at := now() + make_interval(hours => p_ttl_hours);
  INSERT INTO public.classroom_student_sessions(seat_id, token_hash, expires_at)
  VALUES (v_seat_id, p_session_token_hash, v_expires_at);
  UPDATE public.classroom_student_seats
     SET status = 'active', last_active_at = now(), updated_at = now()
   WHERE id = v_seat_id;

  RETURN QUERY SELECT v_seat_id, v_classroom_id, v_classroom_title,
                      v_display_label, v_teacher_display_name,
                      v_safe_mode, v_avatar_key, v_expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_sign_in(varchar,varchar,varchar,integer)
  FROM PUBLIC, asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_session_context_legacy(
  p_session_token_hash varchar
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
  v_session_id uuid;
  v_seat_id uuid;
BEGIN
  UPDATE public.classroom_student_sessions session
     SET last_seen_at = now()
   WHERE session.token_hash = p_session_token_hash
     AND session.revoked_at IS NULL
     AND session.expires_at > now()
  RETURNING session.id, session.seat_id INTO v_session_id, v_seat_id;
  IF v_session_id IS NULL THEN RETURN; END IF;

  UPDATE public.classroom_student_seats seat
     SET last_active_at = now()
   WHERE seat.id = v_seat_id
     AND (seat.last_active_at IS NULL OR seat.last_active_at < now() - interval '1 minute');

  RETURN QUERY
  SELECT seat.id,
         classroom.id,
         classroom.title,
         seat.display_label,
         public.classroom_teacher_public_display_name(classroom.tenant_id, classroom.created_by),
         (classroom.safe_mode_default OR seat.safe_mode),
         seat.avatar_key,
         session.expires_at
    FROM public.classroom_student_sessions session
    JOIN public.classroom_student_seats seat ON seat.id = session.seat_id
    JOIN public.classrooms classroom
      ON classroom.tenant_id = seat.tenant_id AND classroom.id = seat.classroom_id
   WHERE session.id = v_session_id
     AND seat.status = 'active'
     AND classroom.status = 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_session_context_legacy(varchar)
  FROM PUBLIC, asalab_app;
