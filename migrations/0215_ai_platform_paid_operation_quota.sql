-- Platform-wide paid AI admission. Forward-only: 0214 remains immutable.
-- Count of admitted operations, not tokens, dollars or a billing guarantee.
ALTER TABLE ai_assistant_config
    ADD COLUMN paid_operations_per_hour integer NOT NULL DEFAULT 0
    CHECK (paid_operations_per_hour >= 0);

-- No conversation FK: delete/abort/failure must never refund a paid admission.
CREATE TABLE ai_paid_operation_quota (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation varchar(24) NOT NULL CHECK (operation IN ('chat', 'provider_test')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_paid_operation_quota_time_idx ON ai_paid_operation_quota (created_at);
ALTER TABLE ai_paid_operation_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_paid_operation_quota FROM PUBLIC, asalab_app;
-- Preserve known chat admissions during a forward upgrade, even if chats were deleted.
INSERT INTO ai_paid_operation_quota (operation, created_at)
    SELECT 'chat', created_at FROM ai_assistant_request_quota;

-- Private primitive: only the guarded SECURITY DEFINER entry points can call it.
CREATE FUNCTION ai_paid_operation_reserve(p_operation varchar)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_limit integer; v_now timestamptz;
BEGIN
    IF p_operation IS NULL OR p_operation NOT IN ('chat', 'provider_test') THEN
        RAISE EXCEPTION 'AI_OPERATION_INVALID' USING ERRCODE = '22023';
    END IF;
    -- Deliberately UPDATE rather than just SELECT FOR UPDATE: a stale snapshot
    -- at REPEATABLE READ/SERIALIZABLE must fail with serialization_failure,
    -- never count an old ledger. READ COMMITTED sees the preceding admission.
    -- This row also serializes admin setting changes with every admission.
    UPDATE public.ai_assistant_config c
       SET paid_operations_per_hour = c.paid_operations_per_hour
     WHERE c.singleton_key
     RETURNING c.paid_operations_per_hour INTO v_limit;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_CONFIG_UNAVAILABLE';
    END IF;
    -- Measure time after acquiring the lock, not at transaction start.
    v_now := clock_timestamp();
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

DROP FUNCTION ai_admin_get_config(uuid);
DROP FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar
);

CREATE FUNCTION ai_admin_get_config(p_principal uuid)
RETURNS TABLE (
    enabled boolean,
    provider varchar,
    model varchar,
    api_key_configured boolean,
    key_fingerprint varchar,
    configuration_version bigint,
    updated_at timestamptz,
    paid_operations_per_hour integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT c.enabled, c.provider, c.model, c.api_key_ciphertext IS NOT NULL,
           c.key_fingerprint, c.configuration_version, c.updated_at, c.paid_operations_per_hour
      FROM public.ai_assistant_config c WHERE c.singleton_key;
END;
$$;

CREATE FUNCTION ai_admin_set_config(
    p_principal uuid, p_enabled boolean, p_provider varchar, p_model varchar,
    p_action varchar, p_ciphertext varchar, p_iv varchar, p_tag varchar,
    p_fingerprint varchar, p_request_id varchar,
    p_paid_operations_per_hour integer DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_previous public.ai_assistant_config%ROWTYPE;
    v_version bigint;
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    IF p_paid_operations_per_hour < 0 THEN
        RAISE EXCEPTION 'AI_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_provider NOT IN ('openai', 'deepseek')
       OR NOT (
          (p_provider = 'openai' AND p_model IN ('gpt-5-mini', 'gpt-4.1-mini'))
          OR (p_provider = 'deepseek' AND p_model = 'deepseek-chat')
       )
       OR p_action NOT IN ('keep', 'replace', 'clear')
       OR char_length(p_request_id) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'AI_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_action = 'replace' AND (
        p_ciphertext IS NULL OR char_length(p_ciphertext) NOT BETWEEN 8 AND 4096
        OR p_iv IS NULL OR char_length(p_iv) NOT BETWEEN 12 AND 64
        OR p_tag IS NULL OR char_length(p_tag) NOT BETWEEN 16 AND 64
        OR p_fingerprint IS NULL OR char_length(p_fingerprint) NOT BETWEEN 8 AND 16
    ) THEN
        RAISE EXCEPTION 'AI_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO STRICT v_previous
      FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
    IF p_provider <> v_previous.provider AND p_action <> 'replace' THEN
        RAISE EXCEPTION 'AI_PROVIDER_REQUIRES_NEW_KEY' USING ERRCODE = '22023';
    END IF;
    IF p_enabled AND (p_action = 'clear'
        OR (p_action = 'keep' AND v_previous.api_key_ciphertext IS NULL)) THEN
        RAISE EXCEPTION 'AI_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    UPDATE public.ai_assistant_config c SET
        enabled = p_enabled, provider = p_provider, model = p_model,
        paid_operations_per_hour = COALESCE(p_paid_operations_per_hour, c.paid_operations_per_hour),
        api_key_ciphertext = CASE p_action
            WHEN 'replace' THEN p_ciphertext WHEN 'clear' THEN NULL
            ELSE c.api_key_ciphertext END,
        api_key_iv = CASE p_action
            WHEN 'replace' THEN p_iv WHEN 'clear' THEN NULL ELSE c.api_key_iv END,
        api_key_auth_tag = CASE p_action
            WHEN 'replace' THEN p_tag WHEN 'clear' THEN NULL ELSE c.api_key_auth_tag END,
        key_fingerprint = CASE p_action
            WHEN 'replace' THEN p_fingerprint WHEN 'clear' THEN NULL ELSE c.key_fingerprint END,
        configuration_version = c.configuration_version + 1,
        updated_by_principal = p_principal,
        updated_at = now()
      WHERE c.singleton_key
      RETURNING c.configuration_version INTO v_version;
    PERFORM public.admin_append_audit_event(
        p_principal, 'platform', NULL, 'administration.ai_configuration.update',
        'integration', p_provider, 'admin_console', 'Настройка ИИ-провайдера',
        NULL, p_request_id, p_request_id, 'succeeded',
        v_previous.configuration_version, v_version
    );
    RETURN v_version;
END;
$$;

-- Include the configuration version in the same snapshot as the decrypted key.
DROP FUNCTION ai_runtime_config();
CREATE FUNCTION ai_runtime_config()
RETURNS TABLE (
    enabled boolean, provider varchar, model varchar,
    api_key_ciphertext varchar, api_key_iv varchar, api_key_auth_tag varchar,
    configuration_version bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.enabled, c.provider, c.model,
           c.api_key_ciphertext, c.api_key_iv, c.api_key_auth_tag, c.configuration_version
      FROM public.ai_assistant_config c WHERE c.singleton_key
$$;
REVOKE ALL ON FUNCTION ai_runtime_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_runtime_config() TO asalab_app;

CREATE FUNCTION ai_chat_begin_paid(
    p_principal uuid, p_thread uuid, p_request uuid, p_text varchar, p_expected_version bigint
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account uuid;
    v_existing_text varchar;
    v_existing_thread uuid;
    v_title varchar(120);
    v_config public.ai_assistant_config%ROWTYPE;
BEGIN
    IF char_length(trim(p_text)) NOT BETWEEN 1 AND 3000 THEN
        RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_account FROM public.principals p
     WHERE p.id = p_principal AND p.kind = 'account';
    IF v_account IS NULL THEN
        RAISE EXCEPTION 'AI_ACCOUNT_REQUIRED' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_account::text, 7312));
    -- Replays are resolved before the busy/quota checks and never trigger another provider call.
    SELECT m.thread_id, m.content INTO v_existing_thread, v_existing_text
      FROM public.ai_assistant_messages m
     WHERE m.account_id = v_account AND m.request_id = p_request AND m.role = 'user';
    IF FOUND THEN
        IF v_existing_thread <> p_thread OR v_existing_text <> trim(p_text) THEN
            RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023';
        END IF;
        RETURN false;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.ai_assistant_request_quota q
         WHERE q.account_id = v_account AND q.request_id = p_request
    ) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.ai_assistant_request_quota q
         WHERE q.account_id = v_account
           AND q.created_at > now() - interval '1 hour') >= 30 THEN
        RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE = 'P0001';
    END IF;
    -- Serialize settings changes with admission. Replays above remain free even
    -- when their runtime version is stale or the provider has been disabled.
    SELECT * INTO STRICT v_config
      FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
    IF p_expected_version IS DISTINCT FROM v_config.configuration_version THEN
        RAISE EXCEPTION 'AI_CONFIG_CHANGED';
    END IF;
    IF NOT v_config.enabled OR v_config.api_key_ciphertext IS NULL
       OR v_config.api_key_iv IS NULL OR v_config.api_key_auth_tag IS NULL THEN
        RAISE EXCEPTION 'AI_DISABLED';
    END IF;
    -- Replays above return before this shared, non-refundable reservation.
    -- A later failure rolls back admission and the messages together.
    PERFORM public.ai_paid_operation_reserve('chat');
    v_title := left(regexp_replace(trim(p_text), E'[\r\n]+', ' ', 'g'), 110);
    UPDATE public.ai_assistant_threads t SET
        busy_until = clock_timestamp() + interval '85 seconds',
        active_request_id = p_request,
        title = CASE WHEN t.title = 'Новый чат' THEN v_title ELSE t.title END,
        updated_at = clock_timestamp()
      WHERE t.id = p_thread AND t.account_id = v_account
        AND (t.busy_until IS NULL OR t.busy_until < clock_timestamp());
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.ai_assistant_messages
        (thread_id, account_id, request_id, role, content)
      VALUES (p_thread, v_account, p_request, 'user', trim(p_text));
    INSERT INTO public.ai_assistant_request_quota (account_id, request_id)
      VALUES (v_account, p_request);
    RETURN true;
END;
$$;

-- A new API requires this entry point: if 0215 has not been applied, its call
-- fails before any fetch instead of silently using 0214's account-only quota.
REVOKE ALL ON FUNCTION ai_chat_begin_paid(uuid, uuid, uuid, varchar, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_chat_begin_paid(uuid, uuid, uuid, varchar, bigint) TO asalab_app;

-- Preserve the old SQL entry point for legacy workers, including the shared
-- quota and enabled/key guards. New workers must supply their runtime version.
CREATE OR REPLACE FUNCTION ai_chat_begin(p_principal uuid, p_thread uuid, p_request uuid, p_text varchar)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.ai_chat_begin_paid(p_principal, p_thread, p_request, p_text,
        (SELECT c.configuration_version FROM public.ai_assistant_config c WHERE c.singleton_key))
$$;

-- Every provider test is a fresh paid operation, including failures. There is no
-- browser-controlled free-test exception and no automatic retry/refund.
CREATE FUNCTION ai_admin_test_begin(p_principal uuid, p_expected_version bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_version bigint;
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    SELECT c.configuration_version INTO STRICT v_version
      FROM public.ai_assistant_config c WHERE c.singleton_key FOR UPDATE;
    IF p_expected_version IS DISTINCT FROM v_version THEN
        RAISE EXCEPTION 'AI_CONFIG_CHANGED';
    END IF;
    PERFORM public.ai_paid_operation_reserve('provider_test');
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION ai_admin_test_begin(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_admin_test_begin(uuid, bigint) TO asalab_app;
REVOKE ALL ON FUNCTION ai_admin_get_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_admin_get_config(uuid) TO asalab_app;
REVOKE ALL ON FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar, integer
) TO asalab_app;
-- CREATE OR REPLACE preserves the existing chat function's grants.
