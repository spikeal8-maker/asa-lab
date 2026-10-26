-- Administrative generation policy; no credentials or historical content are replaced.
CREATE TABLE public.ai_generation_policy (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), customized boolean NOT NULL DEFAULT false,
 system_prompt varchar(12000) NOT NULL DEFAULT '', allowed_models jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(allowed_models)='array'),
 default_model varchar(200)
);
INSERT INTO public.ai_generation_policy(singleton_key) VALUES(true);
CREATE TABLE public.ai_generation_policy_writes (
 actor uuid NOT NULL,request_id uuid NOT NULL,payload jsonb NOT NULL,result_revision bigint NOT NULL,PRIMARY KEY(actor,request_id)
);
CREATE TABLE public.ai_generation_receipts (
 owner_principal_id uuid NOT NULL REFERENCES public.principals(id),request_id uuid NOT NULL,thread_id uuid NOT NULL,
 model varchar(200) NOT NULL,provider varchar(24) NOT NULL,policy_revision bigint NOT NULL,
 payload_digest varchar(64) NOT NULL,template varchar(12000),context jsonb,PRIMARY KEY(owner_principal_id,request_id)
);
ALTER TABLE public.ai_generation_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_policy_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_generation_policy,public.ai_generation_policy_writes,public.ai_generation_receipts FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_generation_policy_runtime() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.ai_generation_policy%ROWTYPE;c public.ai_assistant_config%ROWTYPE;l public.ai_ollama_settings%ROWTYPE;allowed jsonb;def varchar;
BEGIN
 SELECT * INTO STRICT p FROM public.ai_generation_policy WHERE singleton_key;
 SELECT * INTO STRICT c FROM public.ai_assistant_config WHERE singleton_key;
 SELECT * INTO STRICT l FROM public.ai_ollama_settings WHERE singleton_key;
 allowed:=p.allowed_models;def:=p.default_model;
 IF NOT p.customized THEN
  SELECT coalesce(jsonb_agg(m),'[]') INTO allowed FROM unnest(ARRAY['gpt-6-luna','gpt-5-mini','gpt-4.1-mini','deepseek-flash','deepseek-v4-pro','gemma4:31b','gpt-oss:120b','gpt-oss:20b']) m
   WHERE c.enabled AND c.api_key_ciphertext IS NOT NULL AND public.ai_model_available(c.provider,m,statement_timestamp());
  IF l.enabled AND char_length(l.model)>0 THEN allowed:=allowed||jsonb_build_array('ollama-local');END IF;
  def:=CASE WHEN c.enabled AND c.api_key_ciphertext IS NOT NULL THEN c.model WHEN l.enabled AND char_length(l.model)>0 THEN 'ollama-local' ELSE NULL END;
 END IF;
 RETURN jsonb_build_object('revision',p.revision,'customized',p.customized,'systemPrompt',p.system_prompt,'allowedModels',allowed,'defaultModel',def,
  'providerReady',(SELECT jsonb_object_agg(provider,api_key_ciphertext IS NOT NULL) FROM public.ai_provider_settings),
  'localModel',nullif(l.model,''),'localEnabled',l.enabled);
END;
$$;
CREATE FUNCTION public.ai_generation_policy_get(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 RETURN public.ai_generation_policy_runtime();
END;
$$;
CREATE FUNCTION public.ai_generation_policy_set(p_actor uuid,p_input jsonb,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_generation_policy%ROWTYPE;previous public.ai_generation_policy_writes%ROWTYPE;m text;def text;v_provider text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT old FROM public.ai_generation_policy WHERE singleton_key FOR UPDATE;
 SELECT * INTO previous FROM public.ai_generation_policy_writes WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF previous.payload<>p_input THEN RAISE EXCEPTION 'AI_POLICY_REQUEST_REUSED' USING ERRCODE='22023';END IF;RETURN;END IF;
 IF p_request IS NULL OR jsonb_typeof(p_input)<>'object' OR char_length(p_input->>'systemPrompt') NOT BETWEEN 1 AND 12000
  OR jsonb_typeof(p_input->'allowedModels') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'allowedModels')>20
  OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_input->'allowedModels')) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF (p_input->>'configurationVersion')::bigint IS DISTINCT FROM old.revision THEN RAISE EXCEPTION 'AI_POLICY_CHANGED' USING ERRCODE='40001';END IF;
 FOR m IN SELECT jsonb_array_elements_text(p_input->'allowedModels') LOOP
  IF m<>'ollama-local' AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) v WHERE public.ai_model_available(v,m,statement_timestamp())) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END LOOP;
 def:=p_input->>'defaultModel';
 IF (def IS NULL)<>(jsonb_array_length(p_input->'allowedModels')=0) OR (def IS NOT NULL AND NOT (p_input->'allowedModels')?def) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF def='ollama-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_ollama_settings WHERE singleton_key AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF def IS NOT NULL THEN
  SELECT v INTO v_provider FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) v WHERE public.ai_model_provider_matches(v,def);
  IF NOT EXISTS(SELECT 1 FROM public.ai_provider_settings WHERE ai_provider_settings.provider=v_provider AND api_key_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END IF;
 UPDATE public.ai_generation_policy SET customized=true,system_prompt=p_input->>'systemPrompt',allowed_models=p_input->'allowedModels',default_model=def,revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_generation_policy_writes VALUES(p_actor,p_request,p_input,old.revision+1);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_generation.update','integration','ai','admin_console','Generation policy',NULL,p_request::text,p_request::text,'succeeded',old.revision,old.revision+1);
END;
$$;

CREATE FUNCTION public.ai_generation_runtime(p_model varchar) RETURNS TABLE(enabled boolean,provider varchar,model varchar,api_key_ciphertext varchar,api_key_iv varchar,api_key_auth_tag varchar,configuration_version bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT (public.ai_generation_policy_runtime()->'allowedModels')?p_model THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT c.enabled,s.provider,p_model,s.api_key_ciphertext,s.api_key_iv,s.api_key_auth_tag,c.configuration_version
  FROM public.ai_assistant_config c JOIN public.ai_provider_settings s ON public.ai_model_provider_matches(s.provider,p_model)
  WHERE c.singleton_key AND public.ai_model_available(s.provider,p_model,statement_timestamp());
END;
$$;
CREATE FUNCTION public.ai_generation_replay(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_generation_receipts%ROWTYPE;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.ai_generation_receipts WHERE owner_principal_id=p_owner AND request_id=p_request;
 IF NOT FOUND THEN RETURN false;END IF;
 IF r.thread_id<>p_thread OR r.payload_digest<>encode(sha256(convert_to(p_payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';END IF;
 RETURN true;
END;
$$;
CREATE FUNCTION public.ai_generation_begin(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb,p_model varchar,p_revision bigint,p_config bigint) RETURNS boolean
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
  IF v_provider IS NULL OR NOT c.enabled OR c.configuration_version IS DISTINCT FROM p_config
   OR NOT EXISTS(SELECT 1 FROM public.ai_provider_settings s WHERE s.provider=v_provider AND s.api_key_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
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
-- Old workers can replay existing results, but cannot ignore customized model policy for a fresh charge.
CREATE FUNCTION public.ai_generation_admission_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ai_generation_policy WHERE singleton_key AND customized) AND NOT EXISTS(SELECT 1 FROM public.ai_generation_receipts WHERE owner_principal_id=NEW.owner_principal_id AND request_id=NEW.request_id) THEN
  RAISE EXCEPTION 'AI_POLICY_WORKER_REQUIRED' USING ERRCODE='42501';END IF;RETURN NEW;
END;
$$;
CREATE TRIGGER ai_generation_admission_guard BEFORE INSERT ON public.ai_assistant_request_quota FOR EACH ROW EXECUTE FUNCTION public.ai_generation_admission_guard();
CREATE FUNCTION public.ai_generation_instructions(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('template',template,'context',context) INTO value FROM public.ai_generation_receipts WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_request;
 RETURN value;
END;
$$;
CREATE FUNCTION public.ai_generation_forget_thread() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN UPDATE public.ai_generation_receipts SET template=NULL,context=NULL WHERE owner_principal_id=OLD.owner_principal_id AND thread_id=OLD.id;RETURN OLD;END;
$$;
CREATE TRIGGER ai_generation_forget_thread BEFORE DELETE ON public.ai_assistant_threads FOR EACH ROW EXECUTE FUNCTION public.ai_generation_forget_thread();

-- The selected model is validated by immutable generation admission. Legacy paid tests still check their configured model.
CREATE OR REPLACE FUNCTION public.ai_paid_operation_reserve(p_operation varchar) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE lim integer;at timestamptz;v_provider varchar;model varchar;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN('chat','provider_test') THEN RAISE EXCEPTION 'AI_OPERATION_INVALID';END IF;
 UPDATE public.ai_assistant_config c SET paid_operations_per_hour=c.paid_operations_per_hour WHERE singleton_key RETURNING c.paid_operations_per_hour,c.provider,c.model INTO lim,v_provider,model;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_CONFIG_UNAVAILABLE';END IF;at:=clock_timestamp();
 IF (p_operation='provider_test' OR NOT EXISTS(SELECT 1 FROM public.ai_generation_policy WHERE singleton_key AND customized)) AND NOT public.ai_model_available(v_provider,model,at) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE';END IF;
 IF lim=0 OR (SELECT count(*) FROM public.ai_paid_operation_quota WHERE created_at>at-interval '1 hour')>=lim THEN RAISE EXCEPTION 'AI_PLATFORM_QUOTA_EXHAUSTED';END IF;
 INSERT INTO public.ai_paid_operation_quota(operation,created_at) VALUES(p_operation,at);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_generation_policy_runtime(),public.ai_generation_policy_get(uuid),public.ai_generation_policy_set(uuid,jsonb,uuid),public.ai_generation_runtime(varchar),public.ai_generation_replay(uuid,uuid,uuid,jsonb),public.ai_generation_begin(uuid,uuid,uuid,jsonb,varchar,bigint,bigint),public.ai_generation_instructions(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_generation_policy_runtime(),public.ai_generation_policy_get(uuid),public.ai_generation_policy_set(uuid,jsonb,uuid),public.ai_generation_runtime(varchar),public.ai_generation_replay(uuid,uuid,uuid,jsonb),public.ai_generation_begin(uuid,uuid,uuid,jsonb,varchar,bigint,bigint),public.ai_generation_instructions(uuid,uuid,uuid) TO asalab_app;
REVOKE ALL ON FUNCTION public.ai_generation_admission_guard(),public.ai_generation_forget_thread(),public.ai_paid_operation_reserve(varchar) FROM PUBLIC,asalab_app;

ALTER TABLE public.ai_web_search_settings ADD COLUMN allowed_domains jsonb NOT NULL DEFAULT '[]',ADD COLUMN blocked_domains jsonb NOT NULL DEFAULT '[]',ADD COLUMN search_instructions varchar(3000) NOT NULL DEFAULT '';
CREATE FUNCTION public.ai_web_search_policy_set(p_actor uuid,p_enabled boolean,p_weather boolean,p_limit integer,p_revision bigint,p_request varchar,p_allowed jsonb,p_blocked jsonb,p_instructions varchar)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d text;
BEGIN
 IF jsonb_typeof(p_allowed) IS DISTINCT FROM 'array' OR jsonb_typeof(p_blocked) IS DISTINCT FROM 'array' OR jsonb_array_length(p_allowed)>50 OR jsonb_array_length(p_blocked)>50 OR p_instructions IS NULL OR char_length(p_instructions)>3000 THEN RAISE EXCEPTION 'AI_WEB_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 FOR d IN SELECT jsonb_array_elements_text(p_allowed||p_blocked) LOOP
  IF char_length(d)>253 OR d!~'^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z][a-z0-9-]*$' OR d LIKE '%..%' THEN RAISE EXCEPTION 'AI_WEB_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 END LOOP;
 PERFORM public.ai_web_search_admin_set(p_actor,p_enabled,p_weather,p_limit,p_revision,p_request);
 UPDATE public.ai_web_search_settings SET allowed_domains=p_allowed,blocked_domains=p_blocked,search_instructions=p_instructions WHERE singleton_key;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_web_search_policy_set(uuid,boolean,boolean,integer,bigint,varchar,jsonb,jsonb,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_web_search_policy_set(uuid,boolean,boolean,integer,bigint,varchar,jsonb,jsonb,varchar) TO asalab_app;

CREATE OR REPLACE FUNCTION public.ai_web_search_evidence(p_owner uuid,p_thread uuid,p_request uuid,p_public boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_evidence jsonb;v_request uuid;v_images jsonb;
BEGIN
 SELECT m.request_id INTO v_request FROM public.ai_assistant_messages m WHERE m.thread_id=p_thread AND m.owner_principal_id=p_owner AND m.role='user'
  AND (m.request_id=p_request OR m.id=(SELECT r.source_user_message_id FROM public.ai_assistant_regenerations r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=p_request)) AND public.ai_chat_owner_valid(p_owner);
 IF v_request IS NULL THEN RETURN NULL;END IF;
 SELECT r.evidence INTO v_evidence FROM public.ai_web_search_receipts r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=v_request;
 IF p_public AND v_evidence IS NOT NULL THEN
  SELECT coalesce(jsonb_agg(i.value||jsonb_build_object('thumbnailUrl','/api/ai/threads/'||p_thread::text||'/web-search/'||v_request::text||'/images/'||(i.value->>'id')) ORDER BY i.ordinality),'[]'::jsonb)
   INTO v_images FROM jsonb_array_elements(coalesce(v_evidence->'images','[]'::jsonb)) WITH ORDINALITY i(value,ordinality);
  v_evidence:=jsonb_set(v_evidence-'searchInstructions','{images}',v_images);
 END IF;RETURN v_evidence;
END;
$$;
