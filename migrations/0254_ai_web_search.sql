-- Optional free server search: no provider keys, paid API subscriptions or old-schema changes.
CREATE TABLE public.ai_web_search_settings (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),
 enabled boolean NOT NULL DEFAULT false,
 weather_enabled boolean NOT NULL DEFAULT true,
 operations_per_hour integer NOT NULL DEFAULT 100 CHECK(operations_per_hour BETWEEN 1 AND 10000),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0)
);
INSERT INTO public.ai_web_search_settings(singleton_key) VALUES(true);
ALTER TABLE public.ai_web_search_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_web_search_settings FROM PUBLIC,asalab_app;

CREATE TABLE public.ai_web_search_receipts (
 owner_principal_id uuid NOT NULL REFERENCES public.principals(id),
 request_id uuid NOT NULL,
 thread_id uuid NOT NULL,
 source_user_message_id uuid NOT NULL,
 mode varchar(8) NOT NULL CHECK(mode IN('web','images','weather')),
 query varchar(400),
 forgotten boolean NOT NULL DEFAULT false,
 CHECK((NOT forgotten AND query IS NOT NULL AND char_length(query) BETWEEN 1 AND 400) OR (forgotten AND query IS NULL AND evidence IS NULL)),
 reserved_units integer NOT NULL CHECK(reserved_units BETWEEN 0 AND 3),
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence jsonb,
 PRIMARY KEY(owner_principal_id,request_id),
 FOREIGN KEY(owner_principal_id,request_id) REFERENCES public.ai_assistant_request_quota(owner_principal_id,request_id),
 CHECK(evidence IS NULL OR (jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=65536))
);
CREATE INDEX ai_web_search_admitted_idx ON public.ai_web_search_receipts(admitted_at);
ALTER TABLE public.ai_web_search_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_web_search_receipts FROM PUBLIC,asalab_app;

CREATE TABLE public.ai_web_search_intents (
 owner_principal_id uuid NOT NULL REFERENCES public.principals(id), request_id uuid NOT NULL,
 thread_id uuid NOT NULL, mode varchar(8) NOT NULL CHECK(mode IN('off','auto','web','images','weather')),
 city varchar(100), forgotten boolean NOT NULL DEFAULT false,
 PRIMARY KEY(owner_principal_id,request_id),
 FOREIGN KEY(owner_principal_id,request_id) REFERENCES public.ai_assistant_request_quota(owner_principal_id,request_id),
 CHECK(city IS NULL OR char_length(city) BETWEEN 1 AND 100), CHECK(NOT forgotten OR city IS NULL)
);
ALTER TABLE public.ai_web_search_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_web_search_intents FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_web_text_begin(p_owner uuid,p_thread uuid,p_request uuid,p_text varchar,p_revision bigint,p_mode varchar,p_city varchar,p_uploads uuid[],p_local boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_admitted boolean; v_intent public.ai_web_search_intents%ROWTYPE;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN('off','auto','web','images','weather') OR p_local IS NULL OR (p_city IS NOT NULL AND (char_length(p_city) NOT BETWEEN 1 AND 100 OR p_city~'[[:cntrl:]]')) THEN
  RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 IF coalesce(cardinality(p_uploads),0)>0 THEN
  v_admitted:=CASE WHEN p_local THEN public.ai_attachment_begin_message_local(p_owner,p_thread,p_request,p_text,p_revision,p_uploads)
   ELSE public.ai_attachment_begin_message(p_owner,p_thread,p_request,p_text,p_revision,p_uploads) END;
 ELSE
  v_admitted:=CASE WHEN p_local THEN public.ai_text_begin_local(p_owner,p_thread,p_request,p_text,p_revision)
   ELSE public.ai_text_begin_paid(p_owner,p_thread,p_request,p_text,p_revision) END;
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
REVOKE ALL ON FUNCTION public.ai_web_text_begin(uuid,uuid,uuid,varchar,bigint,varchar,varchar,uuid[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_web_text_begin(uuid,uuid,uuid,varchar,bigint,varchar,varchar,uuid[],boolean) TO asalab_app;

CREATE FUNCTION public.ai_web_search_runtime()
RETURNS SETOF public.ai_web_search_settings LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT * FROM public.ai_web_search_settings WHERE singleton_key
$$;
CREATE FUNCTION public.ai_web_search_admin_get(p_actor uuid)
RETURNS SETOF public.ai_web_search_settings LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM public.ai_web_search_settings WHERE singleton_key;
END;
$$;
CREATE FUNCTION public.ai_web_search_admin_set(p_actor uuid,p_enabled boolean,p_weather boolean,p_limit integer,p_revision bigint,p_request varchar)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_old public.ai_web_search_settings%ROWTYPE;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501'; END IF;
 IF p_enabled IS NULL OR p_weather IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000 OR p_revision IS NULL OR p_revision<1
    OR p_request IS NULL OR char_length(p_request) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'AI_WEB_CONFIG_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT v_old FROM public.ai_web_search_settings WHERE singleton_key FOR UPDATE;
 IF v_old.revision<>p_revision THEN RAISE EXCEPTION 'AI_WEB_CONFIG_CHANGED' USING ERRCODE='40001'; END IF;
 UPDATE public.ai_web_search_settings SET enabled=p_enabled,weather_enabled=p_weather,operations_per_hour=p_limit,revision=revision+1 WHERE singleton_key;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_web_search.update','integration','searxng',
  'admin_console','Server search settings',NULL,p_request,p_request,'succeeded',v_old.revision,v_old.revision+1);
END;
$$;
CREATE FUNCTION public.ai_web_search_claim(p_owner uuid,p_thread uuid,p_request uuid,p_mode varchar,p_query varchar,p_units integer)
RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_config public.ai_web_search_settings%ROWTYPE; v_source uuid; v_existing public.ai_web_search_receipts%ROWTYPE; v_used bigint; v_status varchar;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN('web','images','weather') OR p_query IS NULL OR char_length(p_query) NOT BETWEEN 1 AND 400
    OR p_units IS NULL OR p_units NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'AI_WEB_INVALID' USING ERRCODE='22023'; END IF;
 -- No key/search call can be admitted without the exact existing paid/local chat admission and lease.
 SELECT m.id INTO v_source FROM public.ai_assistant_messages m JOIN public.ai_assistant_threads t
  ON t.id=m.thread_id AND t.owner_principal_id=m.owner_principal_id
  JOIN public.ai_assistant_request_quota q ON q.owner_principal_id=m.owner_principal_id AND q.request_id=m.request_id
  WHERE m.owner_principal_id=p_owner AND m.thread_id=p_thread AND m.request_id=p_request AND m.role='user'
    AND t.active_request_id=p_request AND t.busy_until>clock_timestamp() AND public.ai_chat_owner_valid(p_owner);
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_WEB_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_config FROM public.ai_web_search_settings WHERE singleton_key FOR UPDATE;
 SELECT * INTO v_existing FROM public.ai_web_search_receipts WHERE owner_principal_id=p_owner AND request_id=p_request;
 IF FOUND THEN
  IF v_existing.thread_id<>p_thread OR v_existing.source_user_message_id<>v_source OR v_existing.mode<>p_mode OR v_existing.query<>p_query THEN
   RAISE EXCEPTION 'AI_WEB_CONFLICT' USING ERRCODE='22023';
  END IF;
  RETURN 'replay';
 END IF;
 SELECT coalesce(sum(reserved_units),0) INTO v_used FROM public.ai_web_search_receipts WHERE admitted_at>clock_timestamp()-INTERVAL '1 hour';
 v_status:=CASE WHEN NOT v_config.enabled THEN 'disabled' WHEN v_used+p_units>v_config.operations_per_hour THEN 'limited' ELSE 'ready' END;
 INSERT INTO public.ai_web_search_receipts(owner_principal_id,request_id,thread_id,source_user_message_id,mode,query,reserved_units)
 VALUES(p_owner,p_request,p_thread,v_source,p_mode,p_query,CASE WHEN v_status='ready' THEN p_units ELSE 0 END);
 RETURN v_status;
END;
$$;

CREATE FUNCTION public.ai_web_search_finish(p_owner uuid,p_thread uuid,p_request uuid,p_evidence jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_evidence IS NULL OR jsonb_typeof(p_evidence)<>'object' OR octet_length(p_evidence::text)>65536 THEN
  RAISE EXCEPTION 'AI_WEB_INVALID' USING ERRCODE='22023';
 END IF;
 UPDATE public.ai_web_search_receipts r SET evidence=p_evidence WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=p_request
  AND r.evidence IS NULL AND EXISTS(SELECT 1 FROM public.ai_assistant_threads t WHERE t.id=p_thread AND t.owner_principal_id=p_owner AND t.active_request_id=p_request)
  AND public.ai_chat_owner_valid(p_owner);
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_WEB_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;

CREATE FUNCTION public.ai_web_search_evidence(p_owner uuid,p_thread uuid,p_request uuid,p_public boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_evidence jsonb; v_request uuid; v_images jsonb;
BEGIN
 SELECT m.request_id INTO v_request FROM public.ai_assistant_messages m
  WHERE m.thread_id=p_thread AND m.owner_principal_id=p_owner AND m.role='user'
   AND (m.request_id=p_request OR m.id=(SELECT r.source_user_message_id FROM public.ai_assistant_regenerations r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=p_request))
   AND public.ai_chat_owner_valid(p_owner);
 IF v_request IS NULL THEN RETURN NULL; END IF;
 SELECT r.evidence INTO v_evidence FROM public.ai_web_search_receipts r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=v_request;
 IF p_public AND v_evidence IS NOT NULL THEN
  SELECT coalesce(jsonb_agg(i.value||jsonb_build_object('thumbnailUrl','/api/ai/threads/'||p_thread::text||'/web-search/'||v_request::text||'/images/'||(i.value->>'id')) ORDER BY i.ordinality),'[]'::jsonb)
   INTO v_images FROM jsonb_array_elements(coalesce(v_evidence->'images','[]'::jsonb)) WITH ORDINALITY i(value,ordinality);
  v_evidence:=jsonb_set(v_evidence,'{images}',v_images);
 END IF;
 RETURN v_evidence;
END;
$$;

CREATE FUNCTION public.ai_web_search_forget_thread() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE public.ai_web_search_intents SET city=NULL,forgotten=true WHERE owner_principal_id=OLD.owner_principal_id AND thread_id=OLD.id;
 UPDATE public.ai_web_search_receipts SET query=NULL,evidence=NULL,forgotten=true WHERE owner_principal_id=OLD.owner_principal_id AND thread_id=OLD.id;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_web_search_forget_thread() FROM PUBLIC,asalab_app;
CREATE TRIGGER ai_web_search_forget BEFORE DELETE ON public.ai_assistant_threads FOR EACH ROW EXECUTE FUNCTION public.ai_web_search_forget_thread();
REVOKE ALL ON FUNCTION public.ai_web_search_runtime(),public.ai_web_search_admin_get(uuid),public.ai_web_search_admin_set(uuid,boolean,boolean,integer,bigint,varchar),public.ai_web_search_claim(uuid,uuid,uuid,varchar,varchar,integer),public.ai_web_search_finish(uuid,uuid,uuid,jsonb),public.ai_web_search_evidence(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_web_search_runtime(),public.ai_web_search_admin_get(uuid),public.ai_web_search_admin_set(uuid,boolean,boolean,integer,bigint,varchar),public.ai_web_search_claim(uuid,uuid,uuid,varchar,varchar,integer),public.ai_web_search_finish(uuid,uuid,uuid,jsonb),public.ai_web_search_evidence(uuid,uuid,uuid,boolean) TO asalab_app;

-- Public city/forecast cache is shared across all users and API instances. No prompt, owner or attachment is stored here.
CREATE TABLE public.ai_web_public_cache (
 kind varchar(8) NOT NULL CHECK(kind IN('geocode','weather')), cache_key varchar(100) NOT NULL,
 body jsonb, expires_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_modified varchar(128),
 touched_at timestamptz NOT NULL DEFAULT clock_timestamp(), fetching_until timestamptz, fetch_token uuid,
 PRIMARY KEY(kind,cache_key), CHECK(body IS NULL OR octet_length(body::text)<=1048576)
);
ALTER TABLE public.ai_web_public_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_web_public_cache FROM PUBLIC,asalab_app;
CREATE TABLE public.ai_web_geocoder_budget (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key), last_at timestamptz NOT NULL DEFAULT 'epoch',
 window_start timestamptz NOT NULL DEFAULT clock_timestamp(), inflight_until timestamptz, requests integer NOT NULL DEFAULT 0 CHECK(requests>=0)
);
INSERT INTO public.ai_web_geocoder_budget(singleton_key) VALUES(true);
ALTER TABLE public.ai_web_geocoder_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_web_geocoder_budget FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_web_cache_claim(p_kind varchar,p_key varchar) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.ai_web_public_cache%ROWTYPE; b public.ai_web_geocoder_budget%ROWTYPE; v_now timestamptz; v_token uuid:=gen_random_uuid();
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('geocode','weather') OR p_key IS NULL OR char_length(p_key) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'AI_WEB_CACHE_INVALID' USING ERRCODE='22023'; END IF;
 -- A single global claim lock spans all API instances; no network operation runs inside the transaction.
 PERFORM pg_advisory_xact_lock(7300253);
 v_now:=clock_timestamp();
 SELECT * INTO r FROM public.ai_web_public_cache WHERE kind=p_kind AND cache_key=p_key;
 IF FOUND AND r.expires_at>v_now THEN
  RETURN jsonb_build_object('state',CASE WHEN r.body IS NOT NULL THEN 'fresh' ELSE 'busy' END,'body',r.body,'lastModified',r.last_modified);
 END IF;
 IF r.fetching_until>v_now THEN RETURN jsonb_build_object('state','busy'); END IF;
 DELETE FROM public.ai_web_public_cache WHERE touched_at<v_now-INTERVAL '30 days' AND coalesce(fetching_until,'epoch')<v_now;
 IF NOT EXISTS(SELECT 1 FROM public.ai_web_public_cache WHERE kind=p_kind AND cache_key=p_key)
    AND (SELECT count(*) FROM public.ai_web_public_cache WHERE kind=p_kind)>=1000 THEN RETURN jsonb_build_object('state','limited'); END IF;
 IF p_kind='geocode' THEN
  SELECT * INTO STRICT b FROM public.ai_web_geocoder_budget WHERE singleton_key FOR UPDATE;
  IF b.inflight_until>v_now OR b.last_at>v_now-INTERVAL '1 second' OR (b.window_start>v_now-INTERVAL '1 hour' AND b.requests>=60) THEN RETURN jsonb_build_object('state','limited'); END IF;
  UPDATE public.ai_web_geocoder_budget SET last_at=v_now,inflight_until=v_now+INTERVAL '30 seconds',window_start=CASE WHEN b.window_start<=v_now-INTERVAL '1 hour' THEN v_now ELSE b.window_start END,
   requests=CASE WHEN b.window_start<=v_now-INTERVAL '1 hour' THEN 1 ELSE b.requests+1 END WHERE singleton_key;
 END IF;
 INSERT INTO public.ai_web_public_cache(kind,cache_key,fetching_until,touched_at,fetch_token) VALUES(p_kind,p_key,v_now+INTERVAL '30 seconds',v_now,v_token)
  ON CONFLICT(kind,cache_key) DO UPDATE SET fetching_until=EXCLUDED.fetching_until,touched_at=EXCLUDED.touched_at,fetch_token=EXCLUDED.fetch_token;
 RETURN jsonb_build_object('state','fetch','body',r.body,'lastModified',r.last_modified,'lease',v_token,'fetchUntil',v_now+INTERVAL '30 seconds');
END;
$$;
CREATE FUNCTION public.ai_web_cache_save(p_kind varchar,p_key varchar,p_body jsonb,p_expires timestamptz,p_modified varchar,p_lease uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_lease IS NULL OR p_kind IS NULL OR p_kind NOT IN('geocode','weather') OR p_key IS NULL OR char_length(p_key) NOT BETWEEN 1 AND 100
  OR p_expires IS NULL OR p_expires>clock_timestamp()+INTERVAL '8 days' OR (p_body IS NOT NULL AND octet_length(p_body::text)>1048576)
  OR (p_modified IS NOT NULL AND char_length(p_modified)>128) THEN RAISE EXCEPTION 'AI_WEB_CACHE_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE public.ai_web_public_cache SET body=p_body,expires_at=p_expires,last_modified=p_modified,touched_at=clock_timestamp(),fetching_until=NULL,fetch_token=NULL
  WHERE kind=p_kind AND cache_key=p_key AND fetching_until IS NOT NULL AND fetch_token=p_lease;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_WEB_CACHE_INVALID' USING ERRCODE='22023'; END IF;
 IF p_kind='geocode' THEN UPDATE public.ai_web_geocoder_budget SET last_at=clock_timestamp(),inflight_until=NULL WHERE singleton_key; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_web_cache_claim(varchar,varchar),public.ai_web_cache_save(varchar,varchar,jsonb,timestamptz,varchar,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_web_cache_claim(varchar,varchar),public.ai_web_cache_save(varchar,varchar,jsonb,timestamptz,varchar,uuid) TO asalab_app;
