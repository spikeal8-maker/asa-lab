-- Forward-only provider migration. Historical messages, admission ledgers and 0214/0215 stay intact.
-- Catalog source: apps/api/src/ai-model-catalog.ts (official documentation checked 2026-10-19).
-- These private SQL guards are a closed persistence/admission backstop, checked against that catalog.
CREATE FUNCTION ai_model_provider_matches(p_provider varchar, p_model varchar)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT COALESCE(
        (p_provider = 'openai' AND p_model IN ('gpt-6-luna', 'gpt-5-mini', 'gpt-4.1-mini'))
        OR (p_provider = 'deepseek' AND p_model IN ('deepseek-flash', 'deepseek-v4-pro')),
        false)
$$;
REVOKE ALL ON FUNCTION ai_model_provider_matches(varchar, varchar) FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_model_available(p_provider varchar, p_model varchar, p_at timestamptz)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.ai_model_provider_matches(p_provider, p_model) AND p_at IS NOT NULL
       AND CASE p_model
           WHEN 'gpt-5-mini' THEN p_at < TIMESTAMPTZ '2026-12-11 00:00:00+00'
           WHEN 'gpt-4.1-mini' THEN p_at < TIMESTAMPTZ '2027-01-14 00:00:00+00'
           ELSE true END
$$;
REVOKE ALL ON FUNCTION ai_model_available(varchar, varchar, timestamptz) FROM PUBLIC, asalab_app;

ALTER TABLE ai_assistant_config DROP CONSTRAINT ai_assistant_config_check;
ALTER TABLE ai_assistant_config ALTER COLUMN model SET DEFAULT 'gpt-6-luna';
ALTER TABLE ai_assistant_config ADD COLUMN migrated_from_model varchar(64);

-- Only an untouched installation takes a new default. A configured, still valid OpenAI choice stays.
UPDATE ai_assistant_config SET model = 'gpt-6-luna'
 WHERE provider = 'openai' AND model = 'gpt-5-mini' AND configuration_version = 1
   AND NOT enabled AND api_key_ciphertext IS NULL;

-- deepseek-chat was retired on 2026-07-24. Preserve its exact encrypted key, expose the change,
-- invalidate stale paid tests/requests and require a deliberate new enablement. This is not a test.
UPDATE ai_assistant_config SET
    migrated_from_model = model, model = 'deepseek-flash', enabled = false,
    configuration_version = configuration_version + 1, updated_at = now()
 WHERE provider = 'deepseek' AND model = 'deepseek-chat';

ALTER TABLE ai_assistant_config ADD CONSTRAINT ai_assistant_config_model_catalog_check
    CHECK (public.ai_model_provider_matches(provider, model));

CREATE TABLE ai_provider_settings (
    provider varchar(24) PRIMARY KEY CHECK (provider IN ('openai', 'deepseek')),
    model varchar(64) NOT NULL,
    api_key_ciphertext varchar(4096),
    api_key_iv varchar(64),
    api_key_auth_tag varchar(64),
    key_fingerprint varchar(16),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (public.ai_model_provider_matches(provider, model)),
    CHECK (
        (api_key_ciphertext IS NULL AND api_key_iv IS NULL
         AND api_key_auth_tag IS NULL AND key_fingerprint IS NULL)
        OR (api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL
         AND api_key_auth_tag IS NOT NULL AND key_fingerprint IS NOT NULL)
    )
);
ALTER TABLE ai_provider_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_provider_settings FROM PUBLIC, asalab_app;

INSERT INTO ai_provider_settings (provider, model)
    VALUES ('openai', 'gpt-6-luna'), ('deepseek', 'deepseek-flash');
UPDATE ai_provider_settings p SET
    model = c.model, api_key_ciphertext = c.api_key_ciphertext,
    api_key_iv = c.api_key_iv, api_key_auth_tag = c.api_key_auth_tag,
    key_fingerprint = c.key_fingerprint, updated_at = c.updated_at
 FROM ai_assistant_config c WHERE c.singleton_key AND p.provider = c.provider;

DROP FUNCTION ai_admin_get_config(uuid);
CREATE FUNCTION ai_admin_get_config(p_principal uuid)
RETURNS TABLE (
    enabled boolean, provider varchar, model varchar, api_key_configured boolean,
    key_fingerprint varchar, configuration_version bigint, updated_at timestamptz,
    paid_operations_per_hour integer, provider_configurations jsonb, migrated_from_model varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT c.enabled, c.provider, c.model, c.api_key_ciphertext IS NOT NULL,
           c.key_fingerprint, c.configuration_version, c.updated_at, c.paid_operations_per_hour,
           (SELECT jsonb_agg(jsonb_build_object(
               'provider', p.provider, 'model', p.model,
               'apiKeyConfigured', p.api_key_ciphertext IS NOT NULL,
               'keyFingerprint', p.key_fingerprint, 'updatedAt', p.updated_at
           ) ORDER BY p.provider) FROM public.ai_provider_settings p),
           c.migrated_from_model
      FROM public.ai_assistant_config c WHERE c.singleton_key;
END;
$$;
REVOKE ALL ON FUNCTION ai_admin_get_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_admin_get_config(uuid) TO asalab_app;

DROP FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, integer
);
CREATE FUNCTION ai_admin_set_config(
    p_principal uuid, p_enabled boolean, p_provider varchar, p_model varchar,
    p_action varchar, p_ciphertext varchar, p_iv varchar, p_tag varchar,
    p_fingerprint varchar, p_request_id varchar,
    p_paid_operations_per_hour integer DEFAULT NULL, p_expected_version bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_previous public.ai_assistant_config%ROWTYPE;
    v_target public.ai_provider_settings%ROWTYPE;
    v_version bigint;
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    IF p_enabled IS NULL OR p_paid_operations_per_hour < 0
       OR NOT public.ai_model_provider_matches(p_provider, p_model)
       OR p_action IS NULL OR p_action NOT IN ('keep', 'replace', 'clear')
       OR p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'AI_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT public.ai_model_available(p_provider, p_model, clock_timestamp()) THEN
        RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE';
    END IF;
    IF p_action = 'replace' AND (
        p_ciphertext IS NULL OR char_length(p_ciphertext) NOT BETWEEN 8 AND 4096
        OR p_iv IS NULL OR char_length(p_iv) NOT BETWEEN 12 AND 64
        OR p_tag IS NULL OR char_length(p_tag) NOT BETWEEN 16 AND 64
        OR p_fingerprint IS NULL OR char_length(p_fingerprint) NOT BETWEEN 8 AND 16
    ) THEN
        RAISE EXCEPTION 'AI_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;

    -- The existing config row remains the common settings/admission serialization lock.
    SELECT * INTO STRICT v_previous
      FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
    IF p_expected_version IS NOT NULL
       AND p_expected_version IS DISTINCT FROM v_previous.configuration_version THEN
        RAISE EXCEPTION 'AI_CONFIG_CHANGED';
    END IF;
    SELECT * INTO STRICT v_target FROM public.ai_provider_settings
     WHERE provider = p_provider FOR UPDATE;
    IF p_provider <> v_previous.provider AND p_action <> 'replace'
       AND v_target.api_key_ciphertext IS NULL THEN
        RAISE EXCEPTION 'AI_PROVIDER_REQUIRES_NEW_KEY' USING ERRCODE = '22023';
    END IF;
    IF p_enabled AND (p_action = 'clear'
        OR (p_action = 'keep' AND v_target.api_key_ciphertext IS NULL)) THEN
        RAISE EXCEPTION 'AI_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    UPDATE public.ai_provider_settings p SET
        model = p_model,
        api_key_ciphertext = CASE p_action
            WHEN 'replace' THEN p_ciphertext WHEN 'clear' THEN NULL ELSE p.api_key_ciphertext END,
        api_key_iv = CASE p_action
            WHEN 'replace' THEN p_iv WHEN 'clear' THEN NULL ELSE p.api_key_iv END,
        api_key_auth_tag = CASE p_action
            WHEN 'replace' THEN p_tag WHEN 'clear' THEN NULL ELSE p.api_key_auth_tag END,
        key_fingerprint = CASE p_action
            WHEN 'replace' THEN p_fingerprint WHEN 'clear' THEN NULL ELSE p.key_fingerprint END,
        updated_at = now()
     WHERE p.provider = p_provider RETURNING * INTO v_target;

    -- Compatibility projection for existing runtime/admission entry points. Both stores change
    -- in one transaction; switching or clearing a provider never deletes another provider's slot.
    UPDATE public.ai_assistant_config c SET
        enabled = p_enabled, provider = p_provider, model = p_model,
        paid_operations_per_hour = COALESCE(p_paid_operations_per_hour, c.paid_operations_per_hour),
        api_key_ciphertext = v_target.api_key_ciphertext, api_key_iv = v_target.api_key_iv,
        api_key_auth_tag = v_target.api_key_auth_tag, key_fingerprint = v_target.key_fingerprint,
        configuration_version = c.configuration_version + 1,
        migrated_from_model = NULL, updated_by_principal = p_principal, updated_at = now()
     WHERE c.singleton_key RETURNING c.configuration_version INTO v_version;
    PERFORM public.admin_append_audit_event(
        p_principal, 'platform', NULL, 'administration.ai_configuration.update',
        'integration', p_provider, 'admin_console', 'Настройка ИИ-провайдера',
        NULL, p_request_id, p_request_id, 'succeeded',
        v_previous.configuration_version, v_version
    );
    RETURN v_version;
END;
$$;
REVOKE ALL ON FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, integer, bigint
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, integer, bigint
) TO asalab_app;

-- Keep quota accounting unchanged, adding only a model-lifecycle guard before paid admission.
-- Legacy workers must not charge an operation against a model past its announced shutdown date.
CREATE OR REPLACE FUNCTION ai_paid_operation_reserve(p_operation varchar)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_limit integer; v_now timestamptz; v_provider varchar; v_model varchar;
BEGIN
    IF p_operation IS NULL OR p_operation NOT IN ('chat', 'provider_test') THEN
        RAISE EXCEPTION 'AI_OPERATION_INVALID' USING ERRCODE = '22023';
    END IF;
    UPDATE public.ai_assistant_config c
       SET paid_operations_per_hour = c.paid_operations_per_hour
     WHERE c.singleton_key
     RETURNING c.paid_operations_per_hour, c.provider, c.model INTO v_limit, v_provider, v_model;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_CONFIG_UNAVAILABLE';
    END IF;
    v_now := clock_timestamp();
    IF NOT public.ai_model_available(v_provider, v_model, v_now) THEN
        RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE';
    END IF;
    IF v_limit = 0 OR (
        SELECT count(*) FROM public.ai_paid_operation_quota q
         WHERE q.created_at > v_now - interval '1 hour'
    ) >= v_limit THEN
        RAISE EXCEPTION 'AI_PLATFORM_QUOTA_EXHAUSTED';
    END IF;
    INSERT INTO public.ai_paid_operation_quota (operation, created_at)
        VALUES (p_operation, v_now);
END;
$$;
REVOKE ALL ON FUNCTION ai_paid_operation_reserve(varchar) FROM PUBLIC, asalab_app;
