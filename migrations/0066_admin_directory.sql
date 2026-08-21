-- Administrative Control Plane: read-only directory and session visibility.
--
-- These SECURITY DEFINER functions are the only runtime path to the underlying
-- identity tables. They repeat the scope and role checks in PostgreSQL, return
-- a deliberately small non-secret projection, and never accept a tenant id.

CREATE OR REPLACE FUNCTION admin_list_accounts(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_search varchar,
    p_limit integer,
    p_before timestamptz,
    p_before_id uuid
) RETURNS TABLE (
    account_id uuid,
    principal_id uuid,
    email varchar,
    display_name varchar,
    username varchar,
    account_status varchar,
    email_verification_state varchar,
    created_at timestamptz,
    organization_role varchar,
    membership_state varchar,
    active_session_count bigint,
    last_seen_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_role varchar;
    v_search varchar;
BEGIN
    v_role := public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id);
    IF v_role IS NULL
       OR (p_scope_kind = 'platform' AND v_role <> 'platform_admin')
       OR (p_scope_kind = 'organization' AND v_role NOT IN ('owner', 'school_admin')) THEN
        RAISE EXCEPTION 'administrative accounts scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'account page limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;
    IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION 'account cursor requires both time and id' USING ERRCODE = '22023';
    END IF;
    v_search := lower(NULLIF(trim(p_search), ''));
    IF v_search IS NOT NULL AND length(v_search) > 100 THEN
        RAISE EXCEPTION 'account search is too long' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT a.id,
           pr.id,
           a.email,
           p.display_name,
           p.username,
           a.status,
           a.email_verification_state,
           a.created_at,
           scoped_membership.role,
           scoped_membership.state,
           COALESCE(session_stats.active_count, 0),
           session_stats.last_seen_at
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.principals pr ON pr.account_id = a.id
      LEFT JOIN LATERAL (
          SELECT m.role, m.state
            FROM public.workspace_memberships m
           WHERE p_scope_kind = 'organization'
             AND m.workspace_id = p_scope_id
             AND m.account_id = a.id
           LIMIT 1
      ) scoped_membership ON true
      LEFT JOIN LATERAL (
          SELECT count(*) FILTER (
                     WHERE s.revoked_at IS NULL AND s.expires_at > now()
                 )::bigint AS active_count,
                 max(s.last_seen_at) AS last_seen_at
            FROM public.sessions_v2 s
           WHERE s.principal_id = pr.id
             AND (p_scope_kind = 'platform' OR s.active_workspace_id = p_scope_id)
      ) session_stats ON true
     WHERE (p_scope_kind = 'platform' OR scoped_membership.role IS NOT NULL)
       AND (
           v_search IS NULL
           OR position(v_search IN lower(a.email)) > 0
           OR position(v_search IN lower(p.display_name)) > 0
           OR position(v_search IN lower(p.username)) > 0
       )
       AND (
           p_before IS NULL
           OR (a.created_at, a.id) < (p_before, p_before_id)
       )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION admin_list_organizations(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_search varchar,
    p_limit integer,
    p_before timestamptz,
    p_before_id uuid
) RETURNS TABLE (
    workspace_id uuid,
    title varchar,
    workspace_status varchar,
    created_at timestamptz,
    member_count bigint,
    administrator_count bigint,
    active_session_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_role varchar;
    v_search varchar;
BEGIN
    v_role := public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id);
    IF v_role IS NULL
       OR (p_scope_kind = 'platform' AND v_role <> 'platform_admin')
       OR (p_scope_kind = 'organization' AND v_role NOT IN ('owner', 'school_admin')) THEN
        RAISE EXCEPTION 'administrative organizations scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'organization page limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;
    IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION 'organization cursor requires both time and id' USING ERRCODE = '22023';
    END IF;
    v_search := lower(NULLIF(trim(p_search), ''));
    IF v_search IS NOT NULL AND length(v_search) > 100 THEN
        RAISE EXCEPTION 'organization search is too long' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT w.id,
           w.title,
           w.status,
           w.created_at,
           COALESCE(member_stats.member_count, 0),
           COALESCE(member_stats.administrator_count, 0),
           COALESCE(session_stats.active_session_count, 0)
      FROM public.workspaces w
      LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE m.state = 'active')::bigint AS member_count,
                 count(*) FILTER (
                     WHERE m.state = 'active' AND m.role IN ('owner', 'school_admin')
                 )::bigint AS administrator_count
            FROM public.workspace_memberships m
           WHERE m.workspace_id = w.id
      ) member_stats ON true
      LEFT JOIN LATERAL (
          SELECT count(*)::bigint AS active_session_count
            FROM public.sessions_v2 s
           WHERE s.active_workspace_id = w.id
             AND s.revoked_at IS NULL
             AND s.expires_at > now()
      ) session_stats ON true
     WHERE w.kind = 'organization'
       AND (p_scope_kind = 'platform' OR w.id = p_scope_id)
       AND (v_search IS NULL OR position(v_search IN lower(w.title)) > 0)
       AND (
           p_before IS NULL
           OR (w.created_at, w.id) < (p_before, p_before_id)
       )
     ORDER BY w.created_at DESC, w.id DESC
     LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION admin_list_security_sessions(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_search varchar,
    p_limit integer,
    p_before timestamptz,
    p_before_id uuid
) RETURNS TABLE (
    session_id uuid,
    account_id uuid,
    email varchar,
    display_name varchar,
    username varchar,
    workspace_id uuid,
    workspace_title varchar,
    created_at timestamptz,
    last_seen_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    session_status varchar,
    user_agent_summary varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_role varchar;
    v_search varchar;
BEGIN
    v_role := public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id);
    IF v_role IS NULL
       OR (p_scope_kind = 'platform' AND v_role <> 'platform_admin')
       OR (p_scope_kind = 'organization' AND v_role NOT IN ('owner', 'school_admin')) THEN
        RAISE EXCEPTION 'administrative security scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'security page limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;
    IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION 'security cursor requires both time and id' USING ERRCODE = '22023';
    END IF;
    v_search := lower(NULLIF(trim(p_search), ''));
    IF v_search IS NOT NULL AND length(v_search) > 100 THEN
        RAISE EXCEPTION 'security search is too long' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT s.id,
           a.id,
           a.email,
           p.display_name,
           p.username,
           w.id,
           w.title,
           s.created_at,
           s.last_seen_at,
           s.expires_at,
           s.revoked_at,
           CASE
               WHEN s.revoked_at IS NOT NULL THEN 'revoked'
               WHEN s.expires_at <= now() THEN 'expired'
               ELSE 'active'
           END::varchar,
           NULLIF(s.client_metadata ->> 'userAgentSummary', '')::varchar
      FROM public.sessions_v2 s
      JOIN public.principals pr ON pr.id = s.principal_id
      JOIN public.accounts a ON a.id = pr.account_id
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.workspaces w ON w.id = s.active_workspace_id
     WHERE (p_scope_kind = 'platform' OR s.active_workspace_id = p_scope_id)
       AND (
           v_search IS NULL
           OR position(v_search IN lower(a.email)) > 0
           OR position(v_search IN lower(p.display_name)) > 0
           OR position(v_search IN lower(p.username)) > 0
           OR position(v_search IN lower(COALESCE(s.client_metadata ->> 'userAgentSummary', ''))) > 0
       )
       AND (
           p_before IS NULL
           OR (s.last_seen_at, s.id) < (p_before, p_before_id)
       )
     ORDER BY s.last_seen_at DESC, s.id DESC
     LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_accounts(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_organizations(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_security_sessions(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_list_accounts(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_list_organizations(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_list_security_sessions(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) TO asalab_app;
