-- Additive owner-verified generation lease after immutable 0261_ai_long_answers.sql.
-- Do not restore obsolete varchar(65536) or re-define main ai_chat_finish.
CREATE FUNCTION public.ai_chat_generation_lease(p_owner uuid,p_thread uuid,p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  UPDATE public.ai_assistant_threads SET busy_until=clock_timestamp()+interval '1830 seconds'
  WHERE id=p_thread AND owner_principal_id=p_owner AND active_request_id=p_request
    AND busy_until>clock_timestamp() AND public.ai_chat_owner_valid(p_owner);
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_generation_lease(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_chat_generation_lease(uuid,uuid,uuid) TO asalab_app;
