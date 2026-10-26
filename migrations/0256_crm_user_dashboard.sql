-- Read-only retained facts for the exact authorized CRM subject. No rewards,
-- identity preparation, linked-account merging or historical backfill.
CREATE FUNCTION public.crm_user_dashboard(p_actor uuid,p_kind varchar,p_target uuid,p_class uuid,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
DECLARE v_at timestamptz:=statement_timestamp(); v_from timestamptz;
 v_class uuid; v_rating jsonb; v_result jsonb;
BEGIN
 IF NOT coalesce(public.crm_subject_allowed(p_actor,p_kind,p_target,p_class),false)
 THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_kind='student' THEN
   SELECT classroom_id INTO v_class FROM public.classroom_student_seats WHERE id=p_target;
   IF p_class IS NOT NULL AND p_class IS DISTINCT FROM v_class
   THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
   SELECT item INTO v_rating FROM public.classroom_participant_metrics(v_class)
    WHERE item->>'seatId'=p_target::text;
 END IF;
 v_from:=date_trunc('day',v_at)-interval '29 days';
 WITH actors AS MATERIALIZED (
   SELECT id FROM public.principals WHERE
    (p_kind='account' AND kind='account' AND account_id=p_target) OR
    (p_kind='student' AND kind='student_seat' AND seat_id=p_target)
 ), owned AS MATERIALIZED (
   SELECT p.id,p.updated_at,p.module_key FROM public.projects p JOIN actors a ON a.id=p.owner_principal_id
    WHERE p_kind='account' OR p.classroom_id=v_class
 ), events AS MATERIALIZED (
   SELECT e.id,e.occurred_at,e.event_type,e.module_key
   FROM public.product_analytics_events e
   WHERE ((p_kind='account' AND e.actor_kind='account' AND e.account_id=p_target)
      OR (p_kind='student' AND e.actor_kind='student' AND e.seat_id=p_target))
    AND e.occurred_at>=v_from AND e.occurred_at<=v_at
    AND coalesce(e.persisted_at,e.received_at,e.occurred_at)<=v_at
 ), latest_events AS MATERIALIZED (
   SELECT e.id::text key,e.occurred_at,e.event_type,e.module_key
   FROM public.product_analytics_events e
   WHERE ((p_kind='account' AND e.actor_kind='account' AND e.account_id=p_target)
      OR (p_kind='student' AND e.actor_kind='student' AND e.seat_id=p_target))
    AND e.occurred_at<=v_at AND coalesce(e.persisted_at,e.received_at,e.occurred_at)<=v_at
   ORDER BY e.occurred_at DESC,e.id DESC LIMIT 5
 ), ai AS MATERIALIZED (
   SELECT u.request_id,u.admitted_at,u.status,u.error_code,u.input_tokens,u.output_tokens,true detailed
   FROM public.ai_usage_journal u JOIN actors a ON a.id=u.owner_principal_id
   WHERE ((p_kind='account' AND u.account_id=p_target AND u.seat_id IS NULL)
       OR (p_kind='student' AND u.seat_id=p_target AND u.account_id IS NULL))
    AND u.admitted_at>=v_from AND u.admitted_at<=v_at
   UNION ALL
   SELECT q.request_id,q.created_at,'legacy_unknown',NULL,NULL,NULL,false
   FROM public.ai_assistant_request_quota q JOIN actors a ON a.id=q.owner_principal_id
   WHERE q.created_at>=v_from AND q.created_at<=v_at
    AND NOT EXISTS(SELECT 1 FROM public.ai_usage_journal u
      WHERE u.owner_principal_id=q.owner_principal_id AND u.request_id=q.request_id)
 ), latest_ai AS (
   SELECT key,occurred_at,'ai.request'::varchar event_type,'ai'::varchar module_key FROM (
     (SELECT u.request_id::text key,u.admitted_at occurred_at
      FROM public.ai_usage_journal u JOIN actors a ON a.id=u.owner_principal_id
      WHERE u.admitted_at<=v_at ORDER BY u.admitted_at DESC,u.request_id DESC LIMIT 5)
     UNION ALL
     (SELECT q.request_id::text key,q.created_at occurred_at
      FROM public.ai_assistant_request_quota q JOIN actors a ON a.id=q.owner_principal_id
      WHERE q.created_at<=v_at AND NOT EXISTS(SELECT 1 FROM public.ai_usage_journal u
        WHERE u.owner_principal_id=q.owner_principal_id AND u.request_id=q.request_id)
      ORDER BY q.created_at DESC,q.request_id DESC LIMIT 5)
   ) retained ORDER BY occurred_at DESC,key LIMIT 5
 ), latest_projects AS (
   SELECT id::text key,updated_at occurred_at,'project.updated'::varchar event_type,module_key
   FROM owned WHERE updated_at<=v_at ORDER BY updated_at DESC,id DESC LIMIT 5
 ), actions AS MATERIALIZED (
   SELECT * FROM (SELECT * FROM latest_events UNION ALL SELECT * FROM latest_ai
     UNION ALL SELECT * FROM latest_projects) facts
   ORDER BY occurred_at DESC,event_type,key LIMIT 5
 ), seen AS (
   SELECT max(last_seen_at) at FROM public.sessions_v2 s JOIN actors a ON a.id=s.principal_id
    WHERE p_kind='account' AND s.last_seen_at<=v_at
   UNION ALL SELECT max(last_seen_at) FROM public.classroom_student_sessions
    WHERE p_kind='student' AND seat_id=p_target AND last_seen_at<=v_at
 ), event_days AS (
   SELECT occurred_at::date AS day,count(*) n FROM events GROUP BY occurred_at::date
 ), ai_days AS (
   SELECT admitted_at::date AS day,count(*) n FROM ai GROUP BY admitted_at::date
 ), days AS (
   SELECT v_from::date+n AS day FROM generate_series(0,29) n
 )
 SELECT jsonb_build_object(
   'generatedAt',v_at,'period',jsonb_build_object('days',30,'timeZone','UTC','from',v_from,'to',v_at),
   'lastSeenAt',greatest((SELECT max(at) FROM seen),(SELECT max(occurred_at) FROM latest_events)),
   'lastActionAt',(SELECT max(occurred_at) FROM actions),
   'totals',jsonb_build_object('projects',(SELECT count(*) FROM owned),
     'publications',(SELECT count(*) FROM (
       SELECT s.project_id FROM public.project_publication_state s JOIN owned o ON o.id=s.project_id
       UNION SELECT g.project_id FROM public.project_publications g JOIN owned o ON o.id=g.project_id
     ) retained_publications),
     'events',(SELECT count(*) FROM events),'aiRequests',(SELECT count(*) FROM ai),
     'aiErrors',(SELECT count(*) FROM ai WHERE status='failed' OR error_code IS NOT NULL),
     'inputTokens',(SELECT sum(input_tokens)::text FROM ai),
     'outputTokens',(SELECT sum(output_tokens)::text FROM ai)),
   'activity',(SELECT jsonb_agg(jsonb_build_object('date',d.day,'events',coalesce(e.n,0),
     'aiRequests',coalesce(a.n,0)) ORDER BY d.day) FROM days d
     LEFT JOIN event_days e ON e.day=d.day LEFT JOIN ai_days a ON a.day=d.day),
   'latestActions',coalesce((SELECT jsonb_agg(jsonb_build_object('occurredAt',occurred_at,
     'eventType',event_type,'module',module_key) ORDER BY occurred_at DESC,event_type,key) FROM actions),'[]'::jsonb),
   'rating',CASE WHEN p_kind='student' THEN jsonb_build_object('kind','classroom','value',v_rating->'score',
     'rank',v_rating->'rank','label','Рейтинг в классе',
     'periodDays',(public.classroom_participant_settings_json(v_class)->>'periodDays')::integer)
     ELSE jsonb_build_object('kind','not_configured','value',NULL,'rank',NULL,'periodDays',NULL,'label','Общий рейтинг пока не настроен') END,
   'coverage',jsonb_build_object('activityFrom',(SELECT min(occurred_at) FROM events),'limited',true,
     'aiDetailedRequests',(SELECT count(*) FROM ai WHERE detailed),
     'tokenRequests',(SELECT count(*) FROM ai WHERE input_tokens IS NOT NULL AND output_tokens IS NOT NULL))
 ) INTO v_result;
 PERFORM public.crm_audit(p_actor,p_kind,p_target,p_class,'crm.dashboard.read',NULL,p_request,NULL,NULL);
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_user_dashboard(uuid,varchar,uuid,uuid,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_user_dashboard(uuid,varchar,uuid,uuid,varchar) TO asalab_app;
