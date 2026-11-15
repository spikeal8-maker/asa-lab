-- Account context reads must not wait for the optional management heartbeat.
-- Account expiry and all current authority joins remain independent of it.
CREATE OR REPLACE FUNCTION session_v2_context(p_token_hash text)
RETURNS TABLE (
    principal_id uuid, account_id uuid, workspace_id uuid, tenant_id uuid,
    workspace_kind varchar, user_id uuid, email varchar, display_name varchar,
    school_id uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RETURN QUERY
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
     WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now();

    -- SELECT authority above never takes a row lock. A busy heartbeat is skipped,
    -- not queued, and current revoked/expired rows can never be revived here.
    WITH due AS (
        SELECT s.id FROM public.sessions_v2 s
         WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL
           AND s.expires_at > now() AND s.last_seen_at <= now() - interval '60 seconds'
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.sessions_v2 s SET last_seen_at = now()
      FROM due WHERE s.id = due.id;
END;
$$;
