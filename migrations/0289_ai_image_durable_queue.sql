-- Durable waiting receipts are separate from the one active GPU execution.
-- Released migrations remain immutable. Existing jobs, recipes, UUIDs, quota and
-- private-object cleanup survive; only the old two-slot setting is narrowed.
UPDATE public.ai_image_settings SET global_concurrency=1,revision=revision+1 WHERE global_concurrency<>1;
ALTER TABLE public.ai_image_settings ADD CONSTRAINT ai_image_single_gpu CHECK(global_concurrency=1);
CREATE INDEX ai_image_waiting_idx ON public.ai_image_jobs(created_at,request_id)
 WHERE state='admitted' AND NOT cancel_requested AND deleted_at IS NULL;
CREATE INDEX ai_image_owner_dispatch_idx ON public.ai_usage_journal(owner_principal_id,started_at DESC)
 WHERE operation='image' AND started_at IS NOT NULL;

-- Least-recently-dispatched owner, then FIFO within that owner. Persisted usage
-- survives restart and deletion; a newcomer cannot jump an owner's older job.
CREATE FUNCTION public.ai_image_queue_head() RETURNS SETOF public.ai_image_jobs
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT j.* FROM public.ai_image_jobs j WHERE j.state='admitted' AND NOT j.cancel_requested AND j.deleted_at IS NULL
 ORDER BY (SELECT max(u.started_at) FROM public.ai_usage_journal u WHERE u.owner_principal_id=j.owner_principal_id AND u.operation='image') NULLS FIRST,
 j.created_at,j.request_id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.ai_image_queue_head() FROM PUBLIC,asalab_app;

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
 OR (p_input->>'globalConcurrency')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'AI_IMAGE_CONFIG_INVALID';END IF;
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
-- One serialized scheduler boundary for both API fast-path and background
-- workers. No network request may precede the committed true CAS result.
CREATE OR REPLACE FUNCTION public.ai_image_dispatch(p_owner uuid,p_request uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;head public.ai_image_jobs%ROWTYPE;allowed boolean:=true;
BEGIN
 PERFORM pg_advisory_xact_lock(731289);
 -- Unknown submission and uncertain storage keep their permit. A missing
 -- provider UUID is never evidence that a delayed submission cannot arrive.
 IF EXISTS(SELECT 1 FROM public.ai_image_jobs WHERE state IN('submitting','unknown','running','storing')) THEN RETURN false;END IF;
 SELECT * INTO head FROM public.ai_image_queue_head();
 IF NOT FOUND OR head.owner_principal_id<>p_owner OR head.request_id<>p_request THEN RETURN false;END IF;
 SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND request_id=p_request AND state='admitted' AND deleted_at IS NULL AND NOT cancel_requested FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 BEGIN
  PERFORM public.ai_chat_require_generation(p_owner);
 EXCEPTION WHEN SQLSTATE '42501' THEN allowed:=false;
 END;
 IF NOT allowed OR NOT EXISTS(SELECT 1 FROM public.ai_image_settings WHERE singleton_key AND enabled)
 OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=j.thread_id AND owner_principal_id=p_owner AND archived_at IS NULL) THEN
  UPDATE public.ai_image_jobs SET state='cancelled',cancel_requested=true,error_code='ai_image_denied',lease_id=NULL,lease_until=NULL WHERE owner_principal_id=p_owner AND request_id=p_request;
  UPDATE public.ai_usage_journal SET status='cancelled',finished_at=clock_timestamp(),error_code='ai_image_denied' WHERE owner_principal_id=p_owner AND request_id=p_request AND status IN('admitted','running');
  RETURN false;
 END IF;
 UPDATE public.ai_image_jobs SET state='submitting',lease_id=NULL,lease_until=NULL WHERE owner_principal_id=p_owner AND request_id=p_request;
 UPDATE public.ai_usage_journal SET status='running',started_at=clock_timestamp() WHERE owner_principal_id=p_owner AND request_id=p_request;
 RETURN true;
END;$$;

CREATE OR REPLACE FUNCTION public.ai_image_claim(p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(731289);
 -- Reconciliation/cleanup never authorizes a second POST. Prefer unfinished
 -- work; lease expiry only transfers observation, never execution ownership.
 SELECT * INTO j FROM public.ai_image_jobs WHERE (state IN('submitting','unknown','running','storing') OR cleanup_required)
 AND (lease_until IS NULL OR lease_until<clock_timestamp())
 ORDER BY CASE WHEN state IN('submitting','unknown','running','storing') THEN 0 ELSE 1 END,created_at,request_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.ai_image_jobs WHERE state IN('submitting','unknown','running','storing')) THEN RETURN NULL;END IF;
  -- Do not leapfrog a leased queue head. A crashed pre-CAS worker resumes this
  -- admitted row after expiry; a crashed post-CAS worker only reconciles.
  SELECT * INTO j FROM public.ai_image_queue_head();
  IF NOT FOUND OR (j.lease_until IS NOT NULL AND j.lease_until>=clock_timestamp()) THEN RETURN NULL;END IF;
  SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=j.owner_principal_id AND request_id=j.request_id AND state='admitted' AND deleted_at IS NULL AND NOT cancel_requested FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL;END IF;
 END IF;
 UPDATE public.ai_image_jobs SET lease_id=p_lease,lease_until=clock_timestamp()+interval '2 minutes' WHERE owner_principal_id=j.owner_principal_id AND request_id=j.request_id RETURNING * INTO j;
 RETURN to_jsonb(j);
END;$$;

-- Owner-bound projection reveals only a service-wide pause flag, no other
-- pupil's identity, queue position, prompt or provider identifiers.
CREATE OR REPLACE FUNCTION public.ai_image_get(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND request_id=p_request AND thread_id=p_thread AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_IMAGE_NOT_FOUND';END IF;
 RETURN to_jsonb(j)||jsonb_build_object('queue_paused',j.state='admitted' AND EXISTS(SELECT 1 FROM public.ai_image_jobs WHERE state='unknown'));
END;$$;
CREATE OR REPLACE FUNCTION public.ai_image_begin(p_owner uuid,p_thread uuid,p_request uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
 -- Admission counts unfinished receipts, never historical quota tombstones.
 IF (SELECT count(*) FROM public.ai_image_jobs WHERE state IN('admitted','submitting','unknown','running','storing'))>=200 THEN RAISE EXCEPTION 'AI_IMAGE_QUEUE_FULL';END IF;
 IF (SELECT count(*) FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND state IN('admitted','submitting','unknown','running','storing'))>=2 THEN RAISE EXCEPTION 'AI_IMAGE_OWNER_QUEUE_FULL';END IF;
 INSERT INTO public.ai_image_jobs(owner_principal_id,request_id,thread_id,provider_id,marker,seed,prompt,payload_digest,graph_digest,size,settings_snapshot,recipe)
 VALUES(p_owner,p_request,p_thread,p_provider,'ASA_'||replace(p_provider::text,'-',''),p_seed,p_prompt,d,p_graph_digest,p_size,public.ai_image_config(),p_recipe);
 INSERT INTO public.ai_assistant_request_quota(account_id,owner_principal_id,request_id) VALUES(a,p_owner,p_request);
 UPDATE public.ai_usage_journal SET thread_id=p_thread,operation='image',transport='json',provider='comfyui',requested_model='flux-2-klein-4b-fp8.safetensors' WHERE owner_principal_id=p_owner AND request_id=p_request;
 INSERT INTO public.ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content) VALUES(p_thread,a,p_owner,p_request,'user',p_prompt);
 UPDATE public.ai_assistant_threads SET updated_at=clock_timestamp() WHERE id=p_thread;
 RETURN public.ai_image_get(p_owner,p_thread,p_request)||jsonb_build_object('fresh_admission',true);
END;$$;
