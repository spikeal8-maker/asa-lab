-- Explicit model policy: observations are metadata, never adapter or visibility grants.
ALTER TABLE public.ai_generation_policy ADD COLUMN model_preferences jsonb NOT NULL DEFAULT '[]', ADD COLUMN provider_order jsonb NOT NULL DEFAULT '{}';
-- Freeze the previously effective allowlist once; new providers/models require explicit publication.
-- A legacy default may already be unavailable. Preserve that identity for an explicit admin decision;
-- the seed does not admit a request and all subsequent writes retain the normal default guard.
ALTER TABLE public.ai_generation_policy DISABLE TRIGGER ai_provider_default_guard;
UPDATE public.ai_generation_policy p SET allowed_models=r.value->'allowedModels',default_model=r.value->>'defaultModel',customized=true
 FROM (SELECT public.ai_generation_policy_runtime() AS value) r WHERE NOT p.customized;
ALTER TABLE public.ai_generation_policy ENABLE TRIGGER ai_provider_default_guard;
CREATE TABLE public.ai_provider_catalog_observations (
 provider varchar(24) PRIMARY KEY CHECK(provider IN('openai','deepseek')),
 credential_revision bigint, credential_fingerprint varchar(16), checked_at timestamptz, failed boolean NOT NULL DEFAULT false, models jsonb NOT NULL DEFAULT '[]'
);
INSERT INTO public.ai_provider_catalog_observations(provider) VALUES('openai'),('deepseek');
ALTER TABLE public.ai_provider_catalog_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_provider_catalog_observations FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_selection_available(p_provider varchar,p_model varchar,p_at timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.ai_model_available(p_provider,p_model,p_at)
 AND (p_provider<>'ollama-cloud' OR NOT (SELECT pool_managed FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key) OR EXISTS(SELECT 1 FROM public.ai_ollama_cloud_key_candidates(p_model)))
 AND NOT EXISTS(SELECT 1 FROM public.ai_generation_policy p,jsonb_array_elements(p.model_preferences) m WHERE m->>'id'=p_model AND m->'eligible'='false'::jsonb)
 AND NOT EXISTS(SELECT 1 FROM public.ai_provider_catalog_observations o WHERE o.provider=p_provider AND checked_at IS NOT NULL AND (o.credential_fingerprint IS DISTINCT FROM (SELECT s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider=p_provider) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.models) m WHERE m->>'id'=p_model AND m->'active'='true'::jsonb)))
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
  'localModel',nullif(l.model,''),'localEnabled',l.enabled,
 'modelPreferences',p.model_preferences,'providerOrder',p.provider_order,
 'observations',(SELECT jsonb_agg(jsonb_build_object('provider',o.provider,'source',CASE WHEN o.provider='openai' THEN 'https://api.openai.com/v1/models' ELSE 'https://api.deepseek.com/models' END,'checkedAt',CASE WHEN o.credential_fingerprint IS NOT DISTINCT FROM (SELECT s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider=o.provider) THEN o.checked_at ELSE NULL END,'failed',o.failed,'credentialChanged',o.checked_at IS NOT NULL AND o.credential_fingerprint IS DISTINCT FROM (SELECT s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider=o.provider),'models',o.models) ORDER BY o.provider) FROM public.ai_provider_catalog_observations o));
END;
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
  IF m<>'ollama-local' AND NOT old.allowed_models?m AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) v WHERE public.ai_model_available(v,m,statement_timestamp())) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
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
   IF m NOT IN('openai','deepseek','ollama-cloud','ollama') OR jsonb_typeof(p_input->'providerOrder'->m) IS DISTINCT FROM 'number' OR (p_input->'providerOrder'->>m)::numeric<>trunc((p_input->'providerOrder'->>m)::numeric) OR abs((p_input->'providerOrder'->>m)::numeric)>1000000 THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  END LOOP;
 END IF;
 def:=p_input->>'defaultModel';
 IF (def IS NULL)<>(jsonb_array_length(p_input->'allowedModels')=0) OR (def IS NOT NULL AND NOT (p_input->'allowedModels')?def) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF def IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_input->'modelPreferences',old.model_preferences)) pref WHERE pref->>'id'=def AND pref->'eligible'='false'::jsonb) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF def IS NOT NULL AND def<>'ollama-local' AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) vprov WHERE public.ai_model_available(vprov,def,statement_timestamp()) AND (vprov<>'ollama-cloud' OR NOT (SELECT pool_managed FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key) OR EXISTS(SELECT 1 FROM public.ai_ollama_cloud_key_candidates(def))) AND NOT EXISTS(SELECT 1 FROM public.ai_provider_catalog_observations o WHERE o.provider=vprov AND o.checked_at IS NOT NULL AND (o.credential_fingerprint IS DISTINCT FROM (SELECT s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider=vprov) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.models) observed_model WHERE observed_model->>'id'=def AND observed_model->'active'='true'::jsonb)))) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF def='ollama-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_ollama_settings WHERE singleton_key AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF def IS NOT NULL THEN
  SELECT v INTO v_provider FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) v WHERE public.ai_model_provider_matches(v,def);
  IF NOT EXISTS(SELECT 1 FROM public.ai_provider_settings WHERE ai_provider_settings.provider=v_provider AND api_key_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END IF;
 UPDATE public.ai_generation_policy SET model_preferences=coalesce(p_input->'modelPreferences',old.model_preferences),provider_order=coalesce(p_input->'providerOrder',old.provider_order),customized=true,system_prompt=p_input->>'systemPrompt',allowed_models=p_input->'allowedModels',default_model=def,revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_generation_policy_writes VALUES(p_actor,p_request,p_input,old.revision+1);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_generation.update','integration','ai','admin_console','Generation policy',NULL,p_request::text,p_request::text,'succeeded',old.revision,old.revision+1);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_generation_runtime(p_model varchar) RETURNS TABLE(enabled boolean,provider varchar,model varchar,api_key_ciphertext varchar,api_key_iv varchar,api_key_auth_tag varchar,configuration_version bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT (public.ai_generation_policy_runtime()->'allowedModels')?p_model THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT s.enabled AND s.api_key_ciphertext IS NOT NULL,s.provider,p_model,s.api_key_ciphertext,s.api_key_iv,s.api_key_auth_tag,c.configuration_version
  FROM public.ai_assistant_config c JOIN public.ai_provider_settings s ON public.ai_model_provider_matches(s.provider,p_model)
  WHERE c.singleton_key AND public.ai_selection_available(s.provider,p_model,statement_timestamp());
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
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.model_preferences) pref WHERE pref->>'id'=p_model AND pref->'eligible'='false'::jsonb) THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 IF p_model='ollama-local' THEN
  SELECT * INTO STRICT l FROM public.ai_ollama_settings WHERE singleton_key FOR UPDATE;
  IF NOT l.enabled OR l.revision IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;v_provider:='ollama';
 ELSE
  SELECT * INTO STRICT c FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
  SELECT v INTO v_provider FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) v WHERE public.ai_selection_available(v,p_model,statement_timestamp());
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

CREATE FUNCTION public.ai_provider_catalog_credentials(p_actor uuid,p_provider varchar) RETURNS TABLE(api_key_ciphertext varchar,api_key_iv varchar,api_key_auth_tag varchar,revision bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT s.api_key_ciphertext,s.api_key_iv,s.api_key_auth_tag,s.revision FROM public.ai_provider_settings s WHERE s.provider=p_provider AND p_provider IN('openai','deepseek');
END;$$;
CREATE FUNCTION public.ai_provider_catalog_apply(p_actor uuid,p_provider varchar,p_revision bigint,p_models jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o public.ai_provider_catalog_observations%ROWTYPE; ident text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ai_provider_settings WHERE provider=p_provider AND revision=p_revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 SELECT * INTO STRICT o FROM public.ai_provider_catalog_observations WHERE provider=p_provider FOR UPDATE;
 IF p_models IS NULL THEN UPDATE public.ai_provider_catalog_observations SET failed=true WHERE provider=p_provider;RETURN;END IF;
 IF jsonb_typeof(p_models) IS DISTINCT FROM 'array' OR jsonb_array_length(p_models)>300 OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_models)) THEN RAISE EXCEPTION 'AI_CATALOG_INVALID' USING ERRCODE='22023';END IF;
 FOR ident IN SELECT jsonb_array_elements_text(p_models) LOOP
  IF ident!~'^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$' THEN RAISE EXCEPTION 'AI_CATALOG_INVALID' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT id) FROM (SELECT value->>'id' id FROM jsonb_array_elements(o.models) UNION SELECT jsonb_array_elements_text(p_models)) all_ids)>600 THEN RAISE EXCEPTION 'AI_CATALOG_INVALID' USING ERRCODE='22023';END IF;
 UPDATE public.ai_provider_catalog_observations SET credential_revision=p_revision,credential_fingerprint=(SELECT s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider=p_provider),checked_at=clock_timestamp(),failed=false,models=(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'active',p_models?id) ORDER BY id),'[]') FROM (SELECT value->>'id' id FROM jsonb_array_elements(o.models) UNION SELECT jsonb_array_elements_text(p_models)) ids) WHERE provider=p_provider;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_catalog.refresh','integration',p_provider,'admin_console','Metadata catalogue refreshed',NULL,gen_random_uuid()::text,gen_random_uuid()::text,'succeeded',NULL,NULL);
END;$$;
REVOKE ALL ON FUNCTION public.ai_selection_available(varchar,varchar,timestamptz) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.ai_provider_catalog_credentials(uuid,varchar),public.ai_provider_catalog_apply(uuid,varchar,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_provider_catalog_credentials(uuid,varchar),public.ai_provider_catalog_apply(uuid,varchar,bigint,jsonb) TO asalab_app;
