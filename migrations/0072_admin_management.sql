-- Administrative Control Plane: safe account and session management.
--
-- All mutations are platform-only, require a human reason, protect the acting
-- administrator from self-lockout, and append an immutable audit event. The
-- runtime role still has no direct table access.

DROP FUNCTION admin_list_accounts(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
);

CREATE FUNCTION admin_list_accounts(
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
    last_seen_at timestamptz,
    has_ever_signed_in boolean,
    is_platform_admin boolean
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
           session_stats.last_seen_at,
           COALESCE(session_stats.has_ever_signed_in, false),
           (p_scope_kind = 'platform' AND EXISTS (
               SELECT 1
                 FROM public.capability_grants g
                WHERE g.account_id = a.id
                  AND g.capability = 'platform_admin'
                  AND g.state = 'verified'
           ))
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
                 max(s.last_seen_at) AS last_seen_at,
                 (count(*) > 0) AS has_ever_signed_in
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

CREATE OR REPLACE FUNCTION admin_set_account_status(
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
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative account management denied' USING ERRCODE = '42501';
    END IF;
    IF p_status NOT IN ('active', 'suspended')
       OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
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

CREATE OR REPLACE FUNCTION admin_set_platform_admin(
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
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative role management denied' USING ERRCODE = '42501';
    END IF;
    IF length(trim(p_reason)) NOT BETWEEN 3 AND 500
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

CREATE OR REPLACE FUNCTION admin_revoke_session(
    p_actor_principal_id uuid,
    p_session_id uuid,
    p_reason varchar,
    p_request_id varchar
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_actor_account_id uuid;
    v_target_account_id uuid;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative session management denied' USING ERRCODE = '42501';
    END IF;
    IF length(trim(p_reason)) NOT BETWEEN 3 AND 500
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid session management request' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_actor_account_id
      FROM public.principals p
     WHERE p.id = p_actor_principal_id;
    SELECT p.account_id INTO v_target_account_id
      FROM public.sessions_v2 s
      JOIN public.principals p ON p.id = s.principal_id
     WHERE s.id = p_session_id
     FOR UPDATE OF s;
    IF v_target_account_id IS NULL THEN
        RAISE EXCEPTION 'session not found' USING ERRCODE = '22023';
    END IF;
    IF v_actor_account_id = v_target_account_id THEN
        RAISE EXCEPTION 'administrator cannot revoke their own session here' USING ERRCODE = '22023';
    END IF;

    UPDATE public.sessions_v2
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = p_session_id;
    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.session.revoke',
        'session', p_session_id::text,
        'admin_console', trim(p_reason), NULL,
        p_request_id, p_request_id, 'succeeded', NULL, NULL
    );
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_accounts(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_account_status(uuid, uuid, varchar, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_platform_admin(uuid, uuid, boolean, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_revoke_session(uuid, uuid, varchar, varchar) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_list_accounts(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_set_account_status(uuid, uuid, varchar, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_set_platform_admin(uuid, uuid, boolean, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_revoke_session(uuid, uuid, varchar, varchar) TO asalab_app;
