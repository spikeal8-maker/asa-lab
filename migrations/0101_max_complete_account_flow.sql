-- Complete the MAX account flow without weakening the existing trust boundary.
-- MAX WebAppData is still validated by the API; the database only receives a
-- normalized provider identity and hashes of browser/session capabilities.

ALTER TABLE accounts
    ADD COLUMN password_configured boolean NOT NULL DEFAULT true;

CREATE TABLE max_browser_pairings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash          text NOT NULL UNIQUE CHECK (length(token_hash) BETWEEN 32 AND 255),
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    approved_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
    approved_at         timestamptz,
    consumed_at         timestamptz,
    CHECK (expires_at > created_at),
    CHECK ((approved_account_id IS NULL) = (approved_at IS NULL))
);
CREATE INDEX max_browser_pairings_expiry_idx
    ON max_browser_pairings (expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE max_webhook_events (
    event_hash  text PRIMARY KEY CHECK (length(event_hash) BETWEEN 32 AND 255),
    received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE max_runtime_settings
    ADD COLUMN webhook_url varchar(2048),
    ADD COLUMN webhook_verified_at timestamptz,
    ADD COLUMN webhook_last_error varchar(500);

REVOKE ALL ON max_browser_pairings, max_webhook_events FROM asalab_app;
ALTER TABLE max_browser_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE max_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION auth_max_register_account(
    p_subject varchar,
    p_query_id varchar,
    p_auth_date bigint,
    p_max_username varchar,
    p_max_display_name varchar,
    p_email varchar,
    p_password_hash text,
    p_display_name varchar,
    p_username varchar,
    p_birth_date date,
    p_country varchar,
    p_policy_version varchar,
    p_token_hash text,
    p_ttl_hours integer
) RETURNS TABLE (
    result varchar,
    account_id uuid,
    principal_id uuid,
    workspace_id uuid,
    tenant_id uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account uuid;
    v_principal uuid;
    v_workspace uuid;
    v_tenant uuid;
BEGIN
    IF p_subject !~ '^[0-9]{1,64}$'
       OR length(p_query_id) NOT BETWEEN 1 AND 255
       OR p_auth_date <= 0
       OR length(p_token_hash) NOT BETWEEN 32 AND 255
       OR p_ttl_hours NOT BETWEEN 1 AND 24 THEN
        RETURN QUERY SELECT 'unavailable'::varchar, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('max-subject:' || p_subject, 0));
    IF EXISTS (
        SELECT 1 FROM public.account_external_identities i
         WHERE i.provider = 'max' AND i.subject = p_subject
    ) THEN
        RETURN QUERY SELECT 'identity_taken'::varchar, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.external_auth_assertions a
         WHERE a.provider = 'max' AND a.assertion_id = p_query_id
    ) THEN
        RETURN QUERY SELECT 'assertion_replayed'::varchar, NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    SELECT registered.account_id, registered.principal_id,
           registered.workspace_id, registered.tenant_id
      INTO v_account, v_principal, v_workspace, v_tenant
      FROM public.auth_register_account(
          p_email, p_password_hash, p_display_name, p_username, p_birth_date,
          p_country, p_policy_version, p_token_hash, p_ttl_hours
      ) registered;

    UPDATE public.accounts SET password_configured = false WHERE id = v_account;
    UPDATE public.sessions_v2
       SET client_metadata = jsonb_build_object('authenticationProvider', 'max')
     WHERE token_hash = p_token_hash;
    INSERT INTO public.account_external_identities
        (provider, subject, account_id, username, display_name, last_used_at)
    VALUES
        ('max', p_subject, v_account, NULLIF(trim(p_max_username), ''),
         NULLIF(trim(p_max_display_name), ''), now());
    INSERT INTO public.external_auth_assertions
        (provider, assertion_id, account_id, issued_at)
    VALUES
        ('max', p_query_id, v_account, to_timestamp(p_auth_date::double precision));
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_tenant, NULL, 'account', v_account, 'auth.max_registered',
         jsonb_build_object('provider', 'max'));

    RETURN QUERY SELECT 'authenticated'::varchar, v_account, v_principal, v_workspace, v_tenant;
EXCEPTION
    WHEN unique_violation THEN
        RAISE;
END;
$$;

CREATE FUNCTION auth_max_pairing_start(p_token_hash text, p_ttl_minutes integer)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF length(p_token_hash) NOT BETWEEN 32 AND 255 OR p_ttl_minutes NOT BETWEEN 1 AND 15 THEN
        RETURN false;
    END IF;
    DELETE FROM public.max_browser_pairings
     WHERE expires_at < now() - interval '1 hour' OR consumed_at < now() - interval '1 hour';
    INSERT INTO public.max_browser_pairings (token_hash, expires_at)
    VALUES (p_token_hash, now() + make_interval(mins => p_ttl_minutes));
    RETURN true;
END;
$$;

CREATE FUNCTION auth_max_pairing_approve(p_token_hash text, p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer;
BEGIN
    UPDATE public.max_browser_pairings pairing
       SET approved_account_id = p_account_id,
           approved_at = now()
     WHERE pairing.token_hash = p_token_hash
       AND pairing.expires_at > now()
       AND pairing.consumed_at IS NULL
       AND pairing.approved_account_id IS NULL
       AND EXISTS (
           SELECT 1 FROM public.accounts a
            WHERE a.id = p_account_id AND a.status = 'active'
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

CREATE FUNCTION auth_max_pairing_consume(
    p_token_hash text,
    p_session_hash text,
    p_ttl_hours integer,
    p_user_agent_summary varchar
) RETURNS TABLE (result varchar, account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_pairing public.max_browser_pairings%ROWTYPE;
    v_principal uuid;
    v_workspace uuid;
BEGIN
    IF length(p_token_hash) NOT BETWEEN 32 AND 255
       OR length(p_session_hash) NOT BETWEEN 32 AND 255
       OR p_ttl_hours NOT BETWEEN 1 AND 24 THEN
        RETURN QUERY SELECT 'invalid'::varchar, NULL::uuid;
        RETURN;
    END IF;
    SELECT * INTO v_pairing
      FROM public.max_browser_pairings
     WHERE token_hash = p_token_hash
     FOR UPDATE;
    IF v_pairing.id IS NULL THEN
        RETURN QUERY SELECT 'invalid'::varchar, NULL::uuid;
        RETURN;
    END IF;
    IF v_pairing.expires_at <= now() THEN
        RETURN QUERY SELECT 'expired'::varchar, NULL::uuid;
        RETURN;
    END IF;
    IF v_pairing.consumed_at IS NOT NULL THEN
        RETURN QUERY SELECT 'consumed'::varchar, NULL::uuid;
        RETURN;
    END IF;
    IF v_pairing.approved_account_id IS NULL THEN
        RETURN QUERY SELECT 'pending'::varchar, NULL::uuid;
        RETURN;
    END IF;
    SELECT pr.id, w.id INTO v_principal, v_workspace
      FROM public.principals pr
      JOIN public.workspace_memberships m ON m.account_id = pr.account_id
      JOIN public.workspaces w ON w.id = m.workspace_id
      JOIN public.accounts a ON a.id = pr.account_id
     WHERE pr.account_id = v_pairing.approved_account_id
       AND pr.kind = 'account' AND m.state = 'active'
       AND w.kind = 'personal' AND w.status = 'active' AND a.status = 'active'
     LIMIT 1;
    IF v_principal IS NULL THEN
        RETURN QUERY SELECT 'invalid'::varchar, NULL::uuid;
        RETURN;
    END IF;
    UPDATE public.max_browser_pairings SET consumed_at = now() WHERE id = v_pairing.id;
    INSERT INTO public.sessions_v2
        (principal_id, active_workspace_id, token_hash, expires_at, client_metadata)
    VALUES
        (v_principal, v_workspace, p_session_hash,
         now() + make_interval(hours => p_ttl_hours),
         jsonb_strip_nulls(jsonb_build_object(
             'authenticationProvider', 'max',
             'userAgentSummary', NULLIF(trim(p_user_agent_summary), '')
         )));
    RETURN QUERY SELECT 'authenticated'::varchar, v_pairing.approved_account_id;
END;
$$;

CREATE FUNCTION auth_account_password_context(p_account_id uuid, p_token_hash text)
RETURNS TABLE (password_hash text, password_configured boolean, authentication_source varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.password_hash, a.password_configured,
           COALESCE(f.source, NULLIF(s.client_metadata ->> 'authenticationProvider', ''), 'password')
      FROM public.sessions_v2 s
      JOIN public.principals p ON p.id = s.principal_id
      JOIN public.accounts a ON a.id = p.account_id
      LEFT JOIN public.session_refresh_families f ON f.session_id = s.id
     WHERE a.id = p_account_id
       AND s.token_hash = p_token_hash
       AND s.revoked_at IS NULL AND s.expires_at > now()
       AND a.status = 'active'
     LIMIT 1;
$$;

CREATE FUNCTION auth_account_password_set(
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

CREATE FUNCTION auth_max_webhook_event_claim(p_event_hash text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_inserted integer;
BEGIN
    IF length(p_event_hash) NOT BETWEEN 32 AND 255 THEN RETURN false; END IF;
    DELETE FROM public.max_webhook_events WHERE received_at < now() - interval '24 hours';
    INSERT INTO public.max_webhook_events(event_hash) VALUES (p_event_hash)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted = 1;
END;
$$;

CREATE FUNCTION auth_max_webhook_status_set(
    p_url varchar,
    p_verified boolean,
    p_error varchar
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public.max_runtime_settings
       SET webhook_url = NULLIF(trim(p_url), ''),
           webhook_verified_at = CASE WHEN p_verified THEN now() ELSE webhook_verified_at END,
           webhook_last_error = CASE WHEN p_verified THEN NULL ELSE left(NULLIF(trim(p_error), ''), 500) END
     WHERE singleton_key = true;
END;
$$;

CREATE FUNCTION auth_max_webhook_status()
RETURNS TABLE (webhook_url varchar, webhook_verified_at timestamptz, webhook_last_error varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT settings.webhook_url, settings.webhook_verified_at, settings.webhook_last_error
      FROM public.max_runtime_settings settings
     WHERE settings.singleton_key = true;
$$;

REVOKE ALL ON FUNCTION auth_max_register_account(
    varchar, varchar, bigint, varchar, varchar, varchar, text, varchar,
    varchar, date, varchar, varchar, text, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_pairing_start(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_pairing_approve(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_pairing_consume(text, text, integer, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_password_context(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_password_set(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_webhook_event_claim(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_webhook_status_set(varchar, boolean, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_webhook_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_max_register_account(
    varchar, varchar, bigint, varchar, varchar, varchar, text, varchar,
    varchar, date, varchar, varchar, text, integer
) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_pairing_start(text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_pairing_approve(text, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_pairing_consume(text, text, integer, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_password_context(uuid, text) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_password_set(uuid, text, text) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_webhook_event_claim(text) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_webhook_status_set(varchar, boolean, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_webhook_status() TO asalab_app;
