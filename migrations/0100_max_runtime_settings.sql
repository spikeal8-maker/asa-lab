-- Runtime-managed MAX configuration.
--
-- The bot token is encrypted by the API before it crosses this boundary. The
-- database stores only ciphertext and never exposes it through administration
-- reads or audit events.

CREATE TABLE max_runtime_settings (
    singleton_key        boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
    enabled              boolean NOT NULL DEFAULT false,
    bot_username         varchar(64) NOT NULL DEFAULT 'id231408577954_3_bot'
                         CHECK (bot_username ~ '^[A-Za-z0-9_]{3,64}$'),
    mini_app_url         varchar(2048) NOT NULL DEFAULT 'https://asa-lab.ru/max-login'
                         CHECK (mini_app_url ~ '^https://'),
    token_ciphertext     varchar(2048),
    token_iv             varchar(64),
    token_auth_tag       varchar(64),
    token_fingerprint    varchar(16),
    verified_bot_id      varchar(64),
    verified_bot_name    varchar(128),
    token_verified_at    timestamptz,
    configuration_version bigint NOT NULL DEFAULT 1,
    updated_by_principal uuid REFERENCES principals(id),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (token_ciphertext IS NULL AND token_iv IS NULL AND token_auth_tag IS NULL
         AND token_fingerprint IS NULL AND token_verified_at IS NULL)
        OR
        (token_ciphertext IS NOT NULL AND token_iv IS NOT NULL AND token_auth_tag IS NOT NULL
         AND token_fingerprint IS NOT NULL AND token_verified_at IS NOT NULL)
    ),
    CHECK (NOT enabled OR token_ciphertext IS NOT NULL)
);

INSERT INTO max_runtime_settings (singleton_key) VALUES (true);

ALTER TABLE max_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON max_runtime_settings FROM PUBLIC;
REVOKE ALL ON max_runtime_settings FROM asalab_app;

CREATE FUNCTION auth_max_runtime_config()
RETURNS TABLE (
    enabled boolean,
    bot_username varchar,
    mini_app_url varchar,
    token_ciphertext varchar,
    token_iv varchar,
    token_auth_tag varchar,
    token_fingerprint varchar,
    verified_bot_id varchar,
    verified_bot_name varchar,
    token_verified_at timestamptz,
    configuration_version bigint,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT settings.enabled,
           settings.bot_username,
           settings.mini_app_url,
           settings.token_ciphertext,
           settings.token_iv,
           settings.token_auth_tag,
           settings.token_fingerprint,
           settings.verified_bot_id,
           settings.verified_bot_name,
           settings.token_verified_at,
           settings.configuration_version,
           settings.updated_at
      FROM public.max_runtime_settings settings
     WHERE settings.singleton_key = true
$$;

CREATE FUNCTION admin_get_max_runtime_config(p_actor_principal_id uuid)
RETURNS TABLE (
    enabled boolean,
    bot_username varchar,
    mini_app_url varchar,
    token_configured boolean,
    token_fingerprint varchar,
    verified_bot_id varchar,
    verified_bot_name varchar,
    token_verified_at timestamptz,
    configuration_version bigint,
    updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative MAX configuration denied' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT settings.enabled,
           settings.bot_username,
           settings.mini_app_url,
           settings.token_ciphertext IS NOT NULL,
           settings.token_fingerprint,
           settings.verified_bot_id,
           settings.verified_bot_name,
           settings.token_verified_at,
           settings.configuration_version,
           settings.updated_at
      FROM public.max_runtime_settings settings
     WHERE settings.singleton_key = true;
END;
$$;

CREATE FUNCTION admin_set_max_runtime_config(
    p_actor_principal_id uuid,
    p_enabled boolean,
    p_bot_username varchar,
    p_mini_app_url varchar,
    p_token_action varchar,
    p_token_ciphertext varchar,
    p_token_iv varchar,
    p_token_auth_tag varchar,
    p_token_fingerprint varchar,
    p_verified_bot_id varchar,
    p_verified_bot_name varchar,
    p_reason varchar,
    p_request_id varchar
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_before_version bigint;
    v_after_version bigint;
    v_token_configured boolean;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative MAX configuration denied' USING ERRCODE = '42501';
    END IF;
    IF p_bot_username !~ '^[A-Za-z0-9_]{3,64}$'
       OR length(p_mini_app_url) NOT BETWEEN 12 AND 2048
       OR p_mini_app_url !~ '^https://'
       OR p_token_action NOT IN ('keep', 'replace', 'clear')
       OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid MAX configuration request' USING ERRCODE = '22023';
    END IF;
    IF p_token_action = 'replace' AND (
        p_token_ciphertext IS NULL OR length(p_token_ciphertext) NOT BETWEEN 1 AND 2048
        OR p_token_iv IS NULL OR length(p_token_iv) NOT BETWEEN 1 AND 64
        OR p_token_auth_tag IS NULL OR length(p_token_auth_tag) NOT BETWEEN 1 AND 64
        OR p_token_fingerprint IS NULL OR length(p_token_fingerprint) NOT BETWEEN 8 AND 16
        OR p_verified_bot_id IS NULL OR length(p_verified_bot_id) NOT BETWEEN 1 AND 64
    ) THEN
        RAISE EXCEPTION 'invalid encrypted MAX credential' USING ERRCODE = '22023';
    END IF;

    SELECT settings.configuration_version,
           CASE p_token_action
               WHEN 'replace' THEN true
               WHEN 'clear' THEN false
               ELSE settings.token_ciphertext IS NOT NULL
           END
      INTO v_before_version, v_token_configured
      FROM public.max_runtime_settings settings
     WHERE settings.singleton_key = true
     FOR UPDATE;

    IF p_enabled AND NOT v_token_configured THEN
        RAISE EXCEPTION 'MAX cannot be enabled without a verified token' USING ERRCODE = '22023';
    END IF;

    UPDATE public.max_runtime_settings settings
       SET enabled = p_enabled,
           bot_username = p_bot_username,
           mini_app_url = p_mini_app_url,
           token_ciphertext = CASE p_token_action
               WHEN 'replace' THEN p_token_ciphertext WHEN 'clear' THEN NULL
               ELSE settings.token_ciphertext END,
           token_iv = CASE p_token_action
               WHEN 'replace' THEN p_token_iv WHEN 'clear' THEN NULL ELSE settings.token_iv END,
           token_auth_tag = CASE p_token_action
               WHEN 'replace' THEN p_token_auth_tag WHEN 'clear' THEN NULL
               ELSE settings.token_auth_tag END,
           token_fingerprint = CASE p_token_action
               WHEN 'replace' THEN p_token_fingerprint WHEN 'clear' THEN NULL
               ELSE settings.token_fingerprint END,
           verified_bot_id = CASE p_token_action
               WHEN 'replace' THEN p_verified_bot_id WHEN 'clear' THEN NULL
               ELSE settings.verified_bot_id END,
           verified_bot_name = CASE p_token_action
               WHEN 'replace' THEN p_verified_bot_name WHEN 'clear' THEN NULL
               ELSE settings.verified_bot_name END,
           token_verified_at = CASE p_token_action
               WHEN 'replace' THEN now() WHEN 'clear' THEN NULL ELSE settings.token_verified_at END,
           configuration_version = settings.configuration_version + 1,
           updated_by_principal = p_actor_principal_id,
           updated_at = now()
     WHERE settings.singleton_key = true
     RETURNING settings.configuration_version INTO v_after_version;

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.max_configuration.update',
        'integration', 'max',
        'admin_console', trim(p_reason), NULL,
        p_request_id, p_request_id, 'succeeded', v_before_version, v_after_version
    );
    RETURN v_after_version;
END;
$$;

REVOKE ALL ON FUNCTION auth_max_runtime_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_max_runtime_config(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_max_runtime_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar,
    varchar, varchar, varchar, varchar, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_max_runtime_config() TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_get_max_runtime_config(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_set_max_runtime_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar,
    varchar, varchar, varchar, varchar, varchar
) TO asalab_app;
