-- Native startability and enforcement evidence are separate. No existing setting
-- gains a delivery receipt merely by upgrading or retaining a verified token.
ALTER TABLE auth_provider_settings
    ADD COLUMN native_confirmation_configuration_version bigint,
    ADD COLUMN native_confirmation_verified_at timestamptz,
    ADD CONSTRAINT auth_provider_native_confirmation_pair CHECK (
        (native_confirmation_configuration_version IS NULL) =
        (native_confirmation_verified_at IS NULL)),
    ADD CONSTRAINT auth_provider_native_confirmation_version CHECK (
        native_confirmation_configuration_version IS NULL OR
        (native_confirmation_configuration_version > 0 AND
         native_confirmation_configuration_version <= configuration_version));
UPDATE auth_provider_settings SET health_available = false, health_checked_at = NULL,
    health_reason = CASE WHEN enabled THEN 'delivery_unavailable' ELSE 'disabled' END;

-- This RBAC-only projection adds timestamps, never credential ciphertext or secrets.
DROP FUNCTION admin_get_auth_provider_config(uuid, varchar);

CREATE OR REPLACE FUNCTION admin_get_auth_provider_config(p_actor uuid, p_provider varchar)
RETURNS TABLE (
    enabled boolean, bot_username varchar, mini_app_url varchar,
    token_configured boolean, token_fingerprint varchar,
    verified_bot_id varchar, verified_bot_name varchar, token_verified_at timestamptz,
    configuration_version bigint, updated_at timestamptz,
    webhook_url varchar, webhook_verified_at timestamptz, webhook_last_error varchar,
    native_confirmation_configuration_version bigint, native_confirmation_verified_at timestamptz
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
        s.webhook_verified_at, s.webhook_last_error,
        s.native_confirmation_configuration_version, s.native_confirmation_verified_at
      FROM public.auth_provider_settings s WHERE s.provider = p_provider;
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_auth_provider_config(
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
        webhook_verified_at = NULL, webhook_last_error = NULL,
        native_confirmation_configuration_version = NULL, native_confirmation_verified_at = NULL
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

-- Provider ownership is checked outside PostgreSQL before writes. Bind that
-- check to the exact local version under the same lock as all legacy writers.
CREATE FUNCTION admin_set_auth_provider_config(
    p_actor uuid, p_provider varchar, p_enabled boolean, p_bot_username varchar,
    p_mini_app_url varchar, p_token_action varchar, p_ciphertext varchar,
    p_iv varchar, p_tag varchar, p_fingerprint varchar, p_bot_id varchar,
    p_bot_name varchar, p_reason varchar, p_request_id varchar, p_expected_version bigint
) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_current bigint;
BEGIN
    IF public.admin_authorized_role(p_actor, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'provider configuration denied' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    SELECT s.configuration_version INTO v_current FROM public.auth_provider_settings s
     WHERE s.provider = p_provider FOR UPDATE;
    IF p_expected_version IS NULL OR v_current IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'provider configuration changed' USING ERRCODE = '40001';
    END IF;
    RETURN public.admin_set_auth_provider_config(p_actor, p_provider, p_enabled,
        p_bot_username, p_mini_app_url, p_token_action, p_ciphertext, p_iv, p_tag,
        p_fingerprint, p_bot_id, p_bot_name, p_reason, p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION auth_provider_health_set(
    p_provider varchar, p_version bigint, p_available boolean, p_reason varchar
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.auth_provider_settings SET
        health_available = p_available AND enabled
            AND COALESCE(native_confirmation_configuration_version = configuration_version, false)
            AND native_confirmation_verified_at IS NOT NULL,
        health_reason = CASE WHEN NOT enabled THEN 'disabled'
            WHEN p_available AND (native_confirmation_configuration_version IS DISTINCT FROM configuration_version
                OR native_confirmation_verified_at IS NULL) THEN 'delivery_unavailable'
            ELSE p_reason END,
        health_checked_at = now()
     WHERE provider = p_provider AND configuration_version = p_version
       AND p_reason IN ('ready', 'disabled', 'not_configured',
           'invalid_token', 'delivery_unavailable', 'unavailable')
$$;

-- Only a successful, current-version browser consume of native callback proof
-- records delivery evidence. Raw Mini App proof and start/approve alone do not.

CREATE OR REPLACE FUNCTION auth_provider_pairing_consume(
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
    -- An anonymous login/register attempt cannot replace an Account session
    -- established in the same browser while the bot confirmation was pending.
    IF v_pair.purpose <> 'link' AND p_current_account IS NOT NULL THEN
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
            v_pair.assertion_id, v_pair.auth_date, v_pair.provider_username, v_pair.provider_display_name,
            v_pair.configuration_version
        );
        IF v_link NOT IN ('linked', 'already_linked') THEN
            RETURN QUERY SELECT v_link, NULL::uuid, NULL::varchar, NULL::varchar; RETURN;
        END IF;
        UPDATE public.auth_provider_pairings SET consumed_at = now() WHERE id = v_pair.id;
        UPDATE public.auth_provider_settings SET
            native_confirmation_configuration_version = v_pair.configuration_version,
            native_confirmation_verified_at = now()
         WHERE provider = p_provider AND configuration_version = v_pair.configuration_version;
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
    UPDATE public.auth_provider_settings SET
        native_confirmation_configuration_version = v_pair.configuration_version,
        native_confirmation_verified_at = now()
     WHERE provider = p_provider AND configuration_version = v_pair.configuration_version;
    UPDATE public.account_external_identities SET last_used_at = now() WHERE id = v_identity.id;
    INSERT INTO public.account_external_identity_events(identity_id, account_id, provider, event)
    VALUES (v_identity.id, v_identity.account_id, p_provider, 'used');
    RETURN QUERY SELECT 'authenticated'::varchar, v_identity.account_id, NULL::varchar, NULL::varchar;
END;
$$;

CREATE OR REPLACE FUNCTION auth_provider_pairing_register(
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
        p_policy_version, p_session_hash, p_ttl_hours, v_pair.configuration_version
      ) registered;
    IF v_result = 'authenticated' THEN
        UPDATE public.auth_provider_pairings SET consumed_at = now() WHERE id = v_pair.id;
        UPDATE public.auth_provider_settings SET
            native_confirmation_configuration_version = v_pair.configuration_version,
            native_confirmation_verified_at = now()
         WHERE provider = p_provider AND configuration_version = v_pair.configuration_version;
    END IF;
    RETURN QUERY SELECT v_result, v_account;
END;
$$;

-- Last-method decisions also check the native receipt at the final SQL boundary.
CREATE OR REPLACE FUNCTION auth_provider_status(p_provider varchar, p_account uuid)
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
             AND provider_settings.native_confirmation_configuration_version = provider_settings.configuration_version
             AND provider_settings.native_confirmation_verified_at IS NOT NULL
             AND provider_settings.health_checked_at > now() - interval '1 minute'
            WHERE other_identity.account_id = a.id AND other_identity.provider <> p_provider
              AND other_identity.revoked_at IS NULL AND other_identity.verified_at IS NOT NULL
        )
      FROM public.accounts a
      LEFT JOIN public.account_external_identities i
        ON i.account_id = a.id AND i.provider = p_provider AND i.revoked_at IS NULL
     WHERE a.id = p_account AND a.status = 'active'
$$;

CREATE OR REPLACE FUNCTION auth_provider_revoke(
    p_provider varchar, p_account uuid, p_actor uuid, p_kind varchar,
    p_reason varchar, p_request_id varchar, p_alternative_configuration_version bigint DEFAULT NULL
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
    IF p_kind = 'self' THEN
        -- A last-method decision and a concurrent configuration update must be
        -- serialized for both providers. Use a fixed order for concurrent unlinks.
        PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:max', 0));
        PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:telegram', 0));
    ELSE
        PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:' || p_provider, 0));
    END IF;
    SELECT a.password_configured INTO v_password FROM public.accounts a
     WHERE a.id = p_account FOR UPDATE;
    SELECT i.id, i.subject INTO v_identity, v_subject FROM public.account_external_identities i
     WHERE i.provider = p_provider AND i.account_id = p_account
       AND (i.revoked_at IS NULL OR p_kind = 'admin') FOR UPDATE;
    IF v_identity IS NULL THEN RETURN 'not_linked'; END IF;
    IF p_kind = 'self' AND NOT COALESCE(v_password, false) AND NOT EXISTS (
        SELECT 1 FROM public.account_external_identities i
        JOIN public.auth_provider_settings s ON s.provider = i.provider
         AND s.enabled AND s.health_available
         AND s.native_confirmation_configuration_version = s.configuration_version
         AND s.native_confirmation_verified_at IS NOT NULL AND s.health_checked_at > now() - interval '1 minute'
         AND s.configuration_version = p_alternative_configuration_version
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

REVOKE ALL ON FUNCTION admin_get_auth_provider_config(uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_auth_provider_config(uuid, varchar) TO asalab_app;
REVOKE ALL ON FUNCTION admin_set_auth_provider_config(uuid, varchar, boolean, varchar, varchar,
    varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_auth_provider_config(uuid, varchar, boolean, varchar, varchar,
    varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, bigint) TO asalab_app;
