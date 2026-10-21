-- AI-OLLAMA-LAN-001: independent, optional private-network Ollama runtime.
-- No provider keys, paid-operation reservations, or changes to published 0214-0235.
-- Admission retains Account/Seat ownership, classroom permission, per-owner quota and UUID replay.
CREATE TABLE public.ai_ollama_settings (
  singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  enabled boolean NOT NULL DEFAULT false,
  base_url varchar(256) NOT NULL DEFAULT 'http://127.0.0.1:11434',
  model varchar(100) NOT NULL DEFAULT 'gemma4:12b',
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_principal uuid REFERENCES public.principals(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_ollama_settings(singleton_key) VALUES(true);
ALTER TABLE public.ai_ollama_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_ollama_settings FROM PUBLIC, asalab_app;

CREATE FUNCTION public.ai_ollama_runtime()
RETURNS TABLE (enabled boolean, base_url varchar, model varchar, revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT c.enabled, c.base_url, c.model, c.revision FROM public.ai_ollama_settings c
  WHERE c.singleton_key
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_runtime() TO asalab_app;

CREATE FUNCTION public.ai_ollama_admin_get(p_principal uuid)
RETURNS TABLE (
  enabled boolean, base_url varchar, model varchar,
  revision bigint, updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF public.admin_authorized_role(p_principal, 'platform', NULL)
    IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT c.enabled,c.base_url,c.model,c.revision,c.updated_at
    FROM public.ai_ollama_settings c WHERE c.singleton_key;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_ollama_admin_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_admin_get(uuid) TO asalab_app;

CREATE FUNCTION public.ai_ollama_admin_set(
  p_principal uuid, p_enabled boolean, p_url varchar, p_model varchar,
  p_expected_revision bigint, p_request_id varchar
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
  SELECT * INTO STRICT old FROM public.ai_ollama_settings WHERE singleton_key FOR UPDATE;
  IF old.revision <> p_expected_revision THEN RAISE EXCEPTION 'AI_OLLAMA_CONFIG_CHANGED'; END IF;
  UPDATE public.ai_ollama_settings c SET
      enabled=p_enabled, base_url=p_url, model=p_model,
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
REVOKE ALL ON FUNCTION public.ai_ollama_admin_set(uuid,boolean,varchar,varchar,bigint,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_ollama_admin_set(uuid,boolean,varchar,varchar,bigint,varchar) TO asalab_app;

-- Chat writes via trusted SQL; browser never supplies owner or local connection.
CREATE FUNCTION public.ai_text_begin_local(
  p_owner uuid, p_thread uuid, p_request uuid, p_text varchar, p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account uuid; existing_text varchar; existing_thread uuid;
        title varchar(120); local_config public.ai_ollama_settings%ROWTYPE;
BEGIN
  IF p_text IS NULL OR char_length(trim(p_text)) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT p.account_id INTO v_account FROM public.principals p WHERE p.id=p_owner;
  IF NOT public.ai_chat_owner_valid(p_owner) THEN
    RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
  SELECT m.thread_id,m.content INTO existing_thread,existing_text
    FROM public.ai_assistant_messages m
   WHERE m.owner_principal_id=p_owner AND m.request_id=p_request AND m.role='user';
  IF FOUND THEN
    IF existing_thread <> p_thread OR existing_text <> trim(p_text) THEN
      RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';
    END IF;
    RETURN false;
  END IF;
  IF EXISTS(SELECT 1 FROM public.ai_assistant_request_quota q
            WHERE q.owner_principal_id=p_owner AND q.request_id=p_request) THEN
    RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';
  END IF;
  v_account:=public.ai_chat_require_generation(p_owner);
  IF (SELECT count(*) FROM public.ai_assistant_request_quota q
      WHERE q.owner_principal_id=p_owner AND q.created_at > now()-interval '1 hour') >=30 THEN
    RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO STRICT local_config FROM public.ai_ollama_settings WHERE singleton_key FOR UPDATE;
  IF local_config.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'AI_CONFIG_CHANGED';
  END IF;
  IF NOT local_config.enabled THEN RAISE EXCEPTION 'AI_DISABLED'; END IF;
  title:=left(regexp_replace(trim(p_text), E'[\r\n]+',' ','g'),110);
  UPDATE public.ai_assistant_threads t SET
      busy_until=clock_timestamp()+interval '130 seconds',active_request_id=p_request,
      title=CASE WHEN t.title='Новый чат' THEN title ELSE t.title END,
      updated_at=clock_timestamp()
    WHERE t.id=p_thread AND t.owner_principal_id=p_owner
      AND (t.busy_until IS NULL OR t.busy_until<clock_timestamp());
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.ai_assistant_messages
    (thread_id,account_id,owner_principal_id,request_id,role,content)
    VALUES(p_thread,v_account,p_owner,p_request,'user',trim(p_text));
  INSERT INTO public.ai_assistant_request_quota (account_id,owner_principal_id,request_id)
    VALUES(v_account,p_owner,p_request);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_text_begin_local(uuid,uuid,uuid,varchar,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_text_begin_local(uuid,uuid,uuid,varchar,bigint) TO asalab_app;

CREATE FUNCTION public.ai_text_regenerate_begin_local(
  p_owner uuid,p_thread uuid,p_request uuid,p_source uuid,p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account uuid; source_message public.ai_assistant_messages%ROWTYPE;
        local_config public.ai_ollama_settings%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
  IF public.ai_text_regeneration_replay(p_owner,p_thread,p_request,p_source) THEN RETURN false; END IF;
  v_account:=public.ai_chat_require_generation(p_owner);
  SELECT * INTO source_message FROM public.ai_assistant_messages m
    WHERE m.id=p_source AND m.thread_id=p_thread AND m.owner_principal_id=p_owner
      AND m.role='user' AND char_length(m.content) BETWEEN 1 AND 3000;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.ai_assistant_request_quota q
      WHERE q.owner_principal_id=p_owner AND q.created_at > now()-interval '1 hour')>=30 THEN
    RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO STRICT local_config FROM public.ai_ollama_settings WHERE singleton_key FOR UPDATE;
  IF local_config.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'AI_CONFIG_CHANGED';
  END IF;
  IF NOT local_config.enabled THEN RAISE EXCEPTION 'AI_DISABLED'; END IF;
  UPDATE public.ai_assistant_threads t SET
      busy_until=clock_timestamp()+interval '130 seconds',
      active_request_id=p_request,updated_at=clock_timestamp()
    WHERE t.id=p_thread AND t.owner_principal_id=p_owner
      AND (t.busy_until IS NULL OR t.busy_until<clock_timestamp());
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.ai_assistant_request_quota(account_id,owner_principal_id,request_id)
    VALUES(v_account,p_owner,p_request);
  INSERT INTO public.ai_assistant_regenerations
      (owner_principal_id,request_id,thread_id,source_user_message_id,source_ordinal,source_prompt,source_digest)
    VALUES(p_owner,p_request,p_thread,p_source,source_message.ordinal,source_message.content,
      public.ai_text_source_digest(p_owner,p_thread,p_source,source_message.ordinal,source_message.content));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_text_regenerate_begin_local(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_text_regenerate_begin_local(uuid,uuid,uuid,uuid,bigint) TO asalab_app;
