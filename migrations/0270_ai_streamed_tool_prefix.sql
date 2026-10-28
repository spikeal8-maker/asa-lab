-- Preserve the visible Ollama prefix with the parent acknowledgement in the same admission transaction.
-- The ten-argument function remains available for admitted requests from earlier releases.
CREATE FUNCTION public.ai_tool_image_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_visible_prefix varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_tool_image_receipts%ROWTYPE;j public.ai_image_jobs%ROWTYPE;source uuid;inserted uuid;
BEGIN
 IF p_visible_prefix IS NULL OR octet_length(p_visible_prefix)>8388608 THEN RAISE EXCEPTION 'AI_RESPONSE_INVALID' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND archived_at IS NULL) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.ai_tool_image_receipts WHERE owner_principal_id=p_owner AND parent_request_id=p_parent;
 IF FOUND THEN
  IF r.thread_id<>p_thread OR r.prompt<>p_prompt OR r.size<>p_size THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED';END IF;
  SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=r.child_request_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
  RETURN to_jsonb(j);
 END IF;
 PERFORM 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND active_request_id=p_parent AND busy_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE='42501';END IF;
 SELECT m.id INTO source FROM public.ai_assistant_messages m WHERE m.owner_principal_id=p_owner AND m.thread_id=p_thread AND m.role='user'
 AND (m.request_id=p_parent OR m.id=(SELECT source_user_message_id FROM public.ai_assistant_regenerations WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_parent)) LIMIT 1;
 IF source IS NULL OR p_child=p_parent OR EXISTS(SELECT 1 FROM public.ai_assistant_request_quota WHERE owner_principal_id=p_owner AND request_id=p_child) OR EXISTS(SELECT 1 FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND request_id=p_child) THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_tool_request_receipts WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_parent AND payload->'nativeImage'->>'mode'='auto' AND (payload->'nativeImage'->>'size')::integer=p_size) THEN RAISE EXCEPTION 'AI_TOOL_ADMISSION_INVALID';END IF;
 INSERT INTO public.ai_tool_image_receipts(owner_principal_id,parent_request_id,thread_id,source_user_message_id,child_request_id,prompt,size,recipe)
 VALUES(p_owner,p_parent,p_thread,source,p_child,p_prompt,p_size,'flux2-klein-4b-v1');
 -- Parent acknowledgement and child admission commit together. Any failure rolls both back.
 PERFORM public.ai_chat_finish(p_owner,p_thread,p_parent,p_visible_prefix||CASE WHEN p_visible_prefix='' THEN '' ELSE E'\n\n' END||'Задание на создание изображения принято.','complete');
 PERFORM public.ai_image_begin(p_owner,p_thread,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest);
 SELECT id INTO inserted FROM public.ai_assistant_messages WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user' AND content=p_prompt;
 IF inserted IS NULL THEN RAISE EXCEPTION 'AI_TOOL_ADMISSION_INVALID';END IF;
 -- This row was inserted above in this transaction, never an existing/replayed user message.
 DELETE FROM public.ai_assistant_messages WHERE id=inserted AND owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user';
 SELECT * INTO STRICT j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child;
 RETURN to_jsonb(j);
END;$$;
REVOKE ALL ON FUNCTION public.ai_tool_image_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_tool_image_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar) TO asalab_app;
