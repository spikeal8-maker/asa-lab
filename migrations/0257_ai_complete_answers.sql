-- Complete bounded code answers without changing historical messages or ownership.
ALTER TABLE public.ai_assistant_messages ALTER COLUMN content TYPE varchar(65536);
ALTER TABLE public.ai_assistant_messages DROP CONSTRAINT ai_assistant_messages_content_check;
ALTER TABLE public.ai_assistant_messages ADD CONSTRAINT ai_assistant_messages_content_check
  CHECK (char_length(content) BETWEEN 1 AND 65536);

-- Called only after successful canonical admission, before retrieval/generation.
-- The original immutable request and owner must still own the unexpired lease.
CREATE FUNCTION public.ai_chat_generation_lease(p_owner uuid,p_thread uuid,p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  UPDATE public.ai_assistant_threads SET busy_until=clock_timestamp()+interval '330 seconds'
  WHERE id=p_thread AND owner_principal_id=p_owner AND active_request_id=p_request
    AND busy_until>clock_timestamp() AND public.ai_chat_owner_valid(p_owner);
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_generation_lease(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_chat_generation_lease(uuid,uuid,uuid) TO asalab_app;

CREATE OR REPLACE FUNCTION ai_chat_finish(
    p_principal uuid, p_thread uuid, p_request uuid, p_answer varchar, p_state varchar DEFAULT 'complete'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_inserted uuid; v_source uuid;
BEGIN
    IF p_state NOT IN ('complete', 'stopped') OR char_length(p_answer) NOT BETWEEN 1 AND 65536 THEN
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
