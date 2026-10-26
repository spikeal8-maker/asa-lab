-- Native model tool provenance. Existing image dispatch CAS remains the only GPU submit boundary.
CREATE TABLE public.ai_tool_request_receipts (
 owner_principal_id uuid NOT NULL REFERENCES public.principals(id),
 request_id uuid NOT NULL,
 thread_id uuid NOT NULL REFERENCES public.ai_assistant_threads(id) ON DELETE CASCADE,
 payload jsonb NOT NULL,
 PRIMARY KEY(owner_principal_id,request_id)
);
ALTER TABLE public.ai_tool_request_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_tool_request_receipts FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_tool_request_options(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb,p_create boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_tool_request_receipts%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.ai_tool_request_receipts WHERE owner_principal_id=p_owner AND request_id=p_request;
 IF FOUND THEN
  IF r.thread_id<>p_thread OR r.payload<>p_payload THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';END IF;
  RETURN true;
 END IF;
 IF NOT p_create THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND active_request_id=p_request AND busy_until>clock_timestamp()) THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE='42501';END IF;
 IF p_payload->'nativeImage'->>'mode' NOT IN('auto','off') OR (p_payload->'nativeImage'->>'size')::integer NOT IN(512,768,1024) THEN RAISE EXCEPTION 'AI_TOOL_ADMISSION_INVALID';END IF;
 INSERT INTO public.ai_tool_request_receipts VALUES(p_owner,p_request,p_thread,p_payload);
 RETURN true;
END;$$;
REVOKE ALL ON FUNCTION public.ai_tool_request_options(uuid,uuid,uuid,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_tool_request_options(uuid,uuid,uuid,jsonb,boolean) TO asalab_app;
CREATE TABLE public.ai_tool_image_receipts (
 owner_principal_id uuid NOT NULL REFERENCES public.principals(id),
 parent_request_id uuid NOT NULL,
 thread_id uuid NOT NULL REFERENCES public.ai_assistant_threads(id) ON DELETE CASCADE,
 source_user_message_id uuid NOT NULL REFERENCES public.ai_assistant_messages(id) ON DELETE CASCADE,
 child_request_id uuid NOT NULL UNIQUE,
 prompt varchar(3000) NOT NULL,
 size integer NOT NULL CHECK(size IN(512,768,1024)),
 recipe varchar(40) NOT NULL CHECK(recipe='flux2-klein-4b-v1'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_principal_id,parent_request_id)
);
ALTER TABLE public.ai_tool_image_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_tool_image_receipts FROM PUBLIC,asalab_app;

-- 0259 writes a completion assistant row under the image job UUID. Native jobs
-- already have a visible parent acknowledgement, so keep the child row private.
CREATE FUNCTION public.ai_tool_image_suppress_child_message() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.role='assistant' AND EXISTS(SELECT 1 FROM public.ai_tool_image_receipts r WHERE r.owner_principal_id=NEW.owner_principal_id AND r.thread_id=NEW.thread_id AND r.child_request_id=NEW.request_id) THEN RETURN NULL;END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.ai_tool_image_suppress_child_message() FROM PUBLIC,asalab_app;
CREATE TRIGGER ai_tool_image_suppress_child_message BEFORE INSERT ON public.ai_assistant_messages FOR EACH ROW EXECUTE FUNCTION public.ai_tool_image_suppress_child_message();

CREATE FUNCTION public.ai_tool_image_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_tool_image_receipts%ROWTYPE;j public.ai_image_jobs%ROWTYPE;source uuid;inserted uuid;
BEGIN
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
 PERFORM public.ai_chat_finish(p_owner,p_thread,p_parent,'Задание на создание изображения принято.','complete');
 PERFORM public.ai_image_begin(p_owner,p_thread,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest);
 SELECT id INTO inserted FROM public.ai_assistant_messages WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user' AND content=p_prompt;
 IF inserted IS NULL THEN RAISE EXCEPTION 'AI_TOOL_ADMISSION_INVALID';END IF;
 -- This row was inserted above in this transaction, never an existing/replayed user message.
 DELETE FROM public.ai_assistant_messages WHERE id=inserted AND owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user';
 SELECT * INTO STRICT j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child;
 RETURN to_jsonb(j);
END;$$;

CREATE FUNCTION public.ai_tool_image_receipt(p_owner uuid,p_thread uuid,p_parent uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 RETURN (SELECT to_jsonb(j) FROM public.ai_tool_image_receipts r JOIN public.ai_image_jobs j ON j.owner_principal_id=r.owner_principal_id AND j.thread_id=r.thread_id AND j.request_id=r.child_request_id WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.parent_request_id=p_parent AND j.deleted_at IS NULL);
END;$$;

CREATE FUNCTION public.ai_tool_image_pending(p_owner uuid,p_thread uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(public.ai_image_get(p_owner,p_thread,x.child_request_id)) FROM (
  SELECT r.child_request_id FROM public.ai_tool_image_receipts r JOIN public.ai_image_jobs j ON j.owner_principal_id=r.owner_principal_id AND j.request_id=r.child_request_id
  WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND j.deleted_at IS NULL AND j.state NOT IN('complete','failed','cancelled') ORDER BY r.created_at DESC LIMIT 2
 ) x),'[]'::jsonb);
END;$$;

CREATE FUNCTION public.ai_tool_image_context(p_owner uuid,p_thread uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('prompt',x.prompt,'state',x.state,'model','FLUX.2 Klein 4B','size',x.size)) FROM (
  SELECT r.prompt,r.size,j.state FROM public.ai_tool_image_receipts r JOIN public.ai_image_jobs j ON j.owner_principal_id=r.owner_principal_id AND j.request_id=r.child_request_id
  WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND j.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 3
 ) x),'[]'::jsonb);
END;$$;

-- History uses the visible parent request. The child UUID remains the private image-job identity.
CREATE OR REPLACE FUNCTION public.ai_image_history(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE child uuid;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RETURN '[]';END IF;
 SELECT coalesce((SELECT r.child_request_id FROM public.ai_tool_image_receipts r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.parent_request_id=p_request),p_request) INTO child;
 RETURN coalesce((SELECT jsonb_build_array(jsonb_build_object('requestId',request_id,'width',size,'height',size,'mimeType','image/png','sizeBytes',size_bytes,'downloadUrl','/api/ai/threads/'||thread_id||'/image-generations/'||request_id||'/image')) FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=child AND state='complete' AND deleted_at IS NULL AND NOT cancel_requested),'[]');
END;$$;
CREATE OR REPLACE FUNCTION public.ai_image_kind(p_owner uuid,p_thread uuid,p_request uuid) RETURNS varchar LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.ai_chat_owner_valid(p_owner) AND EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) AND EXISTS(SELECT 1 FROM public.ai_image_jobs j WHERE j.owner_principal_id=p_owner AND j.thread_id=p_thread AND j.deleted_at IS NULL AND (j.request_id=p_request OR EXISTS(SELECT 1 FROM public.ai_tool_image_receipts r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.parent_request_id=p_request AND r.child_request_id=j.request_id))) THEN RETURN 'image';END IF;
 RETURN NULL;
END;$$;

-- A committed admission with a lost SQL reply is recoverable. CAS still permits one POST only.
CREATE OR REPLACE FUNCTION public.ai_image_dispatch(p_owner uuid,p_request uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;allowed boolean:=true;
BEGIN
 SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND request_id=p_request AND state='admitted' AND deleted_at IS NULL AND NOT cancel_requested FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 BEGIN
  PERFORM public.ai_chat_require_generation(p_owner);
 EXCEPTION WHEN SQLSTATE '42501' THEN allowed:=false;
 END;
 IF NOT allowed OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=j.thread_id AND owner_principal_id=p_owner AND archived_at IS NULL) THEN
  UPDATE public.ai_image_jobs SET state='cancelled',cancel_requested=true,error_code='ai_image_denied' WHERE owner_principal_id=p_owner AND request_id=p_request;
  UPDATE public.ai_usage_journal SET status='cancelled',finished_at=clock_timestamp(),error_code='ai_image_denied' WHERE owner_principal_id=p_owner AND request_id=p_request AND status IN('admitted','running');
  RETURN false;
 END IF;
 UPDATE public.ai_image_jobs SET state='submitting' WHERE owner_principal_id=p_owner AND request_id=p_request AND state='admitted' AND NOT cancel_requested;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE public.ai_usage_journal SET status='running',started_at=clock_timestamp() WHERE owner_principal_id=p_owner AND request_id=p_request;
 RETURN true;
END;$$;
CREATE OR REPLACE FUNCTION public.ai_image_claim(p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM public.ai_image_jobs WHERE (state IN('admitted','submitting','unknown','running','storing') OR cleanup_required)
 AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.ai_image_jobs SET lease_id=p_lease,lease_until=clock_timestamp()+interval '2 minutes' WHERE owner_principal_id=j.owner_principal_id AND request_id=j.request_id RETURNING * INTO j;
 RETURN to_jsonb(j);
END;$$;

REVOKE ALL ON FUNCTION public.ai_tool_image_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar),public.ai_tool_image_receipt(uuid,uuid,uuid),public.ai_tool_image_pending(uuid,uuid),public.ai_tool_image_context(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_tool_image_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar),public.ai_tool_image_receipt(uuid,uuid,uuid),public.ai_tool_image_pending(uuid,uuid),public.ai_tool_image_context(uuid,uuid) TO asalab_app;
