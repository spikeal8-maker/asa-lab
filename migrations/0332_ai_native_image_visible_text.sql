-- Save text already shown to the user in the same transaction as native image admission.
-- Keep the original signatures for API/SQL clients on the previous release.
CREATE FUNCTION public.ai_tool_image_visible_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar,p_visible_text varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_tool_image_receipts%ROWTYPE;j public.ai_image_jobs%ROWTYPE;source uuid;inserted uuid;
BEGIN
 IF p_visible_text IS NULL OR octet_length(p_visible_text)>8388608 THEN RAISE EXCEPTION 'AI_RESPONSE_INVALID' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND archived_at IS NULL) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ai_image_settings WHERE singleton_key FOR UPDATE;
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
 VALUES(p_owner,p_parent,p_thread,source,p_child,p_prompt,p_size,p_recipe);
 -- Parent acknowledgement and child admission commit together. Any failure rolls both back.
 PERFORM public.ai_chat_finish(p_owner,p_thread,p_parent,CASE WHEN btrim(p_visible_text)='' THEN 'Задание на создание изображения принято.' ELSE p_visible_text END,'complete');
 PERFORM public.ai_image_begin(p_owner,p_thread,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe);
 SELECT id INTO inserted FROM public.ai_assistant_messages WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user' AND content=p_prompt;
 IF inserted IS NULL THEN RAISE EXCEPTION 'AI_TOOL_ADMISSION_INVALID';END IF;
 -- This row was inserted above in this transaction, never an existing/replayed user message.
 DELETE FROM public.ai_assistant_messages WHERE id=inserted AND owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user';
 SELECT * INTO STRICT j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child;
 RETURN to_jsonb(j);
END;$$;

CREATE FUNCTION public.ai_tool_image_file_visible_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar,p_target jsonb,p_visible_text varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b public.ai_image_file_bindings%ROWTYPE; f public.ai_working_files%ROWTYPE; v public.ai_working_file_versions%ROWTYPE; r public.ai_tool_image_receipts%ROWTYPE; j jsonb; n integer;
BEGIN
 -- Retain the policy guard from the legacy entry point for fresh file bindings.
 IF NOT EXISTS(SELECT 1 FROM public.ai_image_file_bindings WHERE owner_principal_id=p_owner AND parent_request_id=p_parent) AND NOT public.ai_tool_policy_permit(p_owner,p_thread,p_parent,'edit_working_file') THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_target) IS DISTINCT FROM 'object' OR p_target->>'placeholder' IS DISTINCT FROM 'ASA_GENERATED_IMAGE_PENDING' OR jsonb_typeof(p_target->'name') IS DISTINCT FROM 'string' OR p_target->>'name' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,90}\.html$' OR p_target->>'name' LIKE '%..%' OR jsonb_typeof(p_target->'expectedVersion') IS DISTINCT FROM 'number' OR p_target->>'expectedVersion' !~ '^[1-9][0-9]?$' THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_target))<>3 THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 n:=(p_target->>'expectedVersion')::integer;
 SELECT * INTO b FROM public.ai_image_file_bindings WHERE owner_principal_id=p_owner AND parent_request_id=p_parent;
 IF FOUND THEN
  IF b.thread_id<>p_thread OR b.file_name<>p_target->>'name' OR b.expected_version<>n OR b.placeholder<>p_target->>'placeholder' THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
  RETURN public.ai_tool_image_visible_begin(p_owner,p_thread,p_parent,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe,p_visible_text);
 END IF;
 -- An old image receipt cannot be rebound to a new file by replaying it.
 IF EXISTS(SELECT 1 FROM public.ai_tool_image_receipts WHERE owner_principal_id=p_owner AND parent_request_id=p_parent) THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND active_request_id=p_parent AND archived_at IS NULL AND busy_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.ai_working_files WHERE owner_principal_id=p_owner AND thread_id=p_thread AND name=p_target->>'name';
 IF NOT FOUND OR f.head<>n THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT v FROM public.ai_working_file_versions WHERE file_id=f.id AND owner_principal_id=p_owner AND version=n;
 IF (length(v.content)-length(replace(v.content,p_target->>'placeholder','')))/length(p_target->>'placeholder')<>1 THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 j:=public.ai_tool_image_visible_begin(p_owner,p_thread,p_parent,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe,p_visible_text);
 SELECT * INTO STRICT r FROM public.ai_tool_image_receipts WHERE owner_principal_id=p_owner AND parent_request_id=p_parent;
 INSERT INTO public.ai_image_file_bindings(owner_principal_id,parent_request_id,child_request_id,thread_id,source_user_message_id,file_id,file_name,expected_version,placeholder)
 VALUES(p_owner,p_parent,r.child_request_id,p_thread,r.source_user_message_id,f.id,f.name,n,p_target->>'placeholder');
 RETURN j;
END;$$;

CREATE OR REPLACE FUNCTION public.ai_tool_image_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.ai_tool_image_visible_begin(p_owner,p_thread,p_parent,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe,''::varchar)
$$;
CREATE OR REPLACE FUNCTION public.ai_tool_image_file_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar,p_target jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.ai_tool_image_file_visible_begin(p_owner,p_thread,p_parent,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe,p_target,''::varchar)
$$;
REVOKE ALL ON FUNCTION public.ai_tool_image_visible_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar,varchar),public.ai_tool_image_file_visible_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar,jsonb,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_tool_image_visible_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar,varchar),public.ai_tool_image_file_visible_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar,jsonb,varchar) TO asalab_app;
