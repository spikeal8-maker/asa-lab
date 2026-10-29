-- NULL overrides preserve current Qwen 120000/xhigh and other-model 120000/false behaviour.
-- Admin-selected inference controls share the existing revision CAS and audit.
ALTER TABLE public.ai_ollama_settings
  ADD COLUMN thinking varchar(40) CHECK (thinking ~ '^[a-z][a-z0-9_-]{0,39}$'),
  ADD COLUMN context_tokens integer CHECK (context_tokens BETWEEN 2048 AND 1048576);

CREATE FUNCTION public.ai_ollama_runtime_v2()
RETURNS TABLE (enabled boolean, base_url varchar, model varchar, revision bigint, thinking varchar, context_tokens integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT c.enabled, c.base_url, c.model, c.revision, c.thinking, c.context_tokens FROM public.ai_ollama_settings c
  WHERE c.singleton_key
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_runtime_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_runtime_v2() TO asalab_app;

CREATE FUNCTION public.ai_ollama_admin_get_v2(p_principal uuid)
RETURNS TABLE (
  enabled boolean, base_url varchar, model varchar,
  revision bigint, updated_at timestamptz, thinking varchar, context_tokens integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF public.admin_authorized_role(p_principal, 'platform', NULL)
    IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT c.enabled,c.base_url,c.model,c.revision,c.updated_at,c.thinking,c.context_tokens
    FROM public.ai_ollama_settings c WHERE c.singleton_key;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_admin_get_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_admin_get_v2(uuid) TO asalab_app;

CREATE FUNCTION public.ai_ollama_admin_set_v2(
  p_principal uuid, p_enabled boolean, p_url varchar, p_model varchar,
  p_expected_revision bigint, p_request_id varchar, p_thinking varchar, p_context_tokens integer
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_ollama_settings%ROWTYPE; next_revision bigint;
BEGIN
  IF public.admin_authorized_role(p_principal, 'platform', NULL)
    IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_enabled IS NULL OR p_url IS NULL OR char_length(p_url) NOT BETWEEN 15 AND 256
     OR p_model IS NULL OR char_length(p_model) NOT BETWEEN 1 AND 100
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_request_id IS NULL OR char_length(p_request_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'AI_OLLAMA_CONFIG_INVALID' USING ERRCODE='22023';
  END IF;
  IF (p_thinking IS NOT NULL AND p_thinking !~ '^[a-z][a-z0-9_-]{0,39}$') OR (p_context_tokens IS NOT NULL AND p_context_tokens NOT BETWEEN 2048 AND 1048576) THEN
    RAISE EXCEPTION 'AI_OLLAMA_CONFIG_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT old FROM public.ai_ollama_settings WHERE singleton_key FOR UPDATE;
  IF old.revision <> p_expected_revision THEN RAISE EXCEPTION 'AI_OLLAMA_CONFIG_CHANGED'; END IF;
  UPDATE public.ai_ollama_settings c SET
      enabled=p_enabled, base_url=p_url, model=p_model, thinking=coalesce(p_thinking,old.thinking), context_tokens=coalesce(p_context_tokens,old.context_tokens),
      revision=c.revision+1, updated_by_principal=p_principal, updated_at=clock_timestamp()
   WHERE c.singleton_key RETURNING c.revision INTO next_revision;
  PERFORM public.admin_append_audit_event(
      p_principal, 'platform', NULL, 'administration.ai_ollama.update',
      'integration', 'ollama', 'admin_console', 'Настройка локальной модели',
      NULL, p_request_id, p_request_id, 'succeeded',
      old.revision, next_revision
  );
  RETURN next_revision;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_admin_set_v2(uuid,boolean,varchar,varchar,bigint,varchar,varchar,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_admin_set_v2(uuid,boolean,varchar,varchar,bigint,varchar,varchar,integer) TO asalab_app;

