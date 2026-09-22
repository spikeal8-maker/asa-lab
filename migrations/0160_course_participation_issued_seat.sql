-- E1-FIX-11D5 backend acceptance repair:
-- permit an issued StudentSeat only for exact inherited Course participation.
-- Direct / independent participation remains active-seat-only.

CREATE OR REPLACE FUNCTION activity_participation_assign(
    p_actor_principal_id uuid,
    p_activity_run_id uuid,
    p_learner_identity_id uuid,
    p_source_course_enrollment_id uuid DEFAULT NULL
)
RETURNS TABLE (result_code varchar, participation_id uuid,
               participation_status varchar, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_context record;
    v_participation public.activity_participations%ROWTYPE;
    v_created boolean := false;
BEGIN
    SELECT run.tenant_id, run.school_id, run.classroom_id, run.source_kind,
           run.source_course_run_id, membership.user_id AS actor_user_id
      INTO v_context
      FROM public.activity_runs run
      JOIN public.classrooms classroom
        ON classroom.tenant_id = run.tenant_id AND classroom.id = run.classroom_id
       AND classroom.status = 'active'
      JOIN public.principals principal
        ON principal.id = p_actor_principal_id AND principal.kind = 'account'
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = run.tenant_id
       AND membership.classroom_id = run.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
     WHERE run.id = p_activity_run_id
       AND run.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    IF v_context.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.learner_identities learner
         WHERE learner.tenant_id = v_context.tenant_id
           AND learner.school_id = v_context.school_id
           AND learner.id = p_learner_identity_id AND learner.state = 'active'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.learner_identity_links link
        JOIN public.classroom_student_seats seat ON seat.id = link.seat_id
         WHERE link.tenant_id = v_context.tenant_id
           AND link.school_id = v_context.school_id
           AND link.learner_identity_id = p_learner_identity_id
           AND link.link_kind = 'student_seat' AND link.status = 'active'
           AND seat.tenant_id = v_context.tenant_id
           AND seat.classroom_id = v_context.classroom_id
           AND (
               seat.status = 'active'
               OR (
                   seat.status = 'issued'
                   AND p_source_course_enrollment_id IS NOT NULL
                   AND EXISTS (
                       SELECT 1
                         FROM public.course_enrollments enrollment
                        WHERE enrollment.id = p_source_course_enrollment_id
                          AND enrollment.tenant_id = v_context.tenant_id
                          AND enrollment.school_id = v_context.school_id
                          AND enrollment.course_run_id = v_context.source_course_run_id
                          AND enrollment.learner_identity_id = p_learner_identity_id
                          AND enrollment.status IN ('assigned', 'active')
                   )
               )
           )
    ) THEN
        RETURN QUERY SELECT 'learner_not_available'::varchar, NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF v_context.source_kind = 'direct' AND p_source_course_enrollment_id IS NOT NULL THEN
        RETURN QUERY SELECT 'course_enrollment_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;
    IF p_source_course_enrollment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.course_enrollments enrollment
         WHERE enrollment.id = p_source_course_enrollment_id
           AND enrollment.tenant_id = v_context.tenant_id
           AND enrollment.school_id = v_context.school_id
           AND enrollment.course_run_id = v_context.source_course_run_id
           AND enrollment.learner_identity_id = p_learner_identity_id
           AND enrollment.status IN ('assigned', 'active')
    ) THEN
        RETURN QUERY SELECT 'course_enrollment_forbidden'::varchar,
                            NULL::uuid, NULL::varchar, false;
        RETURN;
    END IF;

    INSERT INTO public.activity_participations (
        tenant_id, school_id, activity_run_id, learner_identity_id,
        source_course_enrollment_id, assigned_by_principal_id
    ) VALUES (
        v_context.tenant_id, v_context.school_id, p_activity_run_id,
        p_learner_identity_id, p_source_course_enrollment_id, p_actor_principal_id
    ) ON CONFLICT (activity_run_id, learner_identity_id) DO NOTHING
    RETURNING * INTO v_participation;
    IF v_participation.id IS NOT NULL THEN
        v_created := true;
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES (v_context.tenant_id, v_context.actor_user_id,
                'activity_participation', v_participation.id,
                'participation.assigned',
                jsonb_build_object('actorPrincipalId',p_actor_principal_id,
                    'activityRunId',p_activity_run_id,
                    'learnerIdentityId',p_learner_identity_id,
                    'sourceCourseEnrollmentId',p_source_course_enrollment_id));
    ELSE
        SELECT * INTO v_participation FROM public.activity_participations participation
         WHERE participation.activity_run_id = p_activity_run_id
           AND participation.learner_identity_id = p_learner_identity_id;
        IF v_participation.source_course_enrollment_id
           IS DISTINCT FROM p_source_course_enrollment_id THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar,
                                v_participation.id, v_participation.status, true;
            RETURN;
        END IF;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar, v_participation.id,
                        v_participation.status, NOT v_created;
END;
$$;

REVOKE ALL ON FUNCTION activity_participation_assign(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activity_participation_assign(uuid,uuid,uuid,uuid) TO asalab_app;
