-- Full user CRM authorized by platform owner. Exact classroom readers never
-- acquire access to the learner's linked personal Account or another class.
CREATE TABLE public.crm_student_profiles (
  seat_id uuid PRIMARY KEY REFERENCES public.classroom_student_seats(id),
  birth_date date,
  country varchar(2),
  bio varchar(2000) NOT NULL DEFAULT ''
);
ALTER TABLE public.crm_student_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_student_profiles FROM PUBLIC,asalab_app;

CREATE FUNCTION public.crm_subject_allowed(p_actor uuid,p_kind varchar,p_target uuid,p_class uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN public.admin_authorized_role(p_actor,'platform',NULL)='platform_admin' THEN
    CASE p_kind WHEN 'account' THEN EXISTS(SELECT 1 FROM public.accounts WHERE id=p_target)
      WHEN 'student' THEN EXISTS(SELECT 1 FROM public.classroom_student_seats WHERE id=p_target) ELSE false END
  ELSE p_kind='student' AND p_class IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.classroom_student_seats s WHERE s.id=p_target AND s.classroom_id=p_class
      AND public.ai_classroom_access_teacher(p_actor,p_class,false)) END;
$$;

CREATE FUNCTION public.crm_profile_value(p_kind varchar,p_target uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE p_kind WHEN 'account' THEN (
   SELECT jsonb_build_object('kind','account','id',a.id,'name',f.display_name,'bio',coalesce(f.bio,''),'country',a.country,'birthDate',a.birth_date,
     'age',extract(year FROM age(current_date,a.birth_date))::integer,'email',a.email,'status',a.status,'registeredAt',a.created_at,'classId',NULL,'classTitle',NULL,
     'linkedIdentities',coalesce((SELECT jsonb_agg(jsonb_build_object('kind','student','id',s.id,'classId',s.classroom_id,'name',s.display_label) ORDER BY s.id) FROM public.classroom_student_seats s WHERE s.account_id=a.id),'[]'::jsonb),
     'teachingClasses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'role',m.member_role,'status',c.status) ORDER BY c.id) FROM public.classroom_memberships m JOIN public.classrooms c ON c.id=m.classroom_id AND c.tenant_id=m.tenant_id WHERE m.account_id=a.id),'[]'::jsonb),
     'capabilities',coalesce((SELECT jsonb_agg(jsonb_build_object('capability',g.capability,'state',g.state) ORDER BY g.capability) FROM public.capability_grants g WHERE g.account_id=a.id),'[]'::jsonb),
     'memberships',coalesce((SELECT jsonb_agg(jsonb_build_object('id',w.id,'title',w.title,'role',m.role,'state',m.state) ORDER BY w.id) FROM public.workspace_memberships m JOIN public.workspaces w ON w.id=m.workspace_id WHERE m.account_id=a.id),'[]'::jsonb))
   FROM public.accounts a LEFT JOIN public.profiles f ON f.account_id=a.id WHERE a.id=p_target
 ) WHEN 'student' THEN (
   SELECT jsonb_build_object('kind','student','id',s.id,'name',s.display_label,'bio',coalesce(f.bio,''),'country',f.country,'birthDate',f.birth_date,
     'age',extract(year FROM age(current_date,f.birth_date))::integer,'email',NULL,'status',s.status,'registeredAt',s.created_at,'classId',c.id,'classTitle',c.title,
     'linkedIdentities',CASE WHEN s.account_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('kind','account','id',s.account_id)) END,
     'capabilities','[]'::jsonb,'memberships','[]'::jsonb)
   FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
   LEFT JOIN public.crm_student_profiles f ON f.seat_id=s.id WHERE s.id=p_target
 ) END;
$$;

CREATE FUNCTION public.crm_audit(p_actor uuid,p_kind varchar,p_target uuid,p_class uuid,p_action varchar,p_reason varchar,p_request varchar,p_before jsonb,p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account uuid; v_platform boolean;
BEGIN
 IF NOT coalesce(public.crm_subject_allowed(p_actor,p_kind,p_target,p_class),false) THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 SELECT account_id INTO v_account FROM public.principals WHERE id=p_actor AND kind='account';
 v_platform:=coalesce(public.admin_authorized_role(p_actor,'platform',NULL)='platform_admin',false);
 INSERT INTO public.administrative_audit_events(actor_principal_id,actor_account_id,actor_role,scope_kind,action,target_type,target_id,reason_code,reason_text,request_id,result,metadata_json)
 VALUES(p_actor,v_account,CASE WHEN v_platform THEN 'platform_admin' ELSE 'classroom_teacher' END,'platform',p_action,'crm_'||p_kind,p_target::text,'crm',p_reason,p_request,'succeeded',jsonb_build_object('classroomId',p_class,'before',p_before,'after',p_after));
END;
$$;

CREATE FUNCTION public.crm_card(p_actor uuid,p_kind varchar,p_target uuid,p_class uuid,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_profile jsonb; v_platform boolean;
BEGIN
 IF NOT coalesce(public.crm_subject_allowed(p_actor,p_kind,p_target,p_class),false) THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 v_profile:=public.crm_profile_value(p_kind,p_target);
 v_platform:=coalesce(public.admin_authorized_role(p_actor,'platform',NULL)='platform_admin',false);
 IF NOT v_platform THEN v_profile:=v_profile||jsonb_build_object('linkedIdentities','[]'::jsonb); END IF;
 PERFORM public.crm_audit(p_actor,p_kind,p_target,p_class,'crm.profile.read',NULL,p_request,NULL,NULL);
 RETURN v_profile||jsonb_build_object('version',encode(public.digest(convert_to(v_profile::text,'UTF8'),'sha256'),'hex'),'canEdit',v_platform,'canManageCapabilities',v_platform AND p_kind='account' AND NOT EXISTS(SELECT 1 FROM public.principals WHERE id=p_actor AND account_id=p_target));
END;
$$;

CREATE FUNCTION public.crm_profile_update(p_actor uuid,p_kind varchar,p_target uuid,p_version varchar,p_name varchar,p_birth date,p_country varchar,p_bio varchar,p_reason varchar,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' OR p_kind NOT IN('account','student') THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 OR p_bio IS NULL OR length(p_bio)>2000 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
   OR (p_country IS NOT NULL AND p_country !~ '^[A-Z]{2}$') OR (p_birth IS NOT NULL AND (NOT isfinite(p_birth) OR p_birth>current_date OR p_birth<current_date-interval '120 years'))
   OR (p_kind='account' AND (p_birth IS NULL OR p_birth>current_date-interval '18 years' OR p_country IS NULL)) THEN RAISE EXCEPTION 'CRM_INVALID' USING ERRCODE='22023'; END IF;
 IF p_kind='account' THEN
   PERFORM id FROM public.accounts WHERE id=p_target FOR UPDATE;
   PERFORM account_id FROM public.profiles WHERE account_id=p_target FOR UPDATE;
 ELSE PERFORM id FROM public.classroom_student_seats WHERE id=p_target FOR UPDATE; END IF;
 v_before:=public.crm_profile_value(p_kind,p_target);
 IF v_before IS NULL THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF encode(public.digest(convert_to(v_before::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'CRM_CONFLICT' USING ERRCODE='40001'; END IF;
 IF p_kind='account' THEN
   UPDATE public.accounts SET birth_date=p_birth,country=p_country WHERE id=p_target;
   UPDATE public.profiles SET display_name=trim(p_name),bio=p_bio,updated_at=clock_timestamp() WHERE account_id=p_target;
   IF NOT FOUND THEN RAISE EXCEPTION 'CRM_PROFILE_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 ELSE
   UPDATE public.classroom_student_seats SET display_label=trim(p_name) WHERE id=p_target;
   INSERT INTO public.crm_student_profiles(seat_id,birth_date,country,bio) VALUES(p_target,p_birth,p_country,p_bio)
   ON CONFLICT(seat_id) DO UPDATE SET birth_date=excluded.birth_date,country=excluded.country,bio=excluded.bio;
 END IF;
 v_after:=public.crm_profile_value(p_kind,p_target);
 PERFORM public.crm_audit(p_actor,p_kind,p_target,NULL,'crm.profile.update',trim(p_reason),p_request,v_before,v_after);
 RETURN public.crm_card(p_actor,p_kind,p_target,NULL,p_request);
END;
$$;

CREATE FUNCTION public.crm_capability_update(p_actor uuid,p_target uuid,p_version varchar,p_capability varchar,p_state varchar,p_reason varchar,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before jsonb; v_actor_account uuid;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_capability IS NULL OR p_capability NOT IN('creator','educator','registered_student','guardian') OR p_state IS NULL OR p_state NOT IN('verified','suspended','revoked') OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'CRM_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.accounts WHERE id=p_target AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 SELECT account_id INTO v_actor_account FROM public.principals WHERE id=p_actor;
 IF v_actor_account=p_target THEN RAISE EXCEPTION 'CRM_SELF_CHANGE' USING ERRCODE='22023'; END IF;
 v_before:=public.crm_profile_value('account',p_target);
 IF encode(public.digest(convert_to(v_before::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'CRM_CONFLICT' USING ERRCODE='40001'; END IF;
 INSERT INTO public.capability_grants(account_id,capability,state,policy_version,granted_by) VALUES(p_target,p_capability,p_state,'crm-owner-approved-20261025','admin')
 ON CONFLICT(account_id,capability) DO UPDATE SET state=excluded.state,policy_version=excluded.policy_version,granted_by='admin',granted_at=clock_timestamp();
 PERFORM public.crm_audit(p_actor,'account',p_target,NULL,'crm.capability.update',trim(p_reason),p_request,v_before,public.crm_profile_value('account',p_target));
 RETURN public.crm_card(p_actor,'account',p_target,NULL,p_request);
END;
$$;

CREATE FUNCTION public.crm_content_page(p_actor uuid,p_kind varchar,p_target uuid,p_class uuid,p_category varchar,p_limit integer,p_cursor jsonb,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_fingerprint text; v_last jsonb; v_at timestamptz:=statement_timestamp(); v_result jsonb;
BEGIN
 IF NOT coalesce(public.crm_subject_allowed(p_actor,p_kind,p_target,p_class),false) THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_category IS NULL OR p_category NOT IN('messages','projects','sessions','events') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'CRM_INVALID' USING ERRCODE='22023'; END IF;
 v_fingerprint:=encode(public.digest(convert_to(jsonb_build_array(p_actor,p_kind,p_target,p_class,p_category)::text,'UTF8'),'sha256'),'hex');
 IF p_cursor IS NOT NULL THEN
   BEGIN
     IF octet_length(p_cursor::text)>4096 OR jsonb_typeof(p_cursor)<>'object' OR p_cursor-ARRAY['v','fingerprint','asOf','last']<>'{}'::jsonb OR p_cursor->'v' IS DISTINCT FROM '1'::jsonb OR p_cursor->>'fingerprint' IS DISTINCT FROM v_fingerprint OR jsonb_typeof(p_cursor->'last') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'cursor'; END IF;
     v_at:=(p_cursor->>'asOf')::timestamptz;v_last:=p_cursor->'last';
     IF v_at IS NULL OR NOT isfinite(v_at) OR v_at>statement_timestamp() OR v_at<statement_timestamp()-interval '1 hour' OR v_last-ARRAY['at','id']<>'{}'::jsonb OR NOT isfinite((v_last->>'at')::timestamptz) OR (v_last->>'at')::timestamptz>v_at THEN RAISE EXCEPTION 'cursor'; END IF;
     IF v_last->>'id' IS NULL OR (v_last->>'id') !~ '^[a-f0-9-]{1,100}$' OR v_last->>'at' IS NULL THEN RAISE EXCEPTION 'cursor'; END IF;
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CRM_CURSOR_INVALID' USING ERRCODE='22023'; END;
 END IF;
 WITH actor AS (
   SELECT p.id FROM public.principals p WHERE (p_kind='account' AND p.kind='account' AND p.account_id=p_target) OR (p_kind='student' AND p.kind='student_seat' AND p.seat_id=p_target)
 ), entries AS (
   SELECT m.id::text COLLATE "C" id,m.created_at at,jsonb_build_object('id',m.id,'threadId',m.thread_id,'requestId',m.request_id,'role',m.role,'text',m.content,'state',m.state,'occurredAt',m.created_at) payload
   FROM public.ai_assistant_messages m JOIN actor ON actor.id=m.owner_principal_id WHERE p_category='messages'
   UNION ALL
   SELECT p.id::text,p.created_at,jsonb_build_object('id',p.id,'title',p.title,'module',p.module_key,'status',p.status,'classId',p.classroom_id,'occurredAt',p.created_at)
   FROM public.projects p JOIN actor ON actor.id=p.owner_principal_id WHERE p_category='projects' AND (p_class IS NULL OR p.classroom_id=p_class)
   UNION ALL
   SELECT s.id::text,s.created_at,jsonb_build_object('id',s.id,'occurredAt',s.created_at,'lastSeenAt',s.last_seen_at,'expiresAt',s.expires_at,'state',CASE WHEN s.revoked_at IS NOT NULL THEN 'revoked' WHEN s.expires_at<=statement_timestamp() THEN 'expired' ELSE 'active' END)
   FROM public.sessions_v2 s JOIN actor ON actor.id=s.principal_id WHERE p_category='sessions' AND p_kind='account'
   UNION ALL
   SELECT s.id::text,s.created_at,jsonb_build_object('id',s.id,'occurredAt',s.created_at,'lastSeenAt',s.last_seen_at,'expiresAt',s.expires_at,'state',CASE WHEN s.revoked_at IS NOT NULL THEN 'revoked' WHEN s.expires_at<=statement_timestamp() THEN 'expired' ELSE 'active' END)
   FROM public.classroom_student_sessions s WHERE p_category='sessions' AND p_kind='student' AND s.seat_id=p_target
   UNION ALL
   SELECT e.id::text,e.occurred_at,jsonb_build_object('id',e.id::text,'occurredAt',e.occurred_at,'eventType',e.event_type,'module',e.module_key,'state',e.outcome,'ipAddress',host(e.ip_address),'device',e.user_agent_summary)
   FROM public.product_analytics_events e WHERE p_category='events' AND ((p_kind='account' AND e.actor_kind='account' AND e.account_id=p_target) OR (p_kind='student' AND e.actor_kind='student' AND e.seat_id=p_target))
     AND coalesce(e.persisted_at,e.received_at,e.occurred_at)<=v_at
 ), page AS (
   SELECT * FROM entries WHERE at<=v_at AND (v_last IS NULL OR (at,id)<((v_last->>'at')::timestamptz,(v_last->>'id') COLLATE "C")) ORDER BY at DESC,id DESC LIMIT p_limit+1
 ), visible AS (SELECT * FROM page ORDER BY at DESC,id DESC LIMIT p_limit)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(payload ORDER BY at DESC,id DESC) FROM visible),'[]'::jsonb),'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT jsonb_build_object('v',1,'fingerprint',v_fingerprint,'asOf',v_at,'last',jsonb_build_object('at',at,'id',id)) FROM visible ORDER BY at,id LIMIT 1) ELSE NULL END) INTO v_result;
 PERFORM public.crm_audit(p_actor,p_kind,p_target,p_class,'crm.'||p_category||'.read',NULL,p_request,NULL,NULL);
 RETURN v_result;
END;
$$;

CREATE FUNCTION public.crm_student_status_update(p_actor uuid,p_target uuid,p_version varchar,p_status varchar,p_reason varchar,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before jsonb;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN('active','suspended') OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'CRM_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM id FROM public.classroom_student_seats WHERE id=p_target AND status IN('issued','active','suspended') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 v_before:=public.crm_profile_value('student',p_target);
 IF encode(public.digest(convert_to(v_before::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'CRM_CONFLICT' USING ERRCODE='40001'; END IF;
 UPDATE public.classroom_student_seats SET status=p_status,updated_at=clock_timestamp() WHERE id=p_target;
 IF p_status='suspended' THEN
   UPDATE public.classroom_student_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE seat_id=p_target AND revoked_at IS NULL;
   UPDATE public.sessions_v2 s SET revoked_at=coalesce(s.revoked_at,clock_timestamp()) FROM public.principals p WHERE p.id=s.principal_id AND p.kind='student_seat' AND p.seat_id=p_target AND s.revoked_at IS NULL;
 END IF;
 PERFORM public.crm_audit(p_actor,'student',p_target,NULL,'crm.student.status.update',trim(p_reason),p_request,v_before,public.crm_profile_value('student',p_target));
 RETURN public.crm_card(p_actor,'student',p_target,NULL,p_request);
END;
$$;

CREATE FUNCTION public.crm_project_read(p_actor uuid,p_kind varchar,p_target uuid,p_class uuid,p_project uuid,p_version uuid,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_project public.projects%ROWTYPE;v_result jsonb;
BEGIN
 IF NOT coalesce(public.crm_subject_allowed(p_actor,p_kind,p_target,p_class),false) THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 SELECT p.* INTO v_project FROM public.projects p JOIN public.principals actor ON actor.id=p.owner_principal_id WHERE p.id=p_project
 AND ((p_kind='account' AND actor.kind='account' AND actor.account_id=p_target) OR (p_kind='student' AND actor.kind='student_seat' AND actor.seat_id=p_target)) AND (p_class IS NULL OR p.classroom_id=p_class);
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE='42501'; END IF;
 IF p_version IS NULL THEN
   SELECT jsonb_build_object('projectId',p_project,'title',v_project.title,'module',v_project.module_key,'revision',d.revision,'document',d.document_json,'source','draft','updatedAt',d.updated_at) INTO v_result FROM public.project_drafts d WHERE d.project_id=p_project AND d.tenant_id=v_project.tenant_id;
 ELSE
   SELECT jsonb_build_object('projectId',p_project,'title',v_project.title,'module',v_project.module_key,'revision',v.version_no,'document',v.document_json,'source','saved_version','updatedAt',v.created_at) INTO v_result FROM public.project_versions v WHERE v.project_id=p_project AND v.id=p_version AND v.tenant_id=v_project.tenant_id;
 END IF;
 IF v_result IS NULL THEN RAISE EXCEPTION 'CRM_PROJECT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 IF p_version IS NULL THEN
   v_result:=v_result||jsonb_build_object('preview',(SELECT jsonb_build_object('dataUrl','data:'||s.content_type||';base64,'||replace(encode(s.image,'base64'),E'\n',''),'revision',s.source_revision) FROM public.project_snapshots s WHERE s.project_id=p_project AND s.tenant_id=v_project.tenant_id));
 END IF;
 PERFORM public.crm_audit(p_actor,p_kind,p_target,p_class,'crm.project.read',NULL,p_request,NULL,jsonb_build_object('projectId',p_project,'versionId',p_version));
 RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_subject_allowed(uuid,varchar,uuid,uuid),public.crm_profile_value(varchar,uuid),public.crm_audit(uuid,varchar,uuid,uuid,varchar,varchar,varchar,jsonb,jsonb) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.crm_card(uuid,varchar,uuid,uuid,varchar),public.crm_profile_update(uuid,varchar,uuid,varchar,varchar,date,varchar,varchar,varchar,varchar),public.crm_capability_update(uuid,uuid,varchar,varchar,varchar,varchar,varchar),public.crm_content_page(uuid,varchar,uuid,uuid,varchar,integer,jsonb,varchar),public.crm_project_read(uuid,varchar,uuid,uuid,uuid,uuid,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_card(uuid,varchar,uuid,uuid,varchar),public.crm_profile_update(uuid,varchar,uuid,varchar,varchar,date,varchar,varchar,varchar,varchar),public.crm_capability_update(uuid,uuid,varchar,varchar,varchar,varchar,varchar),public.crm_content_page(uuid,varchar,uuid,uuid,varchar,integer,jsonb,varchar),public.crm_project_read(uuid,varchar,uuid,uuid,uuid,uuid,varchar) TO asalab_app;
REVOKE ALL ON FUNCTION public.crm_student_status_update(uuid,uuid,varchar,varchar,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_student_status_update(uuid,uuid,varchar,varchar,varchar,varchar) TO asalab_app;

-- Forward repair: preserve the public command body/ACL, serialize both writers.
CREATE OR REPLACE FUNCTION public.admin_set_account_status(
    p_actor_principal_id uuid,
    p_target_account_id uuid,
    p_status varchar,
    p_reason varchar,
    p_request_id varchar
) RETURNS varchar
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_actor_account_id uuid;
    v_before varchar;
BEGIN
    -- Serialize privilege writers before actor authorization; prevent mutual revocation.
    PERFORM pg_advisory_xact_lock(68174329, 247);
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative account management denied' USING ERRCODE = '42501';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('active', 'suspended')
       OR p_reason IS NULL OR p_request_id IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid account management request' USING ERRCODE = '22023';
    END IF;

    SELECT p.account_id INTO v_actor_account_id
      FROM public.principals p
     WHERE p.id = p_actor_principal_id;
    IF v_actor_account_id = p_target_account_id AND p_status = 'suspended' THEN
        RAISE EXCEPTION 'administrator cannot suspend their own account' USING ERRCODE = '22023';
    END IF;

    SELECT a.status INTO v_before
      FROM public.accounts a
     WHERE a.id = p_target_account_id
     FOR UPDATE;
    IF v_before IS NULL OR v_before = 'closed' THEN
        RAISE EXCEPTION 'account is not manageable' USING ERRCODE = '22023';
    END IF;
    IF v_before = p_status THEN
        RETURN v_before;
    END IF;

    UPDATE public.accounts SET status = p_status WHERE id = p_target_account_id;
    IF p_status = 'suspended' THEN
        UPDATE public.sessions_v2 s
           SET revoked_at = COALESCE(s.revoked_at, now())
          FROM public.principals p
         WHERE p.account_id = p_target_account_id
           AND s.principal_id = p.id
           AND s.revoked_at IS NULL;
    END IF;

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        CASE WHEN p_status = 'suspended'
             THEN 'administration.account.suspend'
             ELSE 'administration.account.restore' END,
        'account', p_target_account_id::text,
        'admin_console', trim(p_reason), NULL,
        p_request_id, p_request_id, 'succeeded', NULL, NULL
    );
    RETURN p_status;
END;
$$;

-- Forward repair: preserve the public command body/ACL, serialize both writers.
CREATE OR REPLACE FUNCTION public.admin_set_platform_admin(
    p_actor_principal_id uuid,
    p_target_account_id uuid,
    p_enabled boolean,
    p_reason varchar,
    p_request_id varchar
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_actor_account_id uuid;
    v_target_status varchar;
    v_before boolean;
BEGIN
    -- Serialize privilege writers before actor authorization; prevent mutual revocation.
    PERFORM pg_advisory_xact_lock(68174329, 247);
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative role management denied' USING ERRCODE = '42501';
    END IF;
    IF p_enabled IS NULL OR p_reason IS NULL OR p_request_id IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid role management request' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_actor_account_id
      FROM public.principals p
     WHERE p.id = p_actor_principal_id;
    IF v_actor_account_id = p_target_account_id AND NOT p_enabled THEN
        RAISE EXCEPTION 'administrator cannot revoke their own role' USING ERRCODE = '22023';
    END IF;

    SELECT a.status INTO v_target_status
      FROM public.accounts a
     WHERE a.id = p_target_account_id
     FOR UPDATE;
    IF v_target_status IS NULL OR (p_enabled AND v_target_status <> 'active') THEN
        RAISE EXCEPTION 'account is not eligible for this role' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (
        SELECT 1 FROM public.capability_grants g
         WHERE g.account_id = p_target_account_id
           AND g.capability = 'platform_admin'
           AND g.state = 'verified'
    ) INTO v_before;
    IF v_before = p_enabled THEN
        RETURN v_before;
    END IF;

    IF p_enabled THEN
        INSERT INTO public.capability_grants
            (account_id, capability, state, policy_version, granted_by)
        VALUES
            (p_target_account_id, 'platform_admin', 'verified', 'admin-console-v1', 'admin')
        ON CONFLICT (account_id, capability) DO UPDATE
           SET state = 'verified',
               policy_version = 'admin-console-v1',
               granted_by = 'admin',
               granted_at = now();
    ELSE
        UPDATE public.capability_grants
           SET state = 'revoked', granted_at = now()
         WHERE account_id = p_target_account_id
           AND capability = 'platform_admin';
    END IF;

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        CASE WHEN p_enabled
             THEN 'administration.platform_admin.grant'
             ELSE 'administration.platform_admin.revoke' END,
        'account', p_target_account_id::text,
        'admin_console', trim(p_reason), NULL,
        p_request_id, p_request_id, 'succeeded', NULL, NULL
    );
    RETURN p_enabled;
END;
$$;
