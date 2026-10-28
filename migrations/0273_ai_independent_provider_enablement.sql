-- Independent provider switches; credentials, owner admission and paid-operation quota stay intact.
ALTER TABLE public.ai_provider_settings ADD COLUMN enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_provider_settings ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
UPDATE public.ai_provider_settings s SET enabled=c.enabled AND s.api_key_ciphertext IS NOT NULL
 FROM public.ai_assistant_config c WHERE c.singleton_key AND s.provider=c.provider;

CREATE OR REPLACE FUNCTION ai_admin_get_config(p_principal uuid)
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
               'provider', p.provider, 'model', p.model, 'enabled', p.enabled, 'revision', p.revision,
               'apiKeyConfigured', p.api_key_ciphertext IS NOT NULL,
               'keyFingerprint', p.key_fingerprint, 'updatedAt', p.updated_at
           ) ORDER BY p.provider) FROM public.ai_provider_settings p),
           c.migrated_from_model
      FROM public.ai_assistant_config c WHERE c.singleton_key;
END;
$$;

CREATE OR REPLACE FUNCTION ai_admin_set_config(
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
    IF p_enabled AND p_provider <> v_previous.provider AND p_action <> 'replace'
       AND v_target.api_key_ciphertext IS NULL THEN
        RAISE EXCEPTION 'AI_PROVIDER_REQUIRES_NEW_KEY' USING ERRCODE = '22023';
    END IF;
    IF p_enabled AND (p_action = 'clear'
        OR (p_action = 'keep' AND v_target.api_key_ciphertext IS NULL)) THEN
        RAISE EXCEPTION 'AI_KEY_REQUIRED' USING ERRCODE = '22023';
    END IF;
    UPDATE public.ai_provider_settings p SET
        model = p_model, enabled = p_enabled, revision = p.revision + 1,
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

CREATE FUNCTION public.ai_admin_set_provider_config(p_principal uuid,p_enabled boolean,p_provider varchar,p_model varchar,p_action varchar,p_ciphertext varchar,p_iv varchar,p_tag varchar,p_fingerprint varchar,p_request_id varchar,p_paid_operations_per_hour integer,p_expected_version bigint,p_expected_provider_version bigint) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_global bigint;v_provider bigint;v_result bigint;v_previous public.ai_assistant_config%ROWTYPE;
BEGIN
 IF public.admin_authorized_role(p_principal,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 IF p_expected_provider_version IS NULL OR p_expected_provider_version<1 THEN RAISE EXCEPTION 'AI_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 SELECT c.* INTO STRICT v_previous FROM public.ai_assistant_config c WHERE singleton_key FOR UPDATE;
 v_global:=v_previous.configuration_version;
 IF v_global IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 SELECT s.revision INTO v_provider FROM public.ai_provider_settings s WHERE s.provider=p_provider FOR UPDATE;
 IF v_provider IS DISTINCT FROM p_expected_provider_version THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 SELECT public.ai_admin_set_config(p_principal,p_enabled,p_provider,p_model,p_action,p_ciphertext,p_iv,p_tag,p_fingerprint,p_request_id,p_paid_operations_per_hour,p_expected_version) INTO v_result;
 -- The legacy setter explicitly selects its card as the default. Card edits do not.
 -- Restore the old default projection within the same locked transaction.
 IF p_provider<>v_previous.provider THEN
  UPDATE public.ai_assistant_config c SET provider=v_previous.provider,model=v_previous.model,enabled=v_previous.enabled,
   api_key_ciphertext=v_previous.api_key_ciphertext,api_key_iv=v_previous.api_key_iv,
   api_key_auth_tag=v_previous.api_key_auth_tag,key_fingerprint=v_previous.key_fingerprint
   WHERE c.singleton_key;
 END IF;
 RETURN v_result;
END;$$;
REVOKE ALL ON FUNCTION public.ai_admin_set_provider_config(uuid,boolean,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,integer,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_admin_set_provider_config(uuid,boolean,varchar,varchar,varchar,varchar,varchar,varchar,varchar,varchar,integer,bigint,bigint) TO asalab_app;

CREATE OR REPLACE FUNCTION ai_runtime_config()
RETURNS TABLE (
    enabled boolean, provider varchar, model varchar,
    api_key_ciphertext varchar, api_key_iv varchar, api_key_auth_tag varchar,
    configuration_version bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.enabled AND s.enabled AND s.api_key_ciphertext IS NOT NULL, c.provider, c.model,
           s.api_key_ciphertext, s.api_key_iv, s.api_key_auth_tag, c.configuration_version
      FROM public.ai_assistant_config c JOIN public.ai_provider_settings s ON s.provider=c.provider WHERE c.singleton_key
$$;

CREATE OR REPLACE FUNCTION public.ai_generation_policy_runtime() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.ai_generation_policy%ROWTYPE;c public.ai_assistant_config%ROWTYPE;l public.ai_ollama_settings%ROWTYPE;allowed jsonb;def varchar;
BEGIN
 SELECT * INTO STRICT p FROM public.ai_generation_policy WHERE singleton_key;
 SELECT * INTO STRICT c FROM public.ai_assistant_config WHERE singleton_key;
 SELECT * INTO STRICT l FROM public.ai_ollama_settings WHERE singleton_key;
 allowed:=p.allowed_models;def:=p.default_model;
 IF NOT p.customized THEN
  SELECT coalesce(jsonb_agg(m),'[]') INTO allowed FROM (SELECT unnest(ARRAY['gpt-6-luna','gpt-5-mini','gpt-4.1-mini','deepseek-flash','deepseek-v4-pro']) AS m UNION ALL SELECT id AS m FROM public.ai_ollama_cloud_models WHERE active) catalog
   WHERE c.enabled AND c.api_key_ciphertext IS NOT NULL AND public.ai_model_available(c.provider,m,statement_timestamp());
  IF l.enabled AND char_length(l.model)>0 THEN allowed:=allowed||jsonb_build_array('ollama-local');END IF;
  def:=CASE WHEN c.enabled AND c.api_key_ciphertext IS NOT NULL THEN c.model WHEN l.enabled AND char_length(l.model)>0 THEN 'ollama-local' ELSE NULL END;
 END IF;
 RETURN jsonb_build_object('revision',p.revision,'customized',p.customized,'systemPrompt',p.system_prompt,'allowedModels',allowed,'defaultModel',def,
  'providerReady',(SELECT jsonb_object_agg(provider,enabled AND api_key_ciphertext IS NOT NULL) FROM public.ai_provider_settings),
  'localModel',nullif(l.model,''),'localEnabled',l.enabled);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_generation_runtime(p_model varchar) RETURNS TABLE(enabled boolean,provider varchar,model varchar,api_key_ciphertext varchar,api_key_iv varchar,api_key_auth_tag varchar,configuration_version bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT (public.ai_generation_policy_runtime()->'allowedModels')?p_model THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT s.enabled AND s.api_key_ciphertext IS NOT NULL,s.provider,p_model,s.api_key_ciphertext,s.api_key_iv,s.api_key_auth_tag,c.configuration_version
  FROM public.ai_assistant_config c JOIN public.ai_provider_settings s ON public.ai_model_provider_matches(s.provider,p_model)
  WHERE c.singleton_key AND public.ai_model_available(s.provider,p_model,statement_timestamp());
END;
$$;

CREATE FUNCTION public.ai_provider_default_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.default_model IS NULL THEN RETURN NEW;END IF;
 IF NEW.default_model='ollama-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_ollama_settings WHERE singleton_key AND enabled AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.ai_provider_settings s WHERE s.enabled AND s.api_key_ciphertext IS NOT NULL AND public.ai_model_provider_matches(s.provider,NEW.default_model)) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER ai_provider_default_guard BEFORE UPDATE ON public.ai_generation_policy FOR EACH ROW EXECUTE FUNCTION public.ai_provider_default_guard();
REVOKE ALL ON FUNCTION public.ai_provider_default_guard() FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_paid_request_ready(p_owner uuid,p_request uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_provider varchar;v_config public.ai_assistant_config%ROWTYPE;
BEGIN
 SELECT r.provider INTO v_provider FROM public.ai_generation_receipts r WHERE r.owner_principal_id=p_owner AND r.request_id=p_request;
 SELECT * INTO STRICT v_config FROM public.ai_assistant_config WHERE singleton_key;
 IF v_provider IS NULL THEN IF NOT v_config.enabled THEN RETURN false;END IF;v_provider:=v_config.provider;END IF;
 RETURN EXISTS(SELECT 1 FROM public.ai_provider_settings s WHERE s.provider=v_provider AND s.enabled AND s.api_key_ciphertext IS NOT NULL AND s.api_key_iv IS NOT NULL AND s.api_key_auth_tag IS NOT NULL);
END;$$;
REVOKE ALL ON FUNCTION public.ai_paid_request_ready(uuid,uuid) FROM PUBLIC,asalab_app;

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
    IF NOT public.ai_paid_request_ready(p_principal,p_request) THEN
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
    IF NOT public.ai_paid_request_ready(p_owner,p_request) THEN
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

CREATE OR REPLACE FUNCTION public.ai_generation_begin(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb,p_model varchar,p_revision bigint,p_config bigint) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.ai_generation_policy%ROWTYPE;c public.ai_assistant_config%ROWTYPE;l public.ai_ollama_settings%ROWTYPE;v_provider varchar;source uuid;uploads uuid[];admitted boolean;profile jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF public.ai_generation_replay(p_owner,p_thread,p_request,p_payload) THEN RETURN false;END IF;
 SELECT * INTO STRICT p FROM public.ai_generation_policy WHERE singleton_key FOR UPDATE;
 IF NOT p.customized OR p.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF NOT p.allowed_models?p_model OR (p_payload->>'model' IS NOT NULL AND p_payload->>'model'<>p_model) THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 IF p_model='ollama-local' THEN
  SELECT * INTO STRICT l FROM public.ai_ollama_settings WHERE singleton_key FOR UPDATE;
  IF NOT l.enabled OR l.revision IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;v_provider:='ollama';
 ELSE
  SELECT * INTO STRICT c FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
  SELECT v INTO v_provider FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) v WHERE public.ai_model_available(v,p_model,statement_timestamp());
  IF v_provider IS NULL OR c.configuration_version IS DISTINCT FROM p_config
   OR NOT EXISTS(SELECT 1 FROM public.ai_provider_settings s WHERE s.provider=v_provider AND s.enabled AND s.api_key_ciphertext IS NOT NULL AND s.api_key_iv IS NOT NULL AND s.api_key_auth_tag IS NOT NULL) THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 END IF;
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('display_name',CASE WHEN pr.kind='account' THEN left(pf.display_name,120) ELSE ss.display_label END,
  'timezone',CASE WHEN pr.kind='account' THEN pf.time_zone ELSE NULL END,'at',clock_timestamp(),
  'capabilities','Текстовый ответ; скачивание предложенных блоков кода. '||CASE WHEN jsonb_array_length(coalesce(p_payload->'uploads','[]'))>0 THEN 'К этому запросу привязаны приватные вложения; остальные файлы пользователя недоступны. ' ELSE 'Вложения к этому запросу не переданы. ' END||'Свежие сетевые сведения доступны только из переданного блока интернет-поиска и его статуса. Генерация изображений в этом текстовом запросе не выполняется.') INTO profile
  FROM public.principals pr LEFT JOIN public.profiles pf ON pr.kind='account' AND pf.account_id=pr.account_id
  LEFT JOIN public.classroom_student_seats ss ON pr.kind='student_seat' AND ss.id=pr.seat_id WHERE pr.id=p_owner;
 INSERT INTO public.ai_generation_receipts VALUES(p_owner,p_request,p_thread,p_model,v_provider,p.revision,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p.system_prompt,profile);
 source:=(p_payload->>'source')::uuid;
 SELECT coalesce(array_agg(v::uuid),'{}'::uuid[]) INTO uploads FROM jsonb_array_elements_text(coalesce(p_payload->'uploads','[]')) v;
 IF source IS NOT NULL THEN
  admitted:=CASE WHEN v_provider='ollama' THEN public.ai_text_regenerate_begin_local(p_owner,p_thread,p_request,source,p_config) ELSE public.ai_text_regenerate_begin(p_owner,p_thread,p_request,source,p_config) END;
 ELSIF p_payload->>'webSearchMode' IS NOT NULL THEN
  admitted:=public.ai_web_text_begin(p_owner,p_thread,p_request,p_payload->>'text',p_config,p_payload->>'webSearchMode',p_payload->>'weatherCity',uploads,v_provider='ollama');
 ELSIF cardinality(uploads)>0 THEN
  admitted:=CASE WHEN v_provider='ollama' THEN public.ai_attachment_begin_message_local(p_owner,p_thread,p_request,p_payload->>'text',p_config,uploads) ELSE public.ai_attachment_begin_message(p_owner,p_thread,p_request,p_payload->>'text',p_config,uploads) END;
 ELSE
  admitted:=CASE WHEN v_provider='ollama' THEN public.ai_text_begin_local(p_owner,p_thread,p_request,p_payload->>'text',p_config) ELSE public.ai_text_begin_paid(p_owner,p_thread,p_request,p_payload->>'text',p_config) END;
 END IF;
 IF NOT admitted THEN DELETE FROM public.ai_generation_receipts WHERE owner_principal_id=p_owner AND request_id=p_request;END IF;
 RETURN admitted;
END;
$$;

CREATE OR REPLACE FUNCTION ai_admin_test_begin(p_principal uuid, p_expected_version bigint)
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
    IF NOT EXISTS(SELECT 1 FROM public.ai_assistant_config c JOIN public.ai_provider_settings s ON s.provider=c.provider WHERE c.singleton_key AND c.enabled AND s.enabled AND s.api_key_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'AI_DISABLED';END IF;
    PERFORM public.ai_paid_operation_reserve('provider_test');
    RETURN true;
END;
$$;

-- An explicit card test reserves the shared paid quota only after validating that
-- exact provider and revision under the same configuration lock.
CREATE FUNCTION public.ai_admin_test_provider_begin(p_principal uuid,p_expected_version bigint,p_provider varchar,p_expected_provider_version bigint)
RETURNS TABLE(enabled boolean,provider varchar,model varchar,api_key_ciphertext varchar,api_key_iv varchar,api_key_auth_tag varchar,configuration_version bigint,provider_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_config public.ai_assistant_config%ROWTYPE;v_slot public.ai_provider_settings%ROWTYPE;
BEGIN
 IF public.admin_authorized_role(p_principal,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT v_config FROM public.ai_assistant_config c WHERE c.singleton_key FOR UPDATE;
 IF v_config.configuration_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED';END IF;
 SELECT * INTO v_slot FROM public.ai_provider_settings s WHERE s.provider=p_provider FOR UPDATE;
 IF v_slot.revision IS DISTINCT FROM p_expected_provider_version THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED';END IF;
 IF NOT v_slot.enabled OR v_slot.api_key_ciphertext IS NULL OR v_slot.api_key_iv IS NULL OR v_slot.api_key_auth_tag IS NULL THEN RAISE EXCEPTION 'AI_DISABLED';END IF;
 IF NOT public.ai_model_available(p_provider,v_slot.model,clock_timestamp()) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE';END IF;
 PERFORM public.ai_paid_operation_reserve('provider_test');
 RETURN QUERY SELECT true,v_slot.provider,v_slot.model,v_slot.api_key_ciphertext,v_slot.api_key_iv,v_slot.api_key_auth_tag,v_config.configuration_version,v_slot.revision;
END;$$;
REVOKE ALL ON FUNCTION public.ai_admin_test_provider_begin(uuid,bigint,varchar,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_admin_test_provider_begin(uuid,bigint,varchar,bigint) TO asalab_app;
