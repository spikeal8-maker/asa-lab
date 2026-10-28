-- The existing encrypted key remains the legacy route until the administrator saves the pool.
ALTER TABLE public.ai_ollama_cloud_catalog_state ADD COLUMN pool_managed boolean NOT NULL DEFAULT false;
CREATE TABLE public.ai_ollama_cloud_keys (
 slot smallint PRIMARY KEY CHECK(slot BETWEEN 1 AND 5),
 label varchar(64) NOT NULL, priority smallint NOT NULL CHECK(priority BETWEEN 1 AND 5),
 enabled boolean NOT NULL DEFAULT false, models jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(models)='array'),
 api_key_ciphertext varchar(4096), api_key_iv varchar(64), api_key_auth_tag varchar(64), key_fingerprint varchar(16),
 account jsonb, blocked_until timestamptz, blocked_models jsonb NOT NULL DEFAULT '{}',
 CONSTRAINT cloud_key_priority UNIQUE(priority) DEFERRABLE INITIALLY DEFERRED,
 CHECK ((api_key_ciphertext IS NULL AND api_key_iv IS NULL AND api_key_auth_tag IS NULL AND key_fingerprint IS NULL)
 OR (api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL AND api_key_auth_tag IS NOT NULL AND key_fingerprint IS NOT NULL))
);
INSERT INTO public.ai_ollama_cloud_keys(slot,label,priority) SELECT n,'Ключ '||n,n FROM generate_series(1,5) n;
UPDATE public.ai_ollama_cloud_keys k SET enabled=s.api_key_ciphertext IS NOT NULL,
 api_key_ciphertext=s.api_key_ciphertext,api_key_iv=s.api_key_iv,api_key_auth_tag=s.api_key_auth_tag,key_fingerprint=s.key_fingerprint,
 models=(SELECT jsonb_agg(id ORDER BY id) FROM public.ai_ollama_cloud_models WHERE active)
 FROM public.ai_provider_settings s WHERE k.slot=1 AND s.provider='ollama-cloud';
ALTER TABLE public.ai_ollama_cloud_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_ollama_cloud_keys FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_ollama_cloud_key_eligible(k public.ai_ollama_cloud_keys,p_model varchar,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT k.enabled AND k.api_key_ciphertext IS NOT NULL AND k.models?p_model
 AND (k.blocked_until IS NULL OR k.blocked_until<=p_at)
 AND (NOT k.blocked_models?p_model OR (k.blocked_models->>p_model)::timestamptz<=p_at)
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_key_eligible(public.ai_ollama_cloud_keys,varchar,timestamptz) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION public.ai_ollama_cloud_catalog_runtime() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('models',(SELECT jsonb_agg(jsonb_build_object('id',id,'model',model,'capabilities',capabilities,'active',active) ORDER BY id) FROM public.ai_ollama_cloud_models),
 'checkedAt',checked_at,'poolManaged',pool_managed,'availableModels',CASE WHEN pool_managed THEN
 (SELECT coalesce(jsonb_agg(m.id),'[]') FROM public.ai_ollama_cloud_models m WHERE m.active AND EXISTS(SELECT 1 FROM public.ai_ollama_cloud_keys k WHERE public.ai_ollama_cloud_key_eligible(k,m.id,statement_timestamp()))) ELSE NULL END)
 FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key
$$;
CREATE FUNCTION public.ai_ollama_cloud_pool_admin(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('configurationVersion',(SELECT configuration_version FROM public.ai_assistant_config WHERE singleton_key),
 'managed',(SELECT pool_managed FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key),
 'models',(public.ai_ollama_cloud_catalog_runtime()->'models'),
 'keys',(SELECT jsonb_agg(jsonb_build_object('slot',slot,'label',label,'priority',priority,'enabled',enabled,'configured',api_key_ciphertext IS NOT NULL,
 'fingerprint',key_fingerprint,'models',models,'account',account,'blockedUntil',CASE WHEN blocked_until='infinity'::timestamptz THEN NULL ELSE blocked_until END,
 'unavailableModels',(SELECT coalesce(jsonb_agg(key),'[]') FROM jsonb_each_text(blocked_models) WHERE value::timestamptz>statement_timestamp())) ORDER BY priority) FROM public.ai_ollama_cloud_keys));
END;$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_pool_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_pool_admin(uuid) TO asalab_app;

CREATE FUNCTION public.ai_ollama_cloud_pool_save(p_actor uuid,p_expected bigint,p_keys jsonb,p_request varchar) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.ai_assistant_config%ROWTYPE;k public.ai_ollama_cloud_keys%ROWTYPE;m jsonb;v_action text;v_models jsonb;v_changed boolean;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT c FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
 IF c.configuration_version IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001'; END IF;
 IF jsonb_typeof(p_keys) IS DISTINCT FROM 'array' OR jsonb_array_length(p_keys)<>5 OR p_request IS NULL OR char_length(p_request) NOT BETWEEN 1 AND 128
 OR (SELECT count(DISTINCT value->>'slot') FROM jsonb_array_elements(p_keys))<>5
 OR (SELECT count(DISTINCT value->>'priority') FROM jsonb_array_elements(p_keys))<>5 THEN RAISE EXCEPTION 'AI_CLOUD_POOL_INVALID' USING ERRCODE='22023'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(p_keys) LOOP
  IF (m->>'slot')::integer NOT BETWEEN 1 AND 5 OR (m->>'priority')::integer NOT BETWEEN 1 AND 5 OR char_length(m->>'label') NOT BETWEEN 1 AND 64
  OR jsonb_typeof(m->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(m->'models') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'models')>300
  OR m->>'action' NOT IN('keep','replace','clear') THEN RAISE EXCEPTION 'AI_CLOUD_POOL_INVALID' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(m->'models') x WHERE NOT EXISTS(SELECT 1 FROM public.ai_ollama_cloud_models WHERE id=x)) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT k FROM public.ai_ollama_cloud_keys WHERE slot=(m->>'slot')::integer FOR UPDATE;
  v_action:=m->>'action';v_changed:=v_action<>'keep';v_models:=m->'models';
  IF v_action='replace' AND (m->>'ciphertext' IS NULL OR m->>'iv' IS NULL OR m->>'tag' IS NULL OR m->>'fingerprint' IS NULL) THEN RAISE EXCEPTION 'AI_CLOUD_POOL_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.ai_ollama_cloud_keys SET label=m->>'label',priority=(m->>'priority')::integer,enabled=(m->>'enabled')::boolean AND v_action<>'clear',models=v_models,
   api_key_ciphertext=CASE v_action WHEN 'clear' THEN NULL WHEN 'replace' THEN m->>'ciphertext' ELSE k.api_key_ciphertext END,
   api_key_iv=CASE v_action WHEN 'clear' THEN NULL WHEN 'replace' THEN m->>'iv' ELSE k.api_key_iv END,
   api_key_auth_tag=CASE v_action WHEN 'clear' THEN NULL WHEN 'replace' THEN m->>'tag' ELSE k.api_key_auth_tag END,
   key_fingerprint=CASE v_action WHEN 'clear' THEN NULL WHEN 'replace' THEN m->>'fingerprint' ELSE k.key_fingerprint END,
   account=CASE WHEN v_changed THEN NULL ELSE k.account END,blocked_until=CASE WHEN v_changed THEN NULL ELSE k.blocked_until END,
   blocked_models=CASE WHEN v_changed THEN '{}'::jsonb ELSE k.blocked_models END WHERE slot=k.slot;
 END LOOP;
 IF EXISTS(SELECT key_fingerprint FROM public.ai_ollama_cloud_keys WHERE api_key_ciphertext IS NOT NULL GROUP BY key_fingerprint HAVING count(*)>1) THEN RAISE EXCEPTION 'AI_CLOUD_KEY_DUPLICATE' USING ERRCODE='22023'; END IF;
 SELECT * INTO k FROM public.ai_ollama_cloud_keys WHERE enabled AND api_key_ciphertext IS NOT NULL ORDER BY priority LIMIT 1;
 UPDATE public.ai_provider_settings SET api_key_ciphertext=k.api_key_ciphertext,api_key_iv=k.api_key_iv,api_key_auth_tag=k.api_key_auth_tag,key_fingerprint=k.key_fingerprint,updated_at=clock_timestamp() WHERE provider='ollama-cloud';
 UPDATE public.ai_assistant_config SET configuration_version=configuration_version+1,updated_at=clock_timestamp(),
  api_key_ciphertext=CASE WHEN provider='ollama-cloud' THEN k.api_key_ciphertext ELSE api_key_ciphertext END,
  api_key_iv=CASE WHEN provider='ollama-cloud' THEN k.api_key_iv ELSE api_key_iv END,
  api_key_auth_tag=CASE WHEN provider='ollama-cloud' THEN k.api_key_auth_tag ELSE api_key_auth_tag END,
  key_fingerprint=CASE WHEN provider='ollama-cloud' THEN k.key_fingerprint ELSE key_fingerprint END,
  enabled=CASE WHEN provider='ollama-cloud' AND k.api_key_ciphertext IS NULL THEN false ELSE enabled END WHERE singleton_key;
 UPDATE public.ai_ollama_cloud_catalog_state SET pool_managed=true WHERE singleton_key;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ollama_cloud.keys','integration','ollama-cloud','admin_console','Cloud key pool saved',NULL,p_request,p_request,'succeeded',c.configuration_version,c.configuration_version+1);
END;$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_pool_save(uuid,bigint,jsonb,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_pool_save(uuid,bigint,jsonb,varchar) TO asalab_app;

CREATE FUNCTION public.ai_ollama_cloud_pool_credentials(p_actor uuid) RETURNS SETOF public.ai_ollama_cloud_keys LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM public.ai_ollama_cloud_keys ORDER BY priority;
END;$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_pool_credentials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_pool_credentials(uuid) TO asalab_app;
CREATE FUNCTION public.ai_ollama_cloud_key_candidates(p_model varchar) RETURNS SETOF public.ai_ollama_cloud_keys LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT * FROM public.ai_ollama_cloud_keys k WHERE (SELECT pool_managed FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key)
 AND public.ai_ollama_cloud_key_eligible(k,p_model,statement_timestamp()) ORDER BY priority
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_key_candidates(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_key_candidates(varchar) TO asalab_app;

-- A stale response from a replaced key cannot poison the replacement. No configuration-version bump for observations.
CREATE FUNCTION public.ai_ollama_cloud_key_observe(p_slot integer,p_fingerprint varchar,p_account jsonb,p_until timestamptz,p_model varchar DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_account IS NOT NULL AND (jsonb_typeof(p_account) IS DISTINCT FROM 'object' OR pg_column_size(p_account)>8192) THEN RAISE EXCEPTION 'AI_CLOUD_POOL_INVALID' USING ERRCODE='22023';END IF;
 UPDATE public.ai_ollama_cloud_keys SET account=coalesce(p_account,account),
 blocked_until=CASE WHEN p_model IS NULL THEN p_until ELSE blocked_until END,
 blocked_models=CASE WHEN p_model IS NOT NULL THEN blocked_models||jsonb_build_object(p_model,p_until) ELSE blocked_models END
 WHERE slot=p_slot AND key_fingerprint=p_fingerprint
 AND (p_account IS NULL OR account IS NULL OR (p_account->>'checkedAt')::timestamptz >= (account->>'checkedAt')::timestamptz);
END;$$;
REVOKE ALL ON FUNCTION public.ai_ollama_cloud_key_observe(integer,varchar,jsonb,timestamptz,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_cloud_key_observe(integer,varchar,jsonb,timestamptz,varchar) TO asalab_app;

