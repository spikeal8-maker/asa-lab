-- UI adapter for the existing Audience commands. Never create another audience engine.
CREATE OR REPLACE FUNCTION learning_audience_for_teacher(p_account uuid,p_class uuid,p_assignment uuid,p_course uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',audience.id,'type',audience.audience_type,'status',audience.status,
 'courseRunId',audience.target_course_run_id,'members',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'seatId',seat.id,'label',seat.display_label,'status',seat.status,'included',member.id IS NOT NULL AND member.removed_at IS NULL,
 'withdrawn',member.removed_at IS NOT NULL) ORDER BY seat.display_label,seat.id)
 FROM public.classroom_student_seats seat
 LEFT JOIN public.learner_identity_links link ON link.seat_id=seat.id AND link.status='active'
 LEFT JOIN public.learning_audience_named_members member ON member.audience_id=audience.id AND member.learner_identity_id=link.learner_identity_id
 WHERE seat.classroom_id=p_class AND (seat.status IN ('issued','active') OR member.id IS NOT NULL)),'[]'::jsonb))
 FROM public.learning_audience_definitions audience
 LEFT JOIN public.activity_runs run ON run.id=audience.target_activity_run_id
 WHERE audience.classroom_id=p_class AND num_nonnulls(p_assignment,p_course)=1
 AND (audience.target_course_run_id=p_course OR run.source_classroom_assignment_id=p_assignment)
 AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher'));
$$;
CREATE OR REPLACE FUNCTION learning_audience_member_change(p_account uuid,p_actor uuid,p_class uuid,p_audience uuid,p_seat uuid,
 p_include boolean,p_expected boolean,p_reason varchar,p_request varchar)
RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_audience public.learning_audience_definitions%ROWTYPE;v_learner uuid;v_included boolean;v_prior jsonb;v_payload jsonb;v_code varchar;
BEGIN
 IF p_include IS NULL OR p_expected IS NULL OR length(trim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 1000
   OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RETURN 'invalid_change'; END IF;
 SELECT a.* INTO v_audience FROM public.learning_audience_definitions a
 WHERE a.id=p_audience AND a.classroom_id=p_class AND a.status='active' AND a.audience_type='named_learners'
 AND EXISTS(SELECT 1 FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id
   WHERE m.classroom_id=p_class AND m.account_id=p_account AND actor.id=p_actor AND m.member_role IN ('owner','co_teacher')) FOR UPDATE;
 IF v_audience.id IS NULL THEN RETURN 'forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.classroom_student_seats seat WHERE seat.id=p_seat
   AND seat.classroom_id=p_class AND seat.tenant_id=v_audience.tenant_id AND (NOT p_include OR seat.status IN ('issued','active')))
 THEN RETURN 'forbidden'; END IF;
 PERFORM set_config('app.tenant_id',v_audience.tenant_id::text,true);
 IF p_include THEN PERFORM public.learning_audience_ensure_seat_identity(p_seat); END IF;
 SELECT link.learner_identity_id INTO v_learner FROM public.learner_identity_links link
 JOIN public.classroom_student_seats seat ON seat.id=link.seat_id AND seat.classroom_id=p_class
 WHERE seat.id=p_seat AND link.status='active';
 IF v_learner IS NULL THEN RETURN 'forbidden'; END IF;
 v_payload:=jsonb_build_object('actorPrincipalId',p_actor,'seatId',p_seat,'include',p_include,'expectedIncluded',p_expected,'reason',p_reason,'requestId',p_request);
 SELECT payload_json INTO v_prior FROM public.audit_events WHERE entity_id=p_audience AND action='learning.audience.changed' AND payload_json->>'requestId'=p_request LIMIT 1;
 IF v_prior IS NOT NULL THEN RETURN CASE WHEN v_prior=v_payload THEN 'ok' ELSE 'request_conflict' END; END IF;
 SELECT EXISTS(SELECT 1 FROM public.learning_audience_named_members WHERE audience_id=p_audience AND learner_identity_id=v_learner AND removed_at IS NULL) INTO v_included;
 IF v_included<>p_expected THEN RETURN 'membership_conflict'; END IF;
 PERFORM set_config('app.tenant_id',v_audience.tenant_id::text,true);
 IF p_include THEN SELECT result_code INTO v_code FROM public.learning_audience_named_add(p_actor,p_audience,v_learner,p_request);
 ELSE SELECT result_code INTO v_code FROM public.learning_audience_named_remove(p_actor,p_audience,v_learner,p_request); END IF;
 IF v_code NOT IN ('ok','completed','already_satisfied') THEN RETURN v_code; END IF;
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(v_audience.tenant_id,'learning_audience',p_audience,'learning.audience.changed',v_payload);
 RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION learning_audience_for_teacher(uuid,uuid,uuid,uuid),learning_audience_member_change(uuid,uuid,uuid,uuid,uuid,boolean,boolean,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_audience_for_teacher(uuid,uuid,uuid,uuid),learning_audience_member_change(uuid,uuid,uuid,uuid,uuid,boolean,boolean,varchar,varchar) TO asalab_app;
