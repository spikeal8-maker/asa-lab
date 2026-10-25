-- Optional future campaign claims are independent of canonical product visit telemetry.
-- Read visibility is 90 days; opportunistic indexed cleanup is bounded to 100 rows per intake.
-- Digest-only receipts live 97 days so expired claims are not recreated by a retry.
CREATE TABLE public.analytics_acquisition_receipts (
 event_id uuid PRIMARY KEY, actor_kind varchar NOT NULL CHECK(actor_kind IN('account','student')),
 account_id uuid, principal_id uuid NOT NULL, seat_id uuid, workspace_id uuid, class_id uuid,
 binding_digest text NOT NULL, received_at timestamptz NOT NULL, persisted_at timestamptz NOT NULL,
 CHECK ((actor_kind='account' AND account_id IS NOT NULL AND workspace_id IS NOT NULL AND seat_id IS NULL AND class_id IS NULL)
 OR (actor_kind='student' AND account_id IS NULL AND workspace_id IS NULL AND seat_id IS NOT NULL AND class_id IS NOT NULL))
);
CREATE INDEX analytics_acquisition_receipts_retention_idx ON public.analytics_acquisition_receipts(persisted_at,event_id);
CREATE TABLE public.analytics_acquisition_observations (
 event_id uuid PRIMARY KEY REFERENCES public.analytics_acquisition_receipts(event_id),
 actor_kind varchar NOT NULL, account_id uuid, principal_id uuid NOT NULL, seat_id uuid,
 workspace_id uuid, class_id uuid, tenant_id uuid NOT NULL,
 source varchar(64), medium varchar(64), campaign varchar(64), observed_at timestamptz NOT NULL,
 CHECK(source IS NULL OR source ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 CHECK(medium IS NULL OR medium ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 CHECK(campaign IS NULL OR campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 CHECK(coalesce(source,medium,campaign) IS NOT NULL)
);
CREATE INDEX analytics_acquisition_retention_idx ON public.analytics_acquisition_observations(observed_at,event_id);
CREATE INDEX analytics_acquisition_account_idx ON public.analytics_acquisition_observations(account_id,workspace_id,observed_at) WHERE actor_kind='account';
CREATE INDEX analytics_acquisition_subject_limit_idx ON public.analytics_acquisition_observations(principal_id,workspace_id,class_id,observed_at);
CREATE INDEX analytics_acquisition_seat_idx ON public.analytics_acquisition_observations(seat_id,class_id,observed_at) WHERE actor_kind='student';
ALTER TABLE public.analytics_acquisition_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_acquisition_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_acquisition_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_acquisition_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_acquisition_receipts,public.analytics_acquisition_observations FROM PUBLIC,asalab_app;
CREATE FUNCTION public.analytics_acquisition_ingest(p_event uuid,p_kind varchar,p_account uuid,p_principal uuid,p_seat uuid,p_workspace uuid,p_class uuid,p_claim jsonb,p_received timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_tenant uuid; v_digest text; v_now timestamptz:=clock_timestamp(); r public.analytics_acquisition_receipts%ROWTYPE;
BEGIN
 IF p_event IS NULL OR p_principal IS NULL OR p_kind IS NULL OR p_kind NOT IN('account','student') OR p_received IS NULL OR NOT isfinite(p_received)
 OR p_received>v_now+interval '60 seconds' OR p_received<v_now-interval '5 minutes'
 OR jsonb_typeof(p_claim) IS DISTINCT FROM 'object' OR octet_length(p_claim::text)>512
 OR p_claim-ARRAY['source','medium','campaign']<>'{}'::jsonb OR NOT(p_claim ?& ARRAY['source','medium','campaign'])
 OR NOT EXISTS(SELECT 1 FROM jsonb_each(p_claim) f WHERE jsonb_typeof(f.value)='string')
 OR EXISTS(SELECT 1 FROM jsonb_each(p_claim) f WHERE jsonb_typeof(f.value) NOT IN('string','null') OR (jsonb_typeof(f.value)='string' AND (f.value#>>'{}') !~ '^[a-z0-9][a-z0-9_-]{0,63}$'))
 THEN RAISE EXCEPTION 'invalid acquisition envelope' USING ERRCODE='22023'; END IF;
 -- Independently fence server-derived identity/context before every replay.
 IF p_kind='account' AND p_seat IS NULL AND p_class IS NULL THEN
  SELECT w.tenant_id INTO v_tenant FROM public.principals pr JOIN public.accounts a ON a.id=pr.account_id AND a.status='active'
  JOIN public.workspace_memberships m ON m.account_id=a.id AND m.workspace_id=p_workspace AND m.state='active'
  JOIN public.workspaces w ON w.id=m.workspace_id AND w.status='active'
  WHERE pr.id=p_principal AND pr.kind='account' AND pr.account_id=p_account;
 ELSIF p_kind='student' AND p_account IS NULL AND p_workspace IS NULL THEN
  SELECT s.tenant_id INTO v_tenant FROM public.principals pr
  JOIN public.classroom_student_seats s ON s.id=pr.seat_id AND s.id=p_seat AND s.classroom_id=p_class AND s.status IN('issued','active')
  JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id AND c.status='active'
  WHERE pr.id=p_principal AND pr.kind='student_seat';
 END IF;
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'acquisition context denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('acquisition:'||p_event::text,0));
 v_digest:=encode(public.digest(convert_to(p_claim::text,'UTF8'),'sha256'),'hex');
 SELECT * INTO r FROM public.analytics_acquisition_receipts WHERE event_id=p_event;
 IF FOUND THEN
  IF r.actor_kind IS DISTINCT FROM p_kind OR r.account_id IS DISTINCT FROM p_account OR r.principal_id IS DISTINCT FROM p_principal
   OR r.seat_id IS DISTINCT FROM p_seat OR r.workspace_id IS DISTINCT FROM p_workspace OR r.class_id IS DISTINCT FROM p_class OR r.binding_digest IS DISTINCT FROM v_digest
  THEN RAISE EXCEPTION 'acquisition conflict' USING ERRCODE='23505'; END IF;
 ELSE
  -- Bound writes for one authenticated subject/context even with new event IDs.
  PERFORM pg_advisory_xact_lock(hashtextextended('acquisition-subject:'||p_principal::text||':'||coalesce(p_workspace,p_class)::text,0));
  IF (SELECT count(*) FROM public.analytics_acquisition_observations WHERE principal_id=p_principal AND workspace_id IS NOT DISTINCT FROM p_workspace AND class_id IS NOT DISTINCT FROM p_class AND observed_at>v_now-interval '1 day')>=32
  THEN RAISE EXCEPTION 'acquisition daily limit' USING ERRCODE='22023'; END IF;
  INSERT INTO public.analytics_acquisition_receipts VALUES(p_event,p_kind,p_account,p_principal,p_seat,p_workspace,p_class,v_digest,p_received,v_now) RETURNING * INTO r;
  INSERT INTO public.analytics_acquisition_observations VALUES(p_event,p_kind,p_account,p_principal,p_seat,p_workspace,p_class,v_tenant,p_claim->>'source',p_claim->>'medium',p_claim->>'campaign',v_now);
 END IF;
 DELETE FROM public.analytics_acquisition_observations WHERE event_id IN(SELECT event_id FROM public.analytics_acquisition_observations WHERE observed_at<v_now-interval '90 days' ORDER BY observed_at,event_id LIMIT 100);
 DELETE FROM public.analytics_acquisition_receipts WHERE event_id IN(SELECT x.event_id FROM public.analytics_acquisition_receipts x WHERE x.persisted_at<v_now-interval '97 days' AND NOT EXISTS(SELECT 1 FROM public.analytics_acquisition_observations o WHERE o.event_id=x.event_id) ORDER BY x.persisted_at,x.event_id LIMIT 100);
 RETURN jsonb_build_object('accepted',true,'state','persisted','schemaVersion',2,'eventId',p_event,'receiptId',p_event,'operation','acquisition.observed','receivedAt',r.received_at,'persistedAt',r.persisted_at);
END;$$;
REVOKE ALL ON FUNCTION public.analytics_acquisition_ingest(uuid,varchar,uuid,uuid,uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_acquisition_ingest(uuid,varchar,uuid,uuid,uuid,uuid,uuid,jsonb,timestamptz) TO asalab_app;

-- Same canonical catalog reader, authorization, filters, UTC grouping and snapshot cursor;
-- only the optional acquisition aggregate is added. Legacy readers are retained.
CREATE OR REPLACE FUNCTION public.admin_user_catalog_v2(p_actor uuid,p_scope varchar,p_scope_id uuid,p_search varchar,p_kind varchar,p_status varchar,p_sort varchar,p_direction varchar,p_limit integer,p_cursor jsonb,p_filters jsonb,p_mode varchar)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
DECLARE v_role varchar; v_search text; v_fingerprint text; v_at timestamptz; v_last jsonb; v_result jsonb;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN('platform','organization') OR (p_scope='platform' AND p_scope_id IS NOT NULL) OR (p_scope='organization' AND p_scope_id IS NULL) THEN RAISE EXCEPTION 'ADMIN_CATALOG_QUERY_INVALID' USING ERRCODE='22023'; END IF;
  v_role:=public.admin_authorized_role(p_actor,p_scope,p_scope_id);
  IF v_role IS NULL OR (p_scope='platform' AND v_role<>'platform_admin') OR (p_scope='organization' AND v_role NOT IN('owner','school_admin','platform_admin')) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN('all','accounts','students') OR p_status IS NULL OR p_status NOT IN('all','active','inactive')
     OR p_sort IS NULL OR p_sort NOT IN('name','last_activity','activity','created') OR p_direction IS NULL OR p_direction NOT IN('asc','desc')
     OR p_mode IS NULL OR p_mode NOT IN('page','export') OR p_filters IS NULL OR octet_length(p_filters::text)>4096 OR jsonb_typeof(p_filters)<>'object' OR p_filters-ARRAY['role','classId','organizationId','age','ageMin','ageMax','email','activity','registeredAfter','registeredBefore','source','days']<>'{}'::jsonb OR p_limit IS NULL OR (p_limit<1 OR (p_mode='page' AND p_limit>100) OR (p_mode='export' AND p_limit>10001)) OR coalesce(length(p_search),0)>100 THEN
    RAISE EXCEPTION 'ADMIN_CATALOG_QUERY_INVALID' USING ERRCODE='22023';
  END IF;
  IF coalesce(p_filters->>'role','all') NOT IN('all','learner','creator','educator','registered_student','guardian','platform_admin','owner','school_admin','member')
    OR coalesce(p_filters->>'age','all') NOT IN('all','known','unknown') OR coalesce(p_filters->>'email','all') NOT IN('all','present','absent','verified','unverified')
    OR coalesce(p_filters->>'activity','all') NOT IN('all','observed','unknown') OR coalesce(p_filters->>'source','all') NOT IN('all','observed','unknown')
    OR coalesce(p_filters->>'days','30') NOT IN('7','30','90') OR coalesce(p_filters->>'ageMin','0') !~ '^(0|[1-9][0-9]{0,2})$' OR coalesce(p_filters->>'ageMax','120') !~ '^(0|[1-9][0-9]{0,2})$'
    OR (p_filters->>'ageMin')::integer>120 OR (p_filters->>'ageMax')::integer>120 OR coalesce((p_filters->>'ageMin')::integer,0)>coalesce((p_filters->>'ageMax')::integer,120)
    OR (p_filters->>'age'='unknown' AND (p_filters?'ageMin' OR p_filters?'ageMax'))
    THEN RAISE EXCEPTION 'ADMIN_CATALOG_QUERY_INVALID' USING ERRCODE='22023'; END IF;
  IF p_scope='organization' AND p_filters->>'organizationId' IS NOT NULL AND p_filters->>'organizationId' IS DISTINCT FROM p_scope_id::text THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_filters) f WHERE jsonb_typeof(f.value)<>'string') THEN RAISE EXCEPTION 'ADMIN_CATALOG_QUERY_INVALID' USING ERRCODE='22023'; END IF;
  v_search:=lower(nullif(trim(p_search),''));
  v_fingerprint:=encode(public.digest(convert_to(jsonb_build_array(p_actor,p_scope,p_scope_id,v_search,p_kind,p_status,p_sort,p_direction,p_filters)::text,'UTF8'),'sha256'),'hex');
  v_at:=statement_timestamp();
  IF p_cursor IS NOT NULL THEN
    BEGIN
      IF octet_length(p_cursor::text)>4096 OR jsonb_typeof(p_cursor)<>'object' OR p_cursor-ARRAY['v','fingerprint','asOf','last']<>'{}'::jsonb OR p_cursor->'v' IS DISTINCT FROM '1'::jsonb
        OR p_cursor->>'fingerprint' IS DISTINCT FROM v_fingerprint OR jsonb_typeof(p_cursor->'asOf') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_cursor->'last') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'cursor'; END IF;
      v_at:=(p_cursor->>'asOf')::timestamptz;
      IF v_at IS NULL OR NOT isfinite(v_at) OR v_at>statement_timestamp() OR v_at<statement_timestamp()-interval '1 hour' THEN RAISE EXCEPTION 'cursor'; END IF;
      v_last:=p_cursor->'last';
      IF v_last-ARRAY['kind','id','value']<>'{}'::jsonb OR v_last->>'kind' IS NULL OR v_last->>'kind' NOT IN('account','student')
        OR jsonb_typeof(v_last->'id') IS DISTINCT FROM 'string' OR (v_last->>'id') !~ '^[a-f0-9-]{36}$' OR NOT(v_last?'value')
        OR (jsonb_typeof(v_last->'value') NOT IN('string','null')) THEN RAISE EXCEPTION 'cursor'; END IF;
      PERFORM (v_last->>'id')::uuid;
      IF p_sort IN('name','activity','created') AND v_last->>'value' IS NULL THEN RAISE EXCEPTION 'cursor'; END IF;
      IF p_sort='name' AND length(v_last->>'value')>512 THEN RAISE EXCEPTION 'cursor'; END IF;
      IF p_sort='activity' AND (v_last->>'value') !~ '^[0-9]{20}$' THEN RAISE EXCEPTION 'cursor'; END IF;
      IF p_sort IN('last_activity','created') AND v_last->>'value' IS NOT NULL THEN
        IF (v_last->>'value') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$' THEN RAISE EXCEPTION 'cursor'; END IF;
        PERFORM (v_last->>'value')::timestamp;
      END IF;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'ADMIN_CATALOG_CURSOR_INVALID' USING ERRCODE='22023'; END;
  END IF;
  WITH candidates AS (
    SELECT 'account'::text kind,a.id,p.id principal_id,coalesce(nullif(trim(f.display_name),''),nullif(f.username,''),a.email,'Без имени')::text display_name,
      f.username::text login,a.email::text email,a.status::text status,a.created_at,NULL::uuid class_id,NULL::text class_title,NULL::text class_status,
      m.role::text organization_role,m.state::text membership_state,a.email_verification_state::text email_verification_state
    FROM public.accounts a LEFT JOIN public.profiles f ON f.account_id=a.id LEFT JOIN public.principals p ON p.kind='account' AND p.account_id=a.id
    LEFT JOIN public.workspace_memberships m ON m.account_id=a.id AND m.workspace_id=p_scope_id AND p_scope='organization'
    WHERE p_kind IN('all','accounts') AND a.created_at<=v_at AND (p_scope='platform' OR m.id IS NOT NULL)
      AND (p_status='all' OR (p_status='active')=(a.status='active'))
      AND (v_search IS NULL OR position(v_search IN lower(coalesce(f.display_name,'')||E'\n'||coalesce(f.username,'')||E'\n'||coalesce(a.email,'')))>0)
    UNION ALL
    SELECT 'student',s.id,p.id,s.display_label::text,NULL::text,NULL::text,s.status::text,s.created_at,c.id,c.title::text,c.status::text,NULL::text,NULL::text,NULL::text
    FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
    LEFT JOIN public.principals p ON p.kind='student_seat' AND p.seat_id=s.id
    WHERE (p_scope='platform' OR EXISTS(SELECT 1 FROM public.crm_organization_classes oc WHERE oc.classroom_id=c.id AND oc.workspace_id=p_scope_id)) AND p_kind IN('all','students') AND s.created_at<=v_at
      AND (p_status='all' OR (p_status='active')=(s.status IN('issued','active')))
      AND (v_search IS NULL OR position(v_search IN lower(s.display_label||E'\n'||c.title))>0)
  ), measured AS (
    SELECT base.*,greatest(session_data.seen,latest.occurred_at) last_seen,greatest(session_data.started,latest.occurred_at) activity_at,coalesce(activity.n,0) activity_count,
      latest.ip_address,latest.network_kind,latest.user_agent_summary,latest.browser_family,latest.operating_system,latest.device_category,
      session_data.has_signed_in
    FROM candidates base
    LEFT JOIN LATERAL (
      SELECT max(x.last_seen_at) seen,max(x.created_at) started,count(*)>0 has_signed_in FROM (
        SELECT sv.last_seen_at,sv.created_at FROM public.sessions_v2 sv WHERE base.kind='account' AND sv.principal_id=base.principal_id AND sv.created_at<=v_at AND (p_scope='platform' OR sv.active_workspace_id=p_scope_id)
        UNION ALL SELECT ss.last_seen_at,ss.created_at FROM public.classroom_student_sessions ss WHERE base.kind='student' AND ss.seat_id=base.id AND ss.created_at<=v_at
      ) x
    ) session_data ON true
    LEFT JOIN LATERAL (
      SELECT e.occurred_at,e.ip_address,e.network_kind,e.user_agent_summary,e.browser_family,e.operating_system,e.device_category FROM public.product_analytics_events e
      WHERE ((base.kind='account' AND e.actor_kind='account' AND e.account_id=base.id AND (p_scope='platform' OR e.workspace_id=p_scope_id)) OR (base.kind='student' AND e.actor_kind='student' AND e.seat_id=base.id))
        AND e.occurred_at<=v_at AND coalesce(e.persisted_at,e.received_at,e.occurred_at)<=v_at
      ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1
    ) latest ON true
    LEFT JOIN LATERAL (
      SELECT count(*) n FROM public.product_analytics_events e
      WHERE ((base.kind='account' AND e.actor_kind='account' AND e.account_id=base.id AND (p_scope='platform' OR e.workspace_id=p_scope_id)) OR (base.kind='student' AND e.actor_kind='student' AND e.seat_id=base.id))
        AND e.occurred_at>v_at-interval '30 days' AND e.occurred_at<=v_at AND coalesce(e.persisted_at,e.received_at,e.occurred_at)<=v_at
    ) activity ON true
  ), enriched AS (
    SELECT measured.*, CASE WHEN kind='account' THEN CASE WHEN p_scope='platform' THEN a.birth_date ELSE NULL END ELSE sp.birth_date END birth_date,
      extract(year FROM age(current_date,CASE WHEN kind='account' THEN CASE WHEN p_scope='platform' THEN a.birth_date ELSE NULL END ELSE sp.birth_date END))::integer age,
      CASE WHEN kind='account' THEN CASE WHEN p_scope='platform' THEN a.country ELSE NULL END ELSE sp.country END country,
      CASE WHEN kind='account' THEN a.email_verification_state ELSE NULL END email_state,
      CASE WHEN kind='student' THEN ARRAY['learner']::text[] WHEN p_scope='organization' THEN ARRAY(SELECT wm.role::text FROM public.workspace_memberships wm WHERE wm.account_id=measured.id AND wm.workspace_id=p_scope_id AND wm.state='active') ELSE ARRAY(SELECT g.capability::text FROM public.capability_grants g WHERE g.account_id=measured.id AND g.state='verified' AND (p_scope='platform' OR g.capability<>'platform_admin') ORDER BY g.capability) END roles,
      CASE WHEN kind='student' THEN ARRAY[class_id] ELSE ARRAY(SELECT cs.classroom_id FROM public.classroom_student_seats cs WHERE cs.account_id=measured.id AND p_scope='platform' UNION SELECT cm.classroom_id FROM public.classroom_memberships cm WHERE cm.account_id=measured.id AND cm.member_role IN('owner','co_teacher') AND p_scope='platform') END class_ids,
      CASE WHEN p_scope<>'platform' THEN NULL::bigint WHEN kind='student' THEN (SELECT count(*) FROM public.classroom_student_seats cs WHERE cs.id=measured.id AND cs.account_id IS NOT NULL) ELSE (SELECT count(*) FROM public.classroom_student_seats cs WHERE cs.account_id=measured.id AND p_scope='platform') END linked_count,
      first_visit.referrer_origin first_referrer,first_visit.occurred_at first_observed_at,
      ai.requests ai_requests,ai.legacy_requests ai_legacy_requests,ai.covered ai_token_covered,ai.input_tokens,ai.output_tokens
    FROM measured LEFT JOIN public.accounts a ON measured.kind='account' AND a.id=measured.id
    LEFT JOIN public.crm_student_profiles sp ON measured.kind='student' AND sp.seat_id=measured.id
    LEFT JOIN LATERAL (SELECT e.referrer_origin,e.occurred_at FROM public.product_analytics_events e
      WHERE e.event_type='visit.observed' AND ((measured.kind='account' AND e.actor_kind='account' AND e.account_id=measured.id AND (p_scope='platform' OR e.workspace_id=p_scope_id)) OR (measured.kind='student' AND e.actor_kind='student' AND e.seat_id=measured.id))
        AND e.occurred_at<=v_at AND coalesce(e.persisted_at,e.received_at,e.occurred_at)<=v_at ORDER BY e.occurred_at,e.id LIMIT 1) first_visit ON true
    LEFT JOIN LATERAL (
      SELECT count(*) requests,count(*) FILTER(WHERE x.input_tokens IS NOT NULL AND x.output_tokens IS NOT NULL) covered,count(*) FILTER(WHERE x.legacy) legacy_requests,sum(x.input_tokens)::text input_tokens,sum(x.output_tokens)::text output_tokens FROM (
        SELECT j.input_tokens,j.output_tokens,false legacy FROM public.ai_usage_journal j WHERE (p_scope='platform' OR measured.kind='student') AND j.owner_principal_id=measured.principal_id AND j.admitted_at<=v_at AND j.admitted_at>v_at-make_interval(days=>coalesce((p_filters->>'days')::integer,30))
        UNION ALL
        SELECT NULL::bigint,NULL::bigint,true FROM public.ai_assistant_request_quota q WHERE (p_scope='platform' OR measured.kind='student') AND q.owner_principal_id=measured.principal_id AND q.created_at<=v_at AND q.created_at>v_at-make_interval(days=>coalesce((p_filters->>'days')::integer,30)) AND NOT EXISTS(SELECT 1 FROM public.ai_usage_journal j WHERE j.owner_principal_id=q.owner_principal_id AND j.request_id=q.request_id)
      ) x
    ) ai ON true
  ), filtered AS (
    SELECT * FROM enriched b WHERE
      (coalesce(p_filters->>'role','all')='all' OR p_filters->>'role'=ANY(roles) OR (p_filters->>'role' IN('owner','school_admin','member') AND EXISTS(SELECT 1 FROM public.workspace_memberships wm WHERE wm.account_id=b.id AND b.kind='account' AND wm.role=p_filters->>'role' AND wm.state='active' AND (p_scope='platform' OR wm.workspace_id=p_scope_id))))
      AND (p_filters->>'classId' IS NULL OR (p_filters->>'classId')::uuid=ANY(class_ids))
      AND (p_filters->>'organizationId' IS NULL OR (kind='account' AND EXISTS(SELECT 1 FROM public.workspace_memberships wm WHERE wm.account_id=b.id AND wm.workspace_id=(p_filters->>'organizationId')::uuid AND wm.state='active')) OR (kind='student' AND EXISTS(SELECT 1 FROM public.crm_organization_classes oc WHERE oc.classroom_id=b.class_id AND oc.workspace_id=(p_filters->>'organizationId')::uuid)))
      AND (coalesce(p_filters->>'age','all')='all' OR (p_filters->>'age'='known')=(age IS NOT NULL))
      AND (p_filters->>'ageMin' IS NULL OR age>=(p_filters->>'ageMin')::integer)
      AND (p_filters->>'ageMax' IS NULL OR age<=(p_filters->>'ageMax')::integer)
      AND (coalesce(p_filters->>'email','all')='all' OR (p_filters->>'email'='absent' AND email IS NULL) OR (p_filters->>'email'='present' AND email IS NOT NULL) OR (p_filters->>'email'='verified' AND email IS NOT NULL AND email_state='verified') OR (p_filters->>'email'='unverified' AND email IS NOT NULL AND email_state IS DISTINCT FROM 'verified'))
      AND (coalesce(p_filters->>'activity','all')='all' OR (p_filters->>'activity'='observed')=(activity_at IS NOT NULL))
      AND (p_filters->>'registeredAfter' IS NULL OR created_at>=(p_filters->>'registeredAfter')::timestamptz)
      AND (p_filters->>'registeredBefore' IS NULL OR created_at<(p_filters->>'registeredBefore')::timestamptz+interval '1 day')
      AND (coalesce(p_filters->>'source','all')='all' OR (p_filters->>'source'='unknown' AND first_referrer IS NULL) OR (p_filters->>'source'='observed' AND first_referrer IS NOT NULL))
  ), scoped_events AS (
    SELECT e.* FROM public.product_analytics_events e JOIN filtered b ON
      ((b.kind='account' AND e.actor_kind='account' AND e.account_id=b.id AND (p_scope='platform' OR e.workspace_id=p_scope_id)) OR (b.kind='student' AND e.actor_kind='student' AND e.seat_id=b.id))
    WHERE e.occurred_at>v_at-make_interval(days=>coalesce((p_filters->>'days')::integer,30)) AND e.occurred_at<=v_at AND coalesce(e.persisted_at,e.received_at,e.occurred_at)<=v_at
  ), acquisition AS (
    SELECT o.*,b.kind subject_kind,b.id subject_id FROM public.analytics_acquisition_observations o JOIN filtered b ON
    ((b.kind='account' AND o.actor_kind='account' AND o.account_id=b.id AND (p_scope='platform' OR o.workspace_id=p_scope_id))
     OR (b.kind='student' AND o.actor_kind='student' AND o.seat_id=b.id AND o.class_id=b.class_id))
    WHERE o.observed_at<=v_at AND o.observed_at>greatest(v_at-make_interval(days=>coalesce((p_filters->>'days')::integer,30)),statement_timestamp()-interval '90 days')
  ), keyed AS (
    SELECT filtered.*,CASE p_sort WHEN 'name' THEN lower(display_name) WHEN 'activity' THEN lpad(activity_count::text,20,'0')
      WHEN 'created' THEN to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')
      ELSE to_char(activity_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') END COLLATE "C" sort_value FROM filtered
  ), matching AS (
    SELECT * FROM keyed WHERE v_last IS NULL
      OR ((sort_value IS NULL)::integer>( (v_last->>'value') IS NULL)::integer)
      OR ((sort_value IS NULL)=((v_last->>'value') IS NULL) AND (
        (p_direction='asc' AND sort_value>(v_last->>'value') COLLATE "C") OR (p_direction='desc' AND sort_value<(v_last->>'value') COLLATE "C")
        OR (sort_value IS NOT DISTINCT FROM (v_last->>'value') AND (kind,id)>(v_last->>'kind',(v_last->>'id')::uuid))))
  ), page AS (
    SELECT *,row_number() OVER(ORDER BY (sort_value IS NULL),CASE WHEN p_direction='asc' THEN sort_value END COLLATE "C" ASC,CASE WHEN p_direction='desc' THEN sort_value END COLLATE "C" DESC,kind,id) rn
    FROM matching ORDER BY (sort_value IS NULL),CASE WHEN p_direction='asc' THEN sort_value END COLLATE "C" ASC,CASE WHEN p_direction='desc' THEN sort_value END COLLATE "C" DESC,kind,id LIMIT p_limit+1
  ), views AS (
    SELECT rn,kind,id,sort_value,jsonb_build_object('kind',kind,'id',id,'actorKey',kind||':'||id,'principalId',principal_id,'displayName',display_name,'login',login,'email',email,
      'status',status,'normalizedStatus',CASE WHEN status='active' OR (kind='student' AND status='issued') THEN 'active' ELSE 'inactive' END,'createdAt',created_at,'lastSeenAt',last_seen,'lastActivityAt',activity_at,'recentActivityCount',activity_count,
      'lastIpAddress',host(ip_address),'lastNetworkKind',network_kind,'lastDevice',user_agent_summary,'browser',browser_family,'operatingSystem',operating_system,'deviceCategory',device_category,
      'classId',class_id,'classTitle',class_title,'classStatus',class_status,'classIds',class_ids,'birthDate',birth_date,'age',age,'country',country,'roles',roles,'emailVerificationState',email_state,'linkedRecordCount',linked_count,'firstObservedReferrer',first_referrer,'firstObservedAt',first_observed_at,'aiPeriodDays',coalesce((p_filters->>'days')::integer,30),'aiRequests',CASE WHEN p_scope='platform' OR kind='student' THEN ai_requests ELSE NULL END,'aiLegacyRequests',CASE WHEN p_scope='platform' OR kind='student' THEN ai_legacy_requests ELSE NULL END,'aiTokenCovered',CASE WHEN p_scope='platform' OR kind='student' THEN ai_token_covered ELSE NULL END,'aiInputTokens',input_tokens,'aiOutputTokens',output_tokens,
      'acquisitionLatest',(SELECT jsonb_build_object('source',o.source,'medium',o.medium,'campaign',o.campaign,'observedAt',o.observed_at) FROM public.analytics_acquisition_observations o
        WHERE ((page.kind='account' AND o.actor_kind='account' AND o.account_id=page.id AND (p_scope='platform' OR o.workspace_id=p_scope_id)) OR (page.kind='student' AND o.actor_kind='student' AND o.seat_id=page.id AND o.class_id=page.class_id))
        AND o.observed_at<=v_at AND o.observed_at>statement_timestamp()-interval '90 days' ORDER BY o.observed_at DESC,o.event_id DESC LIMIT 1),
      'account',CASE WHEN kind='account' AND principal_id IS NOT NULL AND login IS NOT NULL THEN jsonb_build_object('accountId',id,'principalId',principal_id,'displayName',display_name,'username',login,'email',email,'status',status,
        'emailVerificationState',email_verification_state,'createdAt',created_at,'organizationRole',organization_role,'membershipState',membership_state,'lastSeenAt',last_seen,'hasEverSignedIn',has_signed_in,
        'lastIpAddress',host(ip_address),'lastNetworkKind',network_kind,'lastDevice',user_agent_summary,'recentActivityCount',activity_count,
        'isPlatformAdmin',p_scope='platform' AND EXISTS(SELECT 1 FROM public.capability_grants g WHERE g.account_id=page.id AND g.capability='platform_admin' AND g.state='verified'),
        'activeSessionCount',(SELECT count(*) FROM public.sessions_v2 sv WHERE sv.principal_id=page.principal_id AND sv.revoked_at IS NULL AND sv.expires_at>v_at AND (p_scope='platform' OR sv.active_workspace_id=p_scope_id))) ELSE NULL END) item
    FROM page WHERE rn<=p_limit
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY rn) FROM views),'[]'::jsonb),'asOf',v_at,
    'matchedCount',(SELECT count(*) FROM filtered),'analytics',jsonb_build_object('accounts',(SELECT count(*) FROM filtered WHERE kind='account'),'students',(SELECT count(*) FROM filtered WHERE kind='student'),'linkedRecords',CASE WHEN p_scope='platform' THEN (SELECT count(*) FROM filtered WHERE linked_count>0) ELSE NULL END,'ageUnknown',(SELECT count(*) FROM filtered WHERE age IS NULL),'emailAbsent',(SELECT count(*) FROM filtered WHERE email IS NULL),'sourceUnknown',(SELECT count(*) FROM filtered WHERE first_referrer IS NULL),'activeObserved',(SELECT count(*) FROM filtered WHERE activity_at IS NOT NULL),'aiRequests',(SELECT CASE WHEN p_scope='platform' THEN coalesce(sum(ai_requests),0) ELSE sum(ai_requests) END FROM filtered WHERE p_scope='platform' OR kind='student'),'aiLegacyRequests',(SELECT CASE WHEN p_scope='platform' THEN coalesce(sum(ai_legacy_requests),0) ELSE sum(ai_legacy_requests) END FROM filtered WHERE p_scope='platform' OR kind='student'),'aiCoverage',CASE WHEN p_scope='platform' THEN 'all_authorized' ELSE 'students_only_accounts_unavailable' END,'aiTokenCovered',(SELECT CASE WHEN p_scope='platform' THEN coalesce(sum(ai_token_covered),0) ELSE sum(ai_token_covered) END FROM filtered WHERE p_scope='platform' OR kind='student'),'periodDays',coalesce((p_filters->>'days')::integer,30),'registrationSource','not_stored','geo','not_stored','aiInputTokens',(SELECT sum(input_tokens::numeric)::text FROM filtered WHERE p_scope='platform' OR kind='student'),'aiOutputTokens',(SELECT sum(output_tokens::numeric)::text FROM filtered WHERE p_scope='platform' OR kind='student'),
    'acquisition',jsonb_build_object('retentionDays',90,'status','collecting_current_document',
      'observedRecords',(SELECT count(*) FROM (SELECT DISTINCT subject_kind,subject_id FROM acquisition) z),
      'unknownRecords',(SELECT count(*) FROM filtered)-(SELECT count(*) FROM (SELECT DISTINCT subject_kind,subject_id FROM acquisition) z),
      'observations',(SELECT count(*) FROM acquisition),
      'sources',coalesce((SELECT jsonb_object_agg(label,n) FROM (SELECT source label,count(*) n FROM acquisition WHERE source IS NOT NULL GROUP BY source ORDER BY n DESC,source LIMIT 30) z),'{}'::jsonb),
      'mediums',coalesce((SELECT jsonb_object_agg(label,n) FROM (SELECT medium label,count(*) n FROM acquisition WHERE medium IS NOT NULL GROUP BY medium ORDER BY n DESC,medium LIMIT 30) z),'{}'::jsonb),
      'campaigns',coalesce((SELECT jsonb_object_agg(label,n) FROM (SELECT campaign label,count(*) n FROM acquisition WHERE campaign IS NOT NULL GROUP BY campaign ORDER BY n DESC,campaign LIMIT 30) z),'{}'::jsonb)),
    'activityEvents',(SELECT count(*) FROM scoped_events),
    'registrationMethods',coalesce((SELECT jsonb_object_agg(method,n) FROM (SELECT coalesce(auth_method,'unknown') method,count(*) n FROM scoped_events WHERE outcome='succeeded' AND event_type='auth.register' GROUP BY auth_method ORDER BY n DESC,auth_method LIMIT 30) z),'{}'::jsonb),
    'loginMethods',coalesce((SELECT jsonb_object_agg(method,n) FROM (SELECT coalesce(auth_method,'unknown') method,count(*) n FROM scoped_events WHERE outcome='succeeded' AND event_type IN('auth.login','auth.max','auth.class_join') GROUP BY auth_method ORDER BY n DESC LIMIT 30) z),'{}'::jsonb),
    'tools',coalesce((SELECT jsonb_object_agg(module,n) FROM (SELECT module_key module,count(*) n FROM scoped_events WHERE module_key IS NOT NULL GROUP BY module_key ORDER BY n DESC,module_key LIMIT 30) z),'{}'::jsonb),
    'devices',coalesce((SELECT jsonb_object_agg(device,n) FROM (SELECT coalesce(device_category,'unknown') device,count(*) n FROM filtered GROUP BY device_category) z),'{}'::jsonb),
    'ageGroups',coalesce((SELECT jsonb_object_agg(band,n) FROM (SELECT CASE WHEN age IS NULL THEN 'unknown' WHEN age<18 THEN '0–17' WHEN age<35 THEN '18–34' WHEN age<55 THEN '35–54' ELSE '55+' END band,count(*) n FROM filtered GROUP BY 1) z),'{}'::jsonb),
    'daily',(SELECT jsonb_agg(jsonb_build_object('date',to_char(day,'YYYY-MM-DD'),'registrations',(SELECT count(*) FROM filtered b WHERE b.created_at>=day AND b.created_at<day+interval '1 day'),'events',(SELECT count(*) FROM scoped_events e WHERE e.occurred_at>=day AND e.occurred_at<day+interval '1 day')) ORDER BY day) FROM generate_series(date_trunc('day',v_at)-make_interval(days=>coalesce((p_filters->>'days')::integer,30)-1),date_trunc('day',v_at),interval '1 day') day),
    'roles',coalesce((SELECT jsonb_object_agg(role,n) FROM (SELECT role,count(*) n FROM filtered CROSS JOIN LATERAL unnest(roles) role GROUP BY role) z),'{}'::jsonb),'referrers',coalesce((SELECT jsonb_object_agg(source,n) FROM (SELECT coalesce(first_referrer,'unknown') source,count(*) n FROM filtered GROUP BY first_referrer ORDER BY n DESC,source LIMIT 30) z),'{}'::jsonb)),'studentCoverage',jsonb_build_object('state','complete'),
    'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('v',1,'fingerprint',v_fingerprint,'asOf',v_at,'last',jsonb_build_object('kind',kind,'id',id,'value',sort_value)) FROM views ORDER BY rn DESC LIMIT 1) ELSE NULL END) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_user_catalog_v2(uuid,varchar,uuid,varchar,varchar,varchar,varchar,varchar,integer,jsonb,jsonb,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_catalog_v2(uuid,varchar,uuid,varchar,varchar,varchar,varchar,varchar,integer,jsonb,jsonb,varchar) TO asalab_app;

