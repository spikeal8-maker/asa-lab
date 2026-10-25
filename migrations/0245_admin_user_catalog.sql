-- Typed read catalog. Tenant coincidence is not organization/class authority.
CREATE INDEX admin_catalog_student_event_idx ON public.product_analytics_events(seat_id,occurred_at DESC,id DESC) WHERE actor_kind='student';
CREATE INDEX admin_catalog_account_scope_event_idx ON public.product_analytics_events(account_id,workspace_id,occurred_at DESC,id DESC) WHERE actor_kind='account';
CREATE INDEX admin_catalog_student_seen_idx ON public.classroom_student_sessions(seat_id,last_seen_at DESC);

CREATE FUNCTION public.admin_user_catalog(p_actor uuid,p_scope varchar,p_scope_id uuid,p_search varchar,p_kind varchar,p_status varchar,p_sort varchar,p_direction varchar,p_limit integer,p_cursor jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_role varchar; v_search text; v_fingerprint text; v_at timestamptz; v_last jsonb; v_result jsonb;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN('platform','organization') OR (p_scope='platform' AND p_scope_id IS NOT NULL) OR (p_scope='organization' AND p_scope_id IS NULL) THEN RAISE EXCEPTION 'ADMIN_CATALOG_QUERY_INVALID' USING ERRCODE='22023'; END IF;
  v_role:=public.admin_authorized_role(p_actor,p_scope,p_scope_id);
  IF v_role IS NULL OR (p_scope='platform' AND v_role<>'platform_admin') OR (p_scope='organization' AND v_role NOT IN('owner','school_admin')) THEN
    RAISE EXCEPTION 'ADMIN_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN('all','accounts','students') OR p_status IS NULL OR p_status NOT IN('all','active','inactive')
     OR p_sort IS NULL OR p_sort NOT IN('name','last_activity','activity','created') OR p_direction IS NULL OR p_direction NOT IN('asc','desc')
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR coalesce(length(p_search),0)>100 THEN
    RAISE EXCEPTION 'ADMIN_CATALOG_QUERY_INVALID' USING ERRCODE='22023';
  END IF;
  v_search:=lower(nullif(trim(p_search),''));
  v_fingerprint:=encode(public.digest(convert_to(jsonb_build_array(p_actor,p_scope,p_scope_id,v_search,p_kind,p_status,p_sort,p_direction)::text,'UTF8'),'sha256'),'hex');
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
    WHERE p_scope='platform' AND p_kind IN('all','students') AND s.created_at<=v_at
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
  ), keyed AS (
    SELECT measured.*,CASE p_sort WHEN 'name' THEN lower(display_name) WHEN 'activity' THEN lpad(activity_count::text,20,'0')
      WHEN 'created' THEN to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')
      ELSE to_char(activity_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') END COLLATE "C" sort_value FROM measured
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
      'classId',class_id,'classTitle',class_title,'classStatus',class_status,
      'account',CASE WHEN kind='account' AND principal_id IS NOT NULL AND login IS NOT NULL THEN jsonb_build_object('accountId',id,'principalId',principal_id,'displayName',display_name,'username',login,'email',email,'status',status,
        'emailVerificationState',email_verification_state,'createdAt',created_at,'organizationRole',organization_role,'membershipState',membership_state,'lastSeenAt',last_seen,'hasEverSignedIn',has_signed_in,
        'lastIpAddress',host(ip_address),'lastNetworkKind',network_kind,'lastDevice',user_agent_summary,'recentActivityCount',activity_count,
        'isPlatformAdmin',p_scope='platform' AND EXISTS(SELECT 1 FROM public.capability_grants g WHERE g.account_id=page.id AND g.capability='platform_admin' AND g.state='verified'),
        'activeSessionCount',(SELECT count(*) FROM public.sessions_v2 sv WHERE sv.principal_id=page.principal_id AND sv.revoked_at IS NULL AND sv.expires_at>v_at AND (p_scope='platform' OR sv.active_workspace_id=p_scope_id))) ELSE NULL END) item
    FROM page WHERE rn<=p_limit
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY rn) FROM views),'[]'::jsonb),'asOf',v_at,
    'studentCoverage',CASE WHEN p_scope='platform' THEN jsonb_build_object('state','complete') ELSE jsonb_build_object('state','unavailable','reason','organization_class_mapping_unavailable') END,
    'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('v',1,'fingerprint',v_fingerprint,'asOf',v_at,'last',jsonb_build_object('kind',kind,'id',id,'value',sort_value)) FROM views ORDER BY rn DESC LIMIT 1) ELSE NULL END) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_user_catalog(uuid,varchar,uuid,varchar,varchar,varchar,varchar,varchar,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_catalog(uuid,varchar,uuid,varchar,varchar,varchar,varchar,varchar,integer,jsonb) TO asalab_app;
