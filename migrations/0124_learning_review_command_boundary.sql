CREATE OR REPLACE FUNCTION learning_attempt_review(
    p_account_id uuid,
    p_reviewer_principal_id uuid,
    p_classroom_id uuid,
    p_attempt_id uuid,
    p_decision varchar,
    p_points integer,
    p_feedback varchar,
    p_reason varchar
)
RETURNS TABLE (
    result_code varchar,
    assessment_result_id uuid,
    gradebook_entry_id uuid,
    attempt_state varchar,
    percentage_basis_points integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_attempt record;
    v_result uuid;
    v_gradebook uuid;
    v_percentage integer;
    v_outcome varchar;
BEGIN
    SELECT * INTO v_access
      FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN
        RETURN QUERY SELECT 'classroom_not_found'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_decision NOT IN ('accepted', 'changes_requested', 'incomplete', 'excused') THEN
        RETURN QUERY SELECT 'invalid_decision'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_feedback IS NOT NULL AND length(p_feedback) > 8000 THEN
        RETURN QUERY SELECT 'invalid_feedback'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;

    SELECT attempt.*, version.max_points, classroom.school_id,
           classroom.academic_period_id, principal.id AS reviewer_principal_id
      INTO v_attempt
      FROM public.learning_attempts attempt
      JOIN public.learning_activity_versions version
        ON version.id = attempt.learning_activity_version_id
      JOIN public.classrooms classroom ON classroom.id = attempt.classroom_id
      JOIN public.principals principal
        ON principal.id = p_reviewer_principal_id
       AND principal.account_id = p_account_id
     WHERE attempt.id = p_attempt_id
       AND attempt.classroom_id = p_classroom_id
       AND attempt.tenant_id = v_access.tenant_id
     FOR UPDATE OF attempt;
    IF v_attempt.id IS NULL THEN
        RETURN QUERY SELECT 'attempt_not_found'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF v_attempt.activity_participation_id IS NOT NULL THEN
        RETURN QUERY SELECT 'review_request_required'::varchar,NULL::uuid,NULL::uuid,v_attempt.state::varchar,NULL::integer;
        RETURN;
    END IF;
    IF v_attempt.state <> 'evaluating' THEN
        RETURN QUERY SELECT 'invalid_transition'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_decision = 'changes_requested' THEN
        UPDATE public.learning_attempts
           SET state = 'changes_requested', evaluated_at = now()
         WHERE id = p_attempt_id;
        INSERT INTO public.learning_evaluations (
            tenant_id, attempt_id, evaluator_kind, evaluator_principal_id,
            status, points, max_points, feedback
        ) VALUES (
            v_attempt.tenant_id, p_attempt_id, 'teacher',
            v_attempt.reviewer_principal_id, 'completed', NULL,
            v_attempt.max_points, p_feedback
        );
        UPDATE public.classroom_assignment_work
           SET submitted_at = NULL
         WHERE assignment_id = v_attempt.classroom_assignment_id
           AND seat_id = v_attempt.seat_id;
        RETURN QUERY SELECT 'ok'::varchar, NULL::uuid, NULL::uuid,
            'changes_requested'::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_decision = 'accepted' AND
       (p_points IS NULL OR p_points < 0 OR p_points > v_attempt.max_points) THEN
        RETURN QUERY SELECT 'invalid_points'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_decision IN ('incomplete', 'excused') AND p_reason IS NULL THEN
        RETURN QUERY SELECT 'reason_required'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;

    v_outcome := CASE
        WHEN p_decision = 'accepted' AND p_points * 100 >= v_attempt.max_points * 60
            THEN 'passed'
        WHEN p_decision = 'accepted' THEN 'failed'
        ELSE p_decision
    END;
    v_percentage := CASE WHEN p_points IS NULL THEN NULL
                         ELSE (p_points * 10000) / v_attempt.max_points END;

    INSERT INTO public.learning_evaluations (
        tenant_id, attempt_id, evaluator_kind, evaluator_principal_id,
        status, points, max_points, feedback
    ) VALUES (
        v_attempt.tenant_id, p_attempt_id, 'teacher',
        v_attempt.reviewer_principal_id, 'completed', p_points,
        v_attempt.max_points, p_feedback
    );
    INSERT INTO public.assessment_results (
        tenant_id, attempt_id, raw_points, max_points,
        percentage_basis_points, outcome, manual_points,
        evaluator_principal_id, feedback
    ) VALUES (
        v_attempt.tenant_id, p_attempt_id, p_points, v_attempt.max_points,
        v_percentage, v_outcome, COALESCE(p_points, 0),
        v_attempt.reviewer_principal_id, p_feedback
    ) RETURNING id INTO v_result;
    UPDATE public.learning_attempts
       SET state = p_decision, evaluated_at = now()
     WHERE id = p_attempt_id;

    INSERT INTO public.gradebook_entries (
        tenant_id, school_id, academic_period_id, classroom_id,
        classroom_assignment_id, seat_id, accepted_attempt_id,
        assessment_result_id, published_by_principal_id
    ) VALUES (
        v_attempt.tenant_id, v_attempt.school_id, v_attempt.academic_period_id,
        p_classroom_id, v_attempt.classroom_assignment_id, v_attempt.seat_id,
        p_attempt_id, v_result, v_attempt.reviewer_principal_id
    )
    ON CONFLICT (classroom_assignment_id, seat_id) DO UPDATE
       SET accepted_attempt_id = EXCLUDED.accepted_attempt_id,
           assessment_result_id = EXCLUDED.assessment_result_id,
           published_by_principal_id = EXCLUDED.published_by_principal_id,
           published_at = now(), updated_at = now()
    RETURNING id INTO v_gradebook;
    INSERT INTO public.grade_change_events (
        tenant_id, gradebook_entry_id, assessment_result_id,
        actor_principal_id, event_kind, reason, snapshot
    ) VALUES (
        v_attempt.tenant_id, v_gradebook, v_result,
        v_attempt.reviewer_principal_id, 'published',
        COALESCE(NULLIF(trim(p_reason), ''), 'Первичная публикация результата'),
        jsonb_build_object('points', p_points, 'maxPoints', v_attempt.max_points,
                           'percentageBasisPoints', v_percentage, 'outcome', v_outcome)
    );

    RETURN QUERY SELECT 'ok'::varchar, v_result, v_gradebook,
        p_decision::varchar, v_percentage;
END;
$$;
