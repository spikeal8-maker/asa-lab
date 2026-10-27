-- Independent local GPU admission. No paid/text provider reservation or token estimate.
CREATE TABLE public.ai_image_settings (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key), revision bigint NOT NULL DEFAULT 1,
 enabled boolean NOT NULL DEFAULT false, daily_limit integer NOT NULL DEFAULT 10 CHECK(daily_limit BETWEEN 1 AND 100),
 global_concurrency integer NOT NULL DEFAULT 1 CHECK(global_concurrency BETWEEN 1 AND 2),
 sizes jsonb NOT NULL DEFAULT '[512]' CHECK(jsonb_typeof(sizes)='array')
);
INSERT INTO public.ai_image_settings(singleton_key) VALUES(true);
CREATE TABLE public.ai_image_settings_writes(actor uuid NOT NULL,request_id uuid NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(actor,request_id));
CREATE TABLE public.ai_image_jobs (
 owner_principal_id uuid NOT NULL REFERENCES public.principals(id), request_id uuid NOT NULL,thread_id uuid NOT NULL,
 provider_id uuid NOT NULL UNIQUE, marker varchar(80) NOT NULL UNIQUE, seed bigint NOT NULL CHECK(seed BETWEEN 0 AND 4294967295),
 prompt varchar(3000), payload_digest varchar(64) NOT NULL, graph_digest varchar(64) NOT NULL CHECK(graph_digest~'^[a-f0-9]{64}$'), size integer NOT NULL CHECK(size IN(512,768,1024)),
 recipe varchar(40) NOT NULL DEFAULT 'flux2-klein-4b-v1' CHECK(recipe='flux2-klein-4b-v1'),settings_snapshot jsonb NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'admitted' CHECK(state IN('admitted','submitting','unknown','running','storing','complete','failed','cancelled')),
 cancel_requested boolean NOT NULL DEFAULT false,deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 error_code varchar(64),sha256 varchar(64),size_bytes integer CHECK(size_bytes BETWEEN 1 AND 8388608),
 put_started boolean NOT NULL DEFAULT false,put_uncertain boolean NOT NULL DEFAULT false,
 cleanup_required boolean NOT NULL DEFAULT false,lease_id uuid,lease_until timestamptz,
 PRIMARY KEY(owner_principal_id,request_id),CHECK((sha256 IS NULL)=(size_bytes IS NULL))
);
ALTER TABLE public.ai_image_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_settings_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_image_settings,public.ai_image_settings_writes,public.ai_image_jobs FROM PUBLIC,asalab_app;
ALTER TABLE public.ai_usage_journal DROP CONSTRAINT ai_usage_journal_provider_check;
ALTER TABLE public.ai_usage_journal ADD CHECK(provider IN('openai','deepseek','ollama','ollama-cloud','comfyui'));
ALTER TABLE public.ai_usage_journal DROP CONSTRAINT ai_usage_journal_operation_check;
ALTER TABLE public.ai_usage_journal ADD CHECK(operation IN('chat','regeneration','image'));

CREATE FUNCTION public.ai_image_config(p_actor uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_actor IS NOT NULL THEN IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;END IF;
 RETURN (SELECT jsonb_build_object('configurationVersion',revision,'enabled',enabled,'dailyLimit',daily_limit,'globalConcurrency',global_concurrency,'sizes',sizes,'recipe','flux2-klein-4b-v1') FROM public.ai_image_settings WHERE singleton_key);
END;$$;
CREATE FUNCTION public.ai_image_config_set(p_actor uuid,p_input jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_image_settings%ROWTYPE;r uuid;prior jsonb;v text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;r:=(p_input->>'requestId')::uuid;
 SELECT * INTO STRICT old FROM public.ai_image_settings WHERE singleton_key FOR UPDATE;
 SELECT payload INTO prior FROM public.ai_image_settings_writes WHERE actor=p_actor AND request_id=r;
 IF FOUND THEN IF prior<>p_input THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED';END IF;RETURN;END IF;
 IF (p_input->>'configurationVersion')::bigint<>old.revision THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_input->'sizes') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_input->'sizes') NOT BETWEEN 1 AND 3 OR (p_input->>'dailyLimit')::integer NOT BETWEEN 1 AND 100
 OR (p_input->>'globalConcurrency')::integer NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'AI_IMAGE_CONFIG_INVALID';END IF;
 FOR v IN SELECT jsonb_array_elements_text(p_input->'sizes') LOOP IF v NOT IN('512','768','1024') THEN RAISE EXCEPTION 'AI_IMAGE_CONFIG_INVALID';END IF;END LOOP;
 UPDATE public.ai_image_settings SET enabled=(p_input->>'enabled')::boolean,daily_limit=(p_input->>'dailyLimit')::integer,
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
 AND j.recipe='flux2-klein-4b-v1' AND j.prompt IS NOT NULL AND public.ai_chat_owner_valid(j.owner_principal_id))
 THEN RAISE EXCEPTION 'AI_POLICY_WORKER_REQUIRED' USING ERRCODE='42501';END IF;RETURN NEW;
END;$$;
CREATE FUNCTION public.ai_image_status(p_owner uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 RETURN public.ai_image_config()||jsonb_build_object('remainingToday',greatest(0,(SELECT daily_limit FROM public.ai_image_settings WHERE singleton_key)-(SELECT count(*) FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND created_at>=date_trunc('day',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')));
END;$$;
CREATE FUNCTION public.ai_image_get(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND request_id=p_request AND thread_id=p_thread AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_IMAGE_NOT_FOUND';END IF;
 RETURN to_jsonb(j);
END;$$;
CREATE FUNCTION public.ai_image_begin(p_owner uuid,p_thread uuid,p_request uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
 IF NOT c.enabled THEN RAISE EXCEPTION 'AI_IMAGE_DISABLED';END IF;
 IF p_ready IS DISTINCT FROM true THEN RAISE EXCEPTION 'AI_IMAGE_UNAVAILABLE';END IF;
 a:=public.ai_chat_require_generation(p_owner);
 IF p_prompt IS NULL OR char_length(btrim(p_prompt)) NOT BETWEEN 1 AND 3000 OR NOT c.sizes@>to_jsonb(ARRAY[p_size]) THEN RAISE EXCEPTION 'AI_IMAGE_INPUT_INVALID';END IF;
 PERFORM 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND archived_at IS NULL AND (busy_until IS NULL OR busy_until<clock_timestamp()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED';END IF;
 IF (SELECT count(*) FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=c.daily_limit THEN RAISE EXCEPTION 'AI_IMAGE_QUOTA_EXHAUSTED';END IF;
 IF (SELECT count(*) FROM public.ai_image_jobs WHERE state IN('admitted','submitting','unknown','running','storing'))>=c.global_concurrency THEN RAISE EXCEPTION 'AI_IMAGE_BUSY';END IF;
 INSERT INTO public.ai_image_jobs(owner_principal_id,request_id,thread_id,provider_id,marker,seed,prompt,payload_digest,graph_digest,size,settings_snapshot)
 VALUES(p_owner,p_request,p_thread,p_provider,'ASA_'||replace(p_provider::text,'-',''),p_seed,p_prompt,d,p_graph_digest,p_size,public.ai_image_config());
 INSERT INTO public.ai_assistant_request_quota(account_id,owner_principal_id,request_id) VALUES(a,p_owner,p_request);
 UPDATE public.ai_usage_journal SET thread_id=p_thread,operation='image',transport='json',provider='comfyui',requested_model='flux-2-klein-4b-fp8.safetensors' WHERE owner_principal_id=p_owner AND request_id=p_request;
 INSERT INTO public.ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content) VALUES(p_thread,a,p_owner,p_request,'user',p_prompt);
 UPDATE public.ai_assistant_threads SET updated_at=clock_timestamp() WHERE id=p_thread;
 RETURN public.ai_image_get(p_owner,p_thread,p_request);
END;$$;
-- The only dispatch CAS. A process that loses its reply NEVER calls POST /prompt.
CREATE FUNCTION public.ai_image_dispatch(p_owner uuid,p_request uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE public.ai_image_jobs SET state='submitting' WHERE owner_principal_id=p_owner AND request_id=p_request AND state='admitted' AND deleted_at IS NULL AND NOT cancel_requested;
 IF NOT FOUND THEN RETURN false;END IF;
 UPDATE public.ai_usage_journal SET status='running',started_at=clock_timestamp() WHERE owner_principal_id=p_owner AND request_id=p_request;
 RETURN true;
END;$$;
CREATE FUNCTION public.ai_image_cancel(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM public.ai_image_get(p_owner,p_thread,p_request);
 UPDATE public.ai_image_jobs SET cancel_requested=true,state=CASE WHEN state='admitted' THEN 'cancelled' ELSE state END WHERE owner_principal_id=p_owner AND request_id=p_request AND state NOT IN('complete','failed','cancelled');
 UPDATE public.ai_usage_journal SET status='cancelled',finished_at=clock_timestamp() WHERE owner_principal_id=p_owner AND request_id=p_request AND status='admitted';
 RETURN public.ai_image_get(p_owner,p_thread,p_request);
END;$$;
-- Durable reconcile lease; this function never authorizes another provider POST.
CREATE FUNCTION public.ai_image_claim(p_lease uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM public.ai_image_jobs WHERE (state IN('submitting','unknown','running','storing') OR cleanup_required)
 AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.ai_image_jobs SET lease_id=p_lease,lease_until=clock_timestamp()+interval '2 minutes' WHERE owner_principal_id=j.owner_principal_id AND request_id=j.request_id RETURNING * INTO j;
 RETURN to_jsonb(j);
END;$$;
CREATE FUNCTION public.ai_image_transition(p_owner uuid,p_request uuid,p_lease uuid,p_state varchar,p_sha varchar DEFAULT NULL,p_bytes integer DEFAULT NULL,p_error varchar DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.ai_image_jobs%ROWTYPE;a uuid;
BEGIN
 SELECT * INTO j FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND request_id=p_request AND lease_id=p_lease AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF p_state NOT IN('unknown','running','storing','complete','failed','cancelled') THEN RAISE EXCEPTION 'AI_IMAGE_STATE_INVALID';END IF;
 IF j.state IN('complete','failed','cancelled') AND (NOT j.cleanup_required OR p_state NOT IN('complete','failed','cancelled')) THEN RETURN false;END IF;
 IF p_state='storing' THEN
  IF j.put_started THEN UPDATE public.ai_image_jobs SET lease_id=NULL,lease_until=clock_timestamp()+interval '3 seconds' WHERE owner_principal_id=p_owner AND request_id=p_request;RETURN false;END IF;
  IF j.cancel_requested OR j.deleted_at IS NOT NULL OR p_sha IS NULL OR p_bytes IS NULL OR p_sha!~'^[a-f0-9]{64}$' OR p_bytes NOT BETWEEN 1 AND 8388608 THEN RETURN false;END IF;
  UPDATE public.ai_image_jobs SET state='storing',sha256=p_sha,size_bytes=p_bytes,put_started=true,put_uncertain=true WHERE owner_principal_id=p_owner AND request_id=p_request;RETURN true;
 END IF;
 IF p_state='complete' AND (j.sha256 IS NULL OR NOT j.put_started) THEN RAISE EXCEPTION 'AI_IMAGE_STATE_INVALID';END IF;
 IF j.cancel_requested OR j.deleted_at IS NOT NULL THEN p_state:=CASE WHEN p_state IN('complete','failed','cancelled') THEN 'cancelled' ELSE p_state END;END IF;
 UPDATE public.ai_image_jobs SET state=p_state,error_code=p_error,put_uncertain=CASE WHEN p_state='complete' THEN false ELSE put_uncertain END,
 cleanup_required=cleanup_required OR (p_state='cancelled' AND sha256 IS NOT NULL),lease_id=NULL,lease_until=clock_timestamp()+interval '3 seconds' WHERE owner_principal_id=p_owner AND request_id=p_request;
 IF p_state IN('complete','failed','cancelled') THEN
  UPDATE public.ai_usage_journal SET status=CASE p_state WHEN 'complete' THEN 'succeeded' ELSE p_state END,error_code=p_error,actual_model=CASE WHEN p_state='complete' THEN 'flux-2-klein-4b-fp8.safetensors' ELSE actual_model END,finished_at=clock_timestamp(),duration_ms=greatest(0,floor(extract(epoch FROM(clock_timestamp()-started_at))*1000)::bigint) WHERE owner_principal_id=p_owner AND request_id=p_request AND status IN('admitted','running');
 END IF;
 IF p_state='complete' AND j.deleted_at IS NULL AND NOT j.cancel_requested AND EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=j.thread_id AND owner_principal_id=p_owner) THEN
  SELECT account_id INTO a FROM public.principals WHERE id=p_owner;
  INSERT INTO public.ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content) VALUES(j.thread_id,a,p_owner,p_request,'assistant','Изображение создано.') ON CONFLICT(thread_id,role,request_id) DO NOTHING;
 END IF;
 RETURN true;
END;$$;
CREATE FUNCTION public.ai_image_forget_thread() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- Storing is entered only after the GPU result was observed. Object cleanup,
 -- including a late uncertain PUT, must not retain an already finished GPU slot.
 UPDATE public.ai_image_jobs SET deleted_at=clock_timestamp(),prompt=NULL,cancel_requested=true,cleanup_required=sha256 IS NOT NULL,state=CASE WHEN state IN('admitted','storing','complete','failed') THEN 'cancelled' ELSE state END WHERE owner_principal_id=OLD.owner_principal_id AND thread_id=OLD.id;
 UPDATE public.ai_usage_journal u SET status='cancelled',finished_at=clock_timestamp(),duration_ms=CASE WHEN u.started_at IS NULL THEN NULL ELSE greatest(0,floor(extract(epoch FROM(clock_timestamp()-u.started_at))*1000)::bigint) END
 WHERE u.owner_principal_id=OLD.owner_principal_id AND u.thread_id=OLD.id AND u.status IN('admitted','running')
 AND EXISTS(SELECT 1 FROM public.ai_image_jobs j WHERE j.owner_principal_id=u.owner_principal_id AND j.request_id=u.request_id AND j.state='cancelled' AND j.deleted_at IS NOT NULL);
 RETURN OLD;
END;$$;
CREATE TRIGGER ai_image_forget_thread BEFORE DELETE ON public.ai_assistant_threads FOR EACH ROW EXECUTE FUNCTION public.ai_image_forget_thread();
CREATE FUNCTION public.ai_image_history(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RETURN '[]';END IF;
 RETURN coalesce((SELECT jsonb_build_array(jsonb_build_object('requestId',request_id,'width',size,'height',size,'mimeType','image/png','sizeBytes',size_bytes,'downloadUrl','/api/ai/threads/'||thread_id||'/image-generations/'||request_id||'/image')) FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_request AND state='complete' AND deleted_at IS NULL AND NOT cancel_requested),'[]');
END;$$;
CREATE FUNCTION public.ai_image_cleanup_done(p_owner uuid,p_request uuid,p_lease uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- An uncertain PUT can still arrive late: keep its tombstone eligible for cleanup.
 -- Also close historical deleted/storing rows without releasing unknown GPU work.
 UPDATE public.ai_image_jobs SET state=CASE WHEN deleted_at IS NOT NULL AND state='storing' THEN 'cancelled' ELSE state END,cleanup_required=put_uncertain,lease_id=NULL,lease_until=clock_timestamp()+interval '5 minutes' WHERE owner_principal_id=p_owner AND request_id=p_request AND lease_id=p_lease;
 IF NOT FOUND THEN RETURN;END IF;
 UPDATE public.ai_usage_journal u SET status='cancelled',finished_at=clock_timestamp(),duration_ms=CASE WHEN u.started_at IS NULL THEN NULL ELSE greatest(0,floor(extract(epoch FROM(clock_timestamp()-u.started_at))*1000)::bigint) END
 WHERE u.owner_principal_id=p_owner AND u.request_id=p_request AND u.status IN('admitted','running')
 AND EXISTS(SELECT 1 FROM public.ai_image_jobs j WHERE j.owner_principal_id=u.owner_principal_id AND j.request_id=u.request_id AND j.state='cancelled' AND j.deleted_at IS NOT NULL);
END;$$;
REVOKE ALL ON FUNCTION public.ai_image_forget_thread() FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.ai_image_config(uuid),public.ai_image_config_set(uuid,jsonb),public.ai_image_status(uuid),public.ai_image_get(uuid,uuid,uuid),public.ai_image_begin(uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar),public.ai_image_dispatch(uuid,uuid),public.ai_image_cancel(uuid,uuid,uuid),public.ai_image_claim(uuid),public.ai_image_transition(uuid,uuid,uuid,varchar,varchar,integer,varchar),public.ai_image_history(uuid,uuid,uuid),public.ai_image_cleanup_done(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_image_config(uuid),public.ai_image_config_set(uuid,jsonb),public.ai_image_status(uuid),public.ai_image_get(uuid,uuid,uuid),public.ai_image_begin(uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar),public.ai_image_dispatch(uuid,uuid),public.ai_image_cancel(uuid,uuid,uuid),public.ai_image_claim(uuid),public.ai_image_transition(uuid,uuid,uuid,varchar,varchar,integer,varchar),public.ai_image_history(uuid,uuid,uuid),public.ai_image_cleanup_done(uuid,uuid,uuid) TO asalab_app;

CREATE FUNCTION public.ai_image_kind(p_owner uuid,p_thread uuid,p_request uuid) RETURNS varchar LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.ai_chat_owner_valid(p_owner) AND EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) AND EXISTS(SELECT 1 FROM public.ai_image_jobs WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_request AND deleted_at IS NULL) THEN RETURN 'image';END IF;RETURN NULL;
END;$$;
REVOKE ALL ON FUNCTION public.ai_image_kind(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_image_kind(uuid,uuid,uuid) TO asalab_app;

CREATE TABLE public.ai_image_transfers(owner_principal_id uuid NOT NULL,permit uuid PRIMARY KEY,expires_at timestamptz NOT NULL);
ALTER TABLE public.ai_image_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_image_transfers FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_image_transfer(p_owner uuid,p_permit uuid,p_acquire boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT p_acquire THEN DELETE FROM public.ai_image_transfers WHERE permit=p_permit AND owner_principal_id=p_owner;RETURN true;END IF;
 PERFORM pg_advisory_xact_lock(731265);
 DELETE FROM public.ai_image_transfers WHERE expires_at<clock_timestamp();
 IF NOT public.ai_chat_owner_valid(p_owner) OR EXISTS(SELECT 1 FROM public.ai_image_transfers WHERE owner_principal_id=p_owner) OR (SELECT count(*) FROM public.ai_image_transfers)>=4 THEN RETURN false;END IF;
 INSERT INTO public.ai_image_transfers VALUES(p_owner,p_permit,clock_timestamp()+interval '45 seconds');RETURN true;
END;$$;
REVOKE ALL ON FUNCTION public.ai_image_transfer(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_image_transfer(uuid,uuid,boolean) TO asalab_app;
-- Image prompts cannot silently be charged as text regenerations by a legacy caller.
CREATE FUNCTION public.ai_image_regeneration_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ai_assistant_messages m JOIN public.ai_image_jobs j ON j.owner_principal_id=m.owner_principal_id AND j.thread_id=m.thread_id AND j.request_id=m.request_id WHERE m.id=NEW.source_user_message_id AND m.owner_principal_id=NEW.owner_principal_id) THEN RAISE EXCEPTION 'AI_IMAGE_TEXT_REGENERATION_DENIED' USING ERRCODE='42501';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER ai_image_regeneration_guard BEFORE INSERT ON public.ai_assistant_regenerations FOR EACH ROW EXECUTE FUNCTION public.ai_image_regeneration_guard();
REVOKE ALL ON FUNCTION public.ai_image_regeneration_guard() FROM PUBLIC,asalab_app;
-- Keep shared UUID tombstones while charging text and GPU rate limits separately.
DO $$
DECLARE f regprocedure;body text;updated text;
BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('ai_chat_begin_paid','ai_text_regenerate_begin','ai_text_begin_local','ai_text_regenerate_begin_local') LOOP
  body:=pg_get_functiondef(f);
  updated:=regexp_replace(body,'SELECT count\(\*\) FROM public\.ai_assistant_request_quota q[[:space:]]+WHERE','SELECT count(*) FROM public.ai_assistant_request_quota q WHERE NOT EXISTS(SELECT 1 FROM public.ai_image_jobs image_job WHERE image_job.owner_principal_id=q.owner_principal_id AND image_job.request_id=q.request_id) AND');
  IF updated=body THEN RAISE EXCEPTION 'AI_IMAGE_QUOTA_PATCH_MISSING %',f;END IF;
  EXECUTE updated;
 END LOOP;
END;$$;
