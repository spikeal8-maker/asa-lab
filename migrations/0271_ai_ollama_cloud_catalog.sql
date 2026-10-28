-- One saved Ollama Cloud key; public metadata catalogue is server-owned, never client authority.
ALTER TABLE public.ai_assistant_config ALTER COLUMN model TYPE varchar(128);
ALTER TABLE public.ai_provider_settings ALTER COLUMN model TYPE varchar(128);
CREATE TABLE public.ai_ollama_cloud_models (
 id varchar(128) PRIMARY KEY, model varchar(80) NOT NULL UNIQUE,
 capabilities jsonb NOT NULL CHECK(jsonb_typeof(capabilities)='array'),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.ai_ollama_cloud_catalog_state (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),
 revision bigint NOT NULL DEFAULT 1, checked_at timestamptz
);
INSERT INTO public.ai_ollama_cloud_catalog_state(singleton_key) VALUES(true);
INSERT INTO public.ai_ollama_cloud_models(id,model,capabilities) VALUES
 ('gemma4:31b','gemma4:31b','["completion","vision"]'),
 ('gpt-oss:120b','gpt-oss:120b','["completion"]'),('gpt-oss:20b','gpt-oss:20b','["completion"]');
ALTER TABLE public.ai_ollama_cloud_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_ollama_cloud_catalog_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_ollama_cloud_models,public.ai_ollama_cloud_catalog_state FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_ollama_cloud_catalog_runtime() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('models',(SELECT jsonb_agg(jsonb_build_object('id',id,'model',model,'capabilities',capabilities,'active',active) ORDER BY id) FROM public.ai_ollama_cloud_models),'checkedAt',checked_at) FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_catalog_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_catalog_runtime() TO asalab_app;
CREATE FUNCTION public.ai_ollama_cloud_admin_credentials(p_actor uuid) RETURNS TABLE(api_key_ciphertext varchar,api_key_iv varchar,api_key_auth_tag varchar,key_fingerprint varchar) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT s.api_key_ciphertext,s.api_key_iv,s.api_key_auth_tag,s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider='ollama-cloud';
END;$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_admin_credentials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_admin_credentials(uuid) TO asalab_app;
CREATE FUNCTION public.ai_ollama_cloud_catalog_apply(p_actor uuid,p_expected bigint,p_models jsonb,p_request varchar) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.ai_assistant_config%ROWTYPE;r public.ai_ollama_cloud_catalog_state%ROWTYPE;m jsonb;name text;ident text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT c FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
 IF c.configuration_version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_models) IS DISTINCT FROM 'array' OR jsonb_array_length(p_models) NOT BETWEEN 1 AND 300 OR p_request IS NULL OR char_length(p_request) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'AI_CLOUD_CATALOG_INVALID' USING ERRCODE='22023';END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_models))<>jsonb_array_length(p_models) OR (SELECT count(DISTINCT value->>'model') FROM jsonb_array_elements(p_models))<>jsonb_array_length(p_models) THEN RAISE EXCEPTION 'AI_CLOUD_CATALOG_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT r FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key FOR UPDATE;
 FOR m IN SELECT value FROM jsonb_array_elements(p_models) LOOP
  name:=m->>'model';ident:=m->>'id';
  IF name IS NULL OR name!~'^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$' OR ident IS DISTINCT FROM (CASE WHEN name IN('gemma4:31b','gpt-oss:120b','gpt-oss:20b') THEN name ELSE 'ollama-cloud/'||name END) OR jsonb_typeof(m->'capabilities') IS DISTINCT FROM 'array' OR NOT ((m->'capabilities')?'completion') OR jsonb_array_length(m->'capabilities')>32 THEN RAISE EXCEPTION 'AI_CLOUD_CATALOG_INVALID' USING ERRCODE='22023';END IF;
 END LOOP;
 UPDATE public.ai_ollama_cloud_models SET active=false;
 FOR m IN SELECT value FROM jsonb_array_elements(p_models) LOOP
  INSERT INTO public.ai_ollama_cloud_models(id,model,capabilities,active) VALUES(m->>'id',m->>'model',m->'capabilities',true)
  ON CONFLICT(id) DO UPDATE SET capabilities=excluded.capabilities,active=true;
 END LOOP;
 UPDATE public.ai_ollama_cloud_catalog_state SET revision=revision+1,checked_at=clock_timestamp() WHERE singleton_key;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ollama_cloud.catalog','integration','ollama-cloud','admin_console','Cloud catalogue refreshed',NULL,p_request,p_request,'succeeded',r.revision,r.revision+1);
END;$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_catalog_apply(uuid,bigint,jsonb,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_catalog_apply(uuid,bigint,jsonb,varchar) TO asalab_app;
CREATE OR REPLACE FUNCTION public.ai_model_provider_matches(p_provider varchar,p_model varchar) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((p_provider='openai' AND p_model IN('gpt-6-luna','gpt-5-mini','gpt-4.1-mini')) OR (p_provider='deepseek' AND p_model IN('deepseek-flash','deepseek-v4-pro')) OR (p_provider='ollama-cloud' AND EXISTS(SELECT 1 FROM public.ai_ollama_cloud_models WHERE id=p_model AND active)),false)
$$;
ALTER FUNCTION public.ai_model_available(varchar,varchar,timestamptz) STABLE;
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
  'providerReady',(SELECT jsonb_object_agg(provider,api_key_ciphertext IS NOT NULL) FROM public.ai_provider_settings),
  'localModel',nullif(l.model,''),'localEnabled',l.enabled);
END;
$$;
