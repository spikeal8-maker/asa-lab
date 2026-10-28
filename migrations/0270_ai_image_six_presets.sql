-- Six owner-approved image presets. IDs retain the existing integer wire/receipt format.
-- Square 512 jobs remain readable/recoverable, but cannot be selected for new admission.
ALTER TABLE public.ai_image_jobs DROP CONSTRAINT ai_image_jobs_size_check;
ALTER TABLE public.ai_image_jobs ADD CONSTRAINT ai_image_jobs_size_check CHECK(size IN(512,768,1024,1280,1536,720,864));
ALTER TABLE public.ai_tool_image_receipts DROP CONSTRAINT ai_tool_image_receipts_size_check;
ALTER TABLE public.ai_tool_image_receipts ADD CONSTRAINT ai_tool_image_receipts_size_check CHECK(size IN(512,768,1024,1280,1536,720,864));
ALTER TABLE public.ai_image_settings ALTER COLUMN sizes SET DEFAULT '[768,1024,1280,1536,720,864]';
-- Explicit catalogue rollout requested by the owner; preserve enablement, quota and GPU concurrency.
UPDATE public.ai_image_settings SET sizes='[768,1024,1280,1536,720,864]',revision=revision+1 WHERE singleton_key;
CREATE FUNCTION public.ai_image_height(p_size integer) RETURNS integer LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE p_size WHEN 512 THEN 512 WHEN 768 THEN 768 WHEN 1024 THEN 1024 WHEN 1280 THEN 720 WHEN 1536 THEN 864 WHEN 720 THEN 1280 WHEN 864 THEN 1536 ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.ai_image_height(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_image_height(integer) TO asalab_app;
CREATE OR REPLACE FUNCTION public.ai_image_config_set(p_actor uuid,p_input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_image_settings%ROWTYPE;r uuid;prior jsonb;v text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;r:=(p_input->>'requestId')::uuid;
 SELECT * INTO STRICT old FROM public.ai_image_settings WHERE singleton_key FOR UPDATE;
 SELECT payload INTO prior FROM public.ai_image_settings_writes WHERE actor=p_actor AND request_id=r;
 IF FOUND THEN IF prior<>p_input THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED';END IF;RETURN;END IF;
 IF (p_input->>'configurationVersion')::bigint<>old.revision THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_input->'sizes') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_input->'sizes') NOT BETWEEN 1 AND 6 OR (p_input->>'dailyLimit')::integer NOT BETWEEN 1 AND 100
 OR (p_input->>'globalConcurrency')::integer NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'AI_IMAGE_CONFIG_INVALID';END IF;
 FOR v IN SELECT jsonb_array_elements_text(p_input->'sizes') LOOP IF v NOT IN('768','1024','1280','1536','720','864') THEN RAISE EXCEPTION 'AI_IMAGE_CONFIG_INVALID';END IF;END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'sizes') AS x(value) WHERE jsonb_typeof(x.value)<>'number') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_input->'sizes') AS x(value))<>jsonb_array_length(p_input->'sizes') THEN RAISE EXCEPTION 'AI_IMAGE_CONFIG_INVALID';END IF;
 UPDATE public.ai_image_settings SET enabled=(p_input->>'enabled')::boolean,daily_limit=(p_input->>'dailyLimit')::integer,
 global_concurrency=(p_input->>'globalConcurrency')::integer,sizes=p_input->'sizes',revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_image_settings_writes VALUES(p_actor,r,p_input);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_images.update','integration','ai','admin_console','Local image generation',NULL,r::text,r::text,'succeeded',old.revision,old.revision+1);
END;$$;
CREATE OR REPLACE FUNCTION public.ai_tool_request_options(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb,p_create boolean)
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
 IF p_payload->'nativeImage'->>'mode' NOT IN('auto','off') OR (p_payload->'nativeImage'->>'size')::integer NOT IN(768,1024,1280,1536,720,864) THEN RAISE EXCEPTION 'AI_TOOL_ADMISSION_INVALID';END IF;
 INSERT INTO public.ai_tool_request_receipts VALUES(p_owner,p_request,p_thread,p_payload);
 RETURN true;
END;$$;
CREATE OR REPLACE FUNCTION public.ai_image_history(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE child uuid;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RETURN '[]';END IF;
 SELECT coalesce((SELECT r.child_request_id FROM public.ai_tool_image_receipts r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.parent_request_id=p_request),p_request) INTO child;
 RETURN coalesce((SELECT jsonb_build_array(jsonb_build_object('requestId',request_id,'width',size,'height',public.ai_image_height(size),'mimeType','image/png','sizeBytes',size_bytes,'downloadUrl','/api/ai/threads/'||thread_id||'/image-generations/'||request_id||'/image')) FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=child AND state='complete' AND deleted_at IS NULL AND NOT cancel_requested),'[]');
END;$$;
