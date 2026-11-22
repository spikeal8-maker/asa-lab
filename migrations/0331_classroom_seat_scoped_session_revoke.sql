-- Revoke sessions only for the seat successfully removed from this class.
CREATE OR REPLACE FUNCTION public.classroom_management_remove_seat(
    p_account_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_removed_seat_id uuid;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;

    UPDATE public.classroom_student_seats s
       SET status = 'removed', updated_at = now()
     WHERE s.tenant_id = v_access.tenant_id AND s.classroom_id = p_classroom_id
       AND s.id = p_seat_id AND s.status <> 'removed'
    RETURNING s.id INTO v_removed_seat_id;
    IF NOT FOUND THEN RETURN false; END IF;

    UPDATE public.classroom_student_sessions
       SET revoked_at = now()
     WHERE seat_id = v_removed_seat_id AND revoked_at IS NULL;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'student_seat', v_removed_seat_id,
         'classroom.student_seat_removed',
         jsonb_build_object('classroomId', p_classroom_id,
                            'teacherRole', v_access.teacher_role));
    RETURN true;
END;
$$;
