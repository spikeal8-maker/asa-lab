-- Issue 618: initialize a genuinely new StudentCode Seat in its canonical
-- creation transaction. Single and batch issue both call this command.
-- Preserve the current 0148 validation, case, teacher ACL, audit and return.
-- No trigger, backfill, new runtime grant or existing-Seat repair is introduced.
-- CREATE OR REPLACE retains this existing function's owner and privileges.
CREATE OR REPLACE FUNCTION public.classroom_management_add_seat(
  p_account_id uuid,p_classroom_id uuid,p_display_label varchar,
  p_login_handle varchar,p_safe_mode boolean
)
RETURNS TABLE (
  id uuid,display_label varchar,login_handle varchar,safe_mode boolean,
  status varchar,avatar_key varchar,last_active_at timestamptz,created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_access record; v_seat_id uuid; v_code varchar;
BEGIN
  v_code:=trim(COALESCE(p_login_handle,''));
  IF v_code !~ '^[A-Za-z0-9]{4,10}$' THEN RAISE EXCEPTION 'invalid student code'; END IF;
  SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id,p_classroom_id);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  INSERT INTO public.classroom_student_seats(
    tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,created_by
  ) VALUES (
    v_access.tenant_id,p_classroom_id,trim(p_display_label),v_code,
    v_code,p_safe_mode,v_access.user_id
  ) RETURNING classroom_student_seats.id INTO v_seat_id;

  -- This command has just inserted a new StudentCode Seat. Initialize its
  -- canonical learner and Project principal before the teacher can read it.
  -- Never repair existing, removed or disabled links from sign-in, admission
  -- reads, batch replay, code rotation or Seat updates.
  IF EXISTS (
    SELECT 1 FROM public.classrooms classroom
    WHERE classroom.id=p_classroom_id AND classroom.tenant_id=v_access.tenant_id
      AND classroom.status='active'
  ) THEN
    -- A dynamic Learning audience may already have initialized the learner
    -- during INSERT; the new Seat still needs its own canonical principal.
    IF NOT EXISTS (
      SELECT 1 FROM public.learner_identity_links link WHERE link.seat_id=v_seat_id
    ) THEN
      PERFORM public.learning_audience_ensure_seat_identity(v_seat_id);
    END IF;
    PERFORM public.student_seat_principal(v_seat_id);
  END IF;
  INSERT INTO public.audit_events(
    tenant_id,actor_user_id,entity_type,entity_id,action,payload_json
  ) VALUES (
    v_access.tenant_id,v_access.user_id,'student_seat',v_seat_id,
    'classroom.student_seat_created',
    jsonb_build_object('classroomId',p_classroom_id,'safeMode',p_safe_mode,
      'teacherRole',v_access.teacher_role)
  );
  RETURN QUERY
    SELECT s.id,s.display_label,s.login_handle,s.safe_mode,s.status,s.avatar_key,
      s.last_active_at,s.created_at
    FROM public.classroom_student_seats s WHERE s.id=v_seat_id;
END;
$$;
