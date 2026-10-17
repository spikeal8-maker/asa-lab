-- ASA Lab AI Assistant: native, account-owned text chat and server-managed GPT credentials.
-- This is a new forward migration: 0200 was already published for account presentation.
CREATE TABLE ai_assistant_config (
    singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
    enabled boolean NOT NULL DEFAULT false,
    provider varchar(24) NOT NULL DEFAULT 'openai'
        CHECK (provider IN ('openai', 'deepseek')),
    model varchar(64) NOT NULL DEFAULT 'gpt-5-mini',
    api_key_ciphertext varchar(4096),
    api_key_iv varchar(64),
    api_key_auth_tag varchar(64),
    key_fingerprint varchar(16),
    configuration_version bigint NOT NULL DEFAULT 1,
    updated_by_principal uuid REFERENCES principals(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (provider = 'openai' AND model IN ('gpt-5-mini', 'gpt-4.1-mini'))
        OR (provider = 'deepseek' AND model = 'deepseek-chat')
    ),
    CHECK (
        (api_key_ciphertext IS NULL AND api_key_iv IS NULL
         AND api_key_auth_tag IS NULL AND key_fingerprint IS NULL)
        OR (api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL
         AND api_key_auth_tag IS NOT NULL AND key_fingerprint IS NOT NULL)
    ),
    CHECK (NOT enabled OR api_key_ciphertext IS NOT NULL)
);
INSERT INTO ai_assistant_config (singleton_key) VALUES (true);
ALTER TABLE ai_assistant_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_assistant_config FROM PUBLIC, asalab_app;

CREATE TABLE ai_assistant_threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts(id),
    title varchar(120) NOT NULL DEFAULT 'Новый чат',
    busy_until timestamptz,
    active_request_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_assistant_threads_account_idx
    ON ai_assistant_threads (account_id, updated_at DESC, id DESC);

CREATE TABLE ai_assistant_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES ai_assistant_threads(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES accounts(id),
    request_id uuid NOT NULL,
    role varchar(16) NOT NULL CHECK (role IN ('user', 'assistant')),
    state varchar(16) NOT NULL DEFAULT 'complete'
        CHECK (state IN ('complete', 'stopped')),
    content varchar(8192) NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8192),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (thread_id, role, request_id)
);
CREATE INDEX ai_assistant_messages_thread_idx
    ON ai_assistant_messages (thread_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX ai_assistant_user_request_once_idx
    ON ai_assistant_messages (account_id, request_id) WHERE role = 'user';

-- Append-only admission ledger: deleting a conversation must neither refund
-- quota nor allow its request identifiers to trigger another paid operation.
-- No thread/message foreign key and no runtime table privileges or RLS policies.
CREATE TABLE ai_assistant_request_quota (
    account_id uuid NOT NULL REFERENCES accounts(id),
    request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, request_id)
);
CREATE INDEX ai_assistant_request_quota_account_idx
    ON ai_assistant_request_quota (account_id, created_at DESC);
ALTER TABLE ai_assistant_request_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_assistant_request_quota FROM PUBLIC, asalab_app;
ALTER TABLE ai_assistant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_assistant_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_assistant_threads FROM PUBLIC, asalab_app;
REVOKE ALL ON ai_assistant_messages FROM PUBLIC, asalab_app;

-- All entry points below are called only after the API has resolved the signed
-- session cookie to an ActiveContext. The SQL boundary also checks principal
-- ownership; the browser never supplies an account/principal selector.

CREATE FUNCTION ai_admin_get_config(p_principal uuid)
RETURNS TABLE (
    enabled boolean,
    provider varchar,
    model varchar,
    api_key_configured boolean,
    key_fingerprint varchar,
    configuration_version bigint,
    updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_principal, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT c.enabled, c.provider, c.model, c.api_key_ciphertext IS NOT NULL,
           c.key_fingerprint, c.configuration_version, c.updated_at
      FROM public.ai_assistant_config c WHERE c.singleton_key;
END;
$$;

CREATE FUNCTION ai_admin_set_config(
    p_principal uuid, p_enabled boolean, p_provider varchar, p_model varchar,
    p_action varchar, p_ciphertext varchar, p_iv varchar, p_tag varchar,
    p_fingerprint varchar, p_request_id varchar
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

CREATE FUNCTION ai_runtime_config()
RETURNS TABLE (
    enabled boolean, provider varchar, model varchar,
    api_key_ciphertext varchar, api_key_iv varchar, api_key_auth_tag varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.enabled, c.provider, c.model,
           c.api_key_ciphertext, c.api_key_iv, c.api_key_auth_tag
      FROM public.ai_assistant_config c WHERE c.singleton_key
$$;

CREATE FUNCTION ai_chat_create(p_principal uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_id uuid;
BEGIN
    SELECT p.account_id INTO v_account FROM public.principals p
     WHERE p.id = p_principal AND p.kind = 'account';
    IF v_account IS NULL THEN
        RAISE EXCEPTION 'AI_ACCOUNT_REQUIRED' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.ai_assistant_threads(account_id)
      VALUES (v_account) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE FUNCTION ai_chat_list(p_principal uuid)
RETURNS TABLE (id uuid, title varchar, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.updated_at
      FROM public.ai_assistant_threads t
      JOIN public.principals p ON p.account_id = t.account_id
     WHERE p.id = p_principal AND p.kind = 'account'
     ORDER BY t.updated_at DESC, t.id DESC LIMIT 50
$$;

CREATE FUNCTION ai_chat_messages(p_principal uuid, p_thread uuid)
RETURNS TABLE (
    id uuid, role varchar, content varchar, created_at timestamptz,
    request_id uuid, state varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.id, m.role, m.content, m.created_at, m.request_id, m.state
      FROM (
          SELECT msg.id, msg.role, msg.content, msg.created_at, msg.request_id, msg.state
            FROM public.ai_assistant_messages msg
            JOIN public.ai_assistant_threads t ON t.id = msg.thread_id
            JOIN public.principals p ON p.account_id = t.account_id
           WHERE p.id = p_principal AND p.kind = 'account'
             AND msg.thread_id = p_thread AND msg.account_id = t.account_id
           ORDER BY msg.created_at DESC, msg.id DESC LIMIT 80
      ) m
     ORDER BY m.created_at ASC, m.id ASC
$$;

CREATE FUNCTION ai_chat_begin(p_principal uuid, p_thread uuid, p_request uuid, p_text varchar)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account uuid;
    v_existing_text varchar;
    v_existing_thread uuid;
    v_title varchar(120);
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

CREATE FUNCTION ai_chat_finish(
    p_principal uuid, p_thread uuid, p_request uuid, p_answer varchar,
    p_state varchar DEFAULT 'complete'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_inserted uuid;
BEGIN
    IF p_state NOT IN ('complete', 'stopped') OR
       char_length(p_answer) NOT BETWEEN 1 AND 8192 THEN
        RAISE EXCEPTION 'AI_RESPONSE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_account FROM public.principals p
     WHERE p.id = p_principal AND p.kind = 'account';
    -- Serialise finish with the admission row. Expired workers cannot clear
    -- a newer in-flight request or attach an old answer to its thread.
    PERFORM 1 FROM public.ai_assistant_threads t
     WHERE t.id = p_thread AND t.account_id = v_account
       AND t.active_request_id = p_request
     FOR UPDATE;
    IF v_account IS NULL OR NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.ai_assistant_messages m
         WHERE m.thread_id = p_thread AND m.account_id = v_account
           AND m.request_id = p_request AND m.role = 'user'
    ) THEN
        RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.ai_assistant_messages
        (thread_id, account_id, request_id, role, content, state)
      VALUES (p_thread, v_account, p_request, 'assistant', p_answer, p_state)
      ON CONFLICT (thread_id, role, request_id) DO NOTHING
      RETURNING id INTO v_inserted;
    UPDATE public.ai_assistant_threads
       SET busy_until = NULL, active_request_id = NULL, updated_at = clock_timestamp()
     WHERE id = p_thread AND account_id = v_account
       AND active_request_id = p_request;
    RETURN v_inserted IS NOT NULL;
END;
$$;

CREATE FUNCTION ai_chat_abort(p_principal uuid, p_thread uuid, p_request uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.ai_assistant_threads t
       SET busy_until = NULL, active_request_id = NULL
     WHERE t.id = p_thread AND t.active_request_id = p_request AND EXISTS (
         SELECT 1 FROM public.principals p
          WHERE p.id = p_principal AND p.kind = 'account'
            AND p.account_id = t.account_id
     ) AND EXISTS (
         SELECT 1 FROM public.ai_assistant_messages m
          WHERE m.thread_id = p_thread AND m.request_id = p_request
            AND m.role = 'user' AND m.account_id = t.account_id
     )
$$;


-- Account-owned conversation management and cursor reads. All entry points
-- resolve ownership independently; the browser never supplies an account_id.
CREATE FUNCTION ai_chat_rename(p_principal uuid, p_thread uuid, p_title varchar)
RETURNS TABLE (id uuid, title varchar, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF char_length(trim(p_title)) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'AI_TITLE_INVALID' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    UPDATE public.ai_assistant_threads t SET
        title = trim(p_title), updated_at = clock_timestamp()
      FROM public.principals p
     WHERE p.id = p_principal AND p.kind = 'account'
       AND p.account_id = t.account_id AND t.id = p_thread
    RETURNING t.id, t.title, t.updated_at;
END;
$$;

CREATE FUNCTION ai_chat_delete(p_principal uuid, p_thread uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH removed AS (
        DELETE FROM public.ai_assistant_threads t
        USING public.principals p
        WHERE p.id = p_principal AND p.kind = 'account'
          AND p.account_id = t.account_id AND t.id = p_thread
          AND (t.busy_until IS NULL OR t.busy_until < clock_timestamp())
        RETURNING t.id
    )
    SELECT EXISTS (SELECT 1 FROM removed)
$$;

CREATE FUNCTION ai_chat_list_page(
    p_principal uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
)
RETURNS TABLE (id uuid, title varchar, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.updated_at
      FROM public.ai_assistant_threads t
      JOIN public.principals p ON p.account_id = t.account_id
     WHERE p.id = p_principal AND p.kind = 'account'
       AND (p_before_at IS NULL OR (t.updated_at, t.id) < (p_before_at, p_before_id))
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 51)
$$;

CREATE FUNCTION ai_chat_messages_page(
    p_principal uuid, p_thread uuid,
    p_before_at timestamptz, p_before_id uuid, p_limit integer
)
RETURNS TABLE (
    id uuid, role varchar, content varchar, created_at timestamptz,
    request_id uuid, state varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.id, m.role, m.content, m.created_at, m.request_id, m.state
      FROM (
        SELECT msg.id, msg.role, msg.content, msg.created_at, msg.request_id, msg.state
          FROM public.ai_assistant_messages msg
          JOIN public.ai_assistant_threads t ON t.id = msg.thread_id
          JOIN public.principals p ON p.account_id = t.account_id
         WHERE p.id = p_principal AND p.kind = 'account'
           AND msg.thread_id = p_thread AND msg.account_id = t.account_id
           AND (p_before_at IS NULL OR
                (msg.created_at, msg.id) < (p_before_at, p_before_id))
         ORDER BY msg.created_at DESC, msg.id DESC
         LIMIT LEAST(GREATEST(p_limit, 1), 51)
      ) m
     ORDER BY m.created_at ASC, m.id ASC
$$;

REVOKE ALL ON FUNCTION ai_chat_rename(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_delete(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_list_page(uuid, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_messages_page(uuid, uuid, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_chat_rename(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_delete(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_list_page(uuid, timestamptz, uuid, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_messages_page(uuid, uuid, timestamptz, uuid, integer) TO asalab_app;

REVOKE ALL ON FUNCTION ai_admin_get_config(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_runtime_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_create(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_messages(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_begin(uuid, uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_finish(uuid, uuid, uuid, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_chat_abort(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_admin_get_config(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_admin_set_config(
    uuid, boolean, varchar, varchar, varchar, varchar, varchar, varchar, varchar, varchar
) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_runtime_config() TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_create(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_list(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_messages(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_begin(uuid, uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_finish(uuid, uuid, uuid, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION ai_chat_abort(uuid, uuid, uuid) TO asalab_app;
