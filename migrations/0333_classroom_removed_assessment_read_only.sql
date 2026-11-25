-- Review receipts return before these write boundaries. New grading must
-- serialize with removal of the exact classroom seat behind the attempt.
CREATE FUNCTION public.learning_reject_removed_seat_assessment()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_attempt_id uuid;
    v_participation_id uuid;
    v_classroom_id uuid;
    v_seat_status varchar;
BEGIN
    IF TG_RELID = 'public.learning_evaluations'::regclass THEN
        v_attempt_id := NEW.attempt_id;
    ELSE
        v_attempt_id := NEW.teacher_selected_attempt_id;
        v_participation_id := NEW.id;
        SELECT run.classroom_id INTO v_classroom_id
          FROM public.activity_runs run
         WHERE run.id = NEW.activity_run_id AND run.tenant_id = NEW.tenant_id;
    END IF;

    SELECT seat.status INTO v_seat_status
      FROM public.learning_attempts attempt
      JOIN public.classroom_student_seats seat
        ON seat.id = attempt.seat_id AND seat.tenant_id = attempt.tenant_id
       AND seat.classroom_id = attempt.classroom_id
     WHERE attempt.id = v_attempt_id AND attempt.tenant_id = NEW.tenant_id
       AND (v_participation_id IS NULL OR (
           attempt.activity_participation_id = v_participation_id
           AND attempt.classroom_id = v_classroom_id
       ))
     FOR SHARE OF seat;
    IF v_seat_status = 'removed' THEN
        RAISE EXCEPTION USING ERRCODE = 'P5L03', MESSAGE = 'classroom seat removed';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.learning_reject_removed_seat_assessment() FROM PUBLIC, asalab_app;

CREATE TRIGGER learning_teacher_evaluation_reject_removed_seat
BEFORE INSERT ON public.learning_evaluations
FOR EACH ROW WHEN (NEW.evaluator_kind = 'teacher')
EXECUTE FUNCTION public.learning_reject_removed_seat_assessment();

-- Include an explicit re-selection of the same attempt with a new request.
-- A system clearing the pointer does not create a new teacher selection.
CREATE TRIGGER learning_selected_attempt_reject_removed_seat
BEFORE UPDATE OF teacher_selected_attempt_id ON public.activity_participations
FOR EACH ROW WHEN (NEW.teacher_selected_attempt_id IS NOT NULL)
EXECUTE FUNCTION public.learning_reject_removed_seat_assessment();
