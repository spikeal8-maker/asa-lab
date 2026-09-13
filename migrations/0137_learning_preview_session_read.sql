-- Preview must not even update an author's session last_seen_at.
-- Additive read mode for the existing session resolver. Keep the old function
-- and its touch behavior for old clients and every ordinary account request.
-- Same active session/account/workspace/membership predicates as 0011.
CREATE OR REPLACE FUNCTION public.session_v2_context_read_only(p_token_hash text)
RETURNS TABLE (
    principal_id uuid,
    account_id uuid,
    workspace_id uuid,
    tenant_id uuid,
    workspace_kind varchar,
    user_id uuid,
    email varchar,
    display_name varchar,
    school_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT pr.id, pr.account_id, w.id, w.tenant_id, w.kind,
           l.user_id, a.email, p.display_name, u.school_id
      FROM public.sessions_v2 s
      JOIN public.principals pr ON pr.id = s.principal_id
      JOIN public.accounts a ON a.id = pr.account_id AND a.status = 'active'
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.workspaces w ON w.id = s.active_workspace_id AND w.status = 'active'
      JOIN public.workspace_memberships m
        ON m.account_id = a.id AND m.workspace_id = w.id AND m.state = 'active'
      LEFT JOIN public.legacy_user_account_links l
        ON l.account_id = a.id AND l.tenant_id = w.tenant_id AND l.migration_state = 'active'
      LEFT JOIN public.users u ON u.tenant_id = w.tenant_id AND u.id = l.user_id
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.session_v2_context_read_only(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.session_v2_context_read_only(text) TO asalab_app;
