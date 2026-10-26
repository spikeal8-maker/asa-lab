-- Additive cloud provider. Existing credentials, histories, owners and paid ledgers remain unchanged.
-- Official sources: https://docs.ollama.com/cloud and https://ollama.com/api/tags (2026-10-25).
CREATE OR REPLACE FUNCTION public.ai_model_provider_matches(p_provider varchar, p_model varchar)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT COALESCE(
    (p_provider='openai' AND p_model IN ('gpt-6-luna','gpt-5-mini','gpt-4.1-mini'))
    OR (p_provider='deepseek' AND p_model IN ('deepseek-flash','deepseek-v4-pro'))
    OR (p_provider='ollama-cloud' AND p_model IN ('gemma4:31b','gpt-oss:120b','gpt-oss:20b')), false)
$$;
REVOKE ALL ON FUNCTION public.ai_model_provider_matches(varchar,varchar) FROM PUBLIC,asalab_app;

ALTER TABLE public.ai_assistant_config DROP CONSTRAINT ai_assistant_config_provider_check;
ALTER TABLE public.ai_assistant_config ADD CONSTRAINT ai_assistant_config_provider_check
  CHECK(provider IN ('openai','deepseek','ollama-cloud'));
ALTER TABLE public.ai_provider_settings DROP CONSTRAINT ai_provider_settings_provider_check;
ALTER TABLE public.ai_provider_settings ADD CONSTRAINT ai_provider_settings_provider_check
  CHECK(provider IN ('openai','deepseek','ollama-cloud'));
INSERT INTO public.ai_provider_settings(provider,model) VALUES('ollama-cloud','gemma4:31b');

ALTER TABLE public.ai_usage_journal DROP CONSTRAINT ai_usage_journal_provider_check;
ALTER TABLE public.ai_usage_journal ADD CONSTRAINT ai_usage_journal_provider_check
  CHECK(provider IN ('openai','deepseek','ollama','ollama-cloud'));

CREATE OR REPLACE FUNCTION public.ai_usage_begin(p_owner uuid,p_thread uuid,p_request uuid,p_operation varchar,p_transport varchar,p_provider varchar,p_model varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_operation varchar;
BEGIN
    IF p_operation IS NULL OR p_operation NOT IN ('chat','regeneration') OR p_transport IS NULL OR p_transport NOT IN ('json','sse')
       OR p_provider IS NULL OR p_provider NOT IN ('openai','deepseek','ollama','ollama-cloud') OR p_model IS NULL
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

