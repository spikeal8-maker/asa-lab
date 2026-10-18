-- A common, browser-bound MAX/Telegram lifecycle. Existing accounts, identity
-- history and runtime credentials are preserved. No provider verifies email.

ALTER TABLE account_external_identities
    DROP CONSTRAINT account_external_identities_provider_check,
    ADD CONSTRAINT account_external_identities_provider_check
        CHECK (provider IN ('max', 'telegram')),
    ADD COLUMN revocation_kind varchar(16)
        CHECK (revocation_kind IN ('self', 'admin'));
UPDATE account_external_identities
   SET revocation_kind = CASE
       WHEN revoke_reason = 'self-service unlink' THEN 'self' ELSE 'admin' END
 WHERE revoked_at IS NOT NULL;
ALTER TABLE external_auth_assertions
    DROP CONSTRAINT external_auth_assertions_provider_check,
    ADD CONSTRAINT external_auth_assertions_provider_check
        CHECK (provider IN ('max', 'telegram'));
ALTER TABLE account_external_identity_events
    DROP CONSTRAINT account_external_identity_events_provider_check,
    ADD CONSTRAINT account_external_identity_events_provider_check
        CHECK (provider IN ('max', 'telegram'));
ALTER TABLE session_refresh_families
    DROP CONSTRAINT session_refresh_families_source_check,
    ADD CONSTRAINT session_refresh_families_source_check
        CHECK (source IN ('password', 'max', 'telegram', 'organization'));

CREATE TABLE auth_provider_settings (
    provider varchar(32) PRIMARY KEY CHECK (provider IN ('max', 'telegram')),
    enabled boolean NOT NULL DEFAULT false,
    bot_username varchar(64) NOT NULL DEFAULT ''
        CHECK (bot_username = '' OR bot_username ~ '^[A-Za-z0-9_]{3,64}$'),
    mini_app_url varchar(2048) NOT NULL DEFAULT ''
        CHECK (mini_app_url = '' OR mini_app_url ~ '^https://'),
    token_ciphertext varchar(2048),
    token_iv varchar(64),
    token_auth_tag varchar(64),
    token_fingerprint varchar(16),
    verified_bot_id varchar(64),
    verified_bot_name varchar(128),
    token_verified_at timestamptz,
    configuration_version bigint NOT NULL DEFAULT 1,
    updated_by_principal uuid REFERENCES principals(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    webhook_url varchar(2048),
    webhook_verified_at timestamptz,
    webhook_last_error varchar(500),
    health_available boolean NOT NULL DEFAULT false,
    health_reason varchar(32) NOT NULL DEFAULT 'not_configured',
    health_checked_at timestamptz,
    CHECK (
        (token_ciphertext IS NULL AND token_iv IS NULL AND token_auth_tag IS NULL
         AND token_fingerprint IS NULL AND token_verified_at IS NULL)
        OR
        (token_ciphertext IS NOT NULL AND token_iv IS NOT NULL AND token_auth_tag IS NOT NULL
         AND token_fingerprint IS NOT NULL AND token_verified_at IS NOT NULL)
    ),
    CHECK (NOT enabled OR
        (token_ciphertext IS NOT NULL AND bot_username <> '' AND mini_app_url <> '')),
    CHECK (health_reason IN ('ready', 'disabled', 'not_configured',
        'invalid_token', 'delivery_unavailable', 'unavailable'))
);
INSERT INTO auth_provider_settings (
    provider, enabled, bot_username, mini_app_url, token_ciphertext, token_iv,
    token_auth_tag, token_fingerprint, verified_bot_id, verified_bot_name,
    token_verified_at, configuration_version, updated_by_principal, updated_at,
    webhook_url, webhook_verified_at, webhook_last_error
)
SELECT 'max', enabled, bot_username, mini_app_url, token_ciphertext, token_iv,
       token_auth_tag, token_fingerprint, verified_bot_id, verified_bot_name,
       token_verified_at, configuration_version, updated_by_principal, updated_at,
       webhook_url, NULL, NULL
  FROM max_runtime_settings WHERE singleton_key = true;
INSERT INTO auth_provider_settings (provider) VALUES ('telegram');
ALTER TABLE auth_provider_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_provider_settings FROM PUBLIC, asalab_app;

CREATE TABLE auth_provider_pairings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider varchar(32) NOT NULL REFERENCES auth_provider_settings(provider),
    token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    browser_nonce_hash text NOT NULL CHECK (browser_nonce_hash ~ '^[a-f0-9]{64}$'),
    purpose varchar(16) NOT NULL CHECK (purpose IN ('login', 'register', 'link')),
    requested_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
    configuration_version bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    provider_subject varchar(64),
    provider_username varchar(64),
    provider_display_name varchar(255),
    assertion_id varchar(255),
    auth_date bigint,
    approved_at timestamptz,
    consumed_at timestamptz,
    invalidated_at timestamptz,
    UNIQUE (provider, token_hash),
    UNIQUE (provider, browser_nonce_hash),
    CHECK ((purpose = 'link') = (requested_account_id IS NOT NULL)),
    CHECK (expires_at > created_at),
    CHECK ((approved_at IS NULL) = (provider_subject IS NULL)),
    CHECK (provider_subject IS NULL OR provider_subject ~ '^[0-9]{1,64}$')
);
CREATE INDEX auth_provider_pairings_pending_idx
    ON auth_provider_pairings (provider, expires_at)
    WHERE consumed_at IS NULL AND invalidated_at IS NULL;
CREATE INDEX auth_provider_pairings_account_idx
    ON auth_provider_pairings (requested_account_id)
    WHERE consumed_at IS NULL AND invalidated_at IS NULL;
ALTER TABLE auth_provider_pairings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_provider_pairings FROM PUBLIC, asalab_app;

CREATE FUNCTION auth_provider_runtime_config(p_provider varchar)
RETURNS SETOF auth_provider_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT settings.* FROM public.auth_provider_settings settings
     WHERE settings.provider = p_provider
$$;

CREATE FUNCTION admin_get_auth_provider_config(p_actor uuid, p_provider varchar)
RETURNS TABLE (
    enabled boolean, bot_username varchar, mini_app_url varchar,
    token_configured boolean, token_fingerprint varchar,
    verified_bot_id varchar, verified_bot_name varchar, token_verified_at timestamptz,
    configuration_version bigint, updated_at timestamptz,
    webhook_url varchar, webhook_verified_at timestamptz, webhook_last_error varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'provider configuration denied' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT s.enabled, s.bot_username, s.mini_app_url,
        s.token_ciphertext IS NOT NULL, s.token_fingerprint,
        s.verified_bot_id, s.verified_bot_name, s.token_verified_at,
        s.configuration_version, s.updated_at, s.webhook_url,
        s.webhook_verified_at, s.webhook_last_error
      FROM public.auth_provider_settings s WHERE s.provider = p_provider;
END;
$$;

CREATE FUNCTION admin_set_auth_provider_config(
    p_actor uuid, p_provider varchar, p_enabled boolean, p_bot_username varchar,
    p_mini_app_url varchar, p_token_action varchar, p_ciphertext varchar,
    p_iv varchar, p_tag varchar, p_fingerprint varchar, p_bot_id varchar,
    p_bot_name varchar, p_reason varchar, p_request_id varchar
) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_before bigint;
    v_after bigint;
    v_has_token boolean;
BEGIN
    IF public.admin_authorized_role(p_actor, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'provider configuration denied' USING ERRCODE = '42501';
    END IF;
    IF p_provider IS NULL OR p_provider NOT IN ('max', 'telegram')
       OR p_enabled IS NULL OR p_bot_username IS NULL OR p_mini_app_url IS NULL
       OR (p_bot_username <> '' AND p_bot_username !~ '^[A-Za-z0-9_]{3,64}$')
       OR (p_mini_app_url <> '' AND p_mini_app_url !~ '^https://')
       OR length(p_mini_app_url) > 2048
       OR p_token_action IS NULL OR p_token_action NOT IN ('keep', 'replace', 'clear')
       OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
       OR p_request_id IS NULL OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid provider configuration' USING ERRCODE = '22023';
    END IF;
    IF p_token_action = 'replace' AND (
        p_ciphertext IS NULL OR length(p_ciphertext) NOT BETWEEN 1 AND 2048
        OR p_iv IS NULL OR length(p_iv) NOT BETWEEN 1 AND 64
        OR p_tag IS NULL OR length(p_tag) NOT BETWEEN 1 AND 64
        OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 8 AND 16
        OR p_bot_id IS NULL OR length(p_bot_id) NOT BETWEEN 1 AND 64
    ) THEN
        RAISE EXCEPTION 'invalid encrypted provider credential' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT s.configuration_version, CASE p_token_action
        WHEN 'replace' THEN true WHEN 'clear' THEN false ELSE s.token_ciphertext IS NOT NULL END
      INTO v_before, v_has_token
      FROM public.auth_provider_settings s WHERE s.provider = p_provider FOR UPDATE;
    IF v_before IS NULL OR (p_enabled AND
       (NOT v_has_token OR p_bot_username = '' OR p_mini_app_url = '')) THEN
        RAISE EXCEPTION 'provider is not configured' USING ERRCODE = '22023';
    END IF;
    UPDATE public.auth_provider_settings s SET
        enabled = p_enabled, bot_username = p_bot_username, mini_app_url = p_mini_app_url,
        token_ciphertext = CASE p_token_action
            WHEN 'replace' THEN p_ciphertext WHEN 'clear' THEN NULL ELSE s.token_ciphertext END,
        token_iv = CASE p_token_action
            WHEN 'replace' THEN p_iv WHEN 'clear' THEN NULL ELSE s.token_iv END,
        token_auth_tag = CASE p_token_action
            WHEN 'replace' THEN p_tag WHEN 'clear' THEN NULL ELSE s.token_auth_tag END,
        token_fingerprint = CASE p_token_action
            WHEN 'replace' THEN p_fingerprint WHEN 'clear' THEN NULL ELSE s.token_fingerprint END,
        verified_bot_id = CASE p_token_action
            WHEN 'replace' THEN p_bot_id WHEN 'clear' THEN NULL ELSE s.verified_bot_id END,
        verified_bot_name = CASE p_token_action
            WHEN 'replace' THEN p_bot_name WHEN 'clear' THEN NULL ELSE s.verified_bot_name END,
        token_verified_at = CASE
            WHEN p_token_action = 'clear' THEN NULL
            WHEN p_token_action = 'replace' OR p_enabled THEN now() ELSE s.token_verified_at END,
        configuration_version = s.configuration_version + 1,
        updated_by_principal = p_actor, updated_at = now(),
        health_available = false, health_checked_at = NULL,
        health_reason = CASE WHEN p_enabled THEN 'unavailable' ELSE 'disabled' END,
        webhook_verified_at = NULL, webhook_last_error = NULL
     WHERE s.provider = p_provider RETURNING s.configuration_version INTO v_after;
    UPDATE public.auth_provider_pairings SET invalidated_at = now()
     WHERE provider = p_provider AND consumed_at IS NULL AND invalidated_at IS NULL;
    PERFORM public.admin_append_audit_event(
        p_actor, 'platform', NULL, 'administration.' || p_provider || '_configuration.update',
        'integration', p_provider, 'admin_console', trim(p_reason), NULL,
        p_request_id, p_request_id, 'succeeded', v_before, v_after
    );
    RETURN v_after;
END;
$$;

CREATE FUNCTION auth_provider_health_set(
    p_provider varchar, p_version bigint, p_available boolean, p_reason varchar
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.auth_provider_settings SET
        health_available = p_available AND enabled,
        health_reason = CASE WHEN enabled THEN p_reason ELSE 'disabled' END,
        health_checked_at = now()
     WHERE provider = p_provider AND configuration_version = p_version
       AND p_reason IN ('ready', 'disabled', 'not_configured',
           'invalid_token', 'delivery_unavailable', 'unavailable')
$$;

CREATE FUNCTION auth_provider_webhook_status_set(
    p_provider varchar, p_version bigint, p_url varchar, p_verified boolean, p_error varchar
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.auth_provider_settings SET
        webhook_url = NULLIF(trim(p_url), ''),
        webhook_verified_at = CASE WHEN p_verified THEN now() ELSE NULL END,
        webhook_last_error = CASE WHEN p_verified THEN NULL ELSE left(p_error, 500) END,
        health_available = CASE WHEN p_verified THEN health_available ELSE false END,
        health_reason = CASE WHEN p_verified THEN health_reason ELSE 'delivery_unavailable' END
     WHERE provider = p_provider AND configuration_version = p_version
$$;

CREATE FUNCTION auth_provider_identity_account(p_provider varchar, p_subject varchar)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT i.account_id FROM public.account_external_identities i
     WHERE i.provider = p_provider AND i.subject = p_subject AND i.revoked_at IS NULL
     LIMIT 1
$$;

CREATE FUNCTION auth_provider_link(
    p_provider varchar, p_account uuid, p_subject varchar, p_assertion varchar,
    p_auth_date bigint, p_username varchar, p_display_name varchar
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_identity public.account_external_identities%ROWTYPE;
    v_other_subject varchar;
    v_status varchar;
    v_inserted integer;
    v_was_active boolean;
BEGIN
    IF p_provider IS NULL OR p_provider NOT IN ('max', 'telegram')
       OR p_subject IS NULL OR p_subject !~ '^[0-9]{1,64}$'
       OR p_assertion IS NULL OR length(p_assertion) NOT BETWEEN 1 AND 255
       OR p_auth_date IS NULL OR p_auth_date <= 0 THEN RETURN 'unavailable'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT a.status INTO v_status FROM public.accounts a WHERE a.id = p_account FOR UPDATE;
    IF v_status IS DISTINCT FROM 'active' THEN RETURN 'account_suspended'; END IF;
    SELECT * INTO v_identity FROM public.account_external_identities i
     WHERE i.provider = p_provider AND i.subject = p_subject FOR UPDATE;
    v_was_active := v_identity.id IS NOT NULL AND v_identity.revoked_at IS NULL;
    IF v_identity.id IS NOT NULL AND v_identity.account_id <> p_account THEN
        RETURN 'identity_taken';
    END IF;
    IF v_identity.revoked_at IS NOT NULL AND v_identity.revocation_kind IS DISTINCT FROM 'self' THEN
        RETURN 'identity_revoked';
    END IF;
    SELECT i.subject INTO v_other_subject FROM public.account_external_identities i
     WHERE i.provider = p_provider AND i.account_id = p_account AND i.subject <> p_subject;
    IF v_other_subject IS NOT NULL THEN RETURN 'account_already_linked'; END IF;
    DELETE FROM public.external_auth_assertions WHERE consumed_at < now() - interval '2 hours';
    INSERT INTO public.external_auth_assertions(provider, assertion_id, account_id, issued_at)
    VALUES (p_provider, p_assertion, p_account, to_timestamp(p_auth_date::double precision))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted <> 1 THEN RETURN 'assertion_replayed'; END IF;
    INSERT INTO public.account_external_identities(
        provider, subject, account_id, username, display_name, last_used_at, verified_at
    ) VALUES (
        p_provider, p_subject, p_account, NULLIF(trim(p_username), ''),
        NULLIF(trim(p_display_name), ''), now(), now()
    ) ON CONFLICT (provider, subject) DO UPDATE SET
        username = COALESCE(EXCLUDED.username, account_external_identities.username),
        display_name = COALESCE(EXCLUDED.display_name, account_external_identities.display_name),
        last_used_at = now(), verified_at = now(), revoked_at = NULL,
        revoked_by_principal_id = NULL, revoke_reason = NULL, revocation_kind = NULL
    RETURNING id INTO v_identity.id;
    INSERT INTO public.account_external_identity_events(
        identity_id, account_id, provider, event, reason
    ) VALUES (v_identity.id, p_account, p_provider,
        CASE WHEN v_was_active THEN 'verified' ELSE 'linked' END, 'provider proof confirmed');
    RETURN CASE WHEN v_was_active THEN 'already_linked' ELSE 'linked' END;
END;
$$;

CREATE FUNCTION auth_provider_session_create(
    p_provider varchar, p_account uuid, p_session_hash text,
    p_ttl_hours integer, p_user_agent varchar
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_principal uuid; v_workspace uuid;
BEGIN
    IF p_provider IS NULL OR p_provider NOT IN ('max', 'telegram')
       OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$'
       OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 24 THEN RETURN false; END IF;
    SELECT pr.id, w.id INTO v_principal, v_workspace
      FROM public.principals pr
      JOIN public.accounts a ON a.id = pr.account_id
      JOIN public.workspace_memberships m ON m.account_id = pr.account_id
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE a.id = p_account AND a.status = 'active' AND pr.kind = 'account'
       AND m.state = 'active' AND w.kind = 'personal' AND w.status = 'active'
     LIMIT 1 FOR SHARE OF a;
    IF v_principal IS NULL THEN RETURN false; END IF;
    INSERT INTO public.sessions_v2(
        principal_id, active_workspace_id, token_hash, expires_at, client_metadata
    ) VALUES (
        v_principal, v_workspace, p_session_hash, now() + make_interval(hours => p_ttl_hours),
        jsonb_strip_nulls(jsonb_build_object(
            'authenticationProvider', p_provider,
            'userAgentSummary', NULLIF(trim(p_user_agent), '')
        ))
    );
    RETURN true;
END;
$$;

CREATE FUNCTION auth_provider_login(
    p_provider varchar, p_subject varchar, p_assertion varchar, p_auth_date bigint,
    p_username varchar, p_display_name varchar, p_session_hash text,
    p_ttl_hours integer, p_user_agent varchar
) RETURNS TABLE (result varchar, account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_link varchar;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    IF NOT EXISTS (SELECT 1 FROM public.auth_provider_settings s
        WHERE s.provider = p_provider AND s.enabled) THEN
        RETURN QUERY SELECT 'unavailable'::varchar, NULL::uuid; RETURN;
    END IF;
    v_account := public.auth_provider_identity_account(p_provider, p_subject);
    IF v_account IS NULL THEN
        RETURN QUERY SELECT 'link_required'::varchar, NULL::uuid; RETURN;
    END IF;
    v_link := public.auth_provider_link(
        p_provider, v_account, p_subject, p_assertion, p_auth_date, p_username, p_display_name
    );
    IF v_link NOT IN ('linked', 'already_linked') THEN
        RETURN QUERY SELECT v_link, NULL::uuid; RETURN;
    END IF;
    IF NOT public.auth_provider_session_create(
        p_provider, v_account, p_session_hash, p_ttl_hours, p_user_agent
    ) THEN RETURN QUERY SELECT 'unavailable'::varchar, NULL::uuid; RETURN; END IF;
    RETURN QUERY SELECT 'authenticated'::varchar, v_account;
END;
$$;

CREATE FUNCTION auth_provider_register(
    p_provider varchar, p_subject varchar, p_assertion varchar, p_auth_date bigint,
    p_provider_username varchar, p_provider_name varchar, p_email varchar,
    p_password_hash text, p_display_name varchar, p_username varchar,
    p_birth_date date, p_country varchar, p_policy_version varchar,
    p_session_hash text, p_ttl_hours integer
) RETURNS TABLE (result varchar, account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_identity uuid;
BEGIN
    IF p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 255
       OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR p_password_hash IS NULL OR length(p_password_hash) NOT BETWEEN 32 AND 512
       OR p_display_name IS NULL OR length(trim(p_display_name)) NOT BETWEEN 1 AND 255
       OR p_username IS NULL OR p_username !~ '^[A-Za-z0-9_.-]{3,40}$'
       OR p_birth_date IS NULL OR p_birth_date < DATE '1900-01-01'
       OR p_country IS NULL OR upper(p_country) !~ '^[A-Z]{2}$'
       OR p_policy_version IS NULL OR length(p_policy_version) NOT BETWEEN 1 AND 32 THEN
        RETURN QUERY SELECT 'validation_error'::varchar, NULL::uuid; RETURN;
    END IF;
    IF p_birth_date > (current_date - interval '18 years')::date THEN
        RETURN QUERY SELECT 'age_routed'::varchar, NULL::uuid; RETURN;
    END IF;
    IF p_provider IS NULL OR p_provider NOT IN ('max', 'telegram')
       OR p_subject IS NULL OR p_subject !~ '^[0-9]{1,64}$'
       OR p_assertion IS NULL OR length(p_assertion) NOT BETWEEN 1 AND 255
       OR p_auth_date IS NULL OR p_auth_date <= 0
       OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$'
       OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 24 THEN
        RETURN QUERY SELECT 'unavailable'::varchar, NULL::uuid; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    IF NOT EXISTS (SELECT 1 FROM public.auth_provider_settings s
        WHERE s.provider = p_provider AND s.enabled) THEN
        RETURN QUERY SELECT 'unavailable'::varchar, NULL::uuid; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.account_external_identities i
        WHERE i.provider = p_provider AND i.subject = p_subject) THEN
        RETURN QUERY SELECT 'identity_taken'::varchar, NULL::uuid; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.external_auth_assertions a
        WHERE a.provider = p_provider AND a.assertion_id = p_assertion) THEN
        RETURN QUERY SELECT 'assertion_replayed'::varchar, NULL::uuid; RETURN;
    END IF;
    SELECT registered.account_id INTO v_account FROM public.auth_register_account(
        p_email, p_password_hash, p_display_name, p_username, p_birth_date,
        p_country, p_policy_version, p_session_hash, p_ttl_hours
    ) registered;
    -- The caller hashes the person's explicit fallback password using the
    -- ordinary registration policy; provider outages never require guessing it.
    UPDATE public.accounts SET password_configured = true WHERE id = v_account;
    UPDATE public.sessions_v2 SET client_metadata = jsonb_build_object(
        'authenticationProvider', p_provider
    ) WHERE token_hash = p_session_hash;
    INSERT INTO public.account_external_identities(
        provider, subject, account_id, username, display_name, last_used_at, verified_at
    ) VALUES (p_provider, p_subject, v_account, NULLIF(trim(p_provider_username), ''),
        NULLIF(trim(p_provider_name), ''), now(), now()) RETURNING id INTO v_identity;
    INSERT INTO public.external_auth_assertions(provider, assertion_id, account_id, issued_at)
    VALUES (p_provider, p_assertion, v_account, to_timestamp(p_auth_date::double precision));
    INSERT INTO public.account_external_identity_events(identity_id, account_id, provider, event)
    VALUES (v_identity, v_account, p_provider, 'verified');
    RETURN QUERY SELECT 'authenticated'::varchar, v_account;
END;
$$;

CREATE FUNCTION auth_provider_pairing_start(
    p_provider varchar, p_token_hash text, p_nonce_hash text,
    p_ttl_minutes integer, p_account uuid, p_purpose varchar
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_version bigint; v_pending integer;
BEGIN
    IF p_provider IS NULL OR p_provider NOT IN ('max', 'telegram')
       OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
       OR p_nonce_hash IS NULL OR p_nonce_hash !~ '^[a-f0-9]{64}$'
       OR p_token_hash = p_nonce_hash
       OR p_ttl_minutes IS NULL OR p_ttl_minutes NOT BETWEEN 1 AND 10
       OR p_purpose IS NULL OR p_purpose NOT IN ('login', 'register', 'link')
       OR ((p_purpose = 'link') <> (p_account IS NOT NULL)) THEN RETURN false; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT s.configuration_version INTO v_version FROM public.auth_provider_settings s
     WHERE s.provider = p_provider AND s.enabled AND s.token_ciphertext IS NOT NULL;
    IF v_version IS NULL THEN RETURN false; END IF;
    IF p_account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts a
        WHERE a.id = p_account AND a.status = 'active') THEN RETURN false; END IF;
    DELETE FROM public.auth_provider_pairings WHERE id IN (
        SELECT p.id FROM public.auth_provider_pairings p
         WHERE p.expires_at < now() - interval '1 hour' LIMIT 1000
    );
    SELECT count(*) INTO v_pending FROM (
        SELECT 1 FROM public.auth_provider_pairings p
         WHERE p.provider = p_provider AND p.expires_at > now()
           AND p.consumed_at IS NULL AND p.invalidated_at IS NULL LIMIT 10000
    ) pending;
    IF v_pending >= 10000 THEN RETURN false; END IF;
    INSERT INTO public.auth_provider_pairings(
        provider, token_hash, browser_nonce_hash, purpose, requested_account_id,
        configuration_version, expires_at
    ) VALUES (p_provider, p_token_hash, p_nonce_hash, p_purpose, p_account,
        v_version, now() + make_interval(mins => p_ttl_minutes));
    RETURN true;
END;
$$;

CREATE FUNCTION auth_provider_pairing_approve(
    p_provider varchar, p_token_hash text, p_subject varchar, p_assertion varchar,
    p_auth_date bigint, p_username varchar, p_display_name varchar
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_pair public.auth_provider_pairings%ROWTYPE; v_version bigint;
BEGIN
    IF p_subject IS NULL OR p_subject !~ '^[0-9]{1,64}$'
       OR p_assertion IS NULL OR length(p_assertion) NOT BETWEEN 1 AND 255
       OR p_auth_date IS NULL OR p_auth_date <= 0 THEN RETURN 'invalid'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT s.configuration_version INTO v_version FROM public.auth_provider_settings s
     WHERE s.provider = p_provider AND s.enabled;
    SELECT * INTO v_pair FROM public.auth_provider_pairings p
     WHERE p.provider = p_provider AND p.token_hash = p_token_hash FOR UPDATE;
    IF v_pair.id IS NULL OR v_version IS NULL OR v_pair.configuration_version <> v_version
       OR v_pair.invalidated_at IS NOT NULL OR v_pair.expires_at <= now()
       OR v_pair.consumed_at IS NOT NULL THEN RETURN 'invalid'; END IF;
    IF v_pair.approved_at IS NOT NULL THEN
        RETURN CASE WHEN v_pair.provider_subject = p_subject THEN 'approved' ELSE 'invalid' END;
    END IF;
    IF EXISTS (SELECT 1 FROM public.account_external_identities i
        WHERE i.provider = p_provider AND i.subject = p_subject
          AND i.revoked_at IS NOT NULL AND i.revocation_kind IS DISTINCT FROM 'self') THEN
        UPDATE public.auth_provider_pairings SET invalidated_at = now() WHERE id = v_pair.id;
        RETURN 'identity_revoked';
    END IF;
    UPDATE public.auth_provider_pairings SET
        provider_subject = p_subject, assertion_id = p_assertion, auth_date = p_auth_date,
        provider_username = NULLIF(trim(p_username), ''),
        provider_display_name = NULLIF(trim(p_display_name), ''), approved_at = now()
     WHERE id = v_pair.id;
    RETURN 'approved';
END;
$$;

CREATE FUNCTION auth_provider_pairing_consume(
    p_provider varchar, p_token_hash text, p_nonce_hash text,
    p_session_hash text, p_ttl_hours integer, p_user_agent varchar, p_current_account uuid
) RETURNS TABLE (result varchar, account_id uuid, display_name varchar, username varchar)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_pair public.auth_provider_pairings%ROWTYPE;
    v_identity public.account_external_identities%ROWTYPE;
    v_version bigint;
    v_link varchar;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT s.configuration_version INTO v_version FROM public.auth_provider_settings s
     WHERE s.provider = p_provider AND s.enabled;
    SELECT * INTO v_pair FROM public.auth_provider_pairings p
     WHERE p.provider = p_provider AND p.token_hash = p_token_hash
       AND p.browser_nonce_hash = p_nonce_hash FOR UPDATE;
    IF v_pair.id IS NULL OR v_version IS NULL OR v_pair.configuration_version <> v_version
       OR v_pair.invalidated_at IS NOT NULL THEN
        RETURN QUERY SELECT 'invalid'::varchar, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
    END IF;
    IF v_pair.expires_at <= now() THEN
        RETURN QUERY SELECT 'expired'::varchar, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
    END IF;
    IF v_pair.consumed_at IS NOT NULL THEN
        RETURN QUERY SELECT 'consumed'::varchar, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
    END IF;
    IF v_pair.purpose = 'link' AND
       (p_current_account IS NULL OR p_current_account <> v_pair.requested_account_id) THEN
        RETURN QUERY SELECT 'invalid'::varchar, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
    END IF;
    IF v_pair.approved_at IS NULL THEN
        RETURN QUERY SELECT 'pending'::varchar, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
    END IF;
    SELECT * INTO v_identity FROM public.account_external_identities i
     WHERE i.provider = p_provider AND i.subject = v_pair.provider_subject FOR UPDATE;
    IF v_pair.purpose = 'link' THEN
        v_link := public.auth_provider_link(
            p_provider, v_pair.requested_account_id, v_pair.provider_subject,
            v_pair.assertion_id, v_pair.auth_date, v_pair.provider_username, v_pair.provider_display_name
        );
        IF v_link NOT IN ('linked', 'already_linked') THEN
            RETURN QUERY SELECT v_link, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
        END IF;
        UPDATE public.auth_provider_pairings SET consumed_at = now() WHERE id = v_pair.id;
        RETURN QUERY SELECT 'linked'::varchar, v_pair.requested_account_id,
            NULL::varchar, NULL::varchar; RETURN;
    END IF;
    IF v_identity.id IS NULL THEN
        RETURN QUERY SELECT 'registration_required'::varchar, NULL::uuid,
            v_pair.provider_display_name, v_pair.provider_username; RETURN;
    END IF;
    IF v_identity.revoked_at IS NOT NULL THEN
        RETURN QUERY SELECT 'identity_revoked'::varchar, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
    END IF;
    IF NOT public.auth_provider_session_create(
        p_provider, v_identity.account_id, p_session_hash, p_ttl_hours, p_user_agent
    ) THEN
        RETURN QUERY SELECT 'account_suspended'::varchar, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
    END IF;
    UPDATE public.auth_provider_pairings SET consumed_at = now() WHERE id = v_pair.id;
    UPDATE public.account_external_identities SET last_used_at = now() WHERE id = v_identity.id;
    INSERT INTO public.account_external_identity_events(identity_id, account_id, provider, event)
    VALUES (v_identity.id, v_identity.account_id, p_provider, 'used');
    RETURN QUERY SELECT 'authenticated'::varchar, v_identity.account_id, NULL::varchar, NULL::varchar;
END;
$$;

CREATE FUNCTION auth_provider_pairing_register(
    p_provider varchar, p_token_hash text, p_nonce_hash text, p_email varchar,
    p_password_hash text, p_display_name varchar, p_username varchar,
    p_birth_date date, p_country varchar, p_policy_version varchar,
    p_session_hash text, p_ttl_hours integer
) RETURNS TABLE (result varchar, account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_pair public.auth_provider_pairings%ROWTYPE; v_version bigint; v_result varchar; v_account uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT s.configuration_version INTO v_version FROM public.auth_provider_settings s
     WHERE s.provider = p_provider AND s.enabled;
    SELECT * INTO v_pair FROM public.auth_provider_pairings p
     WHERE p.provider = p_provider AND p.token_hash = p_token_hash
       AND p.browser_nonce_hash = p_nonce_hash FOR UPDATE;
    IF v_pair.id IS NULL OR v_version IS NULL OR v_pair.configuration_version <> v_version
       OR v_pair.invalidated_at IS NOT NULL OR v_pair.expires_at <= now()
       OR v_pair.consumed_at IS NOT NULL OR v_pair.approved_at IS NULL
       OR v_pair.purpose = 'link' THEN
        RETURN QUERY SELECT 'unavailable'::varchar, NULL::uuid; RETURN;
    END IF;
    SELECT registered.result, registered.account_id INTO v_result, v_account
      FROM public.auth_provider_register(
        p_provider, v_pair.provider_subject, v_pair.assertion_id, v_pair.auth_date,
        v_pair.provider_username, v_pair.provider_display_name, p_email,
        p_password_hash, p_display_name, p_username, p_birth_date, p_country,
        p_policy_version, p_session_hash, p_ttl_hours
      ) registered;
    IF v_result = 'authenticated' THEN
        UPDATE public.auth_provider_pairings SET consumed_at = now() WHERE id = v_pair.id;
    END IF;
    RETURN QUERY SELECT v_result, v_account;
END;
$$;

CREATE FUNCTION auth_provider_status(p_provider varchar, p_account uuid)
RETURNS TABLE (
    linked boolean, verified_at timestamptz, first_authenticated_at timestamptz,
    prompt_due boolean, prompt_dismissed_until timestamptz, can_unlink boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT i.id IS NOT NULL, i.verified_at, a.first_authenticated_at,
        a.first_authenticated_at + interval '24 hours' <= now()
            AND a.email_verification_state <> 'verified'
            AND NOT EXISTS (SELECT 1 FROM public.account_external_identities proof
                WHERE proof.account_id = a.id AND proof.revoked_at IS NULL)
            AND (a.max_prompt_dismissed_until IS NULL OR a.max_prompt_dismissed_until <= now()),
        a.max_prompt_dismissed_until,
        a.password_configured OR EXISTS (
            SELECT 1 FROM public.account_external_identities other_identity
            JOIN public.auth_provider_settings provider_settings
              ON provider_settings.provider = other_identity.provider
             AND provider_settings.enabled AND provider_settings.health_available
             AND provider_settings.health_checked_at > now() - interval '1 minute'
            WHERE other_identity.account_id = a.id AND other_identity.provider <> p_provider
              AND other_identity.revoked_at IS NULL AND other_identity.verified_at IS NOT NULL
        )
      FROM public.accounts a
      LEFT JOIN public.account_external_identities i
        ON i.account_id = a.id AND i.provider = p_provider AND i.revoked_at IS NULL
     WHERE a.id = p_account AND a.status = 'active'
$$;

CREATE FUNCTION auth_provider_revoke(
    p_provider varchar, p_account uuid, p_actor uuid, p_kind varchar,
    p_reason varchar, p_request_id varchar
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_identity uuid; v_subject varchar; v_actor_account uuid; v_password boolean;
BEGIN
    IF p_provider IS NULL OR p_provider NOT IN ('max', 'telegram')
       OR p_kind IS NULL OR p_kind NOT IN ('self', 'admin') THEN RETURN 'invalid'; END IF;
    IF p_kind = 'admin' THEN
        IF public.admin_authorized_role(p_actor, 'platform', NULL)
           IS DISTINCT FROM 'platform_admin' THEN
            RAISE EXCEPTION 'provider revocation denied' USING ERRCODE = '42501';
        END IF;
        IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
           OR p_request_id IS NULL OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
            RAISE EXCEPTION 'invalid provider revocation request' USING ERRCODE = '22023';
        END IF;
    ELSE
        SELECT p.account_id INTO v_actor_account FROM public.principals p WHERE p.id = p_actor;
        IF v_actor_account IS DISTINCT FROM p_account THEN
            RAISE EXCEPTION 'provider self-service identity mismatch' USING ERRCODE = '42501';
        END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT a.password_configured INTO v_password FROM public.accounts a
     WHERE a.id = p_account FOR UPDATE;
    SELECT i.id, i.subject INTO v_identity, v_subject FROM public.account_external_identities i
     WHERE i.provider = p_provider AND i.account_id = p_account
       AND (i.revoked_at IS NULL OR p_kind = 'admin') FOR UPDATE;
    IF v_identity IS NULL THEN RETURN 'not_linked'; END IF;
    IF p_kind = 'self' AND NOT COALESCE(v_password, false) AND NOT EXISTS (
        SELECT 1 FROM public.account_external_identities i
        JOIN public.auth_provider_settings s ON s.provider = i.provider
         AND s.enabled AND s.health_available AND s.health_checked_at > now() - interval '1 minute'
        WHERE i.account_id = p_account AND i.provider <> p_provider AND i.revoked_at IS NULL
          AND i.verified_at IS NOT NULL
    ) THEN RETURN 'last_sign_in_method'; END IF;
    UPDATE public.account_external_identities SET
        revoked_at = now(), revoked_by_principal_id = p_actor,
        revoke_reason = trim(p_reason), revocation_kind = p_kind
     WHERE id = v_identity;
    INSERT INTO public.account_external_identity_events(
        identity_id, account_id, provider, event, actor_principal_id, reason
    ) VALUES (v_identity, p_account, p_provider, 'revoked', p_actor, trim(p_reason));
    UPDATE public.auth_provider_pairings SET invalidated_at = now()
     WHERE provider = p_provider AND consumed_at IS NULL AND invalidated_at IS NULL
       AND (requested_account_id = p_account OR provider_subject = v_subject);
    UPDATE public.session_refresh_tokens token SET revoked_at = COALESCE(token.revoked_at, now())
      FROM public.session_refresh_families family
      JOIN public.sessions_v2 session ON session.id = family.session_id
      JOIN public.principals principal ON principal.id = session.principal_id
     WHERE token.family_id = family.id AND principal.account_id = p_account
       AND (family.source = p_provider OR session.client_metadata ->> 'authenticationProvider' = p_provider);
    UPDATE public.session_refresh_families family SET revoked_at = COALESCE(family.revoked_at, now())
      FROM public.sessions_v2 session JOIN public.principals principal ON principal.id = session.principal_id
     WHERE family.session_id = session.id AND principal.account_id = p_account
       AND (family.source = p_provider OR session.client_metadata ->> 'authenticationProvider' = p_provider);
    UPDATE public.sessions_v2 session SET revoked_at = COALESCE(session.revoked_at, now())
      FROM public.principals principal
     WHERE principal.id = session.principal_id AND principal.account_id = p_account
       AND (session.client_metadata ->> 'authenticationProvider' = p_provider OR EXISTS (
            SELECT 1 FROM public.session_refresh_families family
             WHERE family.session_id = session.id AND family.source = p_provider
       ));
    IF p_kind = 'admin' THEN
        PERFORM public.admin_append_audit_event(
            p_actor, 'platform', NULL, 'administration.' || p_provider || '_identity.revoke',
            'account', p_account::text, 'admin_console', trim(p_reason), NULL,
            p_request_id, p_request_id, 'succeeded', NULL, NULL
        );
    END IF;
    RETURN 'unlinked';
END;
$$;

-- Keep callers of the original MAX administration API on the canonical store.
CREATE OR REPLACE FUNCTION auth_max_runtime_config()
RETURNS TABLE (
    enabled boolean, bot_username varchar, mini_app_url varchar,
    token_ciphertext varchar, token_iv varchar, token_auth_tag varchar,
    token_fingerprint varchar, verified_bot_id varchar, verified_bot_name varchar,
    token_verified_at timestamptz, configuration_version bigint, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.enabled, s.bot_username, s.mini_app_url, s.token_ciphertext,
        s.token_iv, s.token_auth_tag, s.token_fingerprint, s.verified_bot_id,
        s.verified_bot_name, s.token_verified_at, s.configuration_version, s.updated_at
      FROM public.auth_provider_settings s WHERE s.provider = 'max'
$$;
CREATE OR REPLACE FUNCTION admin_get_max_runtime_config(p_actor_principal_id uuid)
RETURNS TABLE (
    enabled boolean, bot_username varchar, mini_app_url varchar, token_configured boolean,
    token_fingerprint varchar, verified_bot_id varchar, verified_bot_name varchar,
    token_verified_at timestamptz, configuration_version bigint, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.enabled, s.bot_username, s.mini_app_url, s.token_configured,
        s.token_fingerprint, s.verified_bot_id, s.verified_bot_name, s.token_verified_at,
        s.configuration_version, s.updated_at
      FROM public.admin_get_auth_provider_config(p_actor_principal_id, 'max') s
$$;
CREATE OR REPLACE FUNCTION auth_max_webhook_status()
RETURNS TABLE (webhook_url varchar, webhook_verified_at timestamptz, webhook_last_error varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.webhook_url, s.webhook_verified_at, s.webhook_last_error
      FROM public.auth_provider_settings s WHERE s.provider = 'max'
$$;
CREATE OR REPLACE FUNCTION auth_max_webhook_status_set(p_url varchar, p_verified boolean, p_error varchar)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.auth_provider_webhook_status_set('max', s.configuration_version, p_url, p_verified, p_error)
      FROM public.auth_provider_settings s WHERE s.provider = 'max'
$$;
CREATE OR REPLACE FUNCTION admin_set_max_runtime_config(
    p_actor_principal_id uuid, p_enabled boolean, p_bot_username varchar, p_mini_app_url varchar,
    p_token_action varchar, p_token_ciphertext varchar, p_token_iv varchar, p_token_auth_tag varchar,
    p_token_fingerprint varchar, p_verified_bot_id varchar, p_verified_bot_name varchar,
    p_reason varchar, p_request_id varchar
) RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.admin_set_auth_provider_config(
        p_actor_principal_id, 'max', p_enabled, p_bot_username, p_mini_app_url,
        p_token_action, p_token_ciphertext, p_token_iv, p_token_auth_tag,
        p_token_fingerprint, p_verified_bot_id, p_verified_bot_name, p_reason, p_request_id
    )
$$;
CREATE OR REPLACE FUNCTION auth_max_link(
    p_account_id uuid, p_subject varchar, p_query_id varchar,
    p_auth_date bigint, p_username varchar, p_display_name varchar
) RETURNS TABLE (result varchar)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.auth_provider_link('max', p_account_id, p_subject, p_query_id,
        p_auth_date, p_username, p_display_name)
$$;
CREATE OR REPLACE FUNCTION auth_max_unlink_self(p_account_id uuid, p_actor_principal_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_result varchar;
BEGIN
    v_result := public.auth_provider_revoke(
        'max', p_account_id, p_actor_principal_id, 'self', 'self-service unlink', NULL
    );
    IF v_result = 'last_sign_in_method' THEN
        RAISE EXCEPTION 'last_sign_in_method' USING ERRCODE = '22023';
    END IF;
    RETURN v_result = 'unlinked';
END;
$$;
CREATE OR REPLACE FUNCTION admin_revoke_max_identity(
    p_actor_principal_id uuid, p_target_account_id uuid, p_reason varchar, p_request_id varchar
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.auth_provider_revoke(
        'max', p_target_account_id, p_actor_principal_id, 'admin', p_reason, p_request_id
    ) = 'unlinked'
$$;

-- Browser capabilities created before this migration have no independent
-- browser binding. They may not create sessions after the new lifecycle starts.
CREATE OR REPLACE FUNCTION auth_max_pairing_consume(
    p_token_hash text, p_session_hash text, p_ttl_hours integer, p_user_agent_summary varchar
) RETURNS TABLE (result varchar, account_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT 'invalid'::varchar, NULL::uuid
$$;

CREATE OR REPLACE FUNCTION session_refresh_attach(
    p_access_hash text, p_refresh_hash text, p_source varchar, p_ttl_days integer
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_session_id uuid; v_family_id uuid; v_absolute_expires_at timestamptz;
BEGIN
    IF length(p_access_hash) NOT BETWEEN 32 AND 255
       OR length(p_refresh_hash) NOT BETWEEN 32 AND 255
       OR p_source NOT IN ('password', 'max', 'telegram', 'organization')
       OR p_ttl_days NOT BETWEEN 1 AND 90 THEN RETURN false; END IF;
    SELECT s.id INTO v_session_id FROM public.sessions_v2 s
      JOIN public.principals p ON p.id = s.principal_id JOIN public.accounts a ON a.id = p.account_id
     WHERE s.token_hash = p_access_hash AND s.revoked_at IS NULL AND s.expires_at > now()
       AND a.status = 'active' FOR UPDATE OF s;
    IF v_session_id IS NULL OR EXISTS (
        SELECT 1 FROM public.session_refresh_families f WHERE f.session_id = v_session_id
    ) THEN RETURN false; END IF;
    v_absolute_expires_at := now() + make_interval(days => p_ttl_days);
    INSERT INTO public.session_refresh_families(session_id, source, absolute_expires_at)
    VALUES (v_session_id, p_source, v_absolute_expires_at) RETURNING id INTO v_family_id;
    INSERT INTO public.session_refresh_tokens(family_id, token_hash, generation, expires_at)
    VALUES (v_family_id, p_refresh_hash, 1, v_absolute_expires_at);
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION auth_provider_runtime_config(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_auth_provider_config(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_auth_provider_config(uuid, varchar, boolean, varchar, varchar,
    varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_health_set(varchar, bigint, boolean, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_webhook_status_set(varchar, bigint, varchar, boolean, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_identity_account(varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_link(varchar, uuid, varchar, varchar, bigint, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_session_create(varchar, uuid, text, integer, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_login(varchar, varchar, varchar, bigint, varchar, varchar,
    text, integer, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_register(varchar, varchar, varchar, bigint, varchar, varchar,
    varchar, text, varchar, varchar, date, varchar, varchar, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_pairing_start(varchar, text, text, integer, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_pairing_approve(varchar, text, varchar, varchar,
    bigint, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_pairing_consume(varchar, text, text, text,
    integer, varchar, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_pairing_register(varchar, text, text, varchar, text,
    varchar, varchar, date, varchar, varchar, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_status(varchar, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_provider_revoke(varchar, uuid, uuid, varchar, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_provider_runtime_config(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_get_auth_provider_config(uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_set_auth_provider_config(uuid, varchar, boolean, varchar, varchar,
    varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_health_set(varchar, bigint, boolean, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_webhook_status_set(varchar, bigint, varchar, boolean, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_identity_account(varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_link(varchar, uuid, varchar, varchar, bigint, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_login(varchar, varchar, varchar, bigint, varchar, varchar,
    text, integer, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_register(varchar, varchar, varchar, bigint, varchar, varchar,
    varchar, text, varchar, varchar, date, varchar, varchar, text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_pairing_start(varchar, text, text, integer, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_pairing_approve(varchar, text, varchar, varchar,
    bigint, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_pairing_consume(varchar, text, text, text,
    integer, varchar, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_pairing_register(varchar, text, text, varchar, text,
    varchar, varchar, date, varchar, varchar, text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_status(varchar, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_provider_revoke(varchar, uuid, uuid, varchar, varchar, varchar) TO asalab_app;

-- Release only a failed delivery receipt so the provider may retry the event.
-- Session and identity mutations remain single-use in the pairing functions.
CREATE FUNCTION auth_provider_webhook_event_release(p_event_hash text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    DELETE FROM public.max_webhook_events
     WHERE event_hash = p_event_hash AND p_event_hash ~ '^[a-f0-9]{64}$'
$$;
REVOKE ALL ON FUNCTION auth_provider_webhook_event_release(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_provider_webhook_event_release(text) TO asalab_app;

-- Telegram uses the existing telemetry boundaries; existing scoped validation,
-- module allowlists and provenance remain intact. Assert the reviewed baseline
-- before replacing the two authentication enumerations.
ALTER TABLE public.product_analytics_events
    DROP CONSTRAINT product_analytics_events_event_type_check,
    ADD CONSTRAINT product_analytics_events_event_type_check CHECK (event_type IN (
        'auth.login', 'auth.register', 'auth.max', 'auth.telegram', 'auth.class_join',
        'session.observed', 'module.opened', 'visit.observed'
    )),
    DROP CONSTRAINT product_analytics_events_auth_method_check,
    ADD CONSTRAINT product_analytics_events_auth_method_check CHECK (
        auth_method IS NULL OR auth_method IN (
            'password', 'organization', 'max', 'telegram', 'class_code'
        )
    );
DO $migration$
DECLARE definition text; updated text;
BEGIN
    definition := pg_get_functiondef('public.analytics_record_event(character varying,uuid,uuid,uuid,uuid,character varying,character varying,character varying,character varying,uuid,inet,character varying)'::regprocedure);
    updated := replace(definition, $old$'auth.login', 'auth.register', 'auth.max'$old$,
        $new$'auth.login', 'auth.register', 'auth.max', 'auth.telegram'$new$);
    IF updated = definition THEN RAISE EXCEPTION 'analytics authentication event baseline changed'; END IF;
    definition := updated;
    updated := replace(definition, $old$'password', 'organization', 'max', 'class_code'$old$,
        $new$'password', 'organization', 'max', 'telegram', 'class_code'$new$);
    IF updated = definition THEN RAISE EXCEPTION 'analytics authentication method baseline changed'; END IF;
    EXECUTE updated;
    definition := pg_get_functiondef('public.analytics_ingest_v2(uuid,character varying,uuid,uuid,uuid,uuid,uuid,character varying,jsonb,jsonb,timestamp with time zone)'::regprocedure);
    updated := replace(definition, $old$'auth.login','auth.register','auth.max'$old$,
        $new$'auth.login','auth.register','auth.max','auth.telegram'$new$);
    IF updated = definition THEN RAISE EXCEPTION 'analytics v2 authentication baseline changed'; END IF;
    EXECUTE updated;
END;
$migration$;
