CREATE OR REPLACE FUNCTION auth_account_password_set(
    p_account_id uuid,
    p_token_hash text,
    p_password_hash text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session_id uuid;
    v_tenant_id uuid;
BEGIN
    IF length(p_password_hash) NOT BETWEEN 32 AND 512 THEN RETURN false; END IF;
    SELECT s.id INTO v_session_id
      FROM public.sessions_v2 s
      JOIN public.principals p ON p.id = s.principal_id
     WHERE p.account_id = p_account_id AND s.token_hash = p_token_hash
       AND s.revoked_at IS NULL AND s.expires_at > now()
     FOR UPDATE OF s;
    IF v_session_id IS NULL THEN RETURN false; END IF;

    UPDATE public.accounts
       SET password_hash = p_password_hash, password_configured = true
     WHERE id = p_account_id AND status = 'active';
    IF NOT FOUND THEN RETURN false; END IF;

    UPDATE public.session_refresh_tokens token
       SET revoked_at = COALESCE(token.revoked_at, now())
      FROM public.session_refresh_families family,
           public.sessions_v2 session,
           public.principals principal
     WHERE token.family_id = family.id
       AND family.session_id = session.id
       AND session.principal_id = principal.id
       AND principal.account_id = p_account_id
       AND session.id <> v_session_id;
    UPDATE public.session_refresh_families family
       SET revoked_at = COALESCE(family.revoked_at, now())
      FROM public.sessions_v2 session,
           public.principals principal
     WHERE family.session_id = session.id
       AND session.principal_id = principal.id
       AND principal.account_id = p_account_id
       AND session.id <> v_session_id;
    UPDATE public.sessions_v2 session
       SET revoked_at = COALESCE(session.revoked_at, now())
      FROM public.principals principal
     WHERE session.principal_id = principal.id
       AND principal.account_id = p_account_id
       AND session.id <> v_session_id;

    UPDATE public.sessions legacy_session
       SET revoked_at = COALESCE(legacy_session.revoked_at, now())
      FROM public.legacy_user_account_links legacy_link
     WHERE legacy_link.account_id = p_account_id
       AND legacy_session.tenant_id = legacy_link.tenant_id
       AND legacy_session.user_id = legacy_link.user_id;

    SELECT w.tenant_id INTO v_tenant_id
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = p_account_id AND w.kind = 'personal'
     LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_tenant_id, NULL, 'account', p_account_id, 'auth.password_changed',
             jsonb_build_object('otherSessionsRevoked', true));
    END IF;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION auth_account_password_set(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_account_password_set(uuid, text, text) TO asalab_app;
