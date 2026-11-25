-- Independent local llama.cpp provider. No published migration or existing provider settings are changed.
-- Application-only secrets, explicit configuration CAS, immutable apply receipts and model admissions.
CREATE TABLE public.ai_llamacpp_settings (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),
 enabled boolean NOT NULL DEFAULT false,base_url varchar(256) NOT NULL DEFAULT 'http://127.0.0.1:8080',model varchar(200) NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT now(),updated_by_principal uuid REFERENCES public.principals(id),
 api_key_ciphertext varchar,api_key_iv varchar,api_key_auth_tag varchar,key_fingerprint varchar(64),
 temperature double precision,top_p double precision,max_output_tokens integer,context_tokens integer,confirmed_context_tokens integer,
 context_source varchar(16) NOT NULL DEFAULT 'unknown' CHECK(context_source IN('metadata','admin','unknown')),tools_verified boolean NOT NULL DEFAULT false,
 CHECK((api_key_ciphertext IS NULL AND api_key_iv IS NULL AND api_key_auth_tag IS NULL AND key_fingerprint IS NULL) OR
       (api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL AND api_key_auth_tag IS NOT NULL AND key_fingerprint IS NOT NULL)),
 CHECK(temperature IS NULL OR temperature BETWEEN 0 AND 2),CHECK(top_p IS NULL OR (top_p>0 AND top_p<=1)),
 CHECK(max_output_tokens IS NULL OR max_output_tokens BETWEEN 1 AND 1048576),
 CHECK(context_tokens IS NULL OR context_tokens BETWEEN 1 AND 1048576),
 CHECK(confirmed_context_tokens IS NULL OR confirmed_context_tokens BETWEEN 1 AND 1048576),
 CHECK(NOT enabled OR (char_length(base_url)>0 AND char_length(model)>0))
);
INSERT INTO public.ai_llamacpp_settings DEFAULT VALUES;
CREATE TABLE public.ai_llamacpp_apply_receipts (
 actor uuid NOT NULL,request_id varchar(128) NOT NULL,digest varchar(64) NOT NULL,expected_revision bigint NOT NULL,
 state varchar(12) NOT NULL CHECK(state IN('pending','complete','failed')),result jsonb,error jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor,request_id)
);
CREATE TABLE public.ai_llamacpp_slot (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),actor uuid NOT NULL,thread_id uuid,request_id varchar(128) NOT NULL,
 backend_pid integer NOT NULL,acquired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_llamacpp_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_llamacpp_apply_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_llamacpp_slot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_llamacpp_settings,public.ai_llamacpp_apply_receipts,public.ai_llamacpp_slot FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_llamacpp_runtime() RETURNS SETOF public.ai_llamacpp_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT * FROM public.ai_llamacpp_settings WHERE singleton_key
$$;
CREATE FUNCTION public.ai_llamacpp_admin_get(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.ai_llamacpp_settings%ROWTYPE;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT c FROM public.ai_llamacpp_settings WHERE singleton_key;
 RETURN jsonb_build_object('enabled',c.enabled,'baseUrl',c.base_url,'model',c.model,'revision',c.revision,'updatedAt',c.updated_at,
 'apiKeyConfigured',c.api_key_ciphertext IS NOT NULL,'temperature',c.temperature,'topP',c.top_p,'maxOutputTokens',c.max_output_tokens,
 'contextTokens',c.context_tokens,'confirmedContextTokens',c.confirmed_context_tokens,'contextSource',c.context_source,'toolsVerified',c.tools_verified);
END;$$;
CREATE FUNCTION public.ai_llamacpp_apply_claim(p_actor uuid,p_request varchar,p_digest varchar,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_llamacpp_apply_receipts%ROWTYPE;
BEGIN
 PERFORM public.ai_llamacpp_admin_get(p_actor);
 IF p_request IS NULL OR char_length(p_request) NOT BETWEEN 1 AND 128 OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' OR p_revision IS NULL OR p_revision<1 THEN RAISE EXCEPTION 'AI_LLAMACPP_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request,7333));
 SELECT * INTO r FROM public.ai_llamacpp_apply_receipts WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF r.digest<>p_digest OR r.expected_revision<>p_revision THEN RAISE EXCEPTION 'AI_LLAMACPP_REPLAY_CONFLICT' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('state',r.state,'result',r.result,'error',r.error);
 END IF;
 PERFORM 1 FROM public.ai_llamacpp_settings WHERE singleton_key AND revision=p_revision FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_LLAMACPP_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 INSERT INTO public.ai_llamacpp_apply_receipts(actor,request_id,digest,expected_revision,state) VALUES(p_actor,p_request,p_digest,p_revision,'pending');
 RETURN jsonb_build_object('state','claimed');
END;$$;
CREATE FUNCTION public.ai_llamacpp_apply_fail(p_actor uuid,p_request varchar,p_digest varchar,p_error jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM public.ai_llamacpp_admin_get(p_actor);
 IF jsonb_typeof(p_error) IS DISTINCT FROM 'object' OR coalesce(p_error->>'code','') NOT IN('ai_llamacpp_url_invalid','ai_llamacpp_url_denied','ai_llamacpp_model_invalid','ai_llamacpp_model_missing','ai_llamacpp_key_invalid','ai_llamacpp_encryption_unavailable','ai_llamacpp_key_decryption_failed','ai_llamacpp_auth','ai_llamacpp_busy','ai_llamacpp_unreachable','ai_llamacpp_timeout','ai_llamacpp_invalid','ai_llamacpp_interrupted','ai_llamacpp_response_empty','ai_llamacpp_context_invalid','ai_llamacpp_context_exceeded','ai_llamacpp_config_invalid','ai_llamacpp_config_changed','ai_llamacpp_admin_denied','ai_llamacpp_unavailable','ai_llamacpp_apply_pending','ai_llamacpp_apply_failed','ai_llamacpp_replay_conflict','ai_llamacpp_upstream_error','ai_llamacpp_request_rejected','ai_tool_call_invalid')
 OR coalesce((p_error->>'status')::integer,0) NOT BETWEEN 400 AND 599 OR coalesce(char_length(p_error->>'message'),0) NOT BETWEEN 1 AND 400
 OR (SELECT count(*) FROM jsonb_object_keys(p_error))<>3 THEN RAISE EXCEPTION 'AI_LLAMACPP_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 UPDATE public.ai_llamacpp_apply_receipts SET state='failed',error=p_error WHERE actor=p_actor AND request_id=p_request AND digest=p_digest AND state='pending';
END;$$;
CREATE FUNCTION public.ai_llamacpp_admin_set(p_actor uuid,p_body jsonb,p_request varchar) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_llamacpp_settings%ROWTYPE;r public.ai_llamacpp_apply_receipts%ROWTYPE;a text;v_result jsonb;
BEGIN
 PERFORM public.ai_llamacpp_admin_get(p_actor);
 SELECT * INTO STRICT r FROM public.ai_llamacpp_apply_receipts WHERE actor=p_actor AND request_id=p_request FOR UPDATE;
 IF r.digest IS DISTINCT FROM p_body->>'applyDigest' THEN RAISE EXCEPTION 'AI_LLAMACPP_REPLAY_CONFLICT' USING ERRCODE='22023';END IF;
 IF r.state='complete' THEN RETURN r.result;END IF;
 IF r.state<>'pending' THEN RAISE EXCEPTION 'AI_LLAMACPP_APPLY_FAILED' USING ERRCODE='55000';END IF;
 SELECT * INTO STRICT old FROM public.ai_llamacpp_settings WHERE singleton_key FOR UPDATE;
 IF old.revision IS DISTINCT FROM (p_body->>'revision')::bigint OR old.revision<>r.expected_revision THEN RAISE EXCEPTION 'AI_LLAMACPP_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 a:=coalesce(p_body->>'action','');
 IF a NOT IN('keep','replace','clear') OR jsonb_typeof(p_body->'enabled') IS DISTINCT FROM 'boolean'
 OR p_body->>'baseUrl' IS NULL OR char_length(p_body->>'baseUrl')>256 OR p_body->>'model' IS NULL OR char_length(p_body->>'model')>200
 OR p_body->>'model'~'[[:cntrl:]]' OR position('://' IN p_body->>'model')>0
 OR ((p_body->>'enabled')::boolean AND ((p_body->>'verified')::boolean IS DISTINCT FROM true OR char_length(p_body->>'model')<1))
 OR coalesce(p_body->>'contextSource','unknown') NOT IN('metadata','admin','unknown') THEN RAISE EXCEPTION 'AI_LLAMACPP_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 IF a='keep' AND old.base_url<>p_body->>'baseUrl' AND old.api_key_ciphertext IS NOT NULL THEN RAISE EXCEPTION 'AI_LLAMACPP_KEY_ENDPOINT_CHANGED' USING ERRCODE='22023';END IF;
 IF a='replace' AND (coalesce(char_length(p_body->>'ciphertext'),0) NOT BETWEEN 1 AND 16000 OR coalesce(char_length(p_body->>'iv'),0)<>16
 OR coalesce(char_length(p_body->>'tag'),0)<>22 OR coalesce(p_body->>'fingerprint','')!~'^[a-f0-9]{12,64}$') THEN RAISE EXCEPTION 'AI_LLAMACPP_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 UPDATE public.ai_llamacpp_settings SET enabled=(p_body->>'enabled')::boolean,base_url=p_body->>'baseUrl',model=p_body->>'model',
 temperature=(p_body->>'temperature')::double precision,top_p=(p_body->>'topP')::double precision,max_output_tokens=(p_body->>'maxOutputTokens')::integer,
 context_tokens=(p_body->>'contextTokens')::integer,confirmed_context_tokens=(p_body->>'confirmedContextTokens')::integer,
 context_source=CASE WHEN p_body->>'confirmedContextTokens' IS NOT NULL THEN 'metadata' WHEN p_body->>'contextTokens' IS NOT NULL THEN 'admin' ELSE 'unknown' END,tools_verified=coalesce((p_body->>'toolsVerified')::boolean,false),
 api_key_ciphertext=CASE a WHEN 'replace' THEN p_body->>'ciphertext' WHEN 'clear' THEN NULL ELSE old.api_key_ciphertext END,
 api_key_iv=CASE a WHEN 'replace' THEN p_body->>'iv' WHEN 'clear' THEN NULL ELSE old.api_key_iv END,
 api_key_auth_tag=CASE a WHEN 'replace' THEN p_body->>'tag' WHEN 'clear' THEN NULL ELSE old.api_key_auth_tag END,
 key_fingerprint=CASE a WHEN 'replace' THEN p_body->>'fingerprint' WHEN 'clear' THEN NULL ELSE old.key_fingerprint END,
 revision=revision+1,updated_at=clock_timestamp(),updated_by_principal=p_actor WHERE singleton_key;
 v_result:=jsonb_build_object('config',public.ai_llamacpp_admin_get(p_actor),'verified',coalesce((p_body->>'verified')::boolean,false),'test',CASE WHEN (p_body->>'verified')::boolean THEN jsonb_build_object('model',p_body->>'model','contextTokens',(p_body->>'confirmedContextTokens')::integer,'toolsVerified',coalesce((p_body->>'toolsVerified')::boolean,false)) ELSE NULL END);
 UPDATE public.ai_llamacpp_apply_receipts SET state='complete',result=v_result WHERE actor=p_actor AND request_id=p_request;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_llamacpp.update','integration','llamacpp-local','admin_console','Настройка локальной модели llama.cpp',NULL,p_request,p_request,'succeeded',old.revision,old.revision+1);
 RETURN v_result;
END;$$;

-- The dedicated connection holds this session lock through provider termination.
-- PostgreSQL releases the lock after connection/process failure; stale metadata is then replaced safely.
CREATE FUNCTION public.ai_llamacpp_slot_acquire(p_actor uuid,p_thread uuid,p_request varchar) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE acquired boolean:=false;
BEGIN
 IF p_request IS NULL OR char_length(p_request) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'AI_LLAMACPP_CONFIG_INVALID' USING ERRCODE='22023';END IF;
 IF p_thread IS NULL THEN PERFORM public.ai_llamacpp_admin_get(p_actor);
 ELSIF NOT public.ai_chat_owner_valid(p_actor) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_actor) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=7333 AND objid=1 AND objsubid=2 AND granted) THEN RAISE EXCEPTION 'AI_LLAMACPP_SLOT_REENTRANT' USING ERRCODE='55000';END IF;
 acquired:=pg_try_advisory_lock(7333,1);
 IF NOT acquired THEN RETURN false;END IF;
 INSERT INTO public.ai_llamacpp_slot(singleton_key,actor,thread_id,request_id,backend_pid) VALUES(true,p_actor,p_thread,p_request,pg_backend_pid())
 ON CONFLICT(singleton_key) DO UPDATE SET actor=excluded.actor,thread_id=excluded.thread_id,request_id=excluded.request_id,backend_pid=excluded.backend_pid,acquired_at=clock_timestamp();
 RETURN true;
EXCEPTION WHEN OTHERS THEN
 IF acquired THEN PERFORM pg_advisory_unlock(7333,1);END IF;RAISE;
END;$$;
CREATE FUNCTION public.ai_llamacpp_slot_release(p_actor uuid,p_thread uuid,p_request varchar) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 DELETE FROM public.ai_llamacpp_slot WHERE singleton_key AND actor=p_actor AND thread_id IS NOT DISTINCT FROM p_thread AND request_id=p_request AND backend_pid=pg_backend_pid();
 IF NOT FOUND THEN RETURN false;END IF;
 RETURN pg_advisory_unlock(7333,1);
END;$$;

CREATE OR REPLACE FUNCTION public.ai_text_begin_llamacpp(
  p_owner uuid, p_thread uuid, p_request uuid, p_text varchar, p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account uuid; existing_text varchar; existing_thread uuid;
        v_title varchar(120); local_config public.ai_llamacpp_settings%ROWTYPE;
BEGIN
  IF p_text IS NULL OR char_length(trim(p_text)) NOT BETWEEN 1 AND 3000 THEN
    RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT p.account_id INTO v_account FROM public.principals p WHERE p.id=p_owner;
  IF NOT public.ai_chat_owner_valid(p_owner) THEN
    RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
  SELECT m.thread_id,m.content INTO existing_thread,existing_text
    FROM public.ai_assistant_messages m
   WHERE m.owner_principal_id=p_owner AND m.request_id=p_request AND m.role='user';
  IF FOUND THEN
    IF existing_thread <> p_thread OR existing_text <> trim(p_text) THEN
      RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';
    END IF;
    RETURN false;
  END IF;
  IF EXISTS(SELECT 1 FROM public.ai_assistant_request_quota q
            WHERE q.owner_principal_id=p_owner AND q.request_id=p_request) THEN
    RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';
  END IF;
  v_account:=public.ai_chat_require_generation(p_owner);
  IF (SELECT count(*) FROM public.ai_assistant_request_quota q WHERE NOT EXISTS(SELECT 1 FROM public.ai_image_jobs image_job WHERE image_job.owner_principal_id=q.owner_principal_id AND image_job.request_id=q.request_id) AND q.owner_principal_id=p_owner AND q.created_at > now()-interval '1 hour') >=30 THEN
    RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO STRICT local_config FROM public.ai_llamacpp_settings WHERE singleton_key FOR UPDATE;
  IF local_config.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'AI_CONFIG_CHANGED';
  END IF;
  IF NOT local_config.enabled THEN RAISE EXCEPTION 'AI_DISABLED'; END IF;
  v_title:=left(regexp_replace(trim(p_text), E'[\r\n]+',' ','g'),110);
  UPDATE public.ai_assistant_threads t SET
      busy_until=clock_timestamp()+interval '1830 seconds',active_request_id=p_request,
      title=CASE WHEN t.title='Новый чат' THEN v_title ELSE t.title END,
      updated_at=clock_timestamp()
    WHERE t.id=p_thread AND t.owner_principal_id=p_owner
      AND (t.busy_until IS NULL OR t.busy_until<clock_timestamp());
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.ai_assistant_messages
    (thread_id,account_id,owner_principal_id,request_id,role,content)
    VALUES(p_thread,v_account,p_owner,p_request,'user',trim(p_text));
  INSERT INTO public.ai_assistant_request_quota (account_id,owner_principal_id,request_id)
    VALUES(v_account,p_owner,p_request);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_text_regenerate_begin_llamacpp(
  p_owner uuid,p_thread uuid,p_request uuid,p_source uuid,p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account uuid; source_message public.ai_assistant_messages%ROWTYPE;
        local_config public.ai_llamacpp_settings%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
  IF public.ai_text_regeneration_replay(p_owner,p_thread,p_request,p_source) THEN RETURN false; END IF;
  v_account:=public.ai_chat_require_generation(p_owner);
  SELECT * INTO source_message FROM public.ai_assistant_messages m
    WHERE m.id=p_source AND m.thread_id=p_thread AND m.owner_principal_id=p_owner
      AND m.role='user' AND char_length(m.content) BETWEEN 1 AND 3000;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.ai_assistant_request_quota q WHERE NOT EXISTS(SELECT 1 FROM public.ai_image_jobs image_job WHERE image_job.owner_principal_id=q.owner_principal_id AND image_job.request_id=q.request_id) AND q.owner_principal_id=p_owner AND q.created_at > now()-interval '1 hour')>=30 THEN
    RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE='P0001';
  END IF;
  SELECT * INTO STRICT local_config FROM public.ai_llamacpp_settings WHERE singleton_key FOR UPDATE;
  IF local_config.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'AI_CONFIG_CHANGED';
  END IF;
  IF NOT local_config.enabled THEN RAISE EXCEPTION 'AI_DISABLED'; END IF;
  UPDATE public.ai_assistant_threads t SET
      busy_until=clock_timestamp()+interval '1830 seconds',
      active_request_id=p_request,updated_at=clock_timestamp()
    WHERE t.id=p_thread AND t.owner_principal_id=p_owner
      AND (t.busy_until IS NULL OR t.busy_until<clock_timestamp());
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.ai_assistant_request_quota(account_id,owner_principal_id,request_id)
    VALUES(v_account,p_owner,p_request);
  INSERT INTO public.ai_assistant_regenerations
      (owner_principal_id,request_id,thread_id,source_user_message_id,source_ordinal,source_prompt,source_digest)
    VALUES(p_owner,p_request,p_thread,p_source,source_message.ordinal,source_message.content,
      public.ai_text_source_digest(p_owner,p_thread,p_source,source_message.ordinal,source_message.content));
  RETURN true;
END;
$$;

CREATE FUNCTION ai_attachment_begin_message_llamacpp(
    p_owner uuid,p_thread uuid,p_request uuid,p_text varchar,p_expected_version bigint,p_uploads uuid[]
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_receipt public.ai_attachment_message_receipts%ROWTYPE; v_source public.ai_assistant_messages%ROWTYPE;
        v_manifest jsonb; v_bytes bigint; v_count bigint; v_digest bytea;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
    IF p_uploads IS NULL OR COALESCE(array_ndims(p_uploads),0)<>1 OR cardinality(p_uploads) NOT BETWEEN 1 AND 4
       OR EXISTS(SELECT 1 FROM unnest(p_uploads) u WHERE u IS NULL)
       OR (SELECT count(DISTINCT u) FROM unnest(p_uploads) u)<>cardinality(p_uploads)
       OR p_text IS NULL OR char_length(trim(p_text)) NOT BETWEEN 1 AND 3000 THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_INVALID' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    SELECT * INTO v_receipt FROM public.ai_attachment_message_receipts WHERE owner_principal_id=p_owner AND request_id=p_request;
    IF FOUND THEN
        SELECT * INTO v_source FROM public.ai_assistant_messages q WHERE q.id=v_receipt.source_user_message_id
            AND q.thread_id=p_thread AND q.owner_principal_id=p_owner AND q.role='user';
        IF NOT FOUND OR v_receipt.thread_id<>p_thread OR v_receipt.source_ordinal<>v_source.ordinal OR v_source.content<>trim(p_text)
           OR v_receipt.source_digest<>public.ai_text_source_digest(p_owner,p_thread,v_source.id,v_source.ordinal,v_source.content)
           OR (SELECT array_agg((item->>'uploadId')::uuid ORDER BY position) FROM jsonb_array_elements(v_receipt.manifest) WITH ORDINALITY m(item,position)) IS DISTINCT FROM p_uploads THEN
            RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
        PERFORM public.ai_attachment_bound_items(p_owner,p_thread,p_request,v_source.id,v_source.ordinal,v_receipt.source_digest,v_receipt.manifest);
        RETURN false;
    END IF;
    IF EXISTS(SELECT 1 FROM public.ai_assistant_request_quota WHERE owner_principal_id=p_owner AND request_id=p_request) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
    -- Existing local admission enforces owner, class policy, revision, rate and thread lock.
    -- Attachment rows come last, in UUID order. Failure below rolls back the
    -- user message and BOTH ledgers. No application-side post-send binding.
    IF NOT public.ai_text_begin_llamacpp(p_owner,p_thread,p_request,p_text,p_expected_version) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
    SELECT * INTO STRICT v_source FROM public.ai_assistant_messages
      WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_request AND role='user';
    PERFORM upload_id FROM public.ai_attachment_uploads WHERE owner_principal_id=p_owner AND upload_id=ANY(p_uploads) ORDER BY upload_id FOR UPDATE;
    SELECT count(*),COALESCE(sum(u.size_bytes),0),jsonb_agg(jsonb_build_object('uploadId',u.upload_id,'sha256',u.sha256,'sizeBytes',u.size_bytes,'mediaType',u.media_type) ORDER BY n.position)
      INTO v_count,v_bytes,v_manifest FROM unnest(p_uploads) WITH ORDINALITY n(id,position)
      JOIN public.ai_attachment_uploads u ON u.upload_id=n.id AND u.owner_principal_id=p_owner
      WHERE u.state='ready' AND NOT u.delete_requested AND u.expires_at>clock_timestamp() AND u.validated_at IS NOT NULL;
    IF v_count<>cardinality(p_uploads) THEN RAISE EXCEPTION 'AI_ATTACHMENT_NOT_READY' USING ERRCODE='42501'; END IF;
    IF v_bytes>20971520 THEN RAISE EXCEPTION 'AI_ATTACHMENT_QUOTA' USING ERRCODE='P0001'; END IF;
    v_digest:=public.ai_text_source_digest(p_owner,p_thread,v_source.id,v_source.ordinal,v_source.content);
    INSERT INTO public.ai_attachment_message_receipts(owner_principal_id,request_id,thread_id,source_user_message_id,source_ordinal,source_digest,manifest)
      VALUES(p_owner,p_request,p_thread,v_source.id,v_source.ordinal,v_digest,v_manifest);
    INSERT INTO public.ai_attachment_bindings(upload_id,owner_principal_id,thread_id,source_user_message_id,request_id,source_ordinal,source_digest,position)
      SELECT n.id,p_owner,p_thread,v_source.id,p_request,v_source.ordinal,v_digest,n.position FROM unnest(p_uploads) WITH ORDINALITY n(id,position);
    UPDATE public.ai_attachment_uploads SET state='bound',updated_at=clock_timestamp() WHERE upload_id=ANY(p_uploads);
    RETURN true;
END;
$$;

CREATE FUNCTION public.ai_web_text_begin_llamacpp(p_owner uuid,p_thread uuid,p_request uuid,p_text varchar,p_revision bigint,p_mode varchar,p_city varchar,p_uploads uuid[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_admitted boolean; v_intent public.ai_web_search_intents%ROWTYPE;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN('off','auto','web','images','weather') OR (p_city IS NOT NULL AND (char_length(p_city) NOT BETWEEN 1 AND 100 OR p_city~'[[:cntrl:]]')) THEN
  RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 IF coalesce(cardinality(p_uploads),0)>0 THEN
  v_admitted:=public.ai_attachment_begin_message_llamacpp(p_owner,p_thread,p_request,p_text,p_revision,p_uploads);
 ELSE
  v_admitted:=public.ai_text_begin_llamacpp(p_owner,p_thread,p_request,p_text,p_revision);
 END IF;
 IF v_admitted THEN
  INSERT INTO public.ai_web_search_intents(owner_principal_id,request_id,thread_id,mode,city) VALUES(p_owner,p_request,p_thread,p_mode,p_city);
 ELSE
  SELECT * INTO v_intent FROM public.ai_web_search_intents WHERE owner_principal_id=p_owner AND request_id=p_request;
  IF NOT FOUND THEN
   -- A legacy omitted-mode operation is the original off operation; never upgrade it into a lookup on replay.
   IF p_mode<>'off' OR p_city IS NOT NULL THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
  ELSIF v_intent.thread_id<>p_thread OR v_intent.mode<>p_mode OR v_intent.city IS DISTINCT FROM p_city THEN
   RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN v_admitted;
END;
$$;

ALTER FUNCTION public.ai_generation_policy_runtime() RENAME TO ai_generation_policy_runtime_before_llamacpp;
CREATE FUNCTION public.ai_generation_policy_runtime() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;l public.ai_llamacpp_settings%ROWTYPE;
BEGIN
 r:=public.ai_generation_policy_runtime_before_llamacpp();
 SELECT * INTO STRICT l FROM public.ai_llamacpp_settings WHERE singleton_key;
 IF r->'customized'='false'::jsonb AND l.enabled AND char_length(l.model)>0 THEN
  r:=jsonb_set(r,'{allowedModels}',(r->'allowedModels')||jsonb_build_array('llamacpp-local'));
 END IF;
 RETURN r||jsonb_build_object('llamaCppEnabled',l.enabled,'llamaCppModel',nullif(l.model,''));
END;$$;

CREATE OR REPLACE FUNCTION public.ai_provider_default_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.default_model IS NULL THEN RETURN NEW;END IF;
 IF NEW.default_model='ollama-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_ollama_settings WHERE singleton_key AND enabled AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF NEW.default_model='llamacpp-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_llamacpp_settings WHERE singleton_key AND enabled AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.ai_provider_settings s WHERE s.enabled AND s.api_key_ciphertext IS NOT NULL AND public.ai_model_provider_matches(s.provider,NEW.default_model)) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 RETURN NEW;
END;$$;

CREATE OR REPLACE FUNCTION public.ai_generation_policy_set(p_actor uuid,p_input jsonb,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_generation_policy%ROWTYPE;previous public.ai_generation_policy_writes%ROWTYPE;m text;def text;v_provider text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT old FROM public.ai_generation_policy WHERE singleton_key FOR UPDATE;
 SELECT * INTO previous FROM public.ai_generation_policy_writes WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF previous.payload<>p_input THEN RAISE EXCEPTION 'AI_POLICY_REQUEST_REUSED' USING ERRCODE='22023';END IF;RETURN;END IF;
 IF p_request IS NULL OR jsonb_typeof(p_input)<>'object' OR char_length(p_input->>'systemPrompt') NOT BETWEEN 1 AND 12000
  OR jsonb_typeof(p_input->'allowedModels') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'allowedModels')>2400
  OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(p_input->'allowedModels')) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF (p_input->>'configurationVersion')::bigint IS DISTINCT FROM old.revision THEN RAISE EXCEPTION 'AI_POLICY_CHANGED' USING ERRCODE='40001';END IF;
 FOR m IN SELECT jsonb_array_elements_text(p_input->'allowedModels') LOOP
  IF m NOT IN('ollama-local','llamacpp-local') AND NOT old.allowed_models?m AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) v WHERE public.ai_model_available(v,m,statement_timestamp())) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END LOOP;
 IF p_input?'modelPreferences' THEN
  IF jsonb_typeof(p_input->'modelPreferences') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'modelPreferences')>2400
   OR (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_input->'modelPreferences')) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  FOR m IN SELECT value::text FROM jsonb_array_elements(p_input->'modelPreferences') LOOP
   IF (m::jsonb->>'id') IS NULL OR (m::jsonb->>'id')!~'^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$' OR jsonb_typeof(m::jsonb->'eligible') IS DISTINCT FROM 'boolean' OR jsonb_typeof(m::jsonb->'order') IS DISTINCT FROM 'number' OR (m::jsonb->>'order')::numeric<>trunc((m::jsonb->>'order')::numeric) OR abs((m::jsonb->>'order')::numeric)>1000000 THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  END LOOP;
 END IF;
 IF p_input?'providerOrder' THEN
  IF jsonb_typeof(p_input->'providerOrder') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  FOR m IN SELECT key FROM jsonb_each(p_input->'providerOrder') LOOP
   IF m NOT IN('openai','deepseek','ollama-cloud','polza','ollama','llamacpp-local') OR jsonb_typeof(p_input->'providerOrder'->m) IS DISTINCT FROM 'number' OR (p_input->'providerOrder'->>m)::numeric<>trunc((p_input->'providerOrder'->>m)::numeric) OR abs((p_input->'providerOrder'->>m)::numeric)>1000000 THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
  END LOOP;
 END IF;
 def:=p_input->>'defaultModel';
 IF (def IS NULL)<>(jsonb_array_length(p_input->'allowedModels')=0) OR (def IS NOT NULL AND NOT (p_input->'allowedModels')?def) THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023';END IF;
 IF def IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_input->'modelPreferences',old.model_preferences)) pref WHERE pref->>'id'=def AND pref->'eligible'='false'::jsonb) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF def IS NOT NULL AND def NOT IN('ollama-local','llamacpp-local') AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) vprov WHERE public.ai_model_available(vprov,def,statement_timestamp()) AND (vprov<>'ollama-cloud' OR NOT (SELECT pool_managed FROM public.ai_ollama_cloud_catalog_state WHERE singleton_key) OR EXISTS(SELECT 1 FROM public.ai_ollama_cloud_key_candidates(def))) AND NOT EXISTS(SELECT 1 FROM public.ai_provider_catalog_observations o WHERE o.provider=vprov AND o.checked_at IS NOT NULL AND (o.credential_fingerprint IS DISTINCT FROM (SELECT s.key_fingerprint FROM public.ai_provider_settings s WHERE s.provider=vprov) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.models) observed_model WHERE observed_model->>'id'=def AND observed_model->'active'='true'::jsonb)))) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF def='ollama-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_ollama_settings WHERE singleton_key AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF def='llamacpp-local' THEN
  IF NOT EXISTS(SELECT 1 FROM public.ai_llamacpp_settings WHERE singleton_key AND char_length(model)>0) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 ELSIF def IS NOT NULL THEN
  SELECT v INTO v_provider FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) v WHERE public.ai_model_provider_matches(v,def);
  IF NOT EXISTS(SELECT 1 FROM public.ai_provider_settings WHERE ai_provider_settings.provider=v_provider AND api_key_ciphertext IS NOT NULL) THEN RAISE EXCEPTION 'AI_MODEL_UNAVAILABLE' USING ERRCODE='22023';END IF;
 END IF;
 UPDATE public.ai_generation_policy SET model_preferences=coalesce(p_input->'modelPreferences',old.model_preferences),provider_order=coalesce(p_input->'providerOrder',old.provider_order),customized=true,system_prompt=p_input->>'systemPrompt',allowed_models=p_input->'allowedModels',default_model=def,revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_generation_policy_writes VALUES(p_actor,p_request,p_input,old.revision+1);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_generation.update','integration','ai','admin_console','Generation policy',NULL,p_request::text,p_request::text,'succeeded',old.revision,old.revision+1);
END;
$$;
ALTER FUNCTION public.ai_generation_begin_before_budgets(uuid,uuid,uuid,jsonb,varchar,bigint,bigint) RENAME TO ai_generation_begin_before_llamacpp;
CREATE OR REPLACE FUNCTION public.ai_generation_begin_before_budgets(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb,p_model varchar,p_revision bigint,p_config bigint) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.ai_generation_policy%ROWTYPE;l public.ai_llamacpp_settings%ROWTYPE;v_provider varchar;source uuid;uploads uuid[];admitted boolean;profile jsonb;
BEGIN
 IF p_model<>'llamacpp-local' THEN RETURN public.ai_generation_begin_before_llamacpp(p_owner,p_thread,p_request,p_payload,p_model,p_revision,p_config);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF public.ai_generation_replay(p_owner,p_thread,p_request,p_payload) THEN RETURN false;END IF;
 SELECT * INTO STRICT p FROM public.ai_generation_policy WHERE singleton_key FOR UPDATE;
 IF p.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF (p.customized AND NOT p.allowed_models?p_model) OR (p_payload->>'model' IS NOT NULL AND p_payload->>'model'<>p_model) THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.model_preferences) pref WHERE pref->>'id'=p_model AND pref->'eligible'='false'::jsonb) THEN RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT l FROM public.ai_llamacpp_settings WHERE singleton_key FOR UPDATE;
 IF NOT l.enabled OR l.revision IS DISTINCT FROM p_config THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_llamacpp_slot WHERE singleton_key AND actor=p_owner AND thread_id=p_thread AND request_id=p_request::text AND backend_pid=pg_backend_pid()) OR NOT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=7333 AND objid=1 AND objsubid=2 AND granted) THEN RAISE EXCEPTION 'AI_LLAMACPP_SLOT_REQUIRED' USING ERRCODE='55000';END IF;
 v_provider:='llamacpp-local';
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('display_name',CASE WHEN pr.kind='account' THEN left(pf.display_name,120) ELSE ss.display_label END,
  'timezone',CASE WHEN pr.kind='account' THEN pf.time_zone ELSE NULL END,'at',clock_timestamp(),
  'capabilities','Текстовый ответ; скачивание предложенных блоков кода. '||CASE WHEN jsonb_array_length(coalesce(p_payload->'uploads','[]'))>0 THEN 'К этому запросу привязаны приватные вложения; остальные файлы пользователя недоступны. ' ELSE 'Вложения к этому запросу не переданы. ' END||'Свежие сетевые сведения доступны только из переданного блока интернет-поиска и его статуса. Генерация изображений в этом текстовом запросе не выполняется.') INTO profile
  FROM public.principals pr LEFT JOIN public.profiles pf ON pr.kind='account' AND pf.account_id=pr.account_id
  LEFT JOIN public.classroom_student_seats ss ON pr.kind='student_seat' AND ss.id=pr.seat_id WHERE pr.id=p_owner;
 INSERT INTO public.ai_generation_receipts VALUES(p_owner,p_request,p_thread,p_model,v_provider,p.revision,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p.system_prompt,profile);
 source:=(p_payload->>'source')::uuid;
 SELECT coalesce(array_agg(v::uuid),'{}'::uuid[]) INTO uploads FROM jsonb_array_elements_text(coalesce(p_payload->'uploads','[]')) v;
 IF source IS NOT NULL THEN
  admitted:=public.ai_text_regenerate_begin_llamacpp(p_owner,p_thread,p_request,source,p_config);
 ELSIF p_payload->>'webSearchMode' IS NOT NULL THEN
  admitted:=public.ai_web_text_begin_llamacpp(p_owner,p_thread,p_request,p_payload->>'text',p_config,p_payload->>'webSearchMode',p_payload->>'weatherCity',uploads);
 ELSIF cardinality(uploads)>0 THEN
  admitted:=public.ai_attachment_begin_message_llamacpp(p_owner,p_thread,p_request,p_payload->>'text',p_config,uploads);
 ELSE
  admitted:=public.ai_text_begin_llamacpp(p_owner,p_thread,p_request,p_payload->>'text',p_config);
 END IF;
 IF NOT admitted THEN DELETE FROM public.ai_generation_receipts WHERE owner_principal_id=p_owner AND request_id=p_request;END IF;
 RETURN admitted;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_token_budgets_set(p_actor uuid,p_input jsonb,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_token_budget_policy%ROWTYPE;previous public.ai_token_budget_writes%ROWTYPE;item jsonb;cap text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT old FROM public.ai_token_budget_policy WHERE singleton_key FOR UPDATE;
 SELECT * INTO previous FROM public.ai_token_budget_writes WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF previous.payload<>p_input THEN RAISE EXCEPTION 'AI_BUDGET_REQUEST_REUSED' USING ERRCODE='22023';END IF;RETURN;END IF;
 IF p_request IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR jsonb_typeof(p_input->'models') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_input->'models')>2400 OR (SELECT count(*)<>count(DISTINCT value->>'model') FROM jsonb_array_elements(p_input->'models')) THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
 IF (p_input->>'configurationVersion')::bigint IS DISTINCT FROM old.revision THEN RAISE EXCEPTION 'AI_BUDGET_CHANGED' USING ERRCODE='40001';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_input->'models') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'model' IS NULL OR ((item->>'model') NOT IN('ollama-local','llamacpp-local') AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud','polza']) provider WHERE public.ai_model_provider_matches(provider::varchar,(item->>'model')::varchar)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old.limits) x WHERE x->>'model'=item->>'model')) THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
  FOREACH cap IN ARRAY ARRAY['globalLimit','userLimit'] LOOP
   IF NOT item?cap OR (item->cap<>'null'::jsonb AND (jsonb_typeof(item->cap)<>'string' OR item->>cap!~'^(0|[1-9][0-9]{0,15})$')) THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
   IF (item->>cap)::numeric>9007199254740991 THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
  END LOOP;
 END LOOP;
 UPDATE public.ai_token_budget_policy SET limits=p_input->'models',revision=revision+1 WHERE singleton_key;
 INSERT INTO public.ai_token_budget_writes VALUES(p_actor,p_request,p_input,old.revision+1);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_token_budget.update','integration','ai','admin_console','Monthly token budgets',NULL,p_request::text,p_request::text,'succeeded',old.revision,old.revision+1);
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_token_budgets_admin(p_actor uuid,p_catalog jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;rev bigint;models jsonb;month_start timestamptz:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT revision INTO rev FROM public.ai_token_budget_policy WHERE singleton_key;
 IF jsonb_typeof(p_catalog) IS DISTINCT FROM 'array' OR jsonb_array_length(p_catalog)>2400 THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(m),'[]') INTO models FROM (SELECT jsonb_array_elements_text(allowed_models)::varchar m FROM public.ai_generation_policy WHERE singleton_key
 UNION SELECT (value->>'model')::varchar FROM public.ai_token_budget_policy b,jsonb_array_elements(b.limits)
 UNION SELECT id::varchar FROM public.ai_polza_models WHERE public.ai_model_available('polza',id,statement_timestamp())
 UNION SELECT value::varchar FROM jsonb_array_elements_text(p_catalog) WHERE value IN('ollama-local','llamacpp-local') OR EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) provider WHERE public.ai_model_provider_matches(provider::varchar,value::varchar))) ids;
 WITH stats AS MATERIALIZED (SELECT * FROM public.ai_token_budget_snapshot(models,month_start,NULL))
 SELECT coalesce(jsonb_agg(jsonb_build_object('model',s.model,'globalLimit',item->>'globalLimit','userLimit',item->>'userLimit','used',s.global_used::text,'held',s.global_held::text,'unresolved',s.global_unresolved,'pendingUnknown',s.global_pending_unknown) ORDER BY s.model),'[]') INTO result
 FROM stats s LEFT JOIN (SELECT value item FROM public.ai_token_budget_policy b,jsonb_array_elements(b.limits)) limits ON item->>'model'=s.model;
 RETURN jsonb_build_object('configurationVersion',rev,'models',result,'resetAt',(month_start AT TIME ZONE 'UTC'+interval '1 month') AT TIME ZONE 'UTC');
END;
$$;

ALTER TABLE public.ai_usage_journal ALTER COLUMN provider TYPE varchar(24);
ALTER TABLE public.ai_usage_journal DROP CONSTRAINT ai_usage_journal_provider_check;
ALTER TABLE public.ai_usage_journal ADD CONSTRAINT ai_usage_journal_provider_check CHECK(provider IN('openai','deepseek','ollama','ollama-cloud','comfyui','polza','llamacpp-local'));

CREATE OR REPLACE FUNCTION public.ai_usage_begin(p_owner uuid,p_thread uuid,p_request uuid,p_operation varchar,p_transport varchar,p_provider varchar,p_model varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_operation varchar;
BEGIN
    IF p_operation IS NULL OR p_operation NOT IN ('chat','regeneration') OR p_transport IS NULL OR p_transport NOT IN ('json','sse')
       OR p_provider IS NULL OR p_provider NOT IN ('openai','deepseek','ollama','ollama-cloud','polza','llamacpp-local') OR p_model IS NULL
       OR p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$' OR position('://' IN p_model)>0 THEN
        RAISE EXCEPTION 'AI_USAGE_INVALID' USING ERRCODE='22023';
    END IF;
    -- Canonical admission, exact owner, and current thread lease are mandatory.
    PERFORM 1 FROM public.ai_assistant_threads t JOIN public.ai_assistant_request_quota q
      ON q.owner_principal_id=t.owner_principal_id AND q.request_id=t.active_request_id
     WHERE t.id=p_thread AND t.owner_principal_id=p_owner AND t.active_request_id=p_request FOR UPDATE OF t;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.ai_assistant_regenerations r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=p_request) THEN
        v_operation:='regeneration';
    ELSIF EXISTS(SELECT 1 FROM public.ai_assistant_messages m WHERE m.owner_principal_id=p_owner AND m.thread_id=p_thread AND m.request_id=p_request AND m.role='user') THEN
        v_operation:='chat';
    END IF;
    IF v_operation IS DISTINCT FROM p_operation THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    UPDATE public.ai_usage_journal SET thread_id=p_thread,operation=p_operation,transport=p_transport,
      provider=p_provider,requested_model=p_model,started_at=clock_timestamp(),status='running'
     WHERE owner_principal_id=p_owner AND request_id=p_request AND status='admitted';
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_usage_finish_before_budgets(p_owner uuid,p_request uuid,p_status varchar,p_error varchar,p_input bigint,p_output bigint,p_model varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_row public.ai_usage_journal%ROWTYPE; v_end timestamptz;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('succeeded','stopped','cancelled','failed')
       OR (p_error IS NOT NULL AND p_error NOT IN ('ai_provider_error','ai_response_incomplete','ai_response_invalid','ai_response_empty',
         'ai_stream_invalid','ai_stream_interrupted','ai_provider_timeout','ai_provider_unavailable','ai_provider_rate_limit',
         'ai_provider_authentication_failed','ai_provider_invalid_request','ai_provider_access_denied','ai_provider_insufficient_balance',
         'ai_provider_invalid_parameters','ai_provider_model_unavailable','ai_ollama_unreachable',
         'ai_ollama_timeout','ai_ollama_interrupted','ai_ollama_invalid','ai_ollama_upstream_error','ai_ollama_empty',
         'ai_generation_failed','ai_tool_call_invalid','ai_llamacpp_url_invalid','ai_llamacpp_url_denied','ai_llamacpp_model_invalid','ai_llamacpp_model_missing','ai_llamacpp_key_invalid','ai_llamacpp_encryption_unavailable','ai_llamacpp_key_decryption_failed','ai_llamacpp_auth','ai_llamacpp_busy','ai_llamacpp_unreachable','ai_llamacpp_timeout','ai_llamacpp_invalid','ai_llamacpp_interrupted','ai_llamacpp_response_empty','ai_llamacpp_context_invalid','ai_llamacpp_context_exceeded','ai_llamacpp_config_invalid','ai_llamacpp_config_changed','ai_llamacpp_admin_denied','ai_llamacpp_unavailable','ai_llamacpp_apply_pending','ai_llamacpp_apply_failed','ai_llamacpp_replay_conflict','ai_llamacpp_upstream_error','ai_llamacpp_request_rejected')) OR p_input<0 OR p_output<0 OR p_input>9007199254740991 OR p_output>9007199254740991
       OR (p_model IS NOT NULL AND (p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$' OR position('://' IN p_model)>0)) THEN
        RAISE EXCEPTION 'AI_USAGE_INVALID' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_row FROM public.ai_usage_journal WHERE owner_principal_id=p_owner AND request_id=p_request FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    IF v_row.status NOT IN ('admitted','running') THEN
        IF v_row.status IS DISTINCT FROM p_status OR v_row.error_code IS DISTINCT FROM p_error
           OR v_row.input_tokens IS DISTINCT FROM p_input OR v_row.output_tokens IS DISTINCT FROM p_output
           OR v_row.actual_model IS DISTINCT FROM p_model THEN
            RAISE EXCEPTION 'AI_USAGE_CONFLICT' USING ERRCODE='22023';
        END IF;
        RETURN true;
    END IF;
    IF v_row.status <> 'running' OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_request_quota q WHERE q.owner_principal_id=p_owner AND q.request_id=p_request) THEN
        RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501';
    END IF;
    v_end:=clock_timestamp();
    UPDATE public.ai_usage_journal SET status=p_status,error_code=p_error,finished_at=v_end,
      duration_ms=greatest(0,floor(extract(epoch FROM (v_end-started_at))*1000)::bigint),
      input_tokens=p_input,output_tokens=p_output,actual_model=p_model
     WHERE owner_principal_id=p_owner AND request_id=p_request;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_text_begin_llamacpp(uuid,uuid,uuid,varchar,bigint),public.ai_text_regenerate_begin_llamacpp(uuid,uuid,uuid,uuid,bigint),public.ai_attachment_begin_message_llamacpp(uuid,uuid,uuid,varchar,bigint,uuid[]),public.ai_web_text_begin_llamacpp(uuid,uuid,uuid,varchar,bigint,varchar,varchar,uuid[]),public.ai_generation_begin_before_llamacpp(uuid,uuid,uuid,jsonb,varchar,bigint,bigint),public.ai_generation_begin_before_budgets(uuid,uuid,uuid,jsonb,varchar,bigint,bigint),public.ai_generation_policy_runtime_before_llamacpp() FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.ai_llamacpp_runtime(),public.ai_llamacpp_admin_get(uuid),public.ai_llamacpp_apply_claim(uuid,varchar,varchar,bigint),public.ai_llamacpp_apply_fail(uuid,varchar,varchar,jsonb),public.ai_llamacpp_admin_set(uuid,jsonb,varchar),public.ai_llamacpp_slot_acquire(uuid,uuid,varchar),public.ai_llamacpp_slot_release(uuid,uuid,varchar),public.ai_generation_policy_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_llamacpp_runtime(),public.ai_llamacpp_admin_get(uuid),public.ai_llamacpp_apply_claim(uuid,varchar,varchar,bigint),public.ai_llamacpp_apply_fail(uuid,varchar,varchar,jsonb),public.ai_llamacpp_admin_set(uuid,jsonb,varchar),public.ai_llamacpp_slot_acquire(uuid,uuid,varchar),public.ai_llamacpp_slot_release(uuid,uuid,varchar),public.ai_generation_policy_runtime() TO asalab_app;


-- The llama.cpp history window preserves the existing owner/source/ordinal guards.
-- Only this provider widens recent questions; the service applies the confirmed byte budget.
CREATE FUNCTION public.ai_text_generation_context_llamacpp(p_owner uuid, p_thread uuid, p_request uuid)
RETURNS TABLE (role varchar, content varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_source public.ai_assistant_messages%ROWTYPE;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501'; END IF;
    SELECT q.* INTO v_source FROM public.ai_assistant_messages q
    WHERE q.owner_principal_id = p_owner AND q.thread_id = p_thread AND q.role = 'user'
      AND (q.request_id = p_request OR EXISTS (
          SELECT 1 FROM public.ai_assistant_regenerations r WHERE r.owner_principal_id = p_owner
            AND r.thread_id = p_thread AND r.request_id = p_request AND r.source_user_message_id = q.id
            AND r.source_digest = public.ai_text_source_digest(p_owner, p_thread, q.id, q.ordinal, q.content)
      ));
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE = '42501'; END IF;
    RETURN QUERY
    WITH questions AS (
        SELECT q.* FROM public.ai_assistant_messages q
        WHERE q.thread_id = p_thread AND q.owner_principal_id = p_owner AND q.role = 'user'
          AND q.ordinal <= v_source.ordinal
        ORDER BY q.ordinal DESC LIMIT 32
    ), context AS (
        SELECT q.ordinal, 0 AS part, q.role, q.content FROM questions q
        UNION ALL
        SELECT q.ordinal, 1 AS part, answer.role, answer.content
        FROM questions q JOIN LATERAL (
            SELECT a.role, a.content FROM public.ai_assistant_messages a
            WHERE a.thread_id = p_thread AND a.owner_principal_id = p_owner AND a.role = 'assistant'
              AND a.source_user_message_id = q.id AND a.ordinal < v_source.ordinal
            ORDER BY a.ordinal DESC LIMIT 1
        ) answer ON true WHERE q.id <> v_source.id
    ) SELECT context.role, context.content FROM context ORDER BY context.ordinal, context.part;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_text_generation_context_llamacpp(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_text_generation_context_llamacpp(uuid,uuid,uuid) TO asalab_app;
