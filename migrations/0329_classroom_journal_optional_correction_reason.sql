-- Preserve the canonical dated-journal writer. Only clearing a revision requires a reason.
CREATE OR REPLACE FUNCTION public.classroom_journal_write(p_actor uuid,p_class uuid,p_action varchar,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_class public.classrooms%ROWTYPE; v_prior public.classroom_journal_receipts%ROWTYPE;
 v_scale public.classroom_journal_scales%ROWTYPE; v_column public.classroom_journal_columns%ROWTYPE;
 v_latest public.classroom_journal_revisions%ROWTYPE; v_id uuid; v_seat uuid; v_learner uuid;
 v_expected integer; v_value integer; v_result jsonb; v_payload jsonb; v_recipient uuid; v_emitted integer:=0;
BEGIN
 IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF p_action NOT IN ('scale','column','grade') OR p_action IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
 OR length(p_input::text)>4000 OR jsonb_typeof(p_input->'requestId')<>'string' OR COALESCE(p_input->>'requestId','') !~ '^[A-Za-z0-9._:-]{8,128}$'
 THEN RETURN '{"error":"invalid_body"}'; END IF;
 SELECT * INTO v_class FROM public.classrooms WHERE id=p_class FOR UPDATE;
 v_payload:=jsonb_build_object('action',p_action,'input',p_input);
 SELECT * INTO v_prior FROM public.classroom_journal_receipts WHERE classroom_id=p_class AND actor_id=p_actor AND request_id=p_input->>'requestId';
 IF v_prior.actor_id IS NOT NULL THEN
 IF v_prior.payload<>v_payload THEN RETURN '{"error":"idempotency_conflict"}'; END IF;
 RETURN v_prior.result;
 END IF;
 IF v_class.status<>'active' THEN RETURN '{"error":"classroom_archived"}'; END IF;
 SELECT * INTO v_scale FROM public.classroom_journal_scales WHERE classroom_id=p_class ORDER BY version DESC LIMIT 1;
 IF p_action='scale' THEN
 IF p_input-ARRAY['requestId','expectedRevision','preset']<>'{}'::jsonb OR jsonb_typeof(p_input->'preset')<>'string' OR jsonb_typeof(p_input->'expectedRevision')<>'number' OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR COALESCE(p_input->>'preset','') NOT IN ('five','hundred','three_five','smileys','symbols') THEN RETURN '{"error":"invalid_scale"}'; END IF;
 IF (p_input->>'expectedRevision')::integer<>COALESCE(v_scale.version,0) THEN RETURN '{"error":"revision_conflict"}'; END IF;
 INSERT INTO public.classroom_journal_scales(tenant_id,classroom_id,version,preset,time_zone,created_by)
 VALUES(v_class.tenant_id,p_class,COALESCE(v_scale.version,0)+1,p_input->>'preset',public.classroom_journal_timezone(p_class),p_actor) RETURNING id INTO v_id;
 v_result:=public.classroom_journal_scale_json(p_class);
 ELSIF p_action='column' THEN
 IF p_input-ARRAY['requestId','expectedRevision','date','category']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'expectedRevision')<>'number' OR jsonb_typeof(p_input->'date')<>'string' OR jsonb_typeof(p_input->'category')<>'string'
 OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR COALESCE(p_input->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 OR COALESCE(length(btrim(p_input->>'category')),0) NOT BETWEEN 1 AND 80 OR p_input->>'category' ~ '[[:cntrl:]]'
 THEN RETURN '{"error":"invalid_column"}'; END IF;
 BEGIN
 IF (p_input->>'date')::date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN RETURN '{"error":"invalid_date"}'; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN '{"error":"invalid_date"}'; END;
 IF (p_input->>'expectedRevision')::integer<>COALESCE(v_scale.version,0) THEN RETURN '{"error":"revision_conflict"}'; END IF;
 IF v_scale.id IS NULL THEN
 INSERT INTO public.classroom_journal_scales(tenant_id,classroom_id,version,preset,time_zone,created_by)
 VALUES(v_class.tenant_id,p_class,1,'five',public.classroom_journal_timezone(p_class),p_actor) RETURNING * INTO v_scale;
 END IF;
 INSERT INTO public.classroom_journal_columns(tenant_id,classroom_id,lesson_date,category,scale_id,created_by)
 VALUES(v_class.tenant_id,p_class,(p_input->>'date')::date,btrim(p_input->>'category'),v_scale.id,p_actor) RETURNING id INTO v_id;
 v_result:=jsonb_build_object('id',v_id);
 ELSE
 IF p_input-ARRAY['requestId','expectedRevision','columnId','seatId','value','reason']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'expectedRevision')<>'number' OR jsonb_typeof(p_input->'columnId')<>'string' OR jsonb_typeof(p_input->'seatId')<>'string'
 OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR COALESCE(p_input->>'columnId','') !~ '^[0-9a-fA-F-]{36}$' OR COALESCE(p_input->>'seatId','') !~ '^[0-9a-fA-F-]{36}$'
 OR NOT(p_input?'value') OR (p_input->>'value' IS NOT NULL AND (jsonb_typeof(p_input->'value')<>'number' OR p_input->>'value' !~ '^[0-9]{1,3}$'))
 OR (p_input->>'reason' IS NOT NULL AND (jsonb_typeof(p_input->'reason')<>'string' OR length(btrim(p_input->>'reason')) NOT BETWEEN 1 AND 500 OR p_input->>'reason' ~ '[[:cntrl:]]'))
 THEN RETURN '{"error":"invalid_grade"}'; END IF;
 BEGIN v_seat:=(p_input->>'seatId')::uuid; v_id:=(p_input->>'columnId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_grade"}'; END;
 SELECT * INTO v_column FROM public.classroom_journal_columns WHERE id=v_id AND classroom_id=p_class;
 IF v_column.id IS NULL THEN RETURN '{"error":"not_found"}'; END IF;
 PERFORM 1 FROM public.classroom_student_seats WHERE id=v_seat AND classroom_id=p_class AND status IN ('issued','active') FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO v_scale FROM public.classroom_journal_scales WHERE id=v_column.scale_id;
 v_value:=(p_input->>'value')::integer;
 IF v_value IS NOT NULL AND NOT (CASE v_scale.preset WHEN 'hundred' THEN v_value BETWEEN 0 AND 100
 WHEN 'three_five' THEN v_value IN (3,4,5) WHEN 'five' THEN v_value BETWEEN 0 AND 5 ELSE v_value BETWEEN 1 AND 5 END)
 THEN RETURN '{"error":"invalid_grade"}'; END IF;
 SELECT * INTO v_latest FROM public.classroom_journal_revisions WHERE column_id=v_column.id AND seat_id=v_seat ORDER BY revision DESC LIMIT 1;
 IF v_latest.id IS NULL AND v_value IS NULL THEN RETURN '{"error":"invalid_grade"}'; END IF;
 v_expected:=(p_input->>'expectedRevision')::integer;
 IF v_expected<>COALESCE(v_latest.revision,0) THEN RETURN '{"error":"revision_conflict"}'; END IF;
 IF v_value IS NULL AND v_latest.id IS NOT NULL AND COALESCE(length(btrim(p_input->>'reason')),0)=0 THEN RETURN '{"error":"reason_required"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.learner_identity_links WHERE seat_id=v_seat) THEN
 PERFORM public.learning_audience_ensure_seat_identity(v_seat); END IF;
 SELECT learner_identity_id INTO v_learner FROM public.learner_identity_links
 WHERE seat_id=v_seat AND link_kind='student_seat' AND status='active' AND disabled_at IS NULL FOR SHARE;
 IF v_learner IS NULL OR (v_latest.id IS NOT NULL AND v_latest.learner_identity_id<>v_learner) THEN RETURN '{"error":"not_found"}'; END IF;
 PERFORM 1 FROM public.learner_identities WHERE id=v_learner AND state='active'
 AND tenant_id=v_class.tenant_id AND school_id=v_class.school_id FOR SHARE;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 INSERT INTO public.classroom_journal_revisions(tenant_id,classroom_id,column_id,seat_id,learner_identity_id,revision,value,supersedes_id,reason,author_id)
 VALUES(v_class.tenant_id,p_class,v_column.id,v_seat,v_learner,v_expected+1,v_value,v_latest.id,NULLIF(btrim(p_input->>'reason'),''),p_actor) RETURNING id INTO v_id;
 v_result:=public.classroom_journal_revision_json(v_id);
 -- Transactional inbox creation: failure rolls back grade, receipt and audit.
 -- Canonical Account and Seat each get one event in their existing inbox.
 PERFORM public.student_seat_principal(v_seat);
 FOR v_recipient IN
 SELECT actor.id FROM public.principals actor WHERE actor.kind='student_seat' AND actor.seat_id=v_seat
 UNION
 SELECT actor.id FROM public.learner_identity_links link
 JOIN public.accounts account ON account.id=link.account_id AND account.status='active'
 JOIN public.principals actor ON actor.account_id=account.id AND actor.kind='account'
 WHERE link.link_kind='account' AND link.status='active' AND link.disabled_at IS NULL
 AND link.learner_identity_id=v_learner AND link.tenant_id=v_class.tenant_id AND link.school_id=v_class.school_id
 ORDER BY 1 LOOP
 PERFORM public.classroom_journal_notification_emit(v_recipient,v_id,CASE WHEN v_latest.id IS NULL THEN 'NF04' ELSE 'NF05' END);
 v_emitted:=v_emitted+1;
 END LOOP;
 IF v_emitted=0 THEN RAISE EXCEPTION 'journal notification recipient unavailable'; END IF;
 END IF;
 INSERT INTO public.classroom_journal_receipts(tenant_id,classroom_id,actor_id,request_id,payload,result)
 VALUES(v_class.tenant_id,p_class,p_actor,p_input->>'requestId',v_payload,v_result);
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_class.tenant_id,NULL,'classroom',p_class,'classroom.journal.'||p_action,
 jsonb_build_object('actorId',p_actor,'requestId',p_input->>'requestId','evidenceId',v_id));
 RETURN v_result;
END;
$$;
