CREATE OR REPLACE FUNCTION classroom_course_material_progress_set(
    p_seat_id    uuid,
    p_run_id     uuid,
    p_lesson_id  uuid,
    p_completed  boolean
)
RETURNS TABLE (result_code varchar, completed_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_status varchar;
    v_completed_at timestamptz;
BEGIN
    SELECT run.tenant_id, run.status
      INTO v_tenant, v_status
      FROM public.classroom_student_seats seat
      JOIN public.classroom_course_runs run
        ON run.tenant_id = seat.tenant_id
       AND run.classroom_id = seat.classroom_id
      JOIN public.classroom_course_run_lessons lesson
        ON lesson.run_id = run.id
       AND lesson.tenant_id = run.tenant_id
     WHERE seat.id = p_seat_id
       AND seat.status = 'active'
       AND run.id = p_run_id
       AND lesson.id = p_lesson_id
       AND lesson.kind = 'material'
       AND public.learning_course_seat_visible(seat.id,run.id);

    IF v_tenant IS NULL THEN
        RETURN QUERY SELECT 'lesson_not_found'::varchar, NULL::timestamptz;
        RETURN;
    END IF;
    IF v_status <> 'open' THEN
        RETURN QUERY SELECT 'course_closed'::varchar, NULL::timestamptz;
        RETURN;
    END IF;

    IF p_completed THEN
        INSERT INTO public.classroom_course_lesson_progress (
            tenant_id, run_id, lesson_id, seat_id
        ) VALUES (
            v_tenant, p_run_id, p_lesson_id, p_seat_id
        )
        ON CONFLICT (run_id, lesson_id, seat_id) DO UPDATE
           SET completed_at = classroom_course_lesson_progress.completed_at,
               updated_at = now()
        RETURNING classroom_course_lesson_progress.completed_at INTO v_completed_at;
    ELSE
        DELETE FROM public.classroom_course_lesson_progress progress
         WHERE progress.run_id = p_run_id
           AND progress.lesson_id = p_lesson_id
           AND progress.seat_id = p_seat_id;
        v_completed_at := NULL;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_completed_at;
END;
$$;
