-- Additive exact Seat retained detail. The legacy Account history reader is unchanged.
CREATE FUNCTION public.crm_seat_history(p_actor uuid,p_target uuid,p_class uuid,p_category varchar,p_limit integer,p_cursor jsonb,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_at timestamptz:=statement_timestamp(); v_fingerprint text; v_last jsonb; v_result jsonb;
BEGIN
  IF NOT coalesce(public.crm_subject_allowed(p_actor,'student',p_target,p_class),false) OR NOT EXISTS(SELECT 1 FROM public.classroom_student_seats WHERE id=p_target AND classroom_id=p_class) THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
  IF p_category IS NULL OR p_category NOT IN('projects','publications','ai') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'CRM_INVALID' USING ERRCODE='22023'; END IF;
  v_fingerprint:=encode(public.digest(convert_to(jsonb_build_array(p_actor,p_class,p_target,p_category)::text,'UTF8'),'sha256'),'hex');
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
    WHERE actor.kind='student_seat' AND actor.seat_id=p_target AND p.classroom_id=p_class
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
    WHERE p_category='publications' AND (actor.kind='student_seat' AND actor.seat_id=p_target) AND EXISTS(SELECT 1 FROM owned WHERE id=r.project_id)
    UNION ALL
    SELECT 'legacy_publication:'||g.project_id,g.published_at,jsonb_build_object('type','legacy_publication','id',g.project_id,'title',g.title,'projectId',g.project_id,'module',g.module_key,'revision',g.snapshot_revision,'status','legacy')
    FROM public.project_publications g JOIN public.principals actor ON actor.id=g.owner_principal_id
    WHERE p_category='publications' AND (actor.kind='student_seat' AND actor.seat_id=p_target) AND EXISTS(SELECT 1 FROM owned WHERE id=g.project_id)
    UNION ALL
    SELECT 'ai:'||u.request_id,u.admitted_at,jsonb_build_object('type','ai','id',u.request_id,'title',NULL,'projectId',NULL,'module','ai','status',u.status,'provider',u.provider,'model',u.actual_model,'requestedModel',u.requested_model,'inputTokens',u.input_tokens::text,'outputTokens',u.output_tokens::text,'errorCode',u.error_code,'durationMs',u.duration_ms::text)
    FROM public.ai_usage_journal u WHERE p_category='ai' AND u.seat_id=p_target AND u.account_id IS NULL AND u.owner_principal_id IN(SELECT id FROM public.principals WHERE kind='student_seat' AND seat_id=p_target)
    UNION ALL
    -- Historic quota admissions are retained facts too. They do not prove a
    -- successful generation or any model/token usage; never invent those values.
    SELECT 'ai:'||q.request_id,q.created_at,jsonb_build_object('type','ai','id',q.request_id,'title','Сохранённый запрос без подробных сведений','module','ai','status','legacy_unknown')
    FROM public.ai_assistant_request_quota q JOIN public.principals actor ON actor.id=q.owner_principal_id
    WHERE p_category='ai' AND (actor.kind='student_seat' AND actor.seat_id=p_target)
      AND NOT EXISTS(SELECT 1 FROM public.ai_usage_journal u WHERE u.owner_principal_id=q.owner_principal_id AND u.request_id=q.request_id)
  ), page AS (
    SELECT * FROM entries WHERE at<=v_at AND (v_last IS NULL OR at<(v_last->>'at')::timestamptz OR (at=(v_last->>'at')::timestamptz AND key COLLATE "C">(v_last->>'key') COLLATE "C"))
    ORDER BY at DESC,key COLLATE "C" LIMIT p_limit+1
  ), visible AS (
    SELECT * FROM page ORDER BY at DESC,key COLLATE "C" LIMIT p_limit
  )
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(payload||jsonb_build_object('key',key,'occurredAt',at) ORDER BY at DESC,key COLLATE "C") FROM visible),'[]'::jsonb),'asOf',v_at,'coverage','retained',
    'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('v',1,'fingerprint',v_fingerprint,'asOf',v_at,'last',jsonb_build_object('at',at,'key',key)) FROM visible ORDER BY at ASC,key COLLATE "C" DESC LIMIT 1) ELSE NULL END) INTO v_result;
  PERFORM public.crm_audit(p_actor,'student',p_target,p_class,'crm.history.'||p_category||'.read',NULL,p_request,NULL,NULL);
  RETURN v_result;
END;
$$;
CREATE TABLE public.crm_seat_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 seat_id uuid NOT NULL REFERENCES public.classroom_student_seats(id),
 actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
 body varchar(2000) NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX crm_seat_notes_page_idx ON public.crm_seat_notes(seat_id,created_at DESC,id);
ALTER TABLE public.crm_seat_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_seat_notes FROM PUBLIC,asalab_app;
CREATE TRIGGER crm_seat_notes_immutable BEFORE UPDATE OR DELETE ON public.crm_seat_notes
 FOR EACH ROW EXECUTE FUNCTION public.administrative_audit_events_immutable();
CREATE TABLE public.crm_seat_note_revisions (
 seat_id uuid PRIMARY KEY REFERENCES public.classroom_student_seats(id),
 revision bigint NOT NULL CHECK(revision>0)
);
ALTER TABLE public.crm_seat_note_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_seat_note_revisions FROM PUBLIC,asalab_app;
CREATE FUNCTION public.crm_seat_note_version(p_seat uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(public.digest(convert_to(coalesce((SELECT revision::text FROM public.crm_seat_note_revisions WHERE seat_id=p_seat),'0'),'UTF8'),'sha256'),'hex');
$$;
-- Reading an archived educational record does not grant permission to append.
CREATE FUNCTION public.crm_seat_notes_writable(p_actor uuid,p_target uuid,p_class uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals actor
 JOIN public.accounts account ON account.id=actor.account_id AND account.status='active'
 JOIN public.classrooms classroom ON classroom.id=p_class AND classroom.status='active'
 JOIN public.classroom_student_seats seat ON seat.id=p_target AND seat.classroom_id=classroom.id AND seat.tenant_id=classroom.tenant_id
 WHERE actor.id=p_actor AND actor.kind='account' AND
 (public.admin_authorized_role(p_actor,'platform',NULL)='platform_admin'
 OR public.ai_classroom_access_teacher(p_actor,p_class,true)
 OR EXISTS(SELECT 1 FROM public.crm_organization_classes binding WHERE binding.classroom_id=p_class
 AND public.admin_authorized_role(p_actor,'organization',binding.workspace_id) IN('owner','school_admin'))));
$$;
CREATE FUNCTION public.crm_seat_notes_page(p_actor uuid,p_target uuid,p_class uuid,p_limit integer,p_cursor jsonb,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_at timestamptz:=clock_timestamp();v_last jsonb;v_fingerprint text;v_result jsonb;
BEGIN
 IF NOT coalesce(public.crm_subject_allowed(p_actor,'student',p_target,p_class),false) OR NOT EXISTS(SELECT 1 FROM public.classroom_student_seats WHERE id=p_target AND classroom_id=p_class) THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'CRM_INVALID' USING ERRCODE='22023'; END IF;
 v_fingerprint:=encode(public.digest(convert_to(jsonb_build_array(p_actor,p_target,p_class,'notes')::text,'UTF8'),'sha256'),'hex');
 IF p_cursor IS NOT NULL THEN
  BEGIN
   IF octet_length(p_cursor::text)>4096 OR jsonb_typeof(p_cursor)<>'object' OR p_cursor-ARRAY['v','fingerprint','asOf','last']<>'{}'::jsonb OR p_cursor->'v' IS DISTINCT FROM '1'::jsonb OR p_cursor->>'fingerprint' IS DISTINCT FROM v_fingerprint OR jsonb_typeof(p_cursor->'asOf') IS DISTINCT FROM 'string' OR jsonb_typeof(p_cursor->'last') IS DISTINCT FROM 'object' OR jsonb_typeof(p_cursor->'last'->'at') IS DISTINCT FROM 'string' OR jsonb_typeof(p_cursor->'last'->'id') IS DISTINCT FROM 'string' OR (p_cursor->'last')-ARRAY['at','id']<>'{}'::jsonb THEN RAISE EXCEPTION 'cursor'; END IF;
   v_at:=(p_cursor->>'asOf')::timestamptz;v_last:=p_cursor->'last';
   IF v_at IS NULL OR NOT isfinite(v_at) OR v_at>statement_timestamp() OR v_at<statement_timestamp()-interval '1 hour' OR NOT isfinite((v_last->>'at')::timestamptz) OR (v_last->>'at')::timestamptz>v_at OR (v_last->>'id')::uuid IS NULL OR v_last->>'at' IS NULL THEN RAISE EXCEPTION 'cursor'; END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_CURSOR_INVALID' USING ERRCODE='22023'; END;
 END IF;
 WITH page AS(SELECT * FROM public.crm_seat_notes WHERE seat_id=p_target AND created_at<=v_at AND (v_last IS NULL OR (created_at,id)<((v_last->>'at')::timestamptz,(v_last->>'id')::uuid)) ORDER BY created_at DESC,id DESC LIMIT p_limit+1),
 visible AS(SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'text',body,'occurredAt',created_at) ORDER BY created_at DESC,id DESC) FROM visible),'[]'::jsonb),'version',public.crm_seat_note_version(p_target),'canWrite',public.crm_seat_notes_writable(p_actor,p_target,p_class),'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN(SELECT jsonb_build_object('v',1,'fingerprint',v_fingerprint,'asOf',v_at,'last',jsonb_build_object('at',created_at,'id',id)) FROM visible ORDER BY created_at,id LIMIT 1) ELSE NULL END) INTO v_result;
 PERFORM public.crm_audit(p_actor,'student',p_target,p_class,'crm.notes.read',NULL,p_request,NULL,NULL);
 RETURN v_result;
END;$$;
CREATE FUNCTION public.crm_seat_note_add(p_actor uuid,p_target uuid,p_class uuid,p_version varchar,p_body varchar,p_reason varchar,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_id uuid;v_before text;
BEGIN
 -- Match platform/organization privilege writers, then exact class/binding writers.
 PERFORM pg_advisory_xact_lock(68174329,247);
 PERFORM id FROM public.classrooms WHERE id=p_class FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 -- Legacy co-teacher removal deletes this row without a class lock. Keep that
 -- grant until commit, or wait for its deletion before the fresh authorization.
 PERFORM membership.id FROM public.classroom_memberships membership
 JOIN public.principals actor ON actor.account_id=membership.account_id AND actor.kind='account'
 WHERE actor.id=p_actor AND membership.classroom_id=p_class FOR SHARE OF membership;
 PERFORM membership.id FROM public.workspace_memberships membership
 JOIN public.principals actor ON actor.account_id=membership.account_id AND actor.kind='account'
 JOIN public.crm_organization_classes binding ON binding.workspace_id=membership.workspace_id AND binding.classroom_id=p_class
 JOIN public.workspaces workspace ON workspace.id=membership.workspace_id
 WHERE actor.id=p_actor FOR SHARE OF membership,workspace;
 PERFORM id FROM public.classroom_student_seats WHERE id=p_target AND classroom_id=p_class FOR UPDATE;
 IF NOT FOUND OR NOT coalesce(public.crm_seat_notes_writable(p_actor,p_target,p_class),false) THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 2000 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'CRM_INVALID' USING ERRCODE='22023'; END IF;
 v_before:=public.crm_seat_note_version(p_target);
 IF v_before IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'CRM_CONFLICT' USING ERRCODE='40001'; END IF;
 INSERT INTO public.crm_seat_note_revisions(seat_id,revision) VALUES(p_target,1)
 ON CONFLICT(seat_id) DO UPDATE SET revision=crm_seat_note_revisions.revision+1;
 INSERT INTO public.crm_seat_notes(seat_id,actor_principal_id,body) VALUES(p_target,p_actor,trim(p_body)) RETURNING id INTO v_id;
 PERFORM public.crm_audit(p_actor,'student',p_target,p_class,'crm.notes.add',trim(p_reason),p_request,jsonb_build_object('version',v_before),jsonb_build_object('version',public.crm_seat_note_version(p_target),'noteId',v_id));
 RETURN public.crm_seat_notes_page(p_actor,p_target,p_class,25,NULL,p_request);
END;$$;
REVOKE ALL ON FUNCTION public.crm_seat_notes_writable(uuid,uuid,uuid),public.crm_seat_note_version(uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.crm_seat_history(uuid,uuid,uuid,varchar,integer,jsonb,varchar),public.crm_seat_notes_page(uuid,uuid,uuid,integer,jsonb,varchar),public.crm_seat_note_add(uuid,uuid,uuid,varchar,varchar,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_seat_history(uuid,uuid,uuid,varchar,integer,jsonb,varchar),public.crm_seat_notes_page(uuid,uuid,uuid,integer,jsonb,varchar),public.crm_seat_note_add(uuid,uuid,uuid,varchar,varchar,varchar,varchar) TO asalab_app;
