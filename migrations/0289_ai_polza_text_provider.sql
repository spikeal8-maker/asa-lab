-- Polza text models use the existing owner admission, history and token-budget chain.
-- The saved Polza key remains canonical; its encrypted provider projection changes atomically.
CREATE TABLE public.ai_polza_models (
 id varchar(128) PRIMARY KEY CHECK(id ~ '^polza/[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$'),
 upstream varchar(120) NOT NULL UNIQUE, label varchar(120) NOT NULL,
 kind varchar(16) NOT NULL CHECK(kind IN('chat','stt','image','other')),
 vision boolean NOT NULL, tools boolean NOT NULL, max_output_tokens integer NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 8192),
 active boolean NOT NULL DEFAULT true, selected boolean NOT NULL DEFAULT false,
 CHECK(id='polza/'||upstream AND position('://' IN upstream)=0), CHECK(NOT selected OR kind='chat')
);
CREATE TABLE public.ai_polza_catalog_state (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key), revision bigint NOT NULL DEFAULT 1,
 credential_fingerprint varchar(16), checked_at timestamptz
);
INSERT INTO public.ai_polza_catalog_state(singleton_key) VALUES(true);
ALTER TABLE public.ai_polza_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_polza_catalog_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_polza_models,public.ai_polza_catalog_state FROM PUBLIC,asalab_app;
ALTER TABLE public.ai_provider_settings DROP CONSTRAINT ai_provider_settings_provider_check;
ALTER TABLE public.ai_provider_settings ADD CONSTRAINT ai_provider_settings_provider_check CHECK(provider IN('openai','deepseek','ollama-cloud','polza'));
ALTER TABLE public.ai_usage_journal DROP CONSTRAINT ai_usage_journal_provider_check;
ALTER TABLE public.ai_usage_journal ADD CONSTRAINT ai_usage_journal_provider_check CHECK(provider IN('openai','deepseek','ollama','ollama-cloud','comfyui','polza'));


CREATE FUNCTION public.ai_polza_provider_projection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.enabled IS NOT DISTINCT FROM OLD.enabled AND NEW.api_key_ciphertext IS NOT DISTINCT FROM OLD.api_key_ciphertext THEN RETURN NEW;END IF;
 UPDATE public.ai_provider_settings SET enabled=NEW.enabled,api_key_ciphertext=NEW.api_key_ciphertext,
  api_key_iv=NEW.api_key_iv,api_key_auth_tag=NEW.api_key_auth_tag,key_fingerprint=NEW.key_fingerprint,revision=revision+1,updated_at=now() WHERE provider='polza';
 UPDATE public.ai_assistant_config SET configuration_version=configuration_version+1 WHERE singleton_key;
 RETURN NEW;
END;$$;
CREATE TRIGGER ai_polza_provider_projection AFTER UPDATE OF enabled,api_key_ciphertext ON public.ai_polza_settings FOR EACH ROW EXECUTE FUNCTION public.ai_polza_provider_projection();
REVOKE ALL ON FUNCTION public.ai_polza_provider_projection() FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_polza_catalog_runtime() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('version',c.revision,'checkedAt',c.checked_at,
 'credentialCurrent',s.api_key_ciphertext IS NOT NULL AND c.checked_at IS NOT NULL AND c.credential_fingerprint IS NOT DISTINCT FROM s.key_fingerprint,
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'upstream',m.upstream,'label',m.label,'kind',m.kind,'vision',m.vision,'tools',m.tools,'maxOutputTokens',m.max_output_tokens,'active',m.active,'selected',m.selected) ORDER BY m.label,m.id) FROM public.ai_polza_models m),'[]'::jsonb))
 FROM public.ai_polza_catalog_state c CROSS JOIN public.ai_polza_settings s WHERE c.singleton_key AND s.singleton_key
$$;
REVOKE ALL ON FUNCTION public.ai_polza_catalog_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_polza_catalog_runtime() TO asalab_app;

CREATE FUNCTION public.ai_polza_catalog_apply(p_actor uuid,p_revision bigint,p_models jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.ai_polza_settings%ROWTYPE;m jsonb;old_version bigint;event_id text:=gen_random_uuid()::text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
 SELECT * INTO STRICT s FROM public.ai_polza_settings WHERE singleton_key FOR UPDATE;
 IF s.revision IS DISTINCT FROM p_revision OR s.api_key_ciphertext IS NULL THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_models) IS DISTINCT FROM 'array' OR jsonb_array_length(p_models)>1200 OR
  (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_models)) THEN RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE='22023';END IF;
 SELECT revision INTO old_version FROM public.ai_polza_catalog_state WHERE singleton_key;
 -- Validate all rows before retiring existing metadata. No key or endpoint comes from the catalogue.
 FOR m IN SELECT value FROM jsonb_array_elements(p_models) LOOP
  IF m->>'id' IS NULL OR m->>'upstream' IS NULL OR m->>'id'<>'polza/'||(m->>'upstream') OR
    (m->>'upstream')!~'^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$' OR position('://' IN (m->>'upstream'))>0 OR length(m->>'label') NOT BETWEEN 1 AND 120 OR
    m->>'kind' NOT IN('chat','stt','image','other') OR jsonb_typeof(m->'vision') IS DISTINCT FROM 'boolean' OR
    jsonb_typeof(m->'tools') IS DISTINCT FROM 'boolean' OR jsonb_typeof(m->'maxOutputTokens') IS DISTINCT FROM 'number' OR
    (m->>'maxOutputTokens')::numeric<>trunc((m->>'maxOutputTokens')::numeric) OR (m->>'maxOutputTokens')::numeric NOT BETWEEN 1 AND 8192
    THEN RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE='22023';END IF;
 END LOOP;
 UPDATE public.ai_polza_models SET active=false;
 FOR m IN SELECT value FROM jsonb_array_elements(p_models) LOOP
  INSERT INTO public.ai_polza_models(id,upstream,label,kind,vision,tools,max_output_tokens,active,selected)
   VALUES(m->>'id',m->>'upstream',m->>'label',m->>'kind',(m->>'vision')::boolean,(m->>'tools')::boolean,(m->>'maxOutputTokens')::integer,true,false)
   ON CONFLICT(id) DO UPDATE SET label=excluded.label,kind=excluded.kind,vision=excluded.vision,tools=excluded.tools,
    max_output_tokens=excluded.max_output_tokens,active=true,selected=ai_polza_models.selected AND excluded.kind='chat';
 END LOOP;
 UPDATE public.ai_polza_catalog_state SET revision=revision+1,checked_at=clock_timestamp(),credential_fingerprint=s.key_fingerprint WHERE singleton_key;
 UPDATE public.ai_assistant_config SET configuration_version=configuration_version+1 WHERE singleton_key;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_configuration.update','integration','polza_catalog','admin_console','Обновление каталога Polza',NULL,event_id,event_id,'succeeded',old_version,old_version+1);
END;$$;
REVOKE ALL ON FUNCTION public.ai_polza_catalog_apply(uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_polza_catalog_apply(uuid,bigint,jsonb) TO asalab_app;

CREATE FUNCTION public.ai_polza_models_select(p_actor uuid,p_version bigint,p_ids jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.ai_polza_catalog_state%ROWTYPE;s public.ai_polza_settings%ROWTYPE;m text;event_id text:=gen_random_uuid()::text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
 SELECT * INTO STRICT s FROM public.ai_polza_settings WHERE singleton_key FOR UPDATE;
 SELECT * INTO STRICT c FROM public.ai_polza_catalog_state WHERE singleton_key FOR UPDATE;
 IF c.revision IS DISTINCT FROM p_version OR c.checked_at IS NULL OR s.api_key_ciphertext IS NULL OR c.credential_fingerprint IS DISTINCT FROM s.key_fingerprint THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_ids) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ids)>1200 OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_ids)) THEN RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE='22023';END IF;
 FOR m IN SELECT jsonb_array_elements_text(p_ids) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.ai_polza_models WHERE id=m AND active AND kind='chat') THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END LOOP;
 UPDATE public.ai_polza_models SET selected=p_ids?id;
 UPDATE public.ai_polza_catalog_state SET revision=revision+1 WHERE singleton_key;
 UPDATE public.ai_provider_settings SET model=coalesce((SELECT id FROM public.ai_polza_models WHERE selected AND active ORDER BY id LIMIT 1),'polza/unconfigured'),revision=revision+1 WHERE provider='polza';
 UPDATE public.ai_assistant_config SET configuration_version=configuration_version+1 WHERE singleton_key;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_configuration.update','integration','polza_models','admin_console','Выбор моделей Polza',NULL,event_id,event_id,'succeeded',c.revision,c.revision+1);
END;$$;
REVOKE ALL ON FUNCTION public.ai_polza_models_select(uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_polza_models_select(uuid,bigint,jsonb) TO asalab_app;


CREATE OR REPLACE FUNCTION public.ai_model_provider_matches(p_provider varchar,p_model varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((p_provider='polza' AND (p_model='polza/unconfigured' OR EXISTS(SELECT 1 FROM public.ai_polza_models m WHERE m.id=p_model AND m.kind='chat'))) OR (p_provider='openai' AND p_model IN('gpt-6-luna','gpt-5-mini','gpt-4.1-mini')) OR (p_provider='deepseek' AND p_model IN('deepseek-flash','deepseek-v4-pro')) OR (p_provider='ollama-cloud' AND EXISTS(SELECT 1 FROM public.ai_ollama_cloud_models WHERE id=p_model AND active)),false)
$$;

INSERT INTO public.ai_provider_settings(provider,model,enabled,api_key_ciphertext,api_key_iv,api_key_auth_tag,key_fingerprint)
 SELECT 'polza','polza/unconfigured',enabled,api_key_ciphertext,api_key_iv,api_key_auth_tag,key_fingerprint FROM public.ai_polza_settings WHERE singleton_key;

CREATE OR REPLACE FUNCTION ai_model_available(p_provider varchar, p_model varchar, p_at timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.ai_model_provider_matches(p_provider, p_model) AND p_at IS NOT NULL AND (p_provider<>'polza' OR EXISTS(SELECT 1 FROM public.ai_polza_models m CROSS JOIN public.ai_polza_catalog_state c CROSS JOIN public.ai_polza_settings s WHERE m.id=p_model AND m.active AND m.selected AND c.singleton_key AND s.singleton_key AND c.checked_at IS NOT NULL AND s.api_key_ciphertext IS NOT NULL AND c.credential_fingerprint IS NOT DISTINCT FROM s.key_fingerprint))
       AND CASE p_model
           WHEN 'gpt-5-mini' THEN p_at < TIMESTAMPTZ '2026-12-11 00:00:00+00'
           WHEN 'gpt-4.1-mini' THEN p_at < TIMESTAMPTZ '2027-01-14 00:00:00+00'
           ELSE true END
$$;

CREATE OR REPLACE FUNCTION public.ai_generation_policy_set(p_actor uuid,p_input jsonb,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_generation_policy%ROWTYPE;previous public.ai_generation_policy_writes%ROWTYPE;m text;def text;v_provider text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT old FROM public.ai_generation_policy WHERE singleton_key FOR UPDATE;
 SELECT * INTO previous FROM public.ai_generation_policy_writes WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF previous.payload<>p_input THEN RAISE EXCEPTION 'AI_POLICY_REQUEST_REUSED' USING ERRCODE='22023';END IF;RETURN;END IF;
 IF p_request IS NULL OR jsonb_typeof(p_input)<>'object' OR char_length(p_input->>'systemPrompt') NOT BETWEEN 1 AND 12000
  OR jsonb_typeof(p_input->'allowedModels') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'allowedModels')>2400
  OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_input->'allowedModels')) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF (p_input->>'configurationVersion')::bigint IS DISTINCT FROM old.revision THEN RAISE EXCEPTION 'AI_POLICY_CHANGED' USING ERRCODE='40001';END IF;
 FOR m IN SELECT jsonb_array_elements_text(p_input->'allowedModels') LOOP
  IF m<>'ollama-local' AND NOT old.allowed_models?m AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) v WHERE public.ai_model_available(v,m,statement_timestamp())) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END LOOP;
 IF p_input?'modelPreferences' THEN
  IF jsonb_typeof(p_input->'modelPreferences') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'modelPreferences')>2400
   OR (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_input->'modelPreferences')) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  FOR m IN SELECT value::text FROM jsonb_array_elements(p_input->'modelPreferences') LOOP
   IF (m::jsonb->>'id') IS NULL OR (m::jsonb->>'id')!~'^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$' OR jsonb_typeof(m::jsonb->'eligible') IS DISTINCT FROM 'boolean' OR jsonb_typeof(m::jsonb->'order') IS DISTINCT FROM 'number' OR (m::jsonb->>'order')::numeric<>trunc((m::jsonb->>'order')::numeric) OR abs((m::jsonb->>'order')::numeric)>1000000 THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  END LOOP;
 END IF;
 IF p_input?'providerOrder' THEN
  IF jsonb_typeof(p_input->'providerOrder') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  FOR m IN SELECT key FROM jsonb_each(p_input->'providerOrder') LOOP
   IF m NOT IN('openai','deepseek','ollama-cloud','polza','ollama') OR jsonb_typeof(p_input->'providerOrder'->m) IS DISTINCT FROM 'number' OR (p_input->'providerOrder'->>m)::numeric<>trunc((p_input->'providerOrder'->>m)::numeric) OR abs((p_input->'providerOrder'->>m)::numeric)>1000000 THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  END LOOP;
 END IF;
 def:=p_input->>'defaultModel';
 IF (def IS NULL)<>(jsonb_array_length(p_input->'allowedModels')=0) OR (def IS NOT NULL AND NOT (p_input->'allowedModels')?def) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF def IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_input->'modelPreferences',old.model_preferences)) pref WHERE pref->>'id'=def AND pref->'eligible'='false'::jsonb) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF def IS NOT NULL AND def<>'ollama-local' AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) vprov WHERE public.ai_model_available(vprov,def,statement_timestamp()) AND (vprov<>'ollama-cloud' OR NOT (SELECT pool_managed FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key) OR EXISTS(SELECT 1 FROM public.ai_ollama_cloud_key_candidates(def))) AND NOT EXISTS(SELECT 1 FROM public.ai_provider_catalog_observations o WHERE o.provider=vprov AND o.checked_at IS NOT NULL AND (o.credential_fingerprint IS DISTINCT FROM (SELECT s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider=vprov) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.models) observed_model WHERE observed_model->>'id'=def AND observed_model->'active'='true'::jsonb)))) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF def='ollama-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_ollama_settings WHERE singleton_key AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF def IS NOT NULL THEN
  SELECT v INTO v_provider FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) v WHERE public.ai_model_provider_matches(v,def);
  IF NOT EXISTS(SELECT 1 FROM public.ai_provider_settings WHERE ai_provider_settings.provider=v_provider AND api_key_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END IF;
 UPDATE public.ai_generation_policy SET model_preferences=coalesce(p_input->'modelPreferences',old.model_preferences),provider_order=coalesce(p_input->'providerOrder',old.provider_order),customized=true,system_prompt=p_input->>'systemPrompt',allowed_models=p_input->'allowedModels',default_model=def,revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_generation_policy_writes VALUES(p_actor,p_request,p_input,old.revision+1);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_generation.update','integration','ai','admin_console','Generation policy',NULL,p_request::text,p_request::text,'succeeded',old.revision,old.revision+1);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_generation_begin_before_budgets(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb,p_model varchar,p_revision bigint,p_config bigint) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.ai_generation_policy%ROWTYPE;c public.ai_assistant_config%ROWTYPE;l public.ai_ollama_settings%ROWTYPE;v_provider varchar;source uuid;uploads uuid[];admitted boolean;profile jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF public.ai_generation_replay(p_owner,p_thread,p_request,p_payload) THEN RETURN false;END IF;
 SELECT * INTO STRICT p FROM public.ai_generation_policy WHERE singleton_key FOR UPDATE;
 IF NOT p.customized OR p.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF NOT p.allowed_models?p_model OR (p_payload->>'model' IS NOT NULL AND p_payload->>'model'<>p_model) THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.model_preferences) pref WHERE pref->>'id'=p_model AND pref->'eligible'='false'::jsonb) THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 IF p_model='ollama-local' THEN
  SELECT * INTO STRICT l FROM public.ai_ollama_settings WHERE singleton_key FOR UPDATE;
  IF NOT l.enabled OR l.revision IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;v_provider:='ollama';
 ELSE
  SELECT * INTO STRICT c FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
  SELECT v INTO v_provider FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) v WHERE public.ai_selection_available(v,p_model,statement_timestamp());
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

CREATE OR REPLACE FUNCTION public.ai_token_budgets_set(p_actor uuid,p_input jsonb,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_token_budget_policy%ROWTYPE;previous public.ai_token_budget_writes%ROWTYPE;item jsonb;cap text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT old FROM public.ai_token_budget_policy WHERE singleton_key FOR UPDATE;
 SELECT * INTO previous FROM public.ai_token_budget_writes WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF previous.payload<>p_input THEN RAISE EXCEPTION 'AI_BUDGET_REQUEST_REUSED' USING ERRCODE='22023';END IF;RETURN;END IF;
 IF p_request IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR jsonb_typeof(p_input->'models') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_input->'models')>2400 OR (SELECT count(*)<>count(DISTINCT value->>'model') FROM jsonb_array_elements(p_input->'models')) THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
 IF (p_input->>'configurationVersion')::bigint IS DISTINCT FROM old.revision THEN RAISE EXCEPTION 'AI_BUDGET_CHANGED' USING ERRCODE='40001';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_input->'models') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'model' IS NULL OR ((item->>'model')<>'ollama-local' AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) provider WHERE public.ai_model_provider_matches(provider::varchar,(item->>'model')::varchar)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old.limits) x WHERE x->>'model'=item->>'model')) THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
  FOREACH cap IN ARRAY ARRAY['globalLimit','userLimit'] LOOP
   IF NOT item?cap OR (item->cap<>'null'::jsonb AND (jsonb_typeof(item->cap)<>'string' OR item->>cap!~'^(0|[1-9][0-9]{0,15})$')) THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
   IF (item->>cap)::numeric>9007199254740991 THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
  END LOOP;
 END LOOP;
 UPDATE public.ai_token_budget_policy SET limits=p_input->'models',revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_token_budget_writes VALUES(p_actor,p_request,p_input,old.revision+1);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_token_budget.update','integration','ai','admin_console','Monthly token budgets',NULL,p_request::text,p_request::text,'succeeded',old.revision,old.revision+1);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_usage_begin(p_owner uuid,p_thread uuid,p_request uuid,p_operation varchar,p_transport varchar,p_provider varchar,p_model varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_operation varchar;
BEGIN
    IF p_operation IS NULL OR p_operation NOT IN ('chat','regeneration') OR p_transport IS NULL OR p_transport NOT IN ('json','sse')
       OR p_provider IS NULL OR p_provider NOT IN ('openai','deepseek','ollama','ollama-cloud','polza') OR p_model IS NULL
       OR p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$' OR position('://' IN p_model)>0 THEN
        RAISE EXCEPTION 'AI_USAGE_INVALID' USING ERRCODE='22023';
    END IF;
    -- Canonical admission, exact owner, and current thread lease are mandatory.
    PERFORM 1 FROM public.ai_assistant_threads t JOIN public.ai_assistant_request_quota q
      ON q.owner_principal_id=t.owner_principal_id AND q.request_id=t.active_request_id
     WHERE t.id=p_thread AND t.owner_principal_id=p_owner AND t.active_request_id=p_request FOR UPDATE OF t;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.ai_assistant_regenerations r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=p_request) THEN
        v_operation:='regeneration';
    ELSIF EXISTS(SELECT 1 FROM public.ai_assistant_messages m WHERE m.owner_principal_id=p_owner AND m.thread_id=p_thread AND m.request_id=p_request AND m.role='user') THEN
        v_operation:='chat';
    END IF;
    IF v_operation IS DISTINCT FROM p_operation THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    UPDATE public.ai_usage_journal SET thread_id=p_thread,operation=p_operation,transport=p_transport,
      provider=p_provider,requested_model=p_model,started_at=clock_timestamp(),status='running'
     WHERE owner_principal_id=p_owner AND request_id=p_request AND status='admitted';
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_polza_admin_set(p_actor uuid, p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  old_row public.ai_polza_settings%ROWTYPE;
  key_action text;
  next_enabled boolean;
  next_stt boolean;
  next_limit integer;
  next_global_limit integer;
  next_max integer;
  request_id uuid;
BEGIN
  IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' THEN
    RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE = '22023';
  END IF;
  key_action := p_body->>'action';
  next_enabled := (p_body->>'enabled')::boolean;
  next_stt := (p_body->>'transcriptionEnabled')::boolean;
  next_limit := (p_body->>'dailySecondsLimit')::integer;
  next_global_limit := (p_body->>'globalDailySecondsLimit')::integer;
  next_max := (p_body->>'maxAudioSeconds')::integer;
  request_id := (p_body->>'requestId')::uuid;
  IF key_action NOT IN ('keep', 'replace', 'clear')
     OR next_enabled IS NULL OR next_stt IS NULL
     OR next_limit NOT BETWEEN 60 AND 3600 OR next_global_limit NOT BETWEEN 600 AND 86400
     OR next_max NOT BETWEEN 5 AND 30
     OR request_id IS NULL OR (next_stt AND NOT next_enabled)
     OR (key_action = 'replace' AND (
       length(p_body->>'ciphertext') NOT BETWEEN 8 AND 4096
       OR length(p_body->>'iv') NOT BETWEEN 12 AND 64
       OR length(p_body->>'tag') NOT BETWEEN 16 AND 64
       OR length(p_body->>'fingerprint') NOT BETWEEN 8 AND 16
     )) THEN
    RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
  IF p_body?'paidOperationsPerHour' THEN
    IF jsonb_typeof(p_body->'paidOperationsPerHour') IS DISTINCT FROM 'number' OR (p_body->>'paidOperationsPerHour')::numeric NOT BETWEEN 0 AND 10000 OR (p_body->>'paidOperationsPerHour')::numeric<>trunc((p_body->>'paidOperationsPerHour')::numeric) THEN RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE='22023';END IF;
    IF (p_body->>'textConfigurationVersion')::bigint IS DISTINCT FROM (SELECT configuration_version FROM public.ai_assistant_config WHERE singleton_key) THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
    UPDATE public.ai_assistant_config SET paid_operations_per_hour=(p_body->>'paidOperationsPerHour')::integer,configuration_version=configuration_version+1 WHERE singleton_key;
  END IF;
  SELECT * INTO STRICT old_row FROM public.ai_polza_settings WHERE singleton_key FOR UPDATE;
  IF (p_body->>'configurationVersion')::bigint IS DISTINCT FROM old_row.revision THEN
    RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE = '40001';
  END IF;
  IF next_enabled AND key_action <> 'replace' AND
     (key_action = 'clear' OR old_row.api_key_ciphertext IS NULL) THEN
    RAISE EXCEPTION 'AI_KEY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ai_polza_settings SET
    enabled = next_enabled,
    transcription_enabled = next_stt,
    daily_seconds_limit = next_limit,
    global_daily_seconds_limit = next_global_limit,
    max_audio_seconds = next_max,
    api_key_ciphertext = CASE key_action WHEN 'replace' THEN p_body->>'ciphertext'
      WHEN 'clear' THEN NULL ELSE old_row.api_key_ciphertext END,
    api_key_iv = CASE key_action WHEN 'replace' THEN p_body->>'iv'
      WHEN 'clear' THEN NULL ELSE old_row.api_key_iv END,
    api_key_auth_tag = CASE key_action WHEN 'replace' THEN p_body->>'tag'
      WHEN 'clear' THEN NULL ELSE old_row.api_key_auth_tag END,
    key_fingerprint = CASE key_action WHEN 'replace' THEN p_body->>'fingerprint'
      WHEN 'clear' THEN NULL ELSE old_row.key_fingerprint END,
    revision = old_row.revision + 1,
    updated_at = clock_timestamp()
  WHERE singleton_key;
  PERFORM public.admin_append_audit_event(
    p_actor, 'platform', NULL, 'administration.ai_configuration.update',
    'integration', 'polza', 'admin_console', 'Настройка Polza AI',
    NULL, request_id::text, request_id::text, 'succeeded', old_row.revision, old_row.revision + 1
  );
  RETURN public.ai_polza_admin_config(p_actor);
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
    IF p_provider='polza' THEN RAISE EXCEPTION 'AI_POLZA_USE_DEDICATED_SETTINGS' USING ERRCODE='22023';END IF;
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

-- Existing grants on replaced functions remain intact. New internal helpers are never app-callable.
REVOKE ALL ON FUNCTION public.ai_generation_begin_before_budgets(uuid,uuid,uuid,jsonb,varchar,bigint,bigint) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION public.ai_polza_admin_config(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'configurationVersion', revision,
      'paidOperationsPerHour',(SELECT paid_operations_per_hour FROM public.ai_assistant_config WHERE singleton_key),
      'textConfigurationVersion',(SELECT configuration_version FROM public.ai_assistant_config WHERE singleton_key), 'enabled', enabled,
      'transcriptionEnabled', transcription_enabled,
      'dailySecondsLimit', daily_seconds_limit,
      'globalDailySecondsLimit', global_daily_seconds_limit,
      'maxAudioSeconds', max_audio_seconds,
      'apiKeyConfigured', api_key_ciphertext IS NOT NULL,
      'keyFingerprint', key_fingerprint,
      'updatedAt', updated_at
    ) FROM public.ai_polza_settings WHERE singleton_key
  );
END;
$$;
