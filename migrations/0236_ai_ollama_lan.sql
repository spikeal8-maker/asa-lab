-- 0236: Ollama as a private LAN model provider.
-- Source lineage: IZO_ASA backend/app/integrations/ollama.py and its runtime controller.
-- Forward-only: keep 0214–0229 and 0230–0235 immutable; preserve cloud keys, chat rows and quota receipts.
-- The API is the only caller of the Ollama endpoint. The endpoint is validated in server code
-- before any HTTP request; SQL also restricts persisted origin syntax and keeps settings private.

CREATE OR REPLACE FUNCTION ai_model_provider_matches(p_provider varchar, p_model varchar)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT COALESCE(
        (p_provider = 'openai' AND p_model IN ('gpt-6-luna', 'gpt-5-mini', 'gpt-4.1-mini'))
        OR (p_provider = 'deepseek' AND p_model IN ('deepseek-flash', 'deepseek-v4-pro'))
        OR (p_provider = 'ollama' AND p_model = 'ollama-local'),
        false)
$$;

ALTER TABLE public.ai_assistant_config
    DROP CONSTRAINT ai_assistant_config_provider_check;
ALTER TABLE public.ai_assistant_config
    ADD CONSTRAINT ai_assistant_config_provider_check
        CHECK (provider IN ('openai','deepseek','ollama'));
ALTER TABLE public.ai_assistant_config
    DROP CONSTRAINT ai_assistant_config_check2;
ALTER TABLE public.ai_assistant_config
    ADD CONSTRAINT ai_assistant_config_enabled_check
        CHECK (NOT enabled OR provider = 'ollama' OR api_key_ciphertext IS NOT NULL);

CREATE TABLE public.ai_ollama_settings (
    singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
    base_url varchar(160) NOT NULL DEFAULT 'http://127.0.0.1:11434',
    model_name varchar(128) NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (base_url ~ '^http://[A-Za-z0-9.-]+:11434$'),
    CHECK (model_name = '' OR model_name ~ '^[A-Za-z0-9_./:-]{1,128}$')
);
INSERT INTO public.ai_ollama_settings(singleton_key) VALUES (true);
ALTER TABLE public.ai_ollama_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_ollama_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_ollama_settings FROM PUBLIC, asalab_app;

-- No cloud credential is stored for Ollama. The existing cloud provider slots
-- remain untouched and are restored by the ordinary admin provider switch.
CREATE FUNCTION public.ai_admin_ollama_get(p_principal uuid)
RETURNS TABLE (
    base_url varchar, model_name varchar, configuration_version bigint,
    active boolean, enabled boolean, updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
        IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT o.base_url, o.model_name, c.configuration_version,
               c.provider = 'ollama', c.enabled AND c.provider = 'ollama', o.updated_at
        FROM public.ai_ollama_settings o CROSS JOIN public.ai_assistant_config c
        WHERE o.singleton_key AND c.singleton_key;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_admin_ollama_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_admin_ollama_get(uuid) TO asalab_app;

CREATE FUNCTION public.ai_runtime_ollama()
RETURNS TABLE(base_url varchar, model_name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT o.base_url, o.model_name
      FROM public.ai_ollama_settings o
      JOIN public.ai_assistant_config c ON c.singleton_key
     WHERE o.singleton_key AND c.provider = 'ollama' AND c.enabled
       AND char_length(o.model_name) BETWEEN 1 AND 128
$$;
REVOKE ALL ON FUNCTION public.ai_runtime_ollama() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_runtime_ollama() TO asalab_app;

CREATE FUNCTION public.ai_admin_ollama_set(
    p_principal uuid, p_url varchar, p_model varchar,
    p_enabled boolean, p_expected_version bigint, p_request_id varchar
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_before public.ai_assistant_config%ROWTYPE;
    v_version bigint;
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
        IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    IF p_enabled IS NULL OR p_expected_version IS NULL
       OR p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 1 AND 128
       OR p_url IS NULL OR char_length(p_url) > 160
       OR p_url !~ '^http://[A-Za-z0-9.-]+:11434$'
       OR p_model IS NULL OR p_model !~ '^[A-Za-z0-9_./:-]{1,128}$' THEN
        RAISE EXCEPTION 'AI_OLLAMA_CONFIG_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO STRICT v_before FROM public.ai_assistant_config
        WHERE singleton_key FOR UPDATE;
    IF v_before.configuration_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'AI_CONFIG_CHANGED';
    END IF;
    UPDATE public.ai_ollama_settings o SET
        base_url = p_url, model_name = p_model, updated_at = now()
        WHERE o.singleton_key;
    -- Switching to Ollama never clears the encrypted OpenAI/DeepSeek slots.
    UPDATE public.ai_assistant_config c SET
        enabled = p_enabled,
        provider = 'ollama',
        model = 'ollama-local',
        api_key_ciphertext = NULL, api_key_iv = NULL,
        api_key_auth_tag = NULL, key_fingerprint = NULL,
        configuration_version = c.configuration_version + 1,
        migrated_from_model = NULL,
        updated_by_principal = p_principal, updated_at = now()
        WHERE c.singleton_key
        RETURNING c.configuration_version INTO v_version;
    PERFORM public.admin_append_audit_event(
        p_principal, 'platform', NULL, 'administration.ai_configuration.update',
        'integration', 'ollama', 'admin_console', 'Настройка Ollama LAN',
        NULL, p_request_id, p_request_id, 'succeeded',
        v_before.configuration_version, v_version
    );
    RETURN v_version;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_admin_ollama_set(uuid,varchar,varchar,boolean,bigint,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_admin_ollama_set(uuid,varchar,varchar,boolean,bigint,varchar) TO asalab_app;

-- Replays remain free, and classroom/account request quotas remain in force.
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
    -- Local GPU has no external paid provider call; user and classroom limits still apply.
    IF v_provider = 'ollama' AND p_operation IN ('chat', 'provider_test') THEN
        RETURN;
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

CREATE OR REPLACE FUNCTION ai_chat_begin_paid(
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
     WHERE p.id = p_principal;
    IF NOT public.ai_chat_owner_valid(p_principal) THEN
        RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_principal::text, 7312));
    -- Replays are resolved before the busy/quota checks and never trigger another provider call.
    SELECT m.thread_id, m.content INTO v_existing_thread, v_existing_text
      FROM public.ai_assistant_messages m
     WHERE m.owner_principal_id = p_principal AND m.request_id = p_request AND m.role = 'user';
    IF FOUND THEN
        IF v_existing_thread <> p_thread OR v_existing_text <> trim(p_text) THEN
            RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023';
        END IF;
        RETURN false;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.ai_assistant_request_quota q
         WHERE q.owner_principal_id = p_principal AND q.request_id = p_request
    ) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023';
    END IF;
    v_account:=public.ai_chat_require_generation(p_principal);
    IF (SELECT count(*) FROM public.ai_assistant_request_quota q
         WHERE q.owner_principal_id = p_principal
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
    IF NOT v_config.enabled OR (v_config.provider <> 'ollama' AND (
       v_config.api_key_ciphertext IS NULL OR v_config.api_key_iv IS NULL
       OR v_config.api_key_auth_tag IS NULL)) THEN
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
      WHERE t.id = p_thread AND t.owner_principal_id = p_principal
        AND (t.busy_until IS NULL OR t.busy_until < clock_timestamp());
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.ai_assistant_messages
        (thread_id, account_id, owner_principal_id, request_id, role, content)
      VALUES (p_thread, v_account, p_principal, p_request, 'user', trim(p_text));
    INSERT INTO public.ai_assistant_request_quota (account_id, owner_principal_id, request_id)
      VALUES (v_account, p_principal, p_request);
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION ai_text_regenerate_begin(
    p_owner uuid, p_thread uuid, p_request uuid, p_source uuid, p_expected_version bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_source public.ai_assistant_messages%ROWTYPE;
        v_config public.ai_assistant_config%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text, 7312));
    -- The same source receipt is free even after teacher revocation, archival,
    -- changed provider configuration, or a lost/interrupted upstream response.
    IF public.ai_text_regeneration_replay(p_owner, p_thread, p_request, p_source) THEN RETURN false; END IF;
    v_account := public.ai_chat_require_generation(p_owner);
    SELECT * INTO v_source FROM public.ai_assistant_messages m
    WHERE m.id = p_source AND m.thread_id = p_thread AND m.owner_principal_id = p_owner
      AND m.role = 'user' AND char_length(m.content) BETWEEN 1 AND 3000;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE = '42501'; END IF;
    IF (SELECT count(*) FROM public.ai_assistant_request_quota q
        WHERE q.owner_principal_id = p_owner AND q.created_at > now() - interval '1 hour') >= 30 THEN
        RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO STRICT v_config FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
    IF p_expected_version IS DISTINCT FROM v_config.configuration_version THEN
        RAISE EXCEPTION 'AI_CONFIG_CHANGED';
    END IF;
    IF NOT v_config.enabled OR (v_config.provider <> 'ollama' AND (
       v_config.api_key_ciphertext IS NULL OR v_config.api_key_iv IS NULL
       OR v_config.api_key_auth_tag IS NULL)) THEN
        RAISE EXCEPTION 'AI_DISABLED';
    END IF;
    PERFORM public.ai_paid_operation_reserve('chat');
    UPDATE public.ai_assistant_threads t
    SET busy_until = clock_timestamp() + interval '85 seconds', active_request_id = p_request,
        updated_at = clock_timestamp()
    WHERE t.id = p_thread AND t.owner_principal_id = p_owner
      AND (t.busy_until IS NULL OR t.busy_until < clock_timestamp());
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.ai_assistant_request_quota (account_id, owner_principal_id, request_id)
    VALUES (v_account, p_owner, p_request);
    INSERT INTO public.ai_assistant_regenerations
        (owner_principal_id, request_id, thread_id, source_user_message_id, source_ordinal, source_prompt, source_digest)
    VALUES (p_owner, p_request, p_thread, p_source, v_source.ordinal, v_source.content,
        public.ai_text_source_digest(p_owner, p_thread, p_source, v_source.ordinal, v_source.content));
    RETURN true;
END;
$$;

-- This migration only broadens the trusted model pair in one direction; the
-- existing ai_assistant_config_model_catalog_check uses ai_model_provider_matches().
