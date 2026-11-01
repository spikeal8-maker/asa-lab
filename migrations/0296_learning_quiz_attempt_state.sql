-- Q2a draft: persisted canonical Quiz Start/read/save; no final submission.
-- The migration number is provisional until the dependent drafts integrate.
ALTER TABLE learning_attempts ADD COLUMN expires_at timestamptz;

CREATE TABLE quiz_attempt_states (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    attempt_id uuid PRIMARY KEY,
    participation_attempt_number integer NOT NULL CHECK (participation_attempt_number>0),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    answers_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers_jsonb)='object'),
    selected_questions_jsonb jsonb NOT NULL CHECK (jsonb_typeof(selected_questions_jsonb)='array'),
    question_order_jsonb jsonb NOT NULL CHECK (jsonb_typeof(question_order_jsonb)='array'),
    option_order_jsonb jsonb NOT NULL CHECK (jsonb_typeof(option_order_jsonb)='object'),
    content_snapshot jsonb NOT NULL,
    policy_snapshot jsonb NOT NULL,
    last_saved_at timestamptz,
    FOREIGN KEY (tenant_id,attempt_id) REFERENCES learning_attempts(tenant_id,id)
);
CREATE TABLE quiz_attempt_start_receipts (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    participation_id uuid NOT NULL,
    request_id varchar(128) NOT NULL,
    attempt_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (participation_id,request_id),
    FOREIGN KEY (tenant_id,participation_id) REFERENCES activity_participations(tenant_id,id),
    FOREIGN KEY (tenant_id,attempt_id) REFERENCES learning_attempts(tenant_id,id)
);
REVOKE ALL ON quiz_attempt_states,quiz_attempt_start_receipts FROM PUBLIC,asalab_app;
ALTER TABLE quiz_attempt_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempt_states FORCE ROW LEVEL SECURITY;
CREATE POLICY quiz_attempt_states_tenant ON quiz_attempt_states
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE quiz_attempt_start_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempt_start_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY quiz_attempt_start_receipts_tenant ON quiz_attempt_start_receipts
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE FUNCTION learning_quiz_state_immutable_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
   OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
   OR NEW.participation_attempt_number IS DISTINCT FROM OLD.participation_attempt_number
   OR NEW.selected_questions_jsonb IS DISTINCT FROM OLD.selected_questions_jsonb
   OR NEW.question_order_jsonb IS DISTINCT FROM OLD.question_order_jsonb
   OR NEW.option_order_jsonb IS DISTINCT FROM OLD.option_order_jsonb
   OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
   OR NEW.policy_snapshot IS DISTINCT FROM OLD.policy_snapshot THEN
   RAISE EXCEPTION 'Quiz Start snapshots are immutable';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION learning_quiz_state_immutable_guard() FROM PUBLIC,asalab_app;
CREATE TRIGGER quiz_attempt_states_frozen BEFORE UPDATE OR DELETE ON quiz_attempt_states
 FOR EACH ROW EXECUTE FUNCTION learning_quiz_state_immutable_guard();
CREATE TRIGGER quiz_attempt_start_receipts_immutable BEFORE UPDATE OR DELETE ON quiz_attempt_start_receipts
 FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();

-- The actor comes from a verified session, never from the request body. Identity
-- follows the stable school learner; a replacement Seat does not reset history.
CREATE FUNCTION learning_quiz_scope_internal(p_actor uuid,p_part uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('tenantId',part.tenant_id,'participationId',part.id,
   'learnerIdentityId',part.learner_identity_id,'classroomId',run.classroom_id,
   'assignmentId',run.source_classroom_assignment_id,'activityRunId',run.id,
   'activityVersionId',version.id,'quizVersionId',quiz.id,'seatId',current_seat.id,
   'policy',version.policy_snapshot,'contentDigest',quiz.content_digest,
   'timeOverrideSeconds',part.time_limit_override_seconds,
   'runTimeMinutes',run.runtime_policy_snapshot#>'{explicit,timeLimitMinutes}',
   'effective',public.learning_effective_conditions_internal(run.id,part.id),
   'available',part.status IN ('assigned','active') AND NOT part.excused AND run.lifecycle_status='active'
     AND classroom.status='active' AND handout.status='open'
     AND (run.source_kind<>'course' OR course.status='open')
     AND (part.source_course_enrollment_id IS NULL OR enrollment.status='active'))
 FROM public.activity_participations part
 JOIN public.learner_identities learner ON learner.tenant_id=part.tenant_id
   AND learner.school_id=part.school_id AND learner.id=part.learner_identity_id AND learner.state='active'
 JOIN public.activity_runs run ON run.tenant_id=part.tenant_id AND run.school_id=part.school_id
   AND run.id=part.activity_run_id
 JOIN public.classrooms classroom ON classroom.tenant_id=run.tenant_id AND classroom.id=run.classroom_id
 JOIN public.classroom_assignments handout ON handout.tenant_id=run.tenant_id
   AND handout.classroom_id=run.classroom_id AND handout.id=run.source_classroom_assignment_id
 JOIN public.learning_activity_versions version ON version.tenant_id=run.tenant_id
   AND version.id=run.learning_activity_version_id AND version.canonical_kind='quiz'
 JOIN public.quiz_versions quiz ON quiz.tenant_id=version.tenant_id
   AND quiz.id=version.quiz_version_id
 LEFT JOIN public.classroom_course_runs course ON course.tenant_id=run.tenant_id AND course.id=run.source_course_run_id
 LEFT JOIN public.course_enrollments enrollment ON enrollment.tenant_id=part.tenant_id
   AND enrollment.id=part.source_course_enrollment_id AND enrollment.learner_identity_id=part.learner_identity_id
 JOIN public.principals actor ON actor.id=p_actor
 JOIN LATERAL (
   SELECT seat.id FROM public.classroom_student_seats seat
   JOIN public.learner_identity_links seat_link ON seat_link.tenant_id=part.tenant_id
     AND seat_link.school_id=part.school_id AND seat_link.learner_identity_id=part.learner_identity_id
     AND seat_link.link_kind='student_seat' AND seat_link.seat_id=seat.id AND seat_link.status='active'
   WHERE seat.tenant_id=part.tenant_id AND seat.classroom_id=run.classroom_id AND seat.status='active'
     AND ((actor.kind='student_seat' AND actor.seat_id=seat.id)
       OR (actor.kind='account' AND seat.account_id=actor.account_id
         AND EXISTS (SELECT 1 FROM public.accounts account WHERE account.id=actor.account_id AND account.status='active')
         AND EXISTS (
         SELECT 1 FROM public.learner_identity_links account_link
         WHERE account_link.tenant_id=part.tenant_id AND account_link.school_id=part.school_id
           AND account_link.learner_identity_id=part.learner_identity_id
           AND account_link.link_kind='account' AND account_link.account_id=actor.account_id
           AND account_link.status='active')))
   ORDER BY seat.id LIMIT 1
 ) current_seat ON true
 WHERE part.id=p_part;
$$;
REVOKE ALL ON FUNCTION learning_quiz_scope_internal(uuid,uuid) FROM PUBLIC,asalab_app;

CREATE FUNCTION learning_quiz_window_open_internal(p_scope jsonb,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE((p_scope->>'available')::boolean,false)
   AND (p_scope#>>'{effective,values,opensAt}' IS NULL OR (p_scope#>>'{effective,values,opensAt}')::timestamptz<=p_at)
   AND (p_scope#>>'{effective,values,closesAt}' IS NULL OR (p_scope#>>'{effective,values,closesAt}')::timestamptz>p_at)
   AND (p_scope#>>'{effective,values,latePolicy}' IS DISTINCT FROM 'block_at_due'
     OR COALESCE((p_scope#>>'{effective,teacherUnlocked}')::boolean,false)
     OR p_scope#>>'{effective,values,dueAt}' IS NULL OR (p_scope#>>'{effective,values,dueAt}')::timestamptz>=p_at);
$$;
REVOKE ALL ON FUNCTION learning_quiz_window_open_internal(jsonb,timestamptz) FROM PUBLIC,asalab_app;

CREATE FUNCTION learning_quiz_attempt_read(p_actor uuid,p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_scope jsonb; v_attempt public.learning_attempts%ROWTYPE; v_state public.quiz_attempt_states%ROWTYPE;
BEGIN
 SELECT attempt.* INTO v_attempt FROM public.learning_attempts attempt WHERE attempt.id=p_attempt;
 IF v_attempt.id IS NULL OR v_attempt.activity_participation_id IS NULL THEN RETURN NULL; END IF;
 v_scope:=public.learning_quiz_scope_internal(p_actor,v_attempt.activity_participation_id);
 IF v_scope IS NULL THEN RETURN NULL; END IF;
 SELECT state.* INTO v_state FROM public.quiz_attempt_states state
 WHERE state.tenant_id=v_attempt.tenant_id AND state.attempt_id=v_attempt.id;
 IF v_state.attempt_id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('attemptId',v_attempt.id,'participationId',v_attempt.activity_participation_id,
   'activityRunId',v_scope->'activityRunId','activityVersionId',v_attempt.learning_activity_version_id,
   'attemptNumber',v_state.participation_attempt_number,'state',v_attempt.state,'startedAt',v_attempt.started_at,
   'expiresAt',v_attempt.expires_at,'serverNow',clock_timestamp(),'version',v_state.version,
   'answers',v_state.answers_jsonb,'questions',v_state.selected_questions_jsonb,
   'questionOrder',v_state.question_order_jsonb,'optionOrder',v_state.option_order_jsonb,
   'lastSavedAt',v_state.last_saved_at);
END;
$$;

CREATE FUNCTION learning_quiz_attempt_start(p_actor uuid,p_part uuid,p_request varchar)
RETURNS TABLE(result_code varchar,attempt jsonb,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_scope jsonb; v_attempt uuid; v_count bigint; v_limit bigint; v_number integer;
 v_now timestamptz; v_seconds bigint; v_time_source text; v_questions jsonb; v_order jsonb;
 v_options jsonb; v_effective jsonb; v_next_number bigint;
BEGIN
 IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
   RETURN QUERY SELECT 'invalid_request_id'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_scope:=public.learning_quiz_scope_internal(p_actor,p_part);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb,false; RETURN; END IF;
 PERFORM 1 FROM public.activity_participations part WHERE part.id=p_part FOR UPDATE;
 -- Re-read current admission after lock acquisition, before any writes.
 v_scope:=public.learning_quiz_scope_internal(p_actor,p_part);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb,false; RETURN; END IF;
 SELECT receipt.attempt_id INTO v_attempt FROM public.quiz_attempt_start_receipts receipt
 WHERE receipt.participation_id=p_part AND receipt.request_id=p_request;
 IF v_attempt IS NOT NULL THEN
   RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,v_attempt),true; RETURN; END IF;
 SELECT a.id INTO v_attempt FROM public.learning_attempts a WHERE a.activity_participation_id=p_part
   AND a.state IN ('in_progress','submitted','evaluating') ORDER BY a.attempt_number DESC,a.id LIMIT 1;
 IF v_attempt IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.quiz_attempt_states s WHERE s.attempt_id=v_attempt) THEN
     RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
   INSERT INTO public.quiz_attempt_start_receipts(tenant_id,participation_id,request_id,attempt_id)
   VALUES((v_scope->>'tenantId')::uuid,p_part,p_request,v_attempt);
   RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,v_attempt),true; RETURN;
 END IF;
 v_now:=clock_timestamp();
 IF NOT public.learning_quiz_window_open_internal(v_scope,v_now) THEN
   RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_effective:=v_scope->'effective';
 IF v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}' IS NOT NULL
   AND v_scope#>>'{policy,attemptPolicy,timeLimitMinutes}' IS NOT NULL
   AND (v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}')::bigint
     <> (v_scope#>>'{policy,attemptPolicy,timeLimitMinutes}')::bigint*60 THEN
   RETURN QUERY SELECT 'invalid_policy'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_limit:=(v_effective#>>'{values,attemptLimit}')::bigint;
 SELECT count(*) INTO v_count FROM public.learning_attempts a WHERE a.activity_participation_id=p_part;
 IF v_count>=2147483647 THEN
   RETURN QUERY SELECT 'attempt_limit'::varchar,NULL::jsonb,false; RETURN; END IF;
 IF v_limit IS NOT NULL AND v_count>=v_limit+COALESCE((v_effective->>'extraAttempts')::bigint,0) THEN
   RETURN QUERY SELECT 'attempt_limit'::varchar,NULL::jsonb,false; RETURN; END IF;
 IF v_scope->>'timeOverrideSeconds' IS NOT NULL THEN
   v_seconds:=(v_scope->>'timeOverrideSeconds')::bigint;v_time_source:='participation_override';
 ELSIF v_scope->>'runTimeMinutes' IS NOT NULL THEN
   v_seconds:=(v_scope->>'runTimeMinutes')::bigint*60;v_time_source:='run_pin';
 ELSIF v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}' IS NOT NULL THEN
   v_seconds:=(v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}')::bigint;v_time_source:='activity_version';
 ELSE
   v_seconds:=(v_scope#>>'{policy,attemptPolicy,timeLimitMinutes}')::bigint*60;v_time_source:='activity_version';
 END IF;
 -- Build only the learner allowlist: even extra response_schema/option keys
 -- authored in old content can never disclose an answer key through this DTO.
 SELECT jsonb_agg(jsonb_build_object('id',q.id,'type',q.question_type,'promptBlocks',q.prompt_blocks,
     'maxPoints',mapped.max_points,'options',CASE WHEN q.question_type IN ('single_choice','multiple_choice')
       THEN (SELECT jsonb_agg(jsonb_build_object('id',o.value->>'id','label',o.value->>'label') ORDER BY o.ordinality)
         FROM jsonb_array_elements(q.response_schema->'options') WITH ORDINALITY o(value,ordinality))
       ELSE NULL END) ORDER BY mapped.position),
   jsonb_agg(q.id ORDER BY mapped.position),
   COALESCE(jsonb_object_agg(q.id::text,CASE WHEN q.question_type IN ('single_choice','multiple_choice')
     THEN (SELECT jsonb_agg(o.value->>'id' ORDER BY o.ordinality)
       FROM jsonb_array_elements(q.response_schema->'options') WITH ORDINALITY o(value,ordinality))
     ELSE '[]'::jsonb END),'{}'::jsonb)
 INTO v_questions,v_order,v_options
 FROM public.quiz_version_questions mapped JOIN public.question_versions q
   ON q.tenant_id=mapped.tenant_id AND q.id=mapped.question_version_id
 WHERE mapped.tenant_id=(v_scope->>'tenantId')::uuid AND mapped.quiz_version_id=(v_scope->>'quizVersionId')::uuid;
 IF v_questions IS NULL THEN RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
 -- Siblings share the compatibility handout/Seat number space, but never its
 -- budget. Serialize only that allocator in addition to the exact part lock.
 PERFORM pg_advisory_xact_lock(hashtextextended((v_scope->>'assignmentId')||':'||(v_scope->>'seatId'),0));
 SELECT COALESCE(max(a.attempt_number),0)::bigint+1 INTO v_next_number FROM public.learning_attempts a
 WHERE a.classroom_assignment_id=(v_scope->>'assignmentId')::uuid AND a.seat_id=(v_scope->>'seatId')::uuid;
 IF v_next_number>2147483647 THEN
   RETURN QUERY SELECT 'attempt_limit'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_number:=v_next_number::integer;
 v_now:=clock_timestamp();
 IF NOT public.learning_quiz_window_open_internal(v_scope,v_now) THEN
   RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
 PERFORM set_config('app.tenant_id',v_scope->>'tenantId',true);
 -- Admission above uses current effective conditions. The older standalone
 -- activation command rechecks raw Run windows, so it cannot decide this Start.
 -- Keep the same canonical transition and audit semantics atomically here.
 UPDATE public.activity_participations SET status='active',activated_at=v_now,
   activated_by_principal_id=p_actor,activation_source='meaningful_learner_interaction'
 WHERE id=p_part AND status='assigned';
 IF FOUND THEN
   INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
   VALUES((v_scope->>'tenantId')::uuid,NULL,'activity_participation',p_part,'participation.activated',
     jsonb_build_object('actorPrincipalId',p_actor,'source','meaningful_learner_interaction'));
 END IF;
 INSERT INTO public.learning_attempts(tenant_id,classroom_id,classroom_assignment_id,learning_activity_version_id,
   seat_id,learner_identity_id,activity_participation_id,attempt_number,state,started_at,expires_at,effective_conditions_at_start)
 VALUES((v_scope->>'tenantId')::uuid,(v_scope->>'classroomId')::uuid,(v_scope->>'assignmentId')::uuid,
   (v_scope->>'activityVersionId')::uuid,(v_scope->>'seatId')::uuid,(v_scope->>'learnerIdentityId')::uuid,
   p_part,v_number,'in_progress',v_now,CASE WHEN v_seconds IS NULL THEN NULL ELSE v_now+make_interval(secs=>v_seconds::double precision) END,
   v_effective||jsonb_build_object('timeLimitSeconds',v_seconds,'timeLimitSource',v_time_source)) RETURNING id INTO v_attempt;
 INSERT INTO public.quiz_attempt_states(tenant_id,attempt_id,participation_attempt_number,selected_questions_jsonb,question_order_jsonb,
   option_order_jsonb,content_snapshot,policy_snapshot)
 VALUES((v_scope->>'tenantId')::uuid,v_attempt,(v_count+1)::integer,v_questions,v_order,v_options,
   jsonb_build_object('quizVersionId',v_scope->'quizVersionId','contentDigest',v_scope->'contentDigest'),v_scope->'policy');
 INSERT INTO public.quiz_attempt_start_receipts(tenant_id,participation_id,request_id,attempt_id)
 VALUES((v_scope->>'tenantId')::uuid,p_part,p_request,v_attempt);
 RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,v_attempt),false;
END;
$$;

CREATE FUNCTION learning_quiz_attempt_save(p_actor uuid,p_attempt uuid,p_expected integer,p_answers jsonb)
RETURNS TABLE(result_code varchar,attempt jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_attempt public.learning_attempts%ROWTYPE; v_state public.quiz_attempt_states%ROWTYPE;
 v_scope jsonb; v_entry record; v_question jsonb; v_value jsonb; v_now timestamptz;
BEGIN
 SELECT a.* INTO v_attempt FROM public.learning_attempts a WHERE a.id=p_attempt;
 IF v_attempt.id IS NULL OR v_attempt.activity_participation_id IS NULL THEN
   RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 v_scope:=public.learning_quiz_scope_internal(p_actor,v_attempt.activity_participation_id);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 SELECT a.* INTO v_attempt FROM public.learning_attempts a WHERE a.id=p_attempt FOR UPDATE;
 v_scope:=public.learning_quiz_scope_internal(p_actor,v_attempt.activity_participation_id);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 SELECT s.* INTO v_state FROM public.quiz_attempt_states s WHERE s.attempt_id=p_attempt FOR UPDATE;
 IF v_state.attempt_id IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 v_now:=clock_timestamp();
 IF v_attempt.state<>'in_progress' OR (v_attempt.expires_at IS NOT NULL AND v_attempt.expires_at<=v_now)
    OR NOT public.learning_quiz_window_open_internal(v_scope,v_now) THEN
   RETURN QUERY SELECT 'quiz_attempt_closed'::varchar,NULL::jsonb; RETURN; END IF;
 IF p_expected IS DISTINCT FROM v_state.version THEN
   RETURN QUERY SELECT 'quiz_attempt_conflict'::varchar,NULL::jsonb; RETURN; END IF;
 IF v_state.version=2147483647 THEN
   RETURN QUERY SELECT 'quiz_attempt_conflict'::varchar,NULL::jsonb; RETURN; END IF;
 IF p_answers IS NULL OR jsonb_typeof(p_answers)<>'object' OR octet_length(p_answers::text)>262144 THEN
   RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
 FOR v_entry IN SELECT key,value FROM jsonb_each(p_answers) LOOP
   SELECT q.value INTO v_question FROM jsonb_array_elements(v_state.selected_questions_jsonb) q
   WHERE q.value->>'id'=v_entry.key;
   IF v_question IS NULL OR jsonb_typeof(v_entry.value)<>'object'
     OR v_question->>'type' NOT IN ('single_choice','multiple_choice','boolean','numeric','short_text') THEN
     RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
   IF v_question->>'type'='multiple_choice' THEN
     IF v_entry.value-ARRAY['values']<>'{}'::jsonb OR NOT v_entry.value?'values' THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
     v_value:=v_entry.value->'values';
   ELSE
     IF v_entry.value-ARRAY['value']<>'{}'::jsonb OR NOT v_entry.value?'value' THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
     v_value:=v_entry.value->'value';
   END IF;
   IF v_value='null'::jsonb THEN CONTINUE; END IF;
   IF (v_question->>'type'='single_choice' AND (jsonb_typeof(v_value)<>'string' OR NOT EXISTS(
       SELECT 1 FROM jsonb_array_elements(v_question->'options') o WHERE o->'id'=v_value)))
     OR (v_question->>'type'='multiple_choice' AND (jsonb_typeof(v_value)<>'array'))
     OR (v_question->>'type'='boolean' AND jsonb_typeof(v_value)<>'boolean')
     OR (v_question->>'type'='numeric' AND jsonb_typeof(v_value)<>'number')
     OR (v_question->>'type'='short_text' AND (jsonb_typeof(v_value)<>'string' OR length(v_value#>>'{}')>12000)) THEN
     RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
   IF v_question->>'type'='multiple_choice' THEN
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_value) selected
       WHERE jsonb_typeof(selected)<>'string' OR NOT EXISTS(
         SELECT 1 FROM jsonb_array_elements(v_question->'options') o WHERE o->'id'=selected))
       OR jsonb_array_length(v_value)<>(SELECT count(DISTINCT selected) FROM jsonb_array_elements(v_value) selected) THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
   END IF;
 END LOOP;
 UPDATE public.quiz_attempt_states SET answers_jsonb=p_answers,version=version+1,last_saved_at=v_now
 WHERE attempt_id=p_attempt;
 RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,p_attempt);
END;
$$;
REVOKE ALL ON FUNCTION learning_quiz_attempt_read(uuid,uuid),learning_quiz_attempt_start(uuid,uuid,varchar),
 learning_quiz_attempt_save(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_quiz_attempt_read(uuid,uuid),learning_quiz_attempt_start(uuid,uuid,varchar),
 learning_quiz_attempt_save(uuid,uuid,integer,jsonb) TO asalab_app;
