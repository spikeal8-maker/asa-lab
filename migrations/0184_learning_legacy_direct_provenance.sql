-- Historical teacher handouts have neither a pinned ActivityRun nor a Learning
-- Activity Version. This viewer-scoped proof is intentionally boolean: denied
-- immutable origins and projects must never be exposed through a legacy list.
CREATE FUNCTION public.learning_legacy_direct_provenance(
    p_viewer_principal_id uuid, p_seat_id uuid,
    p_assignment_id uuid, p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_seat record;
    v_actor record;
    v_assignment record;
    v_has_link boolean;
    v_link_active boolean;
    v_origin_present boolean;
    v_run_present boolean;
    v_work_present boolean;
    v_work_project_id uuid;
    v_project_access boolean;
    v_legacy_direct boolean;
    v_legacy_submit_supported boolean;
BEGIN
    SELECT seat.id, seat.tenant_id, seat.classroom_id, seat.account_id,
           seat.status
      INTO v_seat FROM public.classroom_student_seats seat
     WHERE seat.id = p_seat_id;
    SELECT principal.kind, principal.seat_id, principal.account_id
      INTO v_actor FROM public.principals principal
     WHERE principal.id = p_viewer_principal_id;
    SELECT assignment.id, assignment.tenant_id, assignment.classroom_id,
           assignment.status, assignment.assignment_id,
           assignment.course_run_id, assignment.quiz_version_id,
           assignment.learning_activity_version_id
      INTO v_assignment FROM public.classroom_assignments assignment
     WHERE assignment.id = p_assignment_id;
    v_legacy_direct := COALESCE(
        v_assignment.assignment_id IS NOT NULL
        AND v_assignment.course_run_id IS NULL
        AND v_assignment.quiz_version_id IS NULL
        AND v_assignment.learning_activity_version_id IS NULL,
        false);
    IF v_seat.id IS NULL OR v_actor.kind IS NULL OR v_assignment.id IS NULL
       OR v_seat.status <> 'active'
       OR v_assignment.tenant_id <> v_seat.tenant_id
       OR v_assignment.classroom_id <> v_seat.classroom_id
       OR NOT v_legacy_direct
       OR NOT public.learning_direct_assignment_seat_visible(p_seat_id,p_assignment_id)
       OR NOT (
           (v_actor.kind = 'student_seat' AND v_actor.seat_id = p_seat_id)
           OR (v_actor.kind = 'account' AND v_actor.account_id = v_seat.account_id
               AND EXISTS (SELECT 1 FROM public.accounts account
                            WHERE account.id = v_actor.account_id
                              AND account.status = 'active'))
       ) THEN
        RETURN jsonb_build_object('legacyDirect',v_legacy_direct,
            'startAllowed',false,'submitAllowed',false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.learner_identity_links link
         WHERE link.tenant_id = v_seat.tenant_id
           AND link.seat_id = p_seat_id AND link.link_kind = 'student_seat'
    ) INTO v_has_link;
    SELECT work.project_id INTO v_work_project_id
      FROM public.classroom_assignment_work work
     WHERE work.tenant_id = v_seat.tenant_id
       AND work.seat_id = p_seat_id
       AND work.assignment_id = p_assignment_id
       AND (p_project_id IS NULL OR work.project_id = p_project_id);
    SELECT EXISTS (
        SELECT 1 FROM public.learner_identity_links seat_link
         WHERE seat_link.tenant_id = v_seat.tenant_id
           AND seat_link.seat_id = p_seat_id
           AND seat_link.link_kind = 'student_seat'
           AND seat_link.status = 'active'
           AND (v_actor.kind = 'student_seat' OR EXISTS (
               SELECT 1 FROM public.learner_identity_links account_link
                WHERE account_link.tenant_id = seat_link.tenant_id
                  AND account_link.school_id = seat_link.school_id
                  AND account_link.learner_identity_id = seat_link.learner_identity_id
                  AND account_link.account_id = v_actor.account_id
                  AND account_link.link_kind = 'account'
                  AND account_link.status = 'active'))
    ) INTO v_link_active;
    IF v_has_link AND NOT v_link_active THEN
        RETURN jsonb_build_object('legacyDirect',true,
            'startAllowed',false,'submitAllowed',false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.activity_runs run
         WHERE run.tenant_id = v_seat.tenant_id
           AND run.classroom_id = v_seat.classroom_id
           AND run.source_classroom_assignment_id = p_assignment_id
    ) INTO v_run_present;
    SELECT EXISTS (
        SELECT 1 FROM public.learner_identity_links seat_link
        JOIN public.learning_project_origins origin
          ON origin.school_tenant_id = seat_link.tenant_id
         AND origin.school_id = seat_link.school_id
         AND origin.learner_identity_id = seat_link.learner_identity_id
        JOIN public.activity_runs run
          ON run.tenant_id = origin.school_tenant_id
         AND run.id = origin.activity_run_id
         WHERE seat_link.tenant_id = v_seat.tenant_id
           AND seat_link.seat_id = p_seat_id
           AND seat_link.link_kind = 'student_seat'
           AND origin.source_kind = 'direct'
           AND run.classroom_id = v_seat.classroom_id
           AND run.source_classroom_assignment_id = p_assignment_id
    ) OR (COALESCE(p_project_id,v_work_project_id) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.learning_project_origins origin
         WHERE origin.project_id = COALESCE(p_project_id,v_work_project_id)
    )) INTO v_origin_present;
    v_work_present := v_work_project_id IS NOT NULL;
    v_project_access := COALESCE(p_project_id,v_work_project_id) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.project_context_for_principal(
            p_viewer_principal_id,COALESCE(p_project_id,v_work_project_id))
    );
    -- The existing compatibility submission function accepts only same-tenant
    -- projects owned by the Seat principal. Do not advertise Submit otherwise.
    SELECT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals owner
          ON owner.id = project.owner_principal_id
         AND owner.kind = 'student_seat'
         AND owner.seat_id = p_seat_id
        JOIN public.project_drafts draft
          ON draft.tenant_id = project.tenant_id
         AND draft.project_id = project.id
         WHERE project.id = v_work_project_id
           AND project.tenant_id = v_seat.tenant_id
    ) INTO v_legacy_submit_supported;
    RETURN jsonb_build_object(
        'legacyDirect',true,
        'startAllowed',v_assignment.status = 'open'
            AND NOT v_run_present AND NOT v_origin_present
            AND NOT EXISTS (
                SELECT 1 FROM public.classroom_assignment_work work
                 WHERE work.tenant_id = v_seat.tenant_id
                   AND work.seat_id = p_seat_id
                   AND work.assignment_id = p_assignment_id)
            AND (p_project_id IS NULL OR v_project_access),
        'submitAllowed',v_assignment.status = 'open'
            AND v_work_present AND v_project_access
            AND v_legacy_submit_supported
            AND NOT v_origin_present
    );
END;
$$;

REVOKE ALL ON FUNCTION public.learning_legacy_direct_provenance(uuid,uuid,uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_legacy_direct_provenance(uuid,uuid,uuid,uuid)
    TO asalab_app;
