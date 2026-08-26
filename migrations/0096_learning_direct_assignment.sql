-- LRN-VS-001: one product command from authored activity to visible class work.
-- The classroom handout remains a compatibility shell for CURRENT editors and
-- readers; ActivityRun/Audience/Participation are the canonical delivery state.

CREATE OR REPLACE FUNCTION learning_direct_assignment_activity_list(
    p_actor_principal_id uuid, p_tenant_id uuid, p_classroom_id uuid
)
RETURNS TABLE (
    activity_id uuid, activity_version_id uuid, title varchar,
    instructions varchar, kind varchar, module_key varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT activity.id, version.id, version.title, version.instructions,
           version.canonical_kind, version.module_key
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id=principal.account_id
       AND membership.classroom_id=p_classroom_id
       AND membership.member_role IN ('owner','co_teacher')
      JOIN public.classrooms classroom
        ON classroom.tenant_id=membership.tenant_id
       AND classroom.id=membership.classroom_id
       AND classroom.status='active'
      JOIN public.learning_activities activity
        ON activity.tenant_id=classroom.tenant_id
       AND activity.owner_principal_id=p_actor_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content=true
       AND activity.source_teacher_assignment_id IS NOT NULL
       AND activity.current_published_version_id IS NOT NULL
      JOIN public.learning_activity_versions version
        ON version.tenant_id=activity.tenant_id
       AND version.id=activity.current_published_version_id
       AND version.activity_id=activity.id
       AND version.canonical_contract_version=1
       AND version.canonical_kind='project'
     WHERE principal.id=p_actor_principal_id
       AND principal.kind='account'
       AND classroom.tenant_id=p_tenant_id
       AND NOT EXISTS (
         SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
          WHERE compatibility.learning_activity_version_id=version.id)
     ORDER BY activity.created_at DESC, activity.id;
$$;

CREATE OR REPLACE FUNCTION learning_direct_assignment_create(
    p_actor_principal_id uuid,
    p_tenant_id uuid,
    p_classroom_id uuid,
    p_learning_activity_version_id uuid,
    p_due_at timestamptz,
    p_audience_type varchar,
    p_named_seat_ids uuid[],
    p_request_id varchar
)
RETURNS TABLE (
    result_code varchar, classroom_assignment_id uuid, activity_run_id uuid,
    audience_id uuid, assigned_count integer, reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source record;
    v_handout uuid;
    v_run record;
    v_audience record;
    v_learner_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,80}$'
       OR p_audience_type NOT IN ('whole_class','named_learners')
       OR (p_audience_type='whole_class' AND COALESCE(cardinality(p_named_seat_ids),0)<>0)
       OR (p_audience_type='named_learners' AND (
            COALESCE(cardinality(p_named_seat_ids),0)=0
            OR cardinality(p_named_seat_ids)<>(
                SELECT count(DISTINCT seat_id) FROM unnest(p_named_seat_ids) seat_id))) THEN
        RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,0,false;
        RETURN;
    END IF;

    SELECT classroom.tenant_id, classroom.school_id, membership.user_id,
           activity.source_teacher_assignment_id, activity.owner_principal_id,
           version.id AS version_id
      INTO v_source
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id=principal.account_id
       AND membership.classroom_id=p_classroom_id
       AND membership.member_role IN ('owner','co_teacher')
      JOIN public.classrooms classroom
        ON classroom.tenant_id=membership.tenant_id
       AND classroom.id=membership.classroom_id
       AND classroom.status='active'
      JOIN public.learning_activity_versions version
        ON version.id=p_learning_activity_version_id
       AND version.tenant_id=classroom.tenant_id
       AND version.canonical_contract_version=1
       AND version.canonical_kind='project'
      JOIN public.learning_activities activity
        ON activity.tenant_id=version.tenant_id
       AND activity.id=version.activity_id
       AND activity.current_published_version_id=version.id
       AND activity.owner_principal_id=p_actor_principal_id
       AND activity.source_teacher_assignment_id IS NOT NULL
       AND activity.reusable_authored_content=true
       AND activity.archived_at IS NULL
     WHERE principal.id=p_actor_principal_id
       AND principal.kind='account'
       AND classroom.tenant_id=p_tenant_id
       AND NOT EXISTS (
         SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
          WHERE compatibility.learning_activity_version_id=version.id);
    IF v_source.version_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,0,false;
        RETURN;
    END IF;

    -- The established ActivityRun/Audience commands enforce FORCE-RLS through
    -- the transaction-local tenant setting. The actor/classroom/activity join
    -- above proves this tenant before any canonical runtime write is attempted.
    PERFORM set_config('app.tenant_id',p_tenant_id::text,true);

    IF p_audience_type='named_learners' THEN
        IF EXISTS (
            SELECT 1 FROM unnest(p_named_seat_ids) requested(seat_id)
             WHERE NOT EXISTS (
               SELECT 1 FROM public.classroom_student_seats seat
                WHERE seat.id=requested.seat_id
                  AND seat.tenant_id=v_source.tenant_id
                  AND seat.classroom_id=p_classroom_id
                  AND seat.status IN ('issued','active'))
        ) THEN
            RETURN QUERY SELECT 'named_learner_ineligible'::varchar,
                                NULL::uuid,NULL::uuid,NULL::uuid,0,false;
            RETURN;
        END IF;
        PERFORM public.learning_audience_ensure_seat_identity(seat_id)
          FROM unnest(p_named_seat_ids) seat_id;
        SELECT array_agg(DISTINCT link.learner_identity_id ORDER BY link.learner_identity_id)
          INTO v_learner_ids
          FROM unnest(p_named_seat_ids) requested(seat_id)
          JOIN public.learner_identity_links link
            ON link.seat_id=requested.seat_id AND link.status='active';
    END IF;

    IF public.teacher_assignment_hand_out(
         p_actor_principal_id,v_source.source_teacher_assignment_id,
         p_classroom_id,true,p_due_at) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'learning direct assignment handout failed';
    END IF;
    SELECT assignment.id INTO v_handout
      FROM public.classroom_assignments assignment
     WHERE assignment.tenant_id=v_source.tenant_id
       AND assignment.classroom_id=p_classroom_id
       AND assignment.assignment_id=v_source.source_teacher_assignment_id;

    SELECT * INTO v_run FROM public.activity_run_create(
      p_actor_principal_id,v_handout,p_learning_activity_version_id,'direct',
      NULL,NULL,NULL,p_due_at,NULL,NULL,NULL,'{}'::jsonb,'vsrun:'||p_request_id);
    IF v_run.result_code<>'ok' THEN
        RAISE EXCEPTION 'learning direct assignment run failed: %',v_run.result_code;
    END IF;
    SELECT * INTO v_audience FROM public.learning_audience_create(
      p_actor_principal_id,'activity_run',v_run.activity_run_id,p_audience_type,
      CASE WHEN p_audience_type='whole_class' THEN 'dynamic' ELSE 'snapshot' END,
      v_learner_ids,'vsaudience:'||p_request_id);
    IF v_audience.result_code<>'ok' THEN
        RAISE EXCEPTION 'learning direct assignment audience failed: %',v_audience.result_code;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_handout,v_run.activity_run_id,
      v_audience.audience_id,v_audience.created_count+v_audience.independent_count,
      (v_run.reused AND v_audience.reused);
END;
$$;

CREATE OR REPLACE FUNCTION learning_direct_assignment_summary(
    p_actor_principal_id uuid, p_tenant_id uuid, p_classroom_id uuid
)
RETURNS TABLE (
    classroom_assignment_id uuid, audience_type varchar, assigned_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.source_classroom_assignment_id, audience.audience_type,
           count(claim.id) FILTER (
             WHERE claim.ended_at IS NULL
               AND participation.status IN ('assigned','active'))::integer
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id=principal.account_id
       AND membership.classroom_id=p_classroom_id
       AND membership.member_role IN ('owner','co_teacher')
      JOIN public.activity_runs run
        ON run.tenant_id=membership.tenant_id AND run.classroom_id=membership.classroom_id
       AND run.source_kind='direct'
      JOIN public.learning_audience_definitions audience
        ON audience.target_activity_run_id=run.id AND audience.status='active'
      LEFT JOIN public.learning_audience_membership_claims claim ON claim.audience_id=audience.id
      LEFT JOIN public.activity_participations participation ON participation.id=claim.activity_participation_id
     WHERE principal.id=p_actor_principal_id
       AND run.tenant_id=p_tenant_id
     GROUP BY run.source_classroom_assignment_id,audience.audience_type;
$$;

CREATE OR REPLACE FUNCTION learning_direct_assignment_visibility_for_seat(p_seat_id uuid)
RETURNS TABLE (classroom_assignment_id uuid, visible boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.source_classroom_assignment_id,
           EXISTS (
             SELECT 1 FROM public.learner_identity_links link
             JOIN public.activity_participations participation
               ON participation.learner_identity_id=link.learner_identity_id
              AND participation.activity_run_id=run.id
              AND participation.status IN ('assigned','active')
              WHERE link.seat_id=seat.id AND link.status='active')
      FROM public.classroom_student_seats seat
      JOIN public.activity_runs run
        ON run.tenant_id=seat.tenant_id AND run.classroom_id=seat.classroom_id
       AND run.source_kind='direct'
     WHERE seat.id=p_seat_id;
$$;

CREATE OR REPLACE FUNCTION learning_direct_assignment_visibility_for_account(p_account_id uuid)
RETURNS TABLE (seat_id uuid, classroom_assignment_id uuid, visible boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id, visibility.classroom_assignment_id, visibility.visible
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.learning_direct_assignment_visibility_for_seat(seat.id) visibility
     WHERE seat.account_id=p_account_id
       AND seat.status IN ('issued','active');
$$;

REVOKE ALL ON FUNCTION learning_direct_assignment_activity_list(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_direct_assignment_create(uuid,uuid,uuid,uuid,timestamptz,varchar,uuid[],varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_direct_assignment_summary(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_direct_assignment_visibility_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_direct_assignment_visibility_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_direct_assignment_activity_list(uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_direct_assignment_create(uuid,uuid,uuid,uuid,timestamptz,varchar,uuid[],varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_direct_assignment_summary(uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_direct_assignment_visibility_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_direct_assignment_visibility_for_account(uuid) TO asalab_app;
