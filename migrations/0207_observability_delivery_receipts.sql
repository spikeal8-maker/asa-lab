-- OBS3B-SERVER: additive receipts and safe, scoped observations.
-- No purge: immutable operation identities/results are retained indefinitely.
-- Existing classroom project transaction/savepoint callers are unchanged.
ALTER TABLE public.product_analytics_events
  DROP CONSTRAINT product_analytics_events_event_type_check,
  ADD CONSTRAINT product_analytics_events_event_type_check CHECK(event_type IN
    ('auth.login','auth.register','auth.max','auth.class_join','session.observed','module.opened','visit.observed')),
  ADD COLUMN receipt_event_id uuid UNIQUE,
  ADD COLUMN observation_version smallint,
  ADD COLUMN received_at timestamptz,
  ADD COLUMN persisted_at timestamptz,
  ADD COLUMN visit_id uuid,
  ADD COLUMN client_occurred_at timestamptz,
  ADD COLUMN browser_family varchar(16),
  ADD COLUMN browser_major integer,
  ADD COLUMN operating_system varchar(16),
  ADD COLUMN device_category varchar(16),
  ADD COLUMN entry_route varchar(32),
  ADD COLUMN referrer_origin varchar(512),
  ADD COLUMN environment_provenance varchar(24),
  ADD COLUMN address_provenance varchar(24);
ALTER TABLE public.product_module_sessions
  ADD COLUMN visit_id uuid,
  ADD COLUMN browser_family varchar(16),
  ADD COLUMN browser_major integer,
  ADD COLUMN operating_system varchar(16),
  ADD COLUMN device_category varchar(16);
ALTER TABLE public.classroom_activity_events ADD COLUMN async_admission_bucket_at timestamptz;
CREATE UNIQUE INDEX classroom_async_admission_bucket
 ON public.classroom_activity_events(tenant_id,classroom_id,seat_id,actor_principal_id,action,async_admission_bucket_at)
 WHERE async_admission_bucket_at IS NOT NULL;
CREATE TABLE public.analytics_operation_receipts(
 event_id uuid PRIMARY KEY,
 operation varchar(48) NOT NULL,
 actor_kind varchar(16) NOT NULL,
 account_id uuid, principal_id uuid, seat_id uuid, workspace_id uuid, class_id uuid,
 binding_digest varchar(64) NOT NULL,
 received_at timestamptz NOT NULL,
 persisted_at timestamptz NOT NULL,
 result jsonb NOT NULL,
 ip_address inet, network_kind varchar(24), browser_family varchar(16), browser_major integer,
 operating_system varchar(16), device_category varchar(16),
 environment_provenance varchar(24) NOT NULL DEFAULT 'request_reported',
 address_provenance varchar(24) NOT NULL DEFAULT 'server_resolved'
);
CREATE TABLE public.analytics_quality_streams(
 stream_id uuid PRIMARY KEY,
 actor_scope varchar(128) NOT NULL,
 pipeline varchar(24) NOT NULL,
 stream_started_at timestamptz NOT NULL,
 latest_sequence bigint NOT NULL,
 counters jsonb NOT NULL
);
CREATE TABLE public.analytics_quality_snapshots(
 stream_id uuid NOT NULL REFERENCES public.analytics_quality_streams,
 sequence bigint NOT NULL,
 event_id uuid NOT NULL UNIQUE REFERENCES public.analytics_operation_receipts,
 snapshot jsonb NOT NULL,
 PRIMARY KEY(stream_id,sequence)
);
ALTER TABLE public.analytics_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_operation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_quality_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_quality_streams FORCE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_quality_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_quality_snapshots FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_operation_receipts,public.analytics_quality_streams,public.analytics_quality_snapshots FROM PUBLIC,asalab_app;

CREATE FUNCTION public.analytics_ingest_v2(
 p_event_id uuid,p_actor_kind varchar,p_account_id uuid,p_principal_id uuid,
 p_seat_id uuid,p_workspace_id uuid,p_class_id uuid,p_operation varchar,
 p_semantic jsonb,p_metadata jsonb,p_received_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 r public.analytics_operation_receipts%ROWTYPE;
 s public.product_module_sessions%ROWTYPE;
 q public.analytics_quality_streams%ROWTYPE;
 v_tenant uuid; v_project uuid; v_session uuid; v_id bigint; v_activity uuid;
 v_binding varchar(64); v_scope varchar(128); v_pipeline varchar(24); v_stream uuid;
 v_sequence bigint; v_time timestamptz; v_from timestamptz; v_to timestamptz;
 v_client timestamptz; v_bucket timestamptz; v_seconds integer:=0; v_result jsonb;
 v_key text; v_value jsonb; v_count numeric;
 v_allowed text[]; v_now timestamptz:=clock_timestamp();
BEGIN
 IF p_event_id IS NULL OR p_received_at IS NULL OR NOT isfinite(p_received_at) OR p_received_at>v_now+interval '60 seconds'
 OR jsonb_typeof(p_semantic) IS DISTINCT FROM 'object' OR octet_length(p_semantic::text)>8192
 OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR octet_length(p_metadata::text)>4096
 OR p_actor_kind IS NULL OR p_operation IS NULL THEN
  RAISE EXCEPTION 'invalid telemetry envelope' USING ERRCODE='22023';
 END IF;
 IF p_actor_kind='account' THEN
  SELECT w.tenant_id INTO v_tenant FROM public.principals p
  JOIN public.workspace_memberships m ON m.account_id=p.account_id AND m.workspace_id=p_workspace_id
  JOIN public.workspaces w ON w.id=m.workspace_id
   AND (p_operation IN('auth.login','auth.register','auth.max','session.observed') OR (m.state='active' AND w.status='active'))
  WHERE p.id=p_principal_id AND p.account_id=p_account_id AND p_seat_id IS NULL AND p_class_id IS NULL;
 ELSIF p_actor_kind='student' THEN
  SELECT seat.tenant_id INTO v_tenant FROM public.principals p
  JOIN public.classroom_student_seats seat ON seat.id=p_seat_id AND p.seat_id=seat.id
  WHERE p.id=p_principal_id AND seat.classroom_id=p_class_id
   AND (seat.status IN('issued','active') OR p_operation IN('auth.class_join','academic.signed_in','academic.signed_out'))
   AND p_account_id IS NULL AND p_workspace_id IS NULL;
 ELSIF p_actor_kind='anonymous' AND p_account_id IS NULL AND p_principal_id IS NULL AND p_seat_id IS NULL
  AND p_workspace_id IS NULL AND p_class_id IS NULL
  AND p_operation IN('auth.login','auth.register','auth.max','auth.class_join') THEN
  v_tenant:=NULL;
 ELSE
  RAISE EXCEPTION 'telemetry actor denied' USING ERRCODE='42501';
 END IF;
 IF p_actor_kind<>'anonymous' AND v_tenant IS NULL THEN
  RAISE EXCEPTION 'telemetry actor denied' USING ERRCODE='42501';
 END IF;
 IF p_operation IN('start','touch','close') THEN
  v_session:=(p_semantic->>'sessionId')::uuid;
  IF p_operation='start' THEN v_project:=(p_semantic->>'projectId')::uuid;
  ELSE SELECT project_id INTO v_project FROM public.product_module_sessions WHERE id=v_session; END IF;
  IF v_project IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.projects project JOIN public.project_context_for_principal(p_principal_id,v_project) access
   ON access.tenant_id=project.tenant_id
   WHERE project.id=v_project AND project.status<>'trashed'
   AND (p_operation<>'start' OR project.module_key=p_semantic->>'moduleKey')) THEN
   RAISE EXCEPTION 'telemetry project denied' USING ERRCODE='42501';
  END IF;
 END IF;
 -- One global namespace across events, module operations, quality and academics.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 v_binding:=encode(sha256(convert_to(p_semantic::text,'UTF8')),'hex');
 SELECT * INTO r FROM public.analytics_operation_receipts WHERE event_id=p_event_id;
 IF FOUND THEN
  IF r.operation IS DISTINCT FROM p_operation OR r.actor_kind IS DISTINCT FROM p_actor_kind
   OR r.account_id IS DISTINCT FROM p_account_id OR r.principal_id IS DISTINCT FROM p_principal_id
   OR r.seat_id IS DISTINCT FROM p_seat_id OR r.workspace_id IS DISTINCT FROM p_workspace_id
   OR r.class_id IS DISTINCT FROM p_class_id OR r.binding_digest IS DISTINCT FROM v_binding THEN
   RAISE EXCEPTION 'telemetry operation conflict' USING ERRCODE='23505';
  END IF;
  RETURN r.result;
 END IF;
 -- Strict keys at SQL boundary as well as HTTP boundary. No arbitrary stored blob.
 IF p_operation IN('start','touch','close') THEN
  v_allowed:=ARRAY['sessionId','visitId','clientOccurredAt'];
  IF p_operation='start' THEN v_allowed:=v_allowed||ARRAY['projectId','moduleKey']; END IF;
 ELSIF p_operation='quality' THEN
  v_allowed:=ARRAY['pipeline','streamId','sequence','streamStartedAt','clientObservedAt','acknowledgementStage','counters','gauges','coverage'];
 ELSIF p_operation IN('academic.signed_in','academic.signed_out') THEN v_allowed:=ARRAY['authEventId'];
 ELSIF p_operation IN('auth.login','auth.register','auth.max','auth.class_join','session.observed','module.opened','visit.observed') THEN
  v_allowed:=ARRAY['outcome','authMethod','flowId','moduleKey','visitId','clientOccurredAt','entryRoute','referrerOrigin'];
 ELSE RAISE EXCEPTION 'invalid telemetry operation' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_semantic) key WHERE NOT key=ANY(v_allowed))
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_metadata) key WHERE NOT key=ANY(ARRAY['address','networkKind','browser','major','os','device']))
 THEN RAISE EXCEPTION 'invalid telemetry fields' USING ERRCODE='22023'; END IF;
 IF p_semantic ? 'clientOccurredAt' THEN
  v_client:=(p_semantic->>'clientOccurredAt')::timestamptz;
  IF NOT isfinite(v_client) THEN RAISE EXCEPTION 'invalid client time' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_metadata->>'networkKind' IS NOT NULL AND p_metadata->>'networkKind' NOT IN('public','local_network','local_device','proxy','unknown')
 OR p_metadata->>'browser' IS NOT NULL AND p_metadata->>'browser' NOT IN('Edge','Opera','Firefox','Chrome','Safari','unknown')
 OR p_metadata->>'os' IS NOT NULL AND p_metadata->>'os' NOT IN('Windows','Android','iOS','macOS','Linux','unknown')
 OR p_metadata->>'device' IS NOT NULL AND p_metadata->>'device' NOT IN('desktop','mobile','tablet','unknown')
 OR p_metadata->>'major' IS NOT NULL AND (p_metadata->>'major')::integer NOT BETWEEN 0 AND 9999
 THEN RAISE EXCEPTION 'invalid telemetry metadata' USING ERRCODE='22023'; END IF;

 IF p_operation='quality' THEN
  IF p_semantic->>'streamStartedAt' IS NULL OR p_semantic->>'clientObservedAt' IS NULL THEN
   RAISE EXCEPTION 'invalid_quality_time' USING ERRCODE='22023';
  END IF;
  IF NOT isfinite((p_semantic->>'streamStartedAt')::timestamptz) OR NOT isfinite((p_semantic->>'clientObservedAt')::timestamptz) THEN
   RAISE EXCEPTION 'invalid_quality_time' USING ERRCODE='22023';
  END IF;
  v_pipeline:=p_semantic->>'pipeline'; v_stream:=(p_semantic->>'streamId')::uuid;
  v_sequence:=(p_semantic->>'sequence')::bigint;
  IF v_pipeline IS NULL OR v_pipeline NOT IN('product-analytics','client-diagnostics') OR v_stream IS NULL
   OR v_sequence IS NULL OR v_sequence NOT BETWEEN 1 AND 9007199254740991
   OR p_semantic->>'acknowledgementStage' IS DISTINCT FROM
    CASE WHEN v_pipeline='product-analytics' THEN 'persisted' ELSE 'intake_acknowledged' END
   OR jsonb_typeof(p_semantic->'counters') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_semantic->'gauges') IS DISTINCT FROM 'object'
   OR jsonb_typeof(p_semantic->'coverage') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'invalid telemetry quality' USING ERRCODE='22023'; END IF;
  v_allowed:=ARRAY['attempted','enqueued','acknowledged','retried','expired','evicted','permanentRejected','invalidStored','invalidEnvelope','deduplicated','suppressed','coalesced','storageUnavailable'];
  IF (SELECT count(*) FROM jsonb_object_keys(p_semantic->'counters'))<>cardinality(v_allowed)
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_semantic->'counters') key WHERE NOT key=ANY(v_allowed))
  THEN RAISE EXCEPTION 'invalid quality counters' USING ERRCODE='22023'; END IF;
  FOR v_key,v_value IN SELECT * FROM jsonb_each(p_semantic->'counters') LOOP
   IF jsonb_typeof(v_value)<>'number' THEN RAISE EXCEPTION 'invalid counter' USING ERRCODE='22023'; END IF;
   v_count:=(v_value::text)::numeric;
   IF v_count<0 OR v_count>9007199254740991 OR trunc(v_count)<>v_count THEN RAISE EXCEPTION 'invalid counter' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(p_semantic->'gauges'))<>2
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_semantic->'gauges') key WHERE key NOT IN('pending','inFlight'))
   OR (SELECT count(*) FROM jsonb_object_keys(p_semantic->'coverage'))<>4
   OR EXISTS(SELECT 1 FROM jsonb_each(p_semantic->'coverage') x WHERE x.key NOT IN('persistenceUnavailable','uncleanEnd','final','counterSaturated') OR jsonb_typeof(x.value)<>'boolean')
  THEN RAISE EXCEPTION 'invalid quality gauges' USING ERRCODE='22023'; END IF;
  FOR v_key,v_value IN SELECT * FROM jsonb_each(p_semantic->'gauges') LOOP
   IF jsonb_typeof(v_value)<>'number' OR (v_value::text)::numeric NOT BETWEEN 0 AND 256 OR trunc((v_value::text)::numeric)<>(v_value::text)::numeric
   THEN RAISE EXCEPTION 'invalid quality gauge' USING ERRCODE='22023'; END IF;
  END LOOP;
  v_scope:=p_actor_kind||':'||COALESCE(p_account_id,p_seat_id)::text||':'||COALESCE(p_workspace_id,p_class_id)::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_stream::text,1));
  SELECT * INTO q FROM public.analytics_quality_streams WHERE stream_id=v_stream FOR UPDATE;
  IF FOUND THEN
   IF q.actor_scope<>v_scope OR q.pipeline<>v_pipeline OR q.stream_started_at IS DISTINCT FROM (p_semantic->>'streamStartedAt')::timestamptz OR v_sequence<=q.latest_sequence
    OR EXISTS(SELECT 1 FROM jsonb_each(p_semantic->'counters') x WHERE (x.value::text)::numeric<(q.counters->>x.key)::numeric)
   THEN RAISE EXCEPTION 'quality stream conflict' USING ERRCODE='23505'; END IF;
   UPDATE public.analytics_quality_streams SET latest_sequence=v_sequence,counters=p_semantic->'counters' WHERE stream_id=v_stream;
  ELSE
   INSERT INTO public.analytics_quality_streams VALUES(v_stream,v_scope,v_pipeline,(p_semantic->>'streamStartedAt')::timestamptz,v_sequence,p_semantic->'counters');
  END IF;
  v_result:=jsonb_build_object('streamId',v_stream,'sequence',v_sequence,'pipeline',v_pipeline,'acknowledgementStage',p_semantic->>'acknowledgementStage');

 ELSIF p_operation IN('academic.signed_in','academic.signed_out') THEN
  IF p_actor_kind<>'student' THEN RAISE EXCEPTION 'academic actor denied' USING ERRCODE='42501'; END IF;
  v_bucket:=to_timestamp(floor(extract(epoch FROM p_received_at)/600)*600);
  INSERT INTO public.classroom_activity_events(
   tenant_id,classroom_id,seat_id,actor_principal_id,action,actor_is_teacher_at_event,
   first_occurred_at,occurred_at,async_admission_bucket_at)
  VALUES(v_tenant,p_class_id,p_seat_id,p_principal_id,
   CASE WHEN p_operation='academic.signed_in' THEN 'seat.signed_in' ELSE 'seat.signed_out' END,
   false,p_received_at,p_received_at,v_bucket)
  ON CONFLICT(tenant_id,classroom_id,seat_id,actor_principal_id,action,async_admission_bucket_at)
   WHERE async_admission_bucket_at IS NOT NULL
  DO UPDATE SET occurrence_count=classroom_activity_events.occurrence_count+1,
   first_occurred_at=least(classroom_activity_events.first_occurred_at,excluded.first_occurred_at),
   occurred_at=greatest(classroom_activity_events.occurred_at,excluded.occurred_at)
  RETURNING id INTO v_activity;
  v_result:=jsonb_build_object('activityId',v_activity);

 ELSIF p_operation IN('start','touch','close') THEN
  IF v_session IS NULL OR p_semantic->>'visitId' IS NULL OR v_client IS NULL THEN
   RAISE EXCEPTION 'invalid module envelope' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_session::text,2));
  SELECT * INTO s FROM public.product_module_sessions WHERE id=v_session FOR UPDATE;
  IF p_operation='start' THEN
   IF FOUND THEN
    IF s.actor_kind IS DISTINCT FROM p_actor_kind OR s.account_id IS DISTINCT FROM p_account_id
     OR s.principal_id IS DISTINCT FROM p_principal_id OR s.seat_id IS DISTINCT FROM p_seat_id
     OR s.workspace_id IS DISTINCT FROM p_workspace_id OR s.project_id IS DISTINCT FROM v_project
     OR s.module_key IS DISTINCT FROM p_semantic->>'moduleKey'
     OR (s.visit_id IS NOT NULL AND s.visit_id IS DISTINCT FROM (p_semantic->>'visitId')::uuid)
    THEN RAISE EXCEPTION 'module session conflict' USING ERRCODE='23505'; END IF;
   ELSE
    PERFORM public.analytics_start_module_session(v_session,p_actor_kind,p_account_id,p_principal_id,
     p_seat_id,p_workspace_id,(p_semantic->>'moduleKey')::varchar,v_project,(p_metadata->>'address')::inet,
     COALESCE(p_metadata->>'networkKind','unknown')::varchar,NULL::varchar);
    UPDATE public.product_module_sessions SET started_at=p_received_at,last_seen_at=p_received_at,
     visit_id=(p_semantic->>'visitId')::uuid,browser_family=p_metadata->>'browser',
     browser_major=(p_metadata->>'major')::integer,operating_system=p_metadata->>'os',device_category=p_metadata->>'device'
     WHERE id=v_session;
    UPDATE public.product_analytics_events SET occurred_at=p_received_at,received_at=p_received_at,
     persisted_at=clock_timestamp(),observation_version=2,visit_id=(p_semantic->>'visitId')::uuid,
     browser_family=p_metadata->>'browser',browser_major=(p_metadata->>'major')::integer,
     operating_system=p_metadata->>'os',device_category=p_metadata->>'device',
     environment_provenance='request_reported',address_provenance='server_resolved'
     WHERE flow_id=v_session AND event_type='module.opened';
    SELECT * INTO s FROM public.product_module_sessions WHERE id=v_session;
   END IF;
  ELSE
   IF NOT FOUND OR s.actor_kind IS DISTINCT FROM p_actor_kind OR s.account_id IS DISTINCT FROM p_account_id
    OR s.principal_id IS DISTINCT FROM p_principal_id OR s.seat_id IS DISTINCT FROM p_seat_id
    OR s.workspace_id IS DISTINCT FROM p_workspace_id
    OR (s.visit_id IS NOT NULL AND s.visit_id IS DISTINCT FROM (p_semantic->>'visitId')::uuid) THEN
    RAISE EXCEPTION 'module session denied' USING ERRCODE='42501';
   END IF;
   IF s.ended_at IS NULL THEN
    v_time:=greatest(s.last_seen_at,p_received_at);
    IF v_client BETWEEN p_received_at-interval '90 seconds' AND p_received_at+interval '60 seconds' THEN
     v_seconds:=floor(extract(epoch FROM(v_time-s.last_seen_at)))::integer;
     IF v_seconds BETWEEN 5 AND 90 THEN
      v_from:=s.last_seen_at; v_to:=v_time;
      INSERT INTO public.product_module_activity_slices(session_id,started_at,ended_at,active_seconds)
       VALUES(v_session,v_from,v_to,v_seconds);
     ELSE v_seconds:=0; END IF;
    END IF;
    UPDATE public.product_module_sessions SET last_seen_at=v_time,
     ended_at=CASE WHEN p_operation='close' THEN v_time ELSE NULL END WHERE id=v_session RETURNING * INTO s;
   END IF;
  END IF;
  v_result:=jsonb_build_object('sessionId',v_session,'result',jsonb_build_object('creditedSeconds',v_seconds,
   'creditedFrom',v_from,'creditedTo',v_to,'sessionState',CASE WHEN s.ended_at IS NULL THEN 'open' ELSE 'closed' END));

 ELSE
  IF p_semantic->>'outcome' IS NULL OR p_semantic->>'outcome' NOT IN('succeeded','failed','blocked')
   OR ((p_operation='module.opened') IS DISTINCT FROM (p_semantic->>'moduleKey' IS NOT NULL))
   OR p_semantic->>'moduleKey' IS NOT NULL AND p_semantic->>'moduleKey' NOT IN('electronics','three-d','chess','checkers','blocks')
   OR p_semantic->>'authMethod' IS NOT NULL AND p_semantic->>'authMethod' NOT IN('password','organization','max','class_code')
   OR p_semantic->>'entryRoute' IS NOT NULL AND p_semantic->>'entryRoute' NOT IN('home','projects','editor.electronics','editor.three-d','editor.chess','editor.checkers','editor.blocks','games','classes','learning','account','admin','public','unknown')
   OR p_semantic->>'referrerOrigin' IS NOT NULL AND (length(p_semantic->>'referrerOrigin')>512 OR p_semantic->>'referrerOrigin' !~ '^https?://[^/@?#[:space:]]+$')
  THEN RAISE EXCEPTION 'invalid telemetry event' USING ERRCODE='22023'; END IF;
  -- New observations partition exact scope; legacy signatures remain unchanged.
  IF p_operation='session.observed' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',p_actor_kind,p_principal_id,p_workspace_id,p_seat_id,p_class_id,p_metadata->>'address'),3));
   SELECT id INTO v_id FROM public.product_analytics_events WHERE event_type='session.observed'
    AND actor_kind=p_actor_kind AND principal_id IS NOT DISTINCT FROM p_principal_id
    AND workspace_id IS NOT DISTINCT FROM p_workspace_id AND seat_id IS NOT DISTINCT FROM p_seat_id
    AND ip_address IS NOT DISTINCT FROM (p_metadata->>'address')::inet
    AND occurred_at BETWEEN p_received_at-interval '15 minutes' AND p_received_at+interval '15 minutes'
    ORDER BY occurred_at DESC,id DESC LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
   IF v_client NOT BETWEEN p_received_at-interval '15 minutes' AND p_received_at+interval '60 seconds' THEN v_client:=NULL; END IF;
   INSERT INTO public.product_analytics_events(actor_kind,account_id,principal_id,seat_id,workspace_id,tenant_id,
    event_type,outcome,auth_method,module_key,flow_id,ip_address,network_kind,user_agent_summary,
    occurred_at,receipt_event_id,observation_version,received_at,persisted_at,visit_id,client_occurred_at,
    browser_family,browser_major,operating_system,device_category,entry_route,referrer_origin,environment_provenance,address_provenance)
   VALUES(p_actor_kind,p_account_id,p_principal_id,p_seat_id,p_workspace_id,v_tenant,p_operation,
    p_semantic->>'outcome',p_semantic->>'authMethod',p_semantic->>'moduleKey',(p_semantic->>'flowId')::uuid,
    (p_metadata->>'address')::inet,COALESCE(p_metadata->>'networkKind','unknown'),NULL,p_received_at,p_event_id,2,
    p_received_at,clock_timestamp(),(p_semantic->>'visitId')::uuid,v_client,p_metadata->>'browser',
    (p_metadata->>'major')::integer,p_metadata->>'os',p_metadata->>'device',p_semantic->>'entryRoute',p_semantic->>'referrerOrigin','request_reported','server_resolved')
   RETURNING id INTO v_id;
  END IF;
  v_result:=jsonb_build_object('recordId',v_id);
 END IF;
 v_result:=v_result||jsonb_build_object('accepted',true,'state','persisted','schemaVersion',2,'eventId',p_event_id,
  'operation',p_operation,'receiptId',p_event_id,'receivedAt',p_received_at,'persistedAt',clock_timestamp());
 INSERT INTO public.analytics_operation_receipts(event_id,operation,actor_kind,account_id,principal_id,seat_id,workspace_id,class_id,
  binding_digest,received_at,persisted_at,result,ip_address,network_kind,browser_family,browser_major,operating_system,device_category)
 VALUES(p_event_id,p_operation,p_actor_kind,p_account_id,p_principal_id,p_seat_id,p_workspace_id,p_class_id,v_binding,
  p_received_at,(v_result->>'persistedAt')::timestamptz,v_result,(p_metadata->>'address')::inet,p_metadata->>'networkKind',
  p_metadata->>'browser',(p_metadata->>'major')::integer,p_metadata->>'os',p_metadata->>'device');
 IF p_operation='quality' THEN
  INSERT INTO public.analytics_quality_snapshots VALUES(v_stream,v_sequence,p_event_id,p_semantic);
 END IF;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_ingest_v2(uuid,varchar,uuid,uuid,uuid,uuid,uuid,varchar,jsonb,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_ingest_v2(uuid,varchar,uuid,uuid,uuid,uuid,uuid,varchar,jsonb,jsonb,timestamptz) TO asalab_app;


-- Historical internal decisions resolve lineage without replaying an authentication token.
-- Status can change after the server decided admission; browser writers still check fresh auth.
CREATE FUNCTION public.analytics_record_admission_v2(
 p_event_id uuid,p_auth_event_id uuid,p_seat_id uuid,p_class_id uuid,p_signed_in boolean,
 p_metadata jsonb,p_received_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_principal uuid; v_tenant uuid; v_result jsonb;
BEGIN
 IF p_signed_in IS NULL OR p_seat_id IS NULL OR p_class_id IS NULL THEN
  RAISE EXCEPTION 'invalid admission observation' USING ERRCODE='22023';
 END IF;
 SELECT tenant_id INTO v_tenant FROM public.classroom_student_seats
 WHERE id=p_seat_id AND classroom_id=p_class_id;
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'admission lineage unavailable' USING ERRCODE='42501'; END IF;
 SELECT id INTO v_principal FROM public.principals WHERE seat_id=p_seat_id;
 IF v_principal IS NULL THEN
  BEGIN
   SELECT principal_id INTO v_principal FROM public.student_seat_principal(p_seat_id);
  EXCEPTION WHEN unique_violation THEN
   -- Another API instance may have materialized the same canonical identity.
   SELECT id INTO v_principal FROM public.principals WHERE seat_id=p_seat_id;
  END;
 END IF;
 IF v_principal IS NULL THEN RAISE EXCEPTION 'admission principal unavailable' USING ERRCODE='42501'; END IF;
 v_result:=public.analytics_ingest_v2(p_event_id,'student',NULL,v_principal,p_seat_id,NULL,p_class_id,
  CASE WHEN p_signed_in THEN 'academic.signed_in' ELSE 'academic.signed_out' END,
  jsonb_build_object('authEventId',CASE WHEN p_signed_in THEN p_auth_event_id ELSE NULL END),p_metadata,p_received_at);
 IF p_signed_in THEN
  PERFORM public.analytics_ingest_v2(p_auth_event_id,'student',NULL,v_principal,p_seat_id,NULL,p_class_id,
   'auth.class_join','{"outcome":"succeeded","authMethod":"class_code"}'::jsonb,p_metadata,p_received_at);
 END IF;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_record_admission_v2(uuid,uuid,uuid,uuid,boolean,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_record_admission_v2(uuid,uuid,uuid,uuid,boolean,jsonb,timestamptz) TO asalab_app;
