-- Independent tool controls. Prompt revisions and hard safety limits stay separate.
CREATE TABLE public.ai_tool_policy_settings (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 tools jsonb NOT NULL DEFAULT '[{"id":"weather","enabled":true,"instructions":""},{"id":"web_search","enabled":true,"instructions":""},{"id":"image_search","enabled":true,"instructions":""},{"id":"generate_image","enabled":true,"instructions":""}]'::jsonb
);
INSERT INTO public.ai_tool_policy_settings(singleton_key) VALUES(true);
CREATE TABLE public.ai_tool_policy_writes (
 actor uuid NOT NULL REFERENCES public.principals(id),
 request_id uuid NOT NULL,
 expected_revision bigint NOT NULL,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(actor,request_id)
);
CREATE TABLE public.ai_tool_policy_snapshots (
 owner_principal_id uuid NOT NULL REFERENCES public.principals(id),
 request_id uuid NOT NULL,
 thread_id uuid NOT NULL REFERENCES public.ai_assistant_threads(id) ON DELETE CASCADE,
 policy jsonb NOT NULL,
 PRIMARY KEY(owner_principal_id,request_id),
 FOREIGN KEY(owner_principal_id,request_id) REFERENCES public.ai_assistant_request_quota(owner_principal_id,request_id)
);
ALTER TABLE public.ai_tool_policy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tool_policy_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tool_policy_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_tool_policy_settings,public.ai_tool_policy_writes,public.ai_tool_policy_snapshots FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_tool_policy_runtime() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('revision',revision,'tools',tools) FROM public.ai_tool_policy_settings WHERE singleton_key
$$;
CREATE FUNCTION public.ai_tool_policy_admin_get(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 RETURN public.ai_tool_policy_runtime();
END;$$;
CREATE FUNCTION public.ai_tool_policy_set(p_actor uuid,p_expected bigint,p_request uuid,p_tools jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_tool_policy_settings%ROWTYPE;prior public.ai_tool_policy_writes%ROWTYPE;r jsonb;v_item jsonb;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 IF p_request IS NULL OR p_expected IS NULL OR p_expected<1 OR jsonb_typeof(p_tools) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tools)<>4 THEN RAISE EXCEPTION 'AI_TOOL_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF (SELECT count(DISTINCT x.value->>'id') FROM jsonb_array_elements(p_tools) x(value))<>4 OR (SELECT count(*) FROM jsonb_array_elements(p_tools) x(value) WHERE x.value->>'id' IN('weather','web_search','image_search','generate_image'))<>4 THEN RAISE EXCEPTION 'AI_TOOL_POLICY_INVALID' USING ERRCODE='22023';END IF;
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
CREATE FUNCTION public.ai_tool_policy_snapshot(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE saved public.ai_tool_policy_snapshots%ROWTYPE;r jsonb;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO saved FROM public.ai_tool_policy_snapshots WHERE owner_principal_id=p_owner AND request_id=p_request;
 IF FOUND THEN
  IF saved.thread_id<>p_thread THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';END IF;
  RETURN saved.policy;
 END IF;
 PERFORM 1 FROM public.ai_assistant_threads t JOIN public.ai_assistant_request_quota q ON q.owner_principal_id=t.owner_principal_id AND q.request_id=p_request
  WHERE t.id=p_thread AND t.owner_principal_id=p_owner AND t.active_request_id=p_request AND t.busy_until>clock_timestamp() FOR UPDATE OF t;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE='42501';END IF;
 r:=public.ai_tool_policy_runtime();
 INSERT INTO public.ai_tool_policy_snapshots VALUES(p_owner,p_request,p_thread,r) ON CONFLICT(owner_principal_id,request_id) DO NOTHING;
 SELECT * INTO STRICT saved FROM public.ai_tool_policy_snapshots WHERE owner_principal_id=p_owner AND request_id=p_request;
 IF saved.thread_id<>p_thread THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';END IF;
 RETURN saved.policy;
END;$$;
CREATE FUNCTION public.ai_tool_policy_image_permit(p_owner uuid,p_thread uuid,p_request uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_request) THEN RETURN true;END IF;
 RETURN EXISTS(SELECT 1 FROM public.ai_tool_policy_settings s,jsonb_array_elements(s.tools) x WHERE s.singleton_key AND x->>'id'='generate_image' AND x->>'enabled'='true');
END;$$;
-- Close the read/admission race for manual image requests. Native child jobs
-- use the parent's immutable snapshot, so an already-admitted request remains valid.
CREATE FUNCTION public.ai_tool_policy_image_admission_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent uuid;snapshot jsonb;
BEGIN
 SELECT parent_request_id INTO parent FROM public.ai_tool_image_receipts WHERE owner_principal_id=NEW.owner_principal_id AND thread_id=NEW.thread_id AND child_request_id=NEW.request_id;
 IF parent IS NULL THEN PERFORM 1 FROM public.ai_tool_policy_settings WHERE singleton_key FOR SHARE;END IF;
 IF parent IS NOT NULL THEN
  SELECT policy INTO snapshot FROM public.ai_tool_policy_snapshots WHERE owner_principal_id=NEW.owner_principal_id AND thread_id=NEW.thread_id AND request_id=parent;
  IF snapshot IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'tools') x WHERE x->>'id'='generate_image' AND x->>'enabled'='true') THEN RAISE EXCEPTION 'AI_IMAGE_DISABLED' USING ERRCODE='42501';END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.ai_tool_policy_settings s,jsonb_array_elements(s.tools) x WHERE s.singleton_key AND x->>'id'='generate_image' AND x->>'enabled'='true') THEN
  RAISE EXCEPTION 'AI_IMAGE_DISABLED' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER ai_tool_policy_image_admission_guard BEFORE INSERT ON public.ai_image_jobs FOR EACH ROW EXECUTE FUNCTION public.ai_tool_policy_image_admission_guard();
REVOKE ALL ON FUNCTION public.ai_tool_policy_runtime(),public.ai_tool_policy_admin_get(uuid),public.ai_tool_policy_set(uuid,bigint,uuid,jsonb),public.ai_tool_policy_snapshot(uuid,uuid,uuid),public.ai_tool_policy_image_permit(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_tool_policy_runtime(),public.ai_tool_policy_admin_get(uuid),public.ai_tool_policy_set(uuid,bigint,uuid,jsonb),public.ai_tool_policy_snapshot(uuid,uuid,uuid),public.ai_tool_policy_image_permit(uuid,uuid,uuid) TO asalab_app;
REVOKE ALL ON FUNCTION public.ai_tool_policy_image_admission_guard() FROM PUBLIC,asalab_app;
