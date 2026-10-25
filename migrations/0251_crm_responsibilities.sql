-- Scoped responsibility commands. No personal profile data is returned.
CREATE FUNCTION public.crm_responsibility_value(p_kind varchar,p_scope uuid,p_target uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('kind',p_kind,'scopeId',p_scope,'targetId',p_target,'revision',CASE WHEN p_kind='organization' THEN (SELECT id::text||':'||xmin::text FROM public.workspace_memberships WHERE workspace_id=p_scope AND account_id=p_target) ELSE (SELECT id::text||':'||xmin::text FROM public.classroom_memberships WHERE classroom_id=p_scope AND account_id=p_target) END,'role',CASE WHEN p_kind='organization' THEN (SELECT role FROM public.workspace_memberships WHERE workspace_id=p_scope AND account_id=p_target) ELSE (SELECT member_role FROM public.classroom_memberships WHERE classroom_id=p_scope AND account_id=p_target) END,'state',CASE WHEN p_kind='organization' THEN (SELECT state FROM public.workspace_memberships WHERE workspace_id=p_scope AND account_id=p_target) ELSE CASE WHEN EXISTS(SELECT 1 FROM public.classroom_memberships WHERE classroom_id=p_scope AND account_id=p_target) THEN 'active' ELSE NULL END END);
$$;
CREATE FUNCTION public.crm_responsibility_read(p_actor uuid,p_kind varchar,p_scope uuid,p_target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_role varchar; v_value jsonb; v_roles jsonb;
BEGIN
 v_role:=public.admin_authorized_role(p_actor,'platform',NULL);
 IF p_kind='organization' THEN
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_scope AND kind='organization') THEN RAISE EXCEPTION 'scope denied' USING ERRCODE='42501'; END IF;
  IF v_role IS DISTINCT FROM 'platform_admin' THEN v_role:=public.admin_authorized_role(p_actor,'organization',p_scope); END IF;
  IF v_role IS NULL OR v_role NOT IN('platform_admin','owner','school_admin') THEN RAISE EXCEPTION 'scope denied' USING ERRCODE='42501'; END IF;
  v_roles:=CASE v_role WHEN 'platform_admin' THEN '["owner","school_admin","moderator","billing_admin","member","educator"]'::jsonb WHEN 'owner' THEN '["school_admin","moderator","billing_admin","member","educator"]'::jsonb ELSE '["member","educator"]'::jsonb END;
 ELSIF p_kind='classroom' THEN
  IF v_role IS DISTINCT FROM 'platform_admin' OR NOT EXISTS(SELECT 1 FROM public.classrooms WHERE id=p_scope AND status='active') THEN RAISE EXCEPTION 'scope denied' USING ERRCODE='42501'; END IF;
  v_roles:='["co_teacher"]'::jsonb;
 ELSE RAISE EXCEPTION 'invalid scope' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_target) THEN RAISE EXCEPTION 'target unavailable' USING ERRCODE='22023'; END IF;
 v_value:=public.crm_responsibility_value(p_kind,p_scope,p_target);
 IF v_value->>'role'='student' OR (v_role='owner' AND v_value->>'role'='owner') OR (v_role='school_admin' AND coalesce(v_value->>'role','member') NOT IN('member','educator')) OR (p_kind='classroom' AND v_value->>'role'='owner') THEN v_roles:='[]'::jsonb; END IF;
 RETURN v_value||jsonb_build_object('version',encode(public.digest(convert_to(v_value::text,'UTF8'),'sha256'),'hex'),'allowedRoles',v_roles);
END;
$$;
CREATE FUNCTION public.crm_responsibility_update(p_actor uuid,p_kind varchar,p_scope uuid,p_target uuid,p_version varchar,p_role varchar,p_state varchar,p_reason varchar,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_actor uuid; v_tenant uuid; v_school uuid; v_user uuid; v_principal uuid; v_admin varchar;
BEGIN
 -- Same global lock as Account suspension/capability commands, then exact resource lock.
 PERFORM pg_advisory_xact_lock(68174329,247);
 IF p_kind='organization' THEN PERFORM 1 FROM public.workspaces WHERE id=p_scope FOR UPDATE;
 ELSIF p_kind='classroom' THEN PERFORM 1 FROM public.classrooms WHERE id=p_scope FOR UPDATE;
 ELSE RAISE EXCEPTION 'invalid scope' USING ERRCODE='22023'; END IF;
 v_before:=public.crm_responsibility_read(p_actor,p_kind,p_scope,p_target);
 IF p_version IS NULL OR p_version IS DISTINCT FROM v_before->>'version' THEN RAISE EXCEPTION 'stale responsibility' USING ERRCODE='40001'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 OR p_request IS NULL OR length(trim(p_request)) NOT BETWEEN 1 AND 128 OR p_role IS NULL OR NOT (v_before->'allowedRoles' ? p_role) OR p_state IS NULL OR p_state NOT IN('active','suspended','revoked') OR (p_kind='classroom' AND p_state='suspended') THEN RAISE EXCEPTION 'invalid responsibility command' USING ERRCODE='22023'; END IF;
 SELECT account_id INTO v_actor FROM public.principals WHERE id=p_actor;
 v_admin:=public.admin_authorized_role(p_actor,'platform',NULL);
 IF p_kind='organization' THEN
  IF v_admin IS DISTINCT FROM 'platform_admin' AND public.admin_authorized_role(p_actor,'organization',p_scope)='school_admin' AND v_actor=p_target THEN RAISE EXCEPTION 'self change denied' USING ERRCODE='42501'; END IF;
  IF v_before->>'role' IN('owner','school_admin') AND v_before->>'state'='active' AND (p_state<>'active' OR p_role IS DISTINCT FROM v_before->>'role') THEN
   IF v_before->>'role'='owner' AND NOT EXISTS(SELECT 1 FROM public.workspace_memberships m JOIN public.accounts a ON a.id=m.account_id AND a.status='active' WHERE m.workspace_id=p_scope AND m.role='owner' AND m.state='active' AND m.account_id<>p_target) THEN RAISE EXCEPTION 'last owner' USING ERRCODE='22023'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.workspace_memberships m JOIN public.accounts a ON a.id=m.account_id AND a.status='active' WHERE m.workspace_id=p_scope AND m.role IN('owner','school_admin') AND m.state='active' AND m.account_id<>p_target) THEN RAISE EXCEPTION 'last administrator' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_state='active' AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_target AND status='active') THEN RAISE EXCEPTION 'inactive target' USING ERRCODE='22023'; END IF;
  INSERT INTO public.workspace_memberships(account_id,workspace_id,role,state) VALUES(p_target,p_scope,p_role,p_state) ON CONFLICT(account_id,workspace_id) DO UPDATE SET role=excluded.role,state=excluded.state;
 ELSE
  IF p_state='revoked' THEN DELETE FROM public.classroom_memberships WHERE classroom_id=p_scope AND account_id=p_target AND member_role='co_teacher';
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.accounts a JOIN public.capability_grants g ON g.account_id=a.id WHERE a.id=p_target AND a.status='active' AND g.capability='educator' AND g.state IN('provisional','verified')) THEN RAISE EXCEPTION 'educator required' USING ERRCODE='22023'; END IF;
   SELECT tenant_id,school_id INTO v_tenant,v_school FROM public.classrooms WHERE id=p_scope;
   IF NOT EXISTS(SELECT 1 FROM public.classroom_memberships WHERE classroom_id=p_scope AND account_id=p_target) AND (SELECT count(*) FROM public.classroom_memberships WHERE classroom_id=p_scope AND member_role='co_teacher')>=5 THEN RAISE EXCEPTION 'five colleague limit' USING ERRCODE='22023'; END IF;
   SELECT l.user_id INTO v_user FROM public.legacy_user_account_links l JOIN public.users u ON u.id=l.user_id AND u.tenant_id=l.tenant_id AND u.status='active' JOIN public.principals pr ON pr.id=l.principal_id AND pr.account_id=l.account_id AND pr.kind='account' WHERE l.tenant_id=v_tenant AND l.account_id=p_target AND l.migration_state='active';
   IF v_user IS NULL THEN
    IF EXISTS(SELECT 1 FROM public.legacy_user_account_links WHERE tenant_id=v_tenant AND account_id=p_target) THEN RAISE EXCEPTION 'legacy link unavailable' USING ERRCODE='22023'; END IF;
    SELECT id INTO v_principal FROM public.principals WHERE account_id=p_target AND kind='account';
    INSERT INTO public.users(tenant_id,school_id,role,email,display_name,password_hash,status) SELECT v_tenant,v_school,'teacher',a.email,coalesce(nullif(p.display_name,''),p.username),a.password_hash,'active' FROM public.accounts a JOIN public.profiles p ON p.account_id=a.id WHERE a.id=p_target RETURNING id INTO v_user;
    INSERT INTO public.legacy_user_account_links(tenant_id,user_id,account_id,principal_id,migration_state) VALUES(v_tenant,v_user,p_target,v_principal,'active');
   END IF;
   IF EXISTS(SELECT 1 FROM public.classroom_memberships WHERE classroom_id=p_scope AND account_id=p_target AND user_id IS DISTINCT FROM v_user) THEN RAISE EXCEPTION 'canonical account link conflict' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM public.classroom_memberships WHERE classroom_id=p_scope AND user_id=v_user AND (account_id IS DISTINCT FROM p_target OR member_role<>'co_teacher')) THEN RAISE EXCEPTION 'canonical membership conflict' USING ERRCODE='22023'; END IF;
   INSERT INTO public.classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES(v_tenant,p_scope,v_user,p_target,'co_teacher') ON CONFLICT(classroom_id,account_id) WHERE account_id IS NOT NULL DO NOTHING;
  END IF;
 END IF;
 v_after:=public.crm_responsibility_read(p_actor,p_kind,p_scope,p_target);
 INSERT INTO public.administrative_audit_events(actor_principal_id,actor_account_id,actor_role,scope_kind,scope_id,action,target_type,target_id,reason_code,reason_text,request_id,result,metadata_json) VALUES(p_actor,v_actor,coalesce(v_admin,public.admin_authorized_role(p_actor,'organization',p_scope)),CASE WHEN p_kind='organization' THEN 'organization' ELSE 'platform' END,CASE WHEN p_kind='organization' THEN p_scope ELSE NULL END,'crm.responsibility.update','account',p_target::text,'crm',trim(p_reason),p_request,'succeeded',jsonb_build_object('kind',p_kind,'scopeId',p_scope,'before',v_before,'after',v_after));
 RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_responsibility_value(varchar,uuid,uuid),public.crm_responsibility_read(uuid,varchar,uuid,uuid),public.crm_responsibility_update(uuid,varchar,uuid,uuid,varchar,varchar,varchar,varchar,varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.crm_responsibility_read(uuid,varchar,uuid,uuid),public.crm_responsibility_update(uuid,varchar,uuid,uuid,varchar,varchar,varchar,varchar,varchar) TO asalab_app;
-- Serialize canonical invitation writers too; enforce the five-colleague ceiling
-- at the table boundary, even when a legacy invitation was accepted concurrently.
CREATE FUNCTION public.crm_guard_co_teacher() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.member_role<>'co_teacher' THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.classrooms WHERE id=NEW.classroom_id AND tenant_id=NEW.tenant_id FOR UPDATE;
 IF (SELECT count(*) FROM public.classroom_memberships WHERE classroom_id=NEW.classroom_id AND member_role='co_teacher' AND id IS DISTINCT FROM NEW.id AND account_id IS DISTINCT FROM NEW.account_id)>=5 THEN RAISE EXCEPTION 'five colleague limit' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_guard_co_teacher() FROM PUBLIC,asalab_app;
CREATE TRIGGER crm_co_teacher_guard BEFORE INSERT OR UPDATE ON public.classroom_memberships FOR EACH ROW EXECUTE FUNCTION public.crm_guard_co_teacher();
