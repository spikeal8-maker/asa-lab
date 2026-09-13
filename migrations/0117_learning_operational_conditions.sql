-- Operational overrides do not rewrite authored/published or original run snapshots.
ALTER TABLE activity_runs ADD COLUMN operational_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN conditions_revision integer NOT NULL DEFAULT 1,
 ADD COLUMN assignment_timezone varchar(80);
ALTER TABLE activity_participations ADD COLUMN operational_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN conditions_revision integer NOT NULL DEFAULT 1;
ALTER TABLE learning_attempts ADD COLUMN effective_conditions_at_start jsonb;

CREATE OR REPLACE FUNCTION learning_effective_conditions_internal(p_run uuid,p_part uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH scope AS (
 SELECT run.*,part.operational_overrides AS individual,part.extra_attempts,part.teacher_unlocked,
   part.opens_at_override,part.due_at_override,part.closes_at_override,
   version.policy_snapshot FROM public.activity_runs run
 JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
 LEFT JOIN public.activity_participations part ON part.id=p_part AND part.activity_run_id=run.id
 WHERE run.id=p_run
 ), resolved AS (
 SELECT key,
 CASE WHEN individual?key THEN individual->key
      WHEN key='opensAt' AND opens_at_override IS NOT NULL THEN to_jsonb(opens_at_override)
      WHEN key='dueAt' AND due_at_override IS NOT NULL THEN to_jsonb(due_at_override)
      WHEN key='closesAt' AND closes_at_override IS NOT NULL THEN to_jsonb(closes_at_override)
      WHEN operational_overrides?key THEN operational_overrides->key
      WHEN key='opensAt' THEN to_jsonb(COALESCE(opens_at_override,opens_at))
      WHEN key='dueAt' THEN to_jsonb(COALESCE(due_at_override,due_at))
      WHEN key='closesAt' THEN to_jsonb(COALESCE(closes_at_override,closes_at))
      WHEN key='attemptLimit' THEN COALESCE(runtime_policy_snapshot#>'{explicit,attemptLimit}',policy_snapshot#>'{attemptPolicy,maxAttempts}','1'::jsonb)
      WHEN key='latePolicy' THEN to_jsonb(COALESCE(late_policy,policy_snapshot#>>'{latePolicy,mode}','allow_until_close')) END AS value,
 CASE WHEN individual?key THEN 'participation_override'
      WHEN key='opensAt' AND opens_at_override IS NOT NULL OR key='dueAt' AND due_at_override IS NOT NULL
        OR key='closesAt' AND closes_at_override IS NOT NULL THEN 'participation_override'
      WHEN operational_overrides?key THEN 'run_override'
      WHEN key='attemptLimit' AND runtime_policy_snapshot#>'{explicit,attemptLimit}' IS NULL
        OR key='latePolicy' AND late_policy IS NULL THEN 'activity_version' ELSE 'run_pin' END AS source
 FROM scope CROSS JOIN unnest(ARRAY['opensAt','dueAt','closesAt','attemptLimit','latePolicy']) key
 ) SELECT jsonb_build_object('values',jsonb_object_agg(key,value),'sources',jsonb_object_agg(key,source),
   'extraAttempts',COALESCE((SELECT extra_attempts FROM scope),0),
   'teacherUnlocked',COALESCE((SELECT teacher_unlocked FROM scope),false),'timezone',(SELECT assignment_timezone FROM scope)) FROM resolved;
$$;
REVOKE ALL ON FUNCTION learning_effective_conditions_internal(uuid,uuid) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION learning_conditions_for_teacher(p_account uuid,p_class uuid,p_assignment uuid,p_seat uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('runId',run.id,'participationId',part.id,
   'revision',CASE WHEN p_seat IS NULL THEN run.conditions_revision ELSE part.conditions_revision END,
   'overrides',CASE WHEN p_seat IS NULL THEN run.operational_overrides ELSE part.operational_overrides END,
   'effective',public.learning_effective_conditions_internal(run.id,part.id))
 FROM public.activity_runs run
 LEFT JOIN public.learner_identity_links link ON link.seat_id=p_seat AND link.status='active'
   AND link.tenant_id=run.tenant_id AND link.school_id=run.school_id
 LEFT JOIN public.activity_participations part ON part.activity_run_id=run.id AND part.learner_identity_id=link.learner_identity_id
 WHERE run.classroom_id=p_class AND run.source_classroom_assignment_id=p_assignment
   AND (p_seat IS NULL OR part.id IS NOT NULL)
   AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class
     AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher'));
$$;

CREATE OR REPLACE FUNCTION learning_conditions_save(p_account uuid,p_actor uuid,p_class uuid,p_assignment uuid,p_seat uuid,
 p_expected integer,p_values jsonb,p_reason varchar,p_request varchar)
RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_run record; v_part public.activity_participations%ROWTYPE; v_revision integer; v_old jsonb; v_target uuid; v_event jsonb;
 v_effective jsonb; v_opens timestamptz; v_due timestamptz; v_closes timestamptz; v_key text;
BEGIN
 IF jsonb_typeof(p_values)<>'object' OR p_values IS NULL
 OR p_values-ARRAY['opensAt','dueAt','closesAt','attemptLimit','latePolicy']<>'{}'::jsonb
 OR length(trim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 1000
 OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RETURN 'invalid_conditions'; END IF;
 FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
   IF v_key IN ('opensAt','dueAt','closesAt') AND p_values->v_key<>'null'::jsonb
     AND (jsonb_typeof(p_values->v_key)<>'string' OR p_values->>v_key !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$') THEN RETURN 'invalid_datetime'; END IF;
 END LOOP;
 IF p_values?'attemptLimit' AND p_values->'attemptLimit'<>'null'::jsonb
   AND (jsonb_typeof(p_values->'attemptLimit')<>'number' OR p_values->>'attemptLimit' !~ '^[0-9]+$'
     OR (p_values->>'attemptLimit')::integer NOT BETWEEN 1 AND 100) THEN RETURN 'invalid_attempt_limit'; END IF;
 IF p_values?'latePolicy' AND (p_values->>'latePolicy' IS NULL OR p_values->>'latePolicy' NOT IN ('allow_until_close','allow_mark_late','block_at_due')) THEN RETURN 'invalid_late_policy'; END IF;
 SELECT run.* INTO v_run FROM public.activity_runs run WHERE run.classroom_id=p_class
   AND run.source_classroom_assignment_id=p_assignment
   AND EXISTS(SELECT 1 FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id
     WHERE m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher') AND actor.id=p_actor)
 FOR UPDATE;
 IF v_run.id IS NULL THEN RETURN 'forbidden'; END IF;
 IF p_seat IS NOT NULL THEN
   SELECT part.* INTO v_part FROM public.activity_participations part
   JOIN public.learner_identity_links link ON link.learner_identity_id=part.learner_identity_id
     AND link.seat_id=p_seat AND link.status='active' WHERE part.activity_run_id=v_run.id FOR UPDATE OF part;
   IF v_part.id IS NULL THEN RETURN 'forbidden'; END IF;
   v_target:=v_part.id;v_revision:=v_part.conditions_revision;v_old:=v_part.operational_overrides;
 ELSE v_target:=v_run.id;v_revision:=v_run.conditions_revision;v_old:=v_run.operational_overrides; END IF;
 SELECT payload_json INTO v_event FROM public.audit_events WHERE entity_id=v_target
   AND action='learning.conditions.changed' AND payload_json->>'requestId'=p_request LIMIT 1;
 IF v_event IS NOT NULL THEN
   IF v_event->'overrides'=p_values AND v_event->>'actorPrincipalId'=p_actor::text
     AND v_event->>'reason'=p_reason AND (v_event->>'expectedRevision')::integer=p_expected THEN RETURN 'ok'; END IF;
   RETURN 'request_conflict';
 END IF;
 IF v_revision IS DISTINCT FROM p_expected THEN RETURN 'conditions_conflict'; END IF;
 IF v_run.lifecycle_status<>'active' OR (p_seat IS NOT NULL AND v_part.status='withdrawn') THEN RETURN 'not_available'; END IF;
 -- Save and validate all affected effective windows atomically, rolling back on any invalid combination.
 BEGIN
   IF p_seat IS NULL THEN UPDATE public.activity_runs SET operational_overrides=p_values,conditions_revision=conditions_revision+1 WHERE id=v_run.id;
   ELSE UPDATE public.activity_participations SET operational_overrides=p_values,conditions_revision=conditions_revision+1 WHERE id=v_part.id; END IF;
   FOR v_effective IN SELECT public.learning_effective_conditions_internal(v_run.id,part.id)
     FROM public.activity_participations part WHERE part.activity_run_id=v_run.id AND (p_seat IS NULL OR part.id=v_part.id)
     UNION ALL SELECT public.learning_effective_conditions_internal(v_run.id,NULL) WHERE p_seat IS NULL
   LOOP
     v_opens:=(v_effective#>>'{values,opensAt}')::timestamptz;
     v_due:=(v_effective#>>'{values,dueAt}')::timestamptz;
     v_closes:=(v_effective#>>'{values,closesAt}')::timestamptz;
     IF v_opens>v_due OR v_due>v_closes OR v_opens>v_closes THEN RAISE EXCEPTION 'invalid_window' USING ERRCODE='22023'; END IF;
   END LOOP;
 EXCEPTION WHEN invalid_parameter_value OR invalid_datetime_format OR datetime_field_overflow THEN RETURN 'invalid_window'; END;
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_run.tenant_id,NULL,CASE WHEN p_seat IS NULL THEN 'activity_run' ELSE 'activity_participation' END,v_target,
   'learning.conditions.changed',jsonb_build_object('actorPrincipalId',p_actor,'expectedRevision',p_expected,
   'previous',v_old,'overrides',p_values,'reason',p_reason,'requestId',p_request,'classroomId',p_class,'assignmentId',p_assignment));
 RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION learning_conditions_for_teacher(uuid,uuid,uuid,uuid),
 learning_conditions_save(uuid,uuid,uuid,uuid,uuid,integer,jsonb,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_conditions_for_teacher(uuid,uuid,uuid,uuid),
 learning_conditions_save(uuid,uuid,uuid,uuid,uuid,integer,jsonb,varchar,varchar) TO asalab_app;
