-- Read retained records only. No synthetic identities or reconstructed past events.
CREATE INDEX admin_history_projects_owner_idx ON public.projects(owner_principal_id,created_at DESC,id);
CREATE INDEX admin_history_versions_time_idx ON public.project_versions(project_id,created_at DESC,id);
CREATE INDEX admin_history_publications_owner_idx ON public.project_publication_state(owner_principal_id,project_id);
CREATE INDEX admin_history_ai_account_idx ON public.ai_usage_journal(account_id,admitted_at DESC,request_id) WHERE account_id IS NOT NULL;
CREATE INDEX admin_history_ai_seat_idx ON public.ai_usage_journal(seat_id,admitted_at DESC,request_id) WHERE seat_id IS NOT NULL;

CREATE FUNCTION public.admin_user_history(p_actor uuid,p_scope varchar,p_scope_id uuid,p_kind varchar,p_target uuid,p_category varchar,p_limit integer,p_cursor jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_role varchar; v_at timestamptz:=statement_timestamp(); v_fingerprint text; v_last jsonb; v_result jsonb;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN('platform','organization') OR (p_scope='platform' AND p_scope_id IS NOT NULL) OR (p_scope='organization' AND p_scope_id IS NULL)
     OR p_kind IS NULL OR p_kind NOT IN('account','student') OR p_target IS NULL OR p_category IS NULL OR p_category NOT IN('projects','publications','ai') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'ADMIN_HISTORY_QUERY_INVALID' USING ERRCODE='22023';
  END IF;
  v_role:=public.admin_authorized_role(p_actor,p_scope,p_scope_id);
  IF v_role IS NULL OR (p_scope='platform' AND v_role<>'platform_admin') OR (p_scope='organization' AND v_role NOT IN('owner','school_admin')) THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF (p_kind='account' AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_target)) OR (p_kind='student' AND NOT EXISTS(SELECT 1 FROM public.classroom_student_seats WHERE id=p_target)) THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  -- Membership does not authorize reading a person's private projects/AI. The
  -- sources have no exact organization-workspace lineage; tenant is insufficient.
  IF p_scope='organization' THEN
    IF p_kind<>'account' OR NOT EXISTS(SELECT 1 FROM public.workspace_memberships WHERE workspace_id=p_scope_id AND account_id=p_target) THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object('items','[]'::jsonb,'next',NULL,'asOf',v_at,'coverage','unavailable_scope');
  END IF;
  v_fingerprint:=encode(public.digest(convert_to(jsonb_build_array(p_actor,p_scope,p_scope_id,p_kind,p_target,p_category)::text,'UTF8'),'sha256'),'hex');
  IF p_cursor IS NOT NULL THEN
    BEGIN
      IF octet_length(p_cursor::text)>4096 OR jsonb_typeof(p_cursor)<>'object' OR p_cursor-ARRAY['v','fingerprint','asOf','last']<>'{}'::jsonb OR p_cursor->'v' IS DISTINCT FROM '1'::jsonb OR p_cursor->>'fingerprint' IS DISTINCT FROM v_fingerprint OR jsonb_typeof(p_cursor->'asOf') IS DISTINCT FROM 'string' OR jsonb_typeof(p_cursor->'last') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'cursor'; END IF;
      v_at:=(p_cursor->>'asOf')::timestamptz; v_last:=p_cursor->'last';
      IF v_at IS NULL OR NOT isfinite(v_at) OR v_at>statement_timestamp() OR v_at<statement_timestamp()-interval '1 hour' OR v_last-ARRAY['at','key']<>'{}'::jsonb OR jsonb_typeof(v_last->'at') IS DISTINCT FROM 'string' OR jsonb_typeof(v_last->'key') IS DISTINCT FROM 'string' OR (v_last->>'key') !~ '^(project|version|publication|legacy_publication|ai):[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'cursor'; END IF;
      IF NOT isfinite((v_last->>'at')::timestamptz) OR (v_last->>'at')::timestamptz>v_at THEN RAISE EXCEPTION 'cursor'; END IF;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'ADMIN_HISTORY_CURSOR_INVALID' USING ERRCODE='22023'; END;
  END IF;
  WITH owned AS (
    SELECT p.* FROM public.projects p JOIN public.principals actor ON actor.id=p.owner_principal_id
    WHERE (p_kind='account' AND actor.kind='account' AND actor.account_id=p_target) OR (p_kind='student' AND actor.kind='student_seat' AND actor.seat_id=p_target)
  ), entries AS (
    SELECT 'project:'||p.id key,p.created_at at,jsonb_build_object('type','project','id',p.id,'title',p.title,'projectId',p.id,'module',p.module_key,'status',p.status) payload
    FROM owned p WHERE p_category='projects'
    UNION ALL
    SELECT 'version:'||v.id,v.created_at,jsonb_build_object('type','version','id',v.id,'title',coalesce(v.label,p.title),'projectId',p.id,'module',p.module_key,'revision',v.version_no)
    FROM owned p JOIN public.project_versions v ON v.project_id=p.id AND v.tenant_id=p.tenant_id WHERE p_category='projects'
    UNION ALL
    SELECT 'publication:'||r.id,r.published_at,jsonb_build_object('type','publication','id',r.id,'title',r.title,'projectId',r.project_id,'module',r.module_key,'revision',r.revision_no,'status',s.state)
    FROM public.project_publication_revisions r JOIN public.project_publication_state s ON s.id=r.publication_id AND s.project_id=r.project_id AND s.tenant_id=r.tenant_id
    JOIN public.principals actor ON actor.id=s.owner_principal_id
    WHERE p_category='publications' AND ((p_kind='account' AND actor.kind='account' AND actor.account_id=p_target) OR (p_kind='student' AND actor.kind='student_seat' AND actor.seat_id=p_target))
    UNION ALL
    SELECT 'legacy_publication:'||g.project_id,g.published_at,jsonb_build_object('type','legacy_publication','id',g.project_id,'title',g.title,'projectId',g.project_id,'module',g.module_key,'revision',g.snapshot_revision,'status','legacy')
    FROM public.project_publications g JOIN public.principals actor ON actor.id=g.owner_principal_id
    WHERE p_category='publications' AND ((p_kind='account' AND actor.kind='account' AND actor.account_id=p_target) OR (p_kind='student' AND actor.kind='student_seat' AND actor.seat_id=p_target))
    UNION ALL
    SELECT 'ai:'||u.request_id,u.admitted_at,jsonb_build_object('type','ai','id',u.request_id,'title',NULL,'projectId',NULL,'module','ai','status',u.status,'provider',u.provider,'model',u.actual_model,'requestedModel',u.requested_model,'inputTokens',u.input_tokens::text,'outputTokens',u.output_tokens::text,'errorCode',u.error_code,'durationMs',u.duration_ms::text)
    FROM public.ai_usage_journal u WHERE p_category='ai' AND ((p_kind='account' AND u.account_id=p_target AND u.seat_id IS NULL) OR (p_kind='student' AND u.seat_id=p_target AND u.account_id IS NULL))
    UNION ALL
    -- Historic quota admissions are retained facts too. They do not prove a
    -- successful generation or any model/token usage; never invent those values.
    SELECT 'ai:'||q.request_id,q.created_at,jsonb_build_object('type','ai','id',q.request_id,'title','Сохранённый запрос без подробных сведений','module','ai','status','legacy_unknown')
    FROM public.ai_assistant_request_quota q JOIN public.principals actor ON actor.id=q.owner_principal_id
    WHERE p_category='ai' AND ((p_kind='account' AND actor.kind='account' AND actor.account_id=p_target) OR (p_kind='student' AND actor.kind='student_seat' AND actor.seat_id=p_target))
      AND NOT EXISTS(SELECT 1 FROM public.ai_usage_journal u WHERE u.owner_principal_id=q.owner_principal_id AND u.request_id=q.request_id)
  ), page AS (
    SELECT * FROM entries WHERE at<=v_at AND (v_last IS NULL OR at<(v_last->>'at')::timestamptz OR (at=(v_last->>'at')::timestamptz AND key COLLATE "C">(v_last->>'key') COLLATE "C"))
    ORDER BY at DESC,key COLLATE "C" LIMIT p_limit+1
  ), visible AS (
    SELECT * FROM page ORDER BY at DESC,key COLLATE "C" LIMIT p_limit
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(payload||jsonb_build_object('key',key,'occurredAt',at) ORDER BY at DESC,key COLLATE "C") FROM visible),'[]'::jsonb),'asOf',v_at,'coverage','retained',
    'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('v',1,'fingerprint',v_fingerprint,'asOf',v_at,'last',jsonb_build_object('at',at,'key',key)) FROM visible ORDER BY at ASC,key COLLATE "C" DESC LIMIT 1) ELSE NULL END) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_user_history(uuid,varchar,uuid,varchar,uuid,varchar,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_history(uuid,varchar,uuid,varchar,uuid,varchar,integer,jsonb) TO asalab_app;
