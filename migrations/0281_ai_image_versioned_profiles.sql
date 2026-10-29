-- Versioned graphs: preserve v1 rows and admit recipe together with its digest.
ALTER TABLE public.ai_image_settings ADD COLUMN recipe varchar(40) NOT NULL DEFAULT 'flux2-klein-4b-v1' CHECK(recipe IN('flux2-klein-4b-v1','flux2-klein-4b-fp8-izo-v1'));
ALTER TABLE public.ai_image_jobs DROP CONSTRAINT ai_image_jobs_recipe_check;
ALTER TABLE public.ai_image_jobs ADD CONSTRAINT ai_image_jobs_recipe_check CHECK(recipe IN('flux2-klein-4b-v1','flux2-klein-4b-fp8-izo-v1'));
ALTER TABLE public.ai_tool_image_receipts DROP CONSTRAINT ai_tool_image_receipts_recipe_check;
ALTER TABLE public.ai_tool_image_receipts ADD CONSTRAINT ai_tool_image_receipts_recipe_check CHECK(recipe IN('flux2-klein-4b-v1','flux2-klein-4b-fp8-izo-v1'));
CREATE OR REPLACE FUNCTION public.ai_image_config(p_actor uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_actor IS NOT NULL THEN IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;END IF;
 RETURN (SELECT jsonb_build_object('configurationVersion',revision,'enabled',enabled,'dailyLimit',daily_limit,'globalConcurrency',global_concurrency,'sizes',sizes,'recipe',recipe) FROM public.ai_image_settings WHERE singleton_key);
END;$$;
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
 IF p_input ? 'recipe' AND (jsonb_typeof(p_input->'recipe') IS DISTINCT FROM 'string' OR p_input->>'recipe' NOT IN('flux2-klein-4b-v1','flux2-klein-4b-fp8-izo-v1')) THEN RAISE EXCEPTION 'AI_IMAGE_CONFIG_INVALID';END IF;
 IF p_input ? 'recipe' AND p_input->>'recipe'<>old.recipe AND (
 EXISTS(SELECT 1 FROM public.ai_image_jobs WHERE state IN('admitted','submitting','unknown','running','storing')) OR
 EXISTS(SELECT 1 FROM public.ai_tool_request_receipts r JOIN public.ai_assistant_threads t ON t.owner_principal_id=r.owner_principal_id AND t.id=r.thread_id AND t.active_request_id=r.request_id WHERE t.busy_until>clock_timestamp() AND r.payload->'nativeImage'->>'mode'='auto')
 ) THEN RAISE EXCEPTION 'AI_IMAGE_BUSY';END IF;
 UPDATE public.ai_image_settings SET recipe=coalesce(p_input->>'recipe',old.recipe), enabled=(p_input->>'enabled')::boolean,daily_limit=(p_input->>'dailyLimit')::integer,
 global_concurrency=(p_input->>'globalConcurrency')::integer,sizes=p_input->'sizes',revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_image_settings_writes VALUES(p_actor,r,p_input);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_images.update','integration','ai','admin_console','Local image generation',NULL,r::text,r::text,'succeeded',old.revision,old.revision+1);
END;$$;
CREATE OR REPLACE FUNCTION public.ai_generation_admission_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ai_generation_policy WHERE singleton_key AND customized)
 AND NOT EXISTS(SELECT 1 FROM public.ai_generation_receipts WHERE owner_principal_id=NEW.owner_principal_id AND request_id=NEW.request_id)
 AND NOT EXISTS(SELECT 1 FROM public.ai_image_jobs j JOIN public.ai_assistant_threads t ON t.id=j.thread_id AND t.owner_principal_id=j.owner_principal_id
 WHERE j.owner_principal_id=NEW.owner_principal_id AND j.request_id=NEW.request_id AND j.state='admitted' AND j.deleted_at IS NULL
 AND j.recipe IN('flux2-klein-4b-v1','flux2-klein-4b-fp8-izo-v1') AND j.prompt IS NOT NULL AND public.ai_chat_owner_valid(j.owner_principal_id))
 THEN RAISE EXCEPTION 'AI_POLICY_WORKER_REQUIRED' USING ERRCODE='42501';END IF;RETURN NEW;
END;$$;
CREATE FUNCTION public.ai_image_begin(p_owner uuid,p_thread uuid,p_request uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.ai_image_settings%ROWTYPE;j public.ai_image_jobs%ROWTYPE;a uuid;d text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 d:=encode(sha256(convert_to(jsonb_build_array(p_prompt,p_size)::text,'UTF8')),'hex');
 SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND request_id=p_request;
 IF FOUND THEN
  IF j.thread_id<>p_thread OR j.payload_digest<>d OR j.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED';END IF;
  RETURN public.ai_image_get(p_owner,p_thread,p_request);
 END IF;
 IF EXISTS(SELECT 1 FROM public.ai_assistant_request_quota WHERE owner_principal_id=p_owner AND request_id=p_request) THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED';END IF;
 SELECT * INTO STRICT c FROM public.ai_image_settings WHERE singleton_key FOR UPDATE;
 IF p_recipe IS DISTINCT FROM c.recipe THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF NOT c.enabled THEN RAISE EXCEPTION 'AI_IMAGE_DISABLED';END IF;
 IF p_ready IS DISTINCT FROM true THEN RAISE EXCEPTION 'AI_IMAGE_UNAVAILABLE';END IF;
 a:=public.ai_chat_require_generation(p_owner);
 IF p_prompt IS NULL OR char_length(btrim(p_prompt)) NOT BETWEEN 1 AND 3000 OR NOT c.sizes@>to_jsonb(ARRAY[p_size]) THEN RAISE EXCEPTION 'AI_IMAGE_INPUT_INVALID';END IF;
 PERFORM 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND archived_at IS NULL AND (busy_until IS NULL OR busy_until<clock_timestamp()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED';END IF;
 IF (SELECT count(*) FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=c.daily_limit THEN RAISE EXCEPTION 'AI_IMAGE_QUOTA_EXHAUSTED';END IF;
 IF (SELECT count(*) FROM public.ai_image_jobs WHERE state IN('admitted','submitting','unknown','running','storing'))>=c.global_concurrency THEN RAISE EXCEPTION 'AI_IMAGE_BUSY';END IF;
 INSERT INTO public.ai_image_jobs(owner_principal_id,request_id,thread_id,provider_id,marker,seed,prompt,payload_digest,graph_digest,size,settings_snapshot,recipe)
 VALUES(p_owner,p_request,p_thread,p_provider,'ASA_'||replace(p_provider::text,'-',''),p_seed,p_prompt,d,p_graph_digest,p_size,public.ai_image_config(),p_recipe);
 INSERT INTO public.ai_assistant_request_quota(account_id,owner_principal_id,request_id) VALUES(a,p_owner,p_request);
 UPDATE public.ai_usage_journal SET thread_id=p_thread,operation='image',transport='json',provider='comfyui',requested_model='flux-2-klein-4b-fp8.safetensors' WHERE owner_principal_id=p_owner AND request_id=p_request;
 INSERT INTO public.ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content) VALUES(p_thread,a,p_owner,p_request,'user',p_prompt);
 UPDATE public.ai_assistant_threads SET updated_at=clock_timestamp() WHERE id=p_thread;
 RETURN public.ai_image_get(p_owner,p_thread,p_request);
END;$$;
CREATE OR REPLACE FUNCTION public.ai_image_begin(p_owner uuid,p_thread uuid,p_request uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.ai_image_begin(p_owner,p_thread,p_request,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,'flux2-klein-4b-v1'::varchar)
$$;
CREATE FUNCTION public.ai_tool_image_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_tool_image_receipts%ROWTYPE;j public.ai_image_jobs%ROWTYPE;source uuid;inserted uuid;
BEGIN
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
 PERFORM public.ai_chat_finish(p_owner,p_thread,p_parent,'Задание на создание изображения принято.','complete');
 PERFORM public.ai_image_begin(p_owner,p_thread,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe);
 SELECT id INTO inserted FROM public.ai_assistant_messages WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user' AND content=p_prompt;
 IF inserted IS NULL THEN RAISE EXCEPTION 'AI_TOOL_ADMISSION_INVALID';END IF;
 -- This row was inserted above in this transaction, never an existing/replayed user message.
 DELETE FROM public.ai_assistant_messages WHERE id=inserted AND owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child AND role='user';
 SELECT * INTO STRICT j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_child;
 RETURN to_jsonb(j);
END;$$;
CREATE OR REPLACE FUNCTION public.ai_tool_image_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.ai_tool_image_begin(p_owner,p_thread,p_parent,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,'flux2-klein-4b-v1'::varchar)
$$;
REVOKE ALL ON FUNCTION public.ai_image_begin(uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar),public.ai_tool_image_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_image_begin(uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar),public.ai_tool_image_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar) TO asalab_app;

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
 -- Serialize new native intents with profile changes; historical replay stays read-only.
 PERFORM 1 FROM public.ai_image_settings WHERE singleton_key FOR UPDATE;
 INSERT INTO public.ai_tool_request_receipts VALUES(p_owner,p_request,p_thread,p_payload);
 RETURN true;
END;$$;
