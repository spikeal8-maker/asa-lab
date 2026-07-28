-- ACCOUNT-VERTICAL-001 — a live session must reflect a withdrawn permission.
--
-- A token that was valid yesterday is not a permission of its own: it stands
-- for an account that is still active and a principal that is still a member
-- of the workspace it is acting in. Checking only the token, its expiry and its
-- revocation would let a suspended account, or an account whose membership was
-- taken away, keep working until the token happened to expire.
--
-- The resolver therefore fails closed: no active account, or no membership in
-- the session's active workspace, means no context — and the API answers 401
-- exactly as it does for an unknown token.

CREATE OR REPLACE FUNCTION session_v2_context(p_token_hash text)
RETURNS TABLE (
    principal_id   uuid,
    account_id     uuid,
    workspace_id   uuid,
    tenant_id      uuid,
    workspace_kind varchar,
    user_id        uuid,
    email          varchar,
    display_name   varchar,
    school_id      uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_principal uuid;
    v_workspace uuid;
BEGIN
    UPDATE public.sessions_v2 s
       SET last_seen_at = now()
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
    RETURNING s.principal_id, s.active_workspace_id INTO v_principal, v_workspace;

    IF v_principal IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT pr.id,
           pr.account_id,
           w.id,
           w.tenant_id,
           w.kind,
           l.user_id,
           a.email,
           p.display_name,
           u.school_id
      FROM public.principals pr
      JOIN public.accounts a ON a.id = pr.account_id
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.workspaces w ON w.id = v_workspace
      -- The membership is what makes this workspace this account's to act in;
      -- without it the session describes an authority that no longer exists.
      JOIN public.workspace_memberships m
             ON m.account_id = a.id AND m.workspace_id = w.id
      LEFT JOIN public.legacy_user_account_links l
             ON l.account_id = a.id AND l.tenant_id = w.tenant_id AND l.migration_state = 'active'
      LEFT JOIN public.users u ON u.tenant_id = w.tenant_id AND u.id = l.user_id
     WHERE pr.id = v_principal
       AND a.status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION session_v2_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_v2_context(text) TO asalab_app;
