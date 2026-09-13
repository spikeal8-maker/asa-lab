-- Operational controls reuse Participation commands; snapshots and prior Attempts are untouched.
CREATE OR REPLACE FUNCTION learning_participation_conditions_save(
 p_account uuid,p_actor uuid,p_class uuid,p_assignment uuid,p_seat uuid,p_expected integer,
 p_extra integer,p_unlocked boolean,p_excuse boolean,p_reason varchar,p_request varchar)
RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_run public.activity_runs%ROWTYPE;v_part public.activity_participations%ROWTYPE;
 v_event jsonb;v_payload jsonb;v_result varchar;
BEGIN
 IF p_extra IS NULL OR p_extra NOT BETWEEN 0 AND 100 OR p_unlocked IS NULL OR p_excuse IS NULL
   OR length(trim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 1000
   OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RETURN 'invalid_conditions'; END IF;
 SELECT run.* INTO v_run FROM public.activity_runs run
 WHERE run.classroom_id=p_class AND run.source_classroom_assignment_id=p_assignment
 AND EXISTS(SELECT 1 FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id
   WHERE m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher') AND actor.id=p_actor)
 FOR UPDATE;
 IF v_run.id IS NULL THEN RETURN 'forbidden'; END IF;
 SELECT part.* INTO v_part FROM public.activity_participations part JOIN public.learner_identity_links link
   ON link.learner_identity_id=part.learner_identity_id AND link.seat_id=p_seat AND link.status='active'
 WHERE part.activity_run_id=v_run.id FOR UPDATE OF part;
 IF v_part.id IS NULL THEN RETURN 'forbidden'; END IF;
 v_payload:=jsonb_build_object('actorPrincipalId',p_actor,'expectedRevision',p_expected,'extraAttempts',p_extra,
   'teacherUnlocked',p_unlocked,'excuse',p_excuse,'reason',p_reason,'requestId',p_request);
 SELECT payload_json INTO v_event FROM public.audit_events WHERE entity_id=v_part.id
   AND action='learning.conditions.changed' AND payload_json->>'requestId'=p_request LIMIT 1;
 IF v_event IS NOT NULL THEN RETURN CASE WHEN v_event=v_payload THEN 'ok' ELSE 'request_conflict' END; END IF;
 IF v_part.conditions_revision IS DISTINCT FROM p_expected THEN RETURN 'conditions_conflict'; END IF;
 IF v_run.lifecycle_status<>'active' OR v_part.status='withdrawn' THEN RETURN 'not_available'; END IF;
 -- Never erase allowance already granted by a review, or silently undo an excuse.
 IF p_extra<v_part.extra_attempts OR (v_part.excused AND NOT p_excuse) THEN RETURN 'invalid_conditions'; END IF;
 PERFORM set_config('app.tenant_id',v_run.tenant_id::text,true);
 SELECT result_code INTO v_result FROM public.activity_participation_set_overrides(p_actor,v_part.id,p_extra,
   v_part.time_limit_override_seconds,v_part.opens_at_override,v_part.due_at_override,v_part.closes_at_override,p_unlocked);
 IF v_result<>'ok' THEN RETURN v_result; END IF;
 IF p_excuse AND NOT v_part.excused THEN
   SELECT result_code INTO v_result FROM public.activity_participation_excuse(p_actor,v_part.id,p_reason);
   IF v_result<>'ok' THEN RAISE EXCEPTION 'excuse failed'; END IF;
 END IF;
 UPDATE public.activity_participations SET conditions_revision=conditions_revision+1 WHERE id=v_part.id;
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(v_run.tenant_id,'activity_participation',v_part.id,'learning.conditions.changed',v_payload);
 RETURN 'ok';
END;
$$;
CREATE OR REPLACE FUNCTION learning_conditions_impact(p_account uuid,p_class uuid,p_assignment uuid,p_seat uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('participants',count(DISTINCT part.id),'activeAttempts',count(attempt.id) FILTER(WHERE attempt.state='in_progress'),
 'submittedAttempts',count(attempt.id) FILTER(WHERE attempt.state IN ('submitted','evaluating')),
 'excused',COALESCE(bool_or(part.excused),false))
 FROM public.activity_runs run JOIN public.activity_participations part ON part.activity_run_id=run.id
 LEFT JOIN public.learning_attempts attempt ON attempt.activity_participation_id=part.id
 WHERE run.classroom_id=p_class AND run.source_classroom_assignment_id=p_assignment
 AND (p_seat IS NULL OR EXISTS(SELECT 1 FROM public.learner_identity_links link WHERE link.learner_identity_id=part.learner_identity_id AND link.seat_id=p_seat AND link.status='active'))
 AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher'));
$$;
CREATE OR REPLACE FUNCTION learning_gradebook_course_columns(p_account uuid,p_class uuid)
RETURNS TABLE(assignment_id uuid,course_run_id uuid,course_title varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT lesson.classroom_assignment_id,course.id,course.title FROM public.classroom_course_runs course
 JOIN public.classroom_course_run_lessons lesson ON lesson.run_id=course.id
 WHERE course.classroom_id=p_class AND lesson.classroom_assignment_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher'));
$$;
REVOKE ALL ON FUNCTION learning_participation_conditions_save(uuid,uuid,uuid,uuid,uuid,integer,integer,boolean,boolean,varchar,varchar),
 learning_conditions_impact(uuid,uuid,uuid,uuid),learning_gradebook_course_columns(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_participation_conditions_save(uuid,uuid,uuid,uuid,uuid,integer,integer,boolean,boolean,varchar,varchar),
 learning_conditions_impact(uuid,uuid,uuid,uuid),learning_gradebook_course_columns(uuid,uuid) TO asalab_app;
