-- Account C1.4-C1.5: additive educator capability, workspace context,
-- profile and SessionV2 management. Migration 0010 and legacy data remain
-- untouched.

ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS status varchar(32) NOT NULL DEFAULT 'active';
ALTER TABLE workspaces
    ADD CONSTRAINT workspaces_status_check
    CHECK (status IN ('active', 'suspended', 'archived'));

ALTER TABLE workspace_memberships
    ADD COLUMN IF NOT EXISTS state varchar(32) NOT NULL DEFAULT 'active';
ALTER TABLE workspace_memberships
    ADD CONSTRAINT workspace_memberships_state_check
    CHECK (state IN ('active', 'invited', 'suspended', 'revoked'));

ALTER TABLE sessions_v2
    ADD COLUMN IF NOT EXISTS client_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sessions_v2
    ADD CONSTRAINT sessions_v2_client_metadata_object_check
    CHECK (jsonb_typeof(client_metadata) = 'object');

CREATE OR REPLACE FUNCTION auth_account_workspaces(p_account_id uuid)
RETURNS TABLE (workspace_id uuid, tenant_id uuid, kind varchar, title varchar, role varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT w.id, w.tenant_id, w.kind, w.title, m.role
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = p_account_id
       AND m.state = 'active'
       AND w.status = 'active'
     ORDER BY (w.kind = 'personal') DESC, w.title;
$$;

CREATE OR REPLACE FUNCTION auth_account_profile(p_account_id uuid)
RETURNS TABLE (
    email varchar,
    email_verification_state varchar,
    username varchar,
    display_name varchar,
    birth_date date,
    country varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.email, a.email_verification_state, p.username, p.display_name,
           a.birth_date, a.country
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
     WHERE a.id = p_account_id
       AND a.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_update_account_profile(
    p_account_id uuid,
    p_username varchar,
    p_display_name varchar
)
RETURNS TABLE (
    email varchar,
    email_verification_state varchar,
    username varchar,
    display_name varchar,
    birth_date date,
    country varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public.profiles
       SET username = lower(trim(p_username)),
           display_name = trim(p_display_name),
           updated_at = now()
     WHERE account_id = p_account_id
       AND EXISTS (
           SELECT 1
             FROM public.accounts a
            WHERE a.id = p_account_id AND a.status = 'active');
    RETURN QUERY
    SELECT * FROM public.auth_account_profile(p_account_id);
END;
$$;

CREATE OR REPLACE FUNCTION auth_self_attest_educator(p_account_id uuid)
RETURNS TABLE (eligible boolean, grant_state varchar, created boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_birth_date date;
    v_state varchar(32);
    v_inserted integer := 0;
    v_tenant_id uuid;
BEGIN
    SELECT a.birth_date
      INTO v_birth_date
      FROM public.accounts a
     WHERE a.id = p_account_id
       AND a.status = 'active'
     FOR UPDATE;

    IF v_birth_date IS NULL
       OR v_birth_date > (current_date - make_interval(years => 18))::date
    THEN
        RETURN QUERY SELECT false, NULL::varchar, false;
        RETURN;
    END IF;

    INSERT INTO public.capability_grants
        (account_id, capability, state, policy_version, granted_by)
    VALUES
        (p_account_id, 'educator', 'provisional',
         'educator-self-attest-v1', 'self_attestation')
    ON CONFLICT (account_id, capability) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    SELECT g.state
      INTO v_state
      FROM public.capability_grants g
     WHERE g.account_id = p_account_id
       AND g.capability = 'educator';

    IF v_inserted = 1 THEN
        SELECT w.tenant_id
          INTO v_tenant_id
          FROM public.workspace_memberships m
          JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE m.account_id = p_account_id
           AND m.state = 'active'
           AND w.kind = 'personal'
           AND w.status = 'active'
         LIMIT 1;

        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_tenant_id, NULL, 'account', p_account_id,
             'capability.educator_attested',
             jsonb_build_object(
                 'capability', 'educator',
                 'state', 'provisional',
                 'policyVersion', 'educator-self-attest-v1'));
    END IF;

    RETURN QUERY SELECT true, v_state, v_inserted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION session_v2_create(
    p_principal_id uuid,
    p_workspace_id uuid,
    p_token_hash text,
    p_ttl_hours integer,
    p_user_agent_summary varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.workspace_memberships m
          JOIN public.principals pr ON pr.account_id = m.account_id
          JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE pr.id = p_principal_id
           AND m.workspace_id = p_workspace_id
           AND m.state = 'active'
           AND w.status = 'active')
    THEN
        RAISE EXCEPTION 'principal is not an active member of workspace';
    END IF;
    INSERT INTO public.sessions_v2
        (principal_id, active_workspace_id, token_hash, expires_at, client_metadata)
    VALUES
        (p_principal_id, p_workspace_id, p_token_hash,
         now() + make_interval(hours => p_ttl_hours),
         CASE
             WHEN NULLIF(trim(p_user_agent_summary), '') IS NULL THEN '{}'::jsonb
             ELSE jsonb_build_object('userAgentSummary', trim(p_user_agent_summary))
         END)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION session_v2_context(p_token_hash text)
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
    RETURNING s.principal_id, s.active_workspace_id
         INTO v_principal, v_workspace;
    IF v_principal IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT pr.id, pr.account_id, w.id, w.tenant_id, w.kind,
           l.user_id, a.email, p.display_name, u.school_id
      FROM public.principals pr
      JOIN public.accounts a
        ON a.id = pr.account_id AND a.status = 'active'
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.workspaces w
        ON w.id = v_workspace AND w.status = 'active'
      JOIN public.workspace_memberships m
        ON m.account_id = a.id
       AND m.workspace_id = w.id
       AND m.state = 'active'
      LEFT JOIN public.legacy_user_account_links l
        ON l.account_id = a.id
       AND l.tenant_id = w.tenant_id
       AND l.migration_state = 'active'
      LEFT JOIN public.users u
        ON u.tenant_id = w.tenant_id AND u.id = l.user_id
     WHERE pr.id = v_principal;
END;
$$;

CREATE OR REPLACE FUNCTION session_v2_switch_context(
    p_token_hash text,
    p_workspace_id uuid
)
RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session_id uuid;
    v_principal_id uuid;
    v_account_id uuid;
    v_previous_workspace_id uuid;
    v_tenant_id uuid;
BEGIN
    SELECT s.id, s.principal_id, pr.account_id, s.active_workspace_id
      INTO v_session_id, v_principal_id, v_account_id, v_previous_workspace_id
      FROM public.sessions_v2 s
      JOIN public.principals pr ON pr.id = s.principal_id
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
     FOR UPDATE OF s;
    IF v_session_id IS NULL THEN
        RETURN 'unauthorized';
    END IF;

    SELECT w.tenant_id
      INTO v_tenant_id
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = v_account_id
       AND m.workspace_id = p_workspace_id
       AND m.state = 'active'
       AND w.status = 'active';
    IF v_tenant_id IS NULL THEN
        RETURN 'forbidden';
    END IF;

    UPDATE public.sessions_v2
       SET active_workspace_id = p_workspace_id,
           last_seen_at = now()
     WHERE id = v_session_id;

    IF v_previous_workspace_id IS DISTINCT FROM p_workspace_id THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_tenant_id, NULL, 'account', v_account_id, 'workspace.switched',
             jsonb_build_object(
                 'fromWorkspaceId', v_previous_workspace_id,
                 'toWorkspaceId', p_workspace_id,
                 'sessionId', v_session_id));
    END IF;
    RETURN 'switched';
END;
$$;

CREATE OR REPLACE FUNCTION session_v2_list(p_token_hash text)
RETURNS TABLE (
    id uuid,
    created_at timestamptz,
    last_seen_at timestamptz,
    expires_at timestamptz,
    current boolean,
    user_agent_summary varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH current_session AS (
        SELECT id, principal_id
          FROM public.sessions_v2
         WHERE token_hash = p_token_hash
           AND revoked_at IS NULL
           AND expires_at > now()
         LIMIT 1
    )
    SELECT s.id, s.created_at, s.last_seen_at, s.expires_at,
           s.id = c.id,
           NULLIF(s.client_metadata ->> 'userAgentSummary', '')::varchar
      FROM current_session c
      JOIN public.sessions_v2 s ON s.principal_id = c.principal_id
     WHERE s.revoked_at IS NULL
       AND s.expires_at > now()
     ORDER BY (s.id = c.id) DESC, s.last_seen_at DESC;
$$;

CREATE OR REPLACE FUNCTION session_v2_revoke_by_id(
    p_token_hash text,
    p_session_id uuid
)
RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_current_id uuid;
    v_principal_id uuid;
    v_account_id uuid;
    v_tenant_id uuid;
    v_updated integer := 0;
BEGIN
    SELECT s.id, s.principal_id, pr.account_id, w.tenant_id
      INTO v_current_id, v_principal_id, v_account_id, v_tenant_id
      FROM public.sessions_v2 s
      JOIN public.principals pr ON pr.id = s.principal_id
      JOIN public.workspaces w ON w.id = s.active_workspace_id
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now();
    IF v_current_id IS NULL THEN
        RETURN 'unauthorized';
    END IF;
    IF v_current_id = p_session_id THEN
        RETURN 'current_session';
    END IF;

    UPDATE public.sessions_v2
       SET revoked_at = now()
     WHERE id = p_session_id
       AND principal_id = v_principal_id
       AND revoked_at IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RETURN 'not_found';
    END IF;

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_tenant_id, NULL, 'account', v_account_id, 'session.revoked',
         jsonb_build_object('sessionId', p_session_id));
    RETURN 'revoked';
END;
$$;

CREATE OR REPLACE FUNCTION session_v2_revoke_others(p_token_hash text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_current_id uuid;
    v_principal_id uuid;
    v_account_id uuid;
    v_tenant_id uuid;
    v_updated integer := 0;
BEGIN
    SELECT s.id, s.principal_id, pr.account_id, w.tenant_id
      INTO v_current_id, v_principal_id, v_account_id, v_tenant_id
      FROM public.sessions_v2 s
      JOIN public.principals pr ON pr.id = s.principal_id
      JOIN public.workspaces w ON w.id = s.active_workspace_id
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now();
    IF v_current_id IS NULL THEN
        RETURN -1;
    END IF;

    UPDATE public.sessions_v2
       SET revoked_at = now()
     WHERE principal_id = v_principal_id
       AND id <> v_current_id
       AND revoked_at IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_tenant_id, NULL, 'account', v_account_id, 'session.revoked_others',
         jsonb_build_object('revokedCount', v_updated, 'currentSessionId', v_current_id));
    RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION auth_account_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_update_account_profile(uuid, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_self_attest_educator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_create(uuid, uuid, text, integer, varchar) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION session_v2_create(uuid, uuid, text, integer) FROM asalab_app;
REVOKE ALL ON FUNCTION session_v2_switch_context(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_list(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_revoke_by_id(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_revoke_others(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_account_profile(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_update_account_profile(uuid, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_self_attest_educator(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_create(uuid, uuid, text, integer, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_switch_context(text, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_list(text) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_revoke_by_id(text, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_revoke_others(text) TO asalab_app;
