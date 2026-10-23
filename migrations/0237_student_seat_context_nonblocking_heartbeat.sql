-- Seat authority is a current read, not an activity write. Concurrent requests
-- must not queue behind optional activity timestamps (incident 2026-10-23).
-- This replaces only the public entry point; the historical helper remains
-- private, and no credentials, session expiry or learner identifiers change.
CREATE OR REPLACE FUNCTION public.classroom_student_session_context(p_token_hash varchar)
RETURNS TABLE (
    seat_id uuid, classroom_id uuid, classroom_title varchar, display_label varchar,
    teacher_display_name varchar, safe_mode boolean, avatar_key varchar, expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_context record;
BEGIN
    -- Credential version and idle timeout belong in this same authority snapshot,
    -- alongside revocation, absolute expiry and both active-state checks.
    SELECT session.id AS session_id, seat.id AS seat_id, classroom.id AS classroom_id,
           classroom.title AS classroom_title, seat.display_label,
           public.classroom_teacher_public_display_name(classroom.tenant_id, classroom.created_by)
               AS teacher_display_name,
           (classroom.safe_mode_default OR seat.safe_mode) AS safe_mode,
           seat.avatar_key, session.expires_at
      INTO v_context
      FROM public.classroom_student_sessions session
      JOIN public.classroom_seat_credentials credential
        ON credential.seat_id = session.seat_id AND credential.version = session.credential_version
      JOIN public.classroom_student_seats seat ON seat.id = session.seat_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = seat.tenant_id AND classroom.id = seat.classroom_id
     WHERE session.token_hash = p_token_hash AND session.revoked_at IS NULL
       AND session.expires_at > now() AND session.last_seen_at > now() - interval '60 minutes'
       AND seat.status = 'active' AND classroom.status = 'active';
    IF NOT FOUND THEN RETURN; END IF;

    -- Recheck session authority before optional refresh; a busy row is skipped.
    WITH due AS (
        SELECT session.id FROM public.classroom_student_sessions session
          JOIN public.classroom_seat_credentials credential
            ON credential.seat_id = session.seat_id AND credential.version = session.credential_version
         WHERE session.id = v_context.session_id AND session.revoked_at IS NULL
           AND session.expires_at > now()
           AND session.last_seen_at > now() - interval '60 minutes'
           AND session.last_seen_at <= now() - interval '1 minute'
         FOR UPDATE OF session SKIP LOCKED
    )
    UPDATE public.classroom_student_sessions session SET last_seen_at = now()
      FROM due WHERE session.id = due.id;

    -- A separate candidate is essential: seat roster/activity writes must not
    -- make an otherwise valid session wait either.
    WITH due AS (
        SELECT seat.id FROM public.classroom_student_seats seat
         WHERE seat.id = v_context.seat_id AND seat.status = 'active'
           AND (seat.last_active_at IS NULL OR seat.last_active_at <= now() - interval '1 minute')
         FOR UPDATE OF seat SKIP LOCKED
    )
    UPDATE public.classroom_student_seats seat SET last_active_at = now()
      FROM due WHERE seat.id = due.id;

    RETURN QUERY SELECT v_context.seat_id, v_context.classroom_id, v_context.classroom_title,
                        v_context.display_label, v_context.teacher_display_name,
                        v_context.safe_mode, v_context.avatar_key, v_context.expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_session_context(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_session_context(varchar) TO asalab_app;
