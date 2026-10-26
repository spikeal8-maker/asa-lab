-- Preserve complete assistant answers; user input admission limits remain unchanged.
ALTER TABLE public.ai_assistant_messages ALTER COLUMN content TYPE varchar;
ALTER TABLE public.ai_assistant_messages DROP CONSTRAINT ai_assistant_messages_content_check;
ALTER TABLE public.ai_assistant_messages ADD CONSTRAINT ai_assistant_messages_content_check
  CHECK (char_length(content) >= 1 AND (role = 'assistant' OR char_length(content) <= 8192));
CREATE OR REPLACE FUNCTION ai_chat_finish(
    p_principal uuid, p_thread uuid, p_request uuid, p_answer varchar, p_state varchar DEFAULT 'complete'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_inserted uuid; v_source uuid;
BEGIN
    IF p_state NOT IN ('complete', 'stopped') OR (p_answer IS NULL OR char_length(p_answer) < 1) THEN
        RAISE EXCEPTION 'AI_RESPONSE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_account FROM public.principals p WHERE p.id = p_principal;
    PERFORM 1 FROM public.ai_assistant_threads t
    WHERE t.id = p_thread AND t.owner_principal_id = p_principal AND t.active_request_id = p_request FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE = '42501'; END IF;
    SELECT m.id INTO v_source FROM public.ai_assistant_messages m
    WHERE m.thread_id = p_thread AND m.owner_principal_id = p_principal AND m.request_id = p_request AND m.role = 'user';
    IF v_source IS NULL THEN
        SELECT r.source_user_message_id INTO v_source FROM public.ai_assistant_regenerations r
        WHERE r.owner_principal_id = p_principal AND r.thread_id = p_thread AND r.request_id = p_request;
    END IF;
    IF v_source IS NULL THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.ai_assistant_messages
        (thread_id, account_id, owner_principal_id, request_id, role, content, state, source_user_message_id)
    VALUES (p_thread, v_account, p_principal, p_request, 'assistant', p_answer, p_state, v_source)
    ON CONFLICT (thread_id, role, request_id) DO NOTHING RETURNING id INTO v_inserted;
    UPDATE public.ai_assistant_threads SET busy_until = NULL, active_request_id = NULL, updated_at = clock_timestamp()
    WHERE id = p_thread AND owner_principal_id = p_principal AND active_request_id = p_request;
    RETURN v_inserted IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_text_begin_local(
  p_owner uuid, p_thread uuid, p_request uuid, p_text varchar, p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account uuid; existing_text varchar; existing_thread uuid;
        v_title varchar(120); local_config public.ai_ollama_settings%ROWTYPE;
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
  v_title:=left(regexp_replace(trim(p_text), E'[\r\n]+',' ','g'),110);
  UPDATE public.ai_assistant_threads t SET
      busy_until=clock_timestamp()+interval '1830 seconds',active_request_id=p_request,
      title=CASE WHEN t.title='Новый чат' THEN v_title ELSE t.title END,
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
      busy_until=clock_timestamp()+interval '1830 seconds',
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
