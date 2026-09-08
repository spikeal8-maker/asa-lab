-- Separate content authors from educator onboarding in the existing Auth core.
ALTER TABLE capability_grants DROP CONSTRAINT capability_grants_capability_check;
ALTER TABLE capability_grants ADD CONSTRAINT capability_grants_capability_check CHECK (
  capability IN ('creator','educator','registered_student','guardian','platform_admin','content_author')
);
CREATE FUNCTION auth_self_attest_content_author(p_account_id uuid)
RETURNS TABLE (eligible boolean, grant_state varchar, created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_state varchar; v_tenant uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text, 105));
  SELECT w.tenant_id INTO v_tenant FROM public.accounts a
    JOIN public.workspace_memberships m ON m.account_id=a.id AND m.role='owner'
    JOIN public.workspaces w ON w.id=m.workspace_id AND w.kind='personal'
    WHERE a.id=p_account_id AND a.status='active';
  IF v_tenant IS NULL THEN RETURN QUERY SELECT false, NULL::varchar, false; RETURN; END IF;
  SELECT g.state INTO v_state FROM public.capability_grants g
    WHERE g.account_id=p_account_id AND g.capability='content_author' FOR UPDATE;
  IF v_state IS NOT NULL THEN
    RETURN QUERY SELECT true, v_state, false; RETURN;
  END IF;
  INSERT INTO public.capability_grants (account_id,capability,state,policy_version,granted_by)
    VALUES (p_account_id,'content_author','provisional','asa-access-a-v1.2','self_attestation');
  INSERT INTO public.audit_events (tenant_id,entity_type,entity_id,action,payload_json)
    VALUES (v_tenant,'account',p_account_id,'account.content_author_enabled',
      jsonb_build_object('scope','personal','state','provisional'));
  RETURN QUERY SELECT true, 'provisional'::varchar, true;
END;
$$;
REVOKE ALL ON FUNCTION auth_self_attest_content_author(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_self_attest_content_author(uuid) TO asalab_app;

-- Revoke/active-account and owner-workspace checks in the existing SQL guard.
-- Publishing creates a private immutable version, not public visibility or
-- a right to deliver teaching, browse rosters or grade learners.
CREATE OR REPLACE FUNCTION learning_author_can_use_tenant(p_principal_id uuid,p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.principals p
      JOIN public.accounts a ON a.id=p.account_id AND a.status='active'
      JOIN public.capability_grants g ON g.account_id=a.id AND g.state IN ('verified','provisional')
      JOIN public.workspace_memberships m ON m.account_id=a.id
      JOIN public.workspaces w ON w.id=m.workspace_id
    WHERE p.id=p_principal_id AND w.tenant_id=p_tenant_id
      AND ((w.kind='personal' AND m.role='owner' AND g.capability IN ('educator','content_author'))
        OR (w.kind='organization' AND m.role IN ('owner','school_admin','educator') AND g.capability='educator'))
  );
$$;
REVOKE ALL ON FUNCTION learning_author_can_use_tenant(uuid,uuid) FROM PUBLIC;
