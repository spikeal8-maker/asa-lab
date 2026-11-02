-- Extend current settings only; historical snapshots/receipts remain immutable.
UPDATE public.ai_tool_policy_settings SET revision=revision+1,tools=tools || jsonb_build_array(
 jsonb_build_object('id','read_page','enabled',COALESCE((SELECT (x->>'enabled')::boolean FROM jsonb_array_elements(tools) x WHERE x->>'id'='web_search'),false),'instructions',''),
 jsonb_build_object('id','create_working_file','enabled',true,'instructions',''),
 jsonb_build_object('id','read_working_file','enabled',true,'instructions',''),
 jsonb_build_object('id','edit_working_file','enabled',true,'instructions',''))
WHERE singleton_key AND jsonb_array_length(tools)=4;
ALTER TABLE public.ai_tool_policy_settings ALTER COLUMN tools SET DEFAULT '[{"id":"weather","enabled":true,"instructions":""},{"id":"web_search","enabled":true,"instructions":""},{"id":"image_search","enabled":true,"instructions":""},{"id":"generate_image","enabled":true,"instructions":""},{"id":"read_page","enabled":true,"instructions":""},{"id":"create_working_file","enabled":true,"instructions":""},{"id":"read_working_file","enabled":true,"instructions":""},{"id":"edit_working_file","enabled":true,"instructions":""}]'::jsonb;
CREATE OR REPLACE FUNCTION public.ai_tool_policy_set(p_actor uuid,p_expected bigint,p_request uuid,p_tools jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_tool_policy_settings%ROWTYPE;prior public.ai_tool_policy_writes%ROWTYPE;r jsonb;v_item jsonb;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 IF p_request IS NULL OR p_expected IS NULL OR p_expected<1 OR jsonb_typeof(p_tools) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tools)<>8 THEN RAISE EXCEPTION 'AI_TOOL_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF (SELECT count(DISTINCT x.value->>'id') FROM jsonb_array_elements(p_tools) x(value))<>8 OR (SELECT count(*) FROM jsonb_array_elements(p_tools) x(value) WHERE x.value->>'id' IN('weather','web_search','image_search','generate_image','read_page','create_working_file','read_working_file','edit_working_file'))<>8 THEN RAISE EXCEPTION 'AI_TOOL_POLICY_INVALID' USING ERRCODE='22023';END IF;
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_tools) LOOP
  IF jsonb_typeof(v_item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(v_item))<>3 OR NOT (v_item ?& ARRAY['id','enabled','instructions']) OR jsonb_typeof(v_item->'enabled')<>'boolean' OR jsonb_typeof(v_item->'instructions')<>'string' OR char_length(v_item->>'instructions')>3000 OR (v_item->>'instructions')~'[[:cntrl:]]' THEN RAISE EXCEPTION 'AI_TOOL_POLICY_INVALID' USING ERRCODE='22023';END IF;
 END LOOP;
 SELECT * INTO STRICT old FROM public.ai_tool_policy_settings WHERE singleton_key FOR UPDATE;
 SELECT * INTO prior FROM public.ai_tool_policy_writes WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF prior.expected_revision<>p_expected OR prior.payload<>p_tools THEN RAISE EXCEPTION 'AI_TOOL_POLICY_REQUEST_REUSED' USING ERRCODE='22023';END IF;
  RETURN prior.result;
 END IF;
 IF old.revision<>p_expected THEN RAISE EXCEPTION 'AI_TOOL_POLICY_CHANGED' USING ERRCODE='40001';END IF;
 UPDATE public.ai_tool_policy_settings SET revision=revision+1,tools=p_tools WHERE singleton_key;
 r:=public.ai_tool_policy_runtime();
 INSERT INTO public.ai_tool_policy_writes VALUES(p_actor,p_request,p_expected,p_tools,r);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_tool_policy.update','integration','ai','admin_console','Tool policy',NULL,p_request::text,p_request::text,'succeeded',old.revision,old.revision+1);
 RETURN r;
END;$$;

CREATE FUNCTION public.ai_tool_policy_permit(p_owner uuid,p_thread uuid,p_request uuid,p_tool text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE frozen jsonb;current_tools jsonb;snapshot_enabled boolean;
BEGIN
 IF p_tool NOT IN ('weather','web_search','image_search','generate_image','read_page','create_working_file','read_working_file','edit_working_file') OR p_tool IS NULL THEN RETURN false; END IF;
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(
  SELECT 1 FROM public.ai_assistant_threads t JOIN public.ai_assistant_request_quota q ON q.owner_principal_id=t.owner_principal_id AND q.request_id=p_request
  WHERE t.id=p_thread AND t.owner_principal_id=p_owner AND t.active_request_id=p_request AND t.busy_until>clock_timestamp()
 ) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 frozen:=public.ai_tool_policy_snapshot(p_owner,p_thread,p_request);
 SELECT tools INTO STRICT current_tools FROM public.ai_tool_policy_settings WHERE singleton_key FOR SHARE;
 SELECT (x->>'enabled')::boolean INTO snapshot_enabled FROM jsonb_array_elements(frozen->'tools') x WHERE x->>'id'=p_tool;
 IF snapshot_enabled IS NULL AND jsonb_array_length(frozen->'tools')=4 THEN
  IF p_tool='read_page' THEN
   SELECT (x->>'enabled')::boolean INTO snapshot_enabled FROM jsonb_array_elements(frozen->'tools') x WHERE x->>'id'='web_search';
  ELSIF p_tool IN ('create_working_file','read_working_file','edit_working_file') THEN snapshot_enabled:=true; END IF;
 END IF;
 IF p_tool='edit_working_file' AND NOT public.ai_tool_policy_permit(p_owner,p_thread,p_request,'read_working_file') THEN RETURN false; END IF;
 RETURN COALESCE(snapshot_enabled,false) AND EXISTS(SELECT 1 FROM jsonb_array_elements(current_tools) x WHERE x->>'id'=p_tool AND x->'enabled'='true'::jsonb);
END;$$;
REVOKE ALL ON FUNCTION public.ai_tool_policy_permit(uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_tool_policy_permit(uuid,uuid,uuid,text) TO asalab_app;
-- Serialize version creation with policy changes. Human restore and an already
-- admitted image completion retain their existing null-request semantics.
ALTER FUNCTION public.ai_working_file_write(uuid,uuid,text,integer,text,uuid,uuid,uuid,uuid,integer,text) RENAME TO ai_working_file_write_internal;
REVOKE ALL ON FUNCTION public.ai_working_file_write_internal(uuid,uuid,text,integer,text,uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_working_file_write(p_owner uuid,p_thread uuid,p_name text,p_expected integer,p_content text,p_operation uuid,p_request uuid,p_anchor uuid,p_source uuid,p_block integer,p_summary text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_request IS NOT NULL AND NOT public.ai_tool_policy_permit(p_owner,p_thread,p_request,CASE WHEN p_expected=0 THEN 'create_working_file' ELSE 'edit_working_file' END) THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN public.ai_working_file_write_internal(p_owner,p_thread,p_name,p_expected,p_content,p_operation,p_request,p_anchor,p_source,p_block,p_summary);
END;$$;
REVOKE ALL ON FUNCTION public.ai_working_file_write(uuid,uuid,text,integer,text,uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_working_file_write(uuid,uuid,text,integer,text,uuid,uuid,uuid,uuid,integer,text) TO asalab_app;

-- Check the current policy atomically with job admission, not at completion.
CREATE OR REPLACE FUNCTION public.ai_tool_policy_image_admission_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent uuid;
BEGIN
 SELECT parent_request_id INTO parent FROM public.ai_tool_image_receipts WHERE owner_principal_id=NEW.owner_principal_id AND thread_id=NEW.thread_id AND child_request_id=NEW.request_id;
 IF parent IS NOT NULL THEN
  IF NOT public.ai_tool_policy_permit(NEW.owner_principal_id,NEW.thread_id,parent,'generate_image') THEN RAISE EXCEPTION 'AI_IMAGE_DISABLED' USING ERRCODE='42501'; END IF;
 ELSE
  PERFORM 1 FROM public.ai_tool_policy_settings WHERE singleton_key FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.ai_tool_policy_settings s,jsonb_array_elements(s.tools) x WHERE s.singleton_key AND x->>'id'='generate_image' AND x->>'enabled'='true') THEN RAISE EXCEPTION 'AI_IMAGE_DISABLED' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE FUNCTION public.ai_tool_policy_binding_admission_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_tool_policy_permit(NEW.owner_principal_id,NEW.thread_id,NEW.parent_request_id,'edit_working_file') THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.ai_tool_policy_binding_admission_guard() FROM PUBLIC,asalab_app;
CREATE TRIGGER ai_tool_policy_binding_admission_guard BEFORE INSERT ON public.ai_image_file_bindings FOR EACH ROW EXECUTE FUNCTION public.ai_tool_policy_binding_admission_guard();
