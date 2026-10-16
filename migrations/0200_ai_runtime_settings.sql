-- Runtime-managed AI provider configuration.
--
-- The DeepSeek API key is encrypted by the API before it crosses this boundary.
-- Administration reads expose only status and a short fingerprint, never the key.

CREATE TABLE ai_runtime_settings (
    singleton_key          boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
    provider               varchar(32) NOT NULL DEFAULT 'deepseek'
                           CHECK (provider = 'deepseek'),
    enabled                boolean NOT NULL DEFAULT false,
    api_key_ciphertext     varchar(4096),
    api_key_iv             varchar(64),
    api_key_auth_tag       varchar(64),
    key_fingerprint        varchar(16),
    configuration_version  bigint NOT NULL DEFAULT 1,
    updated_by_principal   uuid REFERENCES principals(id),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (api_key_ciphertext IS NULL AND api_key_iv IS NULL
         AND api_key_auth_tag IS NULL AND key_fingerprint IS NULL)
        OR
        (api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL
         AND api_key_auth_tag IS NOT NULL AND key_fingerprint IS NOT NULL)
    ),
    CHECK (NOT enabled OR api_key_ciphertext IS NOT NULL)
);

INSERT INTO ai_runtime_settings (singleton_key) VALUES (true);

ALTER TABLE ai_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_runtime_settings FROM PUBLIC;
REVOKE ALL ON ai_runtime_settings FROM asalab_app;

CREATE FUNCTION ai_runtime_config()
RETURNS TABLE (
    enabled boolean,
    provider varchar,
    api_key_ciphertext varchar,
    api_key_iv varchar,
    api_key_auth_tag varchar,
    key_fingerprint varchar,
    configuration_version bigint,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT settings.enabled,
           settings.provider,
           settings.api_key_ciphertext,
           settings.api_key_iv,
           settings.api_key_auth_tag,
           settings.key_fingerprint,
           settings.configuration_version,
           settings.updated_at
      FROM public.ai_runtime_settings settings
     WHERE settings.singleton_key = true
$$;

CREATE FUNCTION admin_get_ai_runtime_config(p_actor_principal_id uuid)
RETURNS TABLE (
    enabled boolean,
    provider varchar,
    api_key_configured boolean,
    key_fingerprint varchar,
    configuration_version bigint,
    updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative AI configuration denied' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT settings.enabled,
           settings.provider,
           settings.api_key_ciphertext IS NOT NULL,
           settings.key_fingerprint,
           settings.configuration_version,
           settings.updated_at
      FROM public.ai_runtime_settings settings
     WHERE settings.singleton_key = true;
END;
$$;

CREATE FUNCTION admin_set_ai_runtime_config(
    p_actor_principal_id uuid,
    p_enabled boolean,
    p_key_action varchar,
    p_api_key_ciphertext varchar,
    p_api_key_iv varchar,
    p_api_key_auth_tag varchar,
    p_key_fingerprint varchar,
    p_reason varchar,
    p_request_id varchar
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_before_version bigint;
    v_after_version bigint;
    v_key_configured boolean;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative AI configuration denied' USING ERRCODE = '42501';
    END IF;
    IF p_key_action NOT IN ('keep', 'replace', 'clear')
       OR length(trim(p_reason)) NOT BETWEEN 3 AND 500
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid AI configuration request' USING ERRCODE = '22023';
    END IF;
    IF p_key_action = 'replace' AND (
        p_api_key_ciphertext IS NULL OR length(p_api_key_ciphertext) NOT BETWEEN 1 AND 4096
        OR p_api_key_iv IS NULL OR length(p_api_key_iv) NOT BETWEEN 1 AND 64
        OR p_api_key_auth_tag IS NULL OR length(p_api_key_auth_tag) NOT BETWEEN 1 AND 64
        OR p_key_fingerprint IS NULL OR length(p_key_fingerprint) NOT BETWEEN 8 AND 16
    ) THEN
        RAISE EXCEPTION 'invalid encrypted AI credential' USING ERRCODE = '22023';
    END IF;

    SELECT settings.configuration_version,
           CASE p_key_action
               WHEN 'replace' THEN true
               WHEN 'clear' THEN false
               ELSE settings.api_key_ciphertext IS NOT NULL
           END
      INTO v_before_version, v_key_configured
      FROM public.ai_runtime_settings settings
     WHERE settings.singleton_key = true
     FOR UPDATE;

    IF p_enabled AND NOT v_key_configured THEN
        RAISE EXCEPTION 'AI cannot be enabled without a key' USING ERRCODE = '22023';
    END IF;

    UPDATE public.ai_runtime_settings settings
       SET enabled = p_enabled,
           api_key_ciphertext = CASE p_key_action
               WHEN 'replace' THEN p_api_key_ciphertext
               WHEN 'clear' THEN NULL
               ELSE settings.api_key_ciphertext END,
           api_key_iv = CASE p_key_action
               WHEN 'replace' THEN p_api_key_iv
               WHEN 'clear' THEN NULL
               ELSE settings.api_key_iv END,
           api_key_auth_tag = CASE p_key_action
               WHEN 'replace' THEN p_api_key_auth_tag
               WHEN 'clear' THEN NULL
               ELSE settings.api_key_auth_tag END,
           key_fingerprint = CASE p_key_action
               WHEN 'replace' THEN p_key_fingerprint
               WHEN 'clear' THEN NULL
               ELSE settings.key_fingerprint END,
           configuration_version = settings.configuration_version + 1,
           updated_by_principal = p_actor_principal_id,
           updated_at = now()
     WHERE settings.singleton_key = true
     RETURNING settings.configuration_version INTO v_after_version;

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.ai_configuration.update',
        'integration', 'deepseek',
        'admin_console', trim(p_reason), NULL,
        p_request_id, p_request_id, 'succeeded', v_before_version, v_after_version
    );
    RETURN v_after_version;
END;
$$;

REVOKE ALL ON FUNCTION ai_runtime_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_ai_runtime_config(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_ai_runtime_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION ai_runtime_config() TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_get_ai_runtime_config(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_set_ai_runtime_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar
) TO asalab_app;
