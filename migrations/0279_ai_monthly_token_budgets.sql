-- Soft UTC-month admission budgets. Holds are concurrency reservations, never
-- predictions, provider output limits, actual token usage, or expiring refunds.
CREATE TABLE public.ai_token_budget_policy (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),
 revision bigint NOT NULL DEFAULT 0,
 limits jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(limits)='array')
);
INSERT INTO public.ai_token_budget_policy DEFAULT VALUES;
CREATE TABLE public.ai_token_budget_writes (
 actor uuid NOT NULL, request_id uuid NOT NULL, payload jsonb NOT NULL,
 revision bigint NOT NULL, PRIMARY KEY(actor,request_id)
);
CREATE TABLE public.ai_token_budget_reservations (
 owner_principal_id uuid NOT NULL, request_id uuid NOT NULL,
 model varchar(200) NOT NULL, month_start timestamptz NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 1 AND 8192),
 state varchar(20) NOT NULL DEFAULT 'held' CHECK(state IN('held','settled','pending_unknown')),
 PRIMARY KEY(owner_principal_id,request_id),
 FOREIGN KEY(owner_principal_id,request_id) REFERENCES public.ai_usage_journal(owner_principal_id,request_id)
);
CREATE INDEX ai_token_budget_month_model ON public.ai_token_budget_reservations(month_start,model);
ALTER TABLE public.ai_token_budget_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_token_budget_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_token_budget_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_token_budget_policy,public.ai_token_budget_writes,public.ai_token_budget_reservations FROM PUBLIC,asalab_app;

-- A receipt identifies the immutable selection alias (not today's local model).
-- Older rows without either identity are explicitly unresolved for every model.
CREATE FUNCTION public.ai_token_budget_snapshot(p_models jsonb,p_month timestamptz,p_owner uuid)
RETURNS TABLE(model varchar,used numeric,held numeric,unresolved boolean,global_used numeric,global_held numeric,global_unresolved boolean,pending_unknown boolean,global_pending_unknown boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH month_rows AS MATERIALIZED (
 -- Indexed reservation-month -> journal PK lookup; a late result belongs here
 -- even when its journal timestamp is in another month.
 SELECT j.owner_principal_id,j.request_id,j.operation,j.provider,j.input_tokens,j.output_tokens,r.model selection,r.amount,r.state
 FROM public.ai_token_budget_reservations r JOIN public.ai_usage_journal j USING(owner_principal_id,request_id)
 WHERE r.month_start=p_month AND p_models?r.model
 UNION ALL
 -- Only legacy rows use admitted_at, with an indexable half-open UTC range.
 SELECT j.owner_principal_id,j.request_id,j.operation,j.provider,j.input_tokens,j.output_tokens,
 coalesce(g.model,CASE WHEN j.provider='ollama' THEN 'ollama-local' ELSE j.requested_model END),NULL::bigint,NULL::varchar
 FROM public.ai_usage_journal j LEFT JOIN public.ai_generation_receipts g USING(owner_principal_id,request_id)
 WHERE j.admitted_at>=p_month AND j.admitted_at<(p_month AT TIME ZONE 'UTC'+interval '1 month') AT TIME ZONE 'UTC'
 AND NOT EXISTS(SELECT 1 FROM public.ai_token_budget_reservations r WHERE r.owner_principal_id=j.owner_principal_id AND r.request_id=j.request_id)
 ), entries AS MATERIALIZED (
 SELECT j.* FROM month_rows j WHERE true
 AND j.operation IS DISTINCT FROM 'image' AND j.provider IS DISTINCT FROM 'comfyui'
 AND NOT EXISTS(SELECT 1 FROM public.ai_image_jobs image_job WHERE image_job.owner_principal_id=j.owner_principal_id AND image_job.request_id=j.request_id)
 ), grouped AS (
 SELECT selection,
 sum(coalesce(input_tokens,0)::numeric+coalesce(output_tokens,0)::numeric) global_used,
 sum(amount) FILTER(WHERE state<>'settled') global_held,
 bool_or(amount IS NULL AND (input_tokens IS NULL OR output_tokens IS NULL)) global_unresolved,
 sum(coalesce(input_tokens,0)::numeric+coalesce(output_tokens,0)::numeric) FILTER(WHERE owner_principal_id=p_owner) used,
 sum(amount) FILTER(WHERE state<>'settled' AND owner_principal_id=p_owner) held,
 bool_or(amount IS NULL AND (input_tokens IS NULL OR output_tokens IS NULL)) FILTER(WHERE owner_principal_id=p_owner) unresolved,
 bool_or(state='pending_unknown') FILTER(WHERE owner_principal_id=p_owner) pending_unknown,
 bool_or(state='pending_unknown') global_pending_unknown
 FROM entries GROUP BY selection
 ), unidentified AS (
 SELECT coalesce(bool_or(selection IS NULL),false) global_unknown,
 coalesce(bool_or(selection IS NULL AND owner_principal_id=p_owner),false) own_unknown FROM entries
 )
 SELECT ids.m::varchar,coalesce(g.used,0),coalesce(g.held,0),coalesce(g.unresolved,false) OR u.own_unknown,
 coalesce(g.global_used,0),coalesce(g.global_held,0),coalesce(g.global_unresolved,false) OR u.global_unknown,
 coalesce(g.pending_unknown,false),coalesce(g.global_pending_unknown,false)
 FROM (SELECT DISTINCT jsonb_array_elements_text(p_models) m) ids LEFT JOIN grouped g ON g.selection=ids.m CROSS JOIN unidentified u
$$;
REVOKE ALL ON FUNCTION public.ai_token_budget_snapshot(jsonb,timestamptz,uuid) FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_token_budget_reason(gc numeric,uc numeric,gu numeric,gh numeric,gunknown boolean,u numeric,h numeric,unknown boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN (gc IS NOT NULL AND gunknown) OR (uc IS NOT NULL AND unknown) THEN 'ai_budget_pending'
 WHEN gc=0 OR uc=0 THEN 'ai_budget_exhausted'
 WHEN (gc IS NOT NULL AND gu+gh>=gc) OR (uc IS NOT NULL AND u+h>=uc)
 THEN CASE WHEN (gc IS NOT NULL AND gh>0 AND gu<gc) OR (uc IS NOT NULL AND h>0 AND u<uc) THEN 'ai_budget_pending' ELSE 'ai_budget_exhausted' END END
$$;
REVOKE ALL ON FUNCTION public.ai_token_budget_reason(numeric,numeric,numeric,numeric,boolean,numeric,numeric,boolean) FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_token_budgets_own(p_owner uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;month_start timestamptz:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';END IF;
 WITH stats AS MATERIALIZED (SELECT * FROM public.ai_token_budget_snapshot((SELECT allowed_models FROM public.ai_generation_policy WHERE singleton_key),month_start,p_owner)),
 rows AS (SELECT s.*,item->>'userLimit' user_limit,public.ai_token_budget_reason((item->>'globalLimit')::numeric,(item->>'userLimit')::numeric,s.global_used,s.global_held,s.global_unresolved,s.used,s.held,s.unresolved) reason
 FROM stats s LEFT JOIN (SELECT value item FROM public.ai_token_budget_policy p,jsonb_array_elements(p.limits)) limits ON item->>'model'=s.model)
 SELECT coalesce(jsonb_agg(jsonb_build_object('model',model,'limit',user_limit,'used',used::text,'held',held::text,'remaining',CASE WHEN user_limit IS NOT NULL THEN greatest(0,user_limit::numeric-used-held)::text END,'unresolved',unresolved,'pendingUnknown',pending_unknown,'available',reason IS NULL,'reason',reason) ORDER BY model),'[]') INTO result FROM rows;
 RETURN jsonb_build_object('models',result,'resetAt',(month_start AT TIME ZONE 'UTC'+interval '1 month') AT TIME ZONE 'UTC');
END;
$$;

CREATE FUNCTION public.ai_token_budgets_admin(p_actor uuid,p_catalog jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;rev bigint;models jsonb;month_start timestamptz:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT revision INTO rev FROM public.ai_token_budget_policy WHERE singleton_key;
 IF jsonb_typeof(p_catalog) IS DISTINCT FROM 'array' OR jsonb_array_length(p_catalog)>2400 THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(m),'[]') INTO models FROM (SELECT jsonb_array_elements_text(allowed_models)::varchar m FROM public.ai_generation_policy WHERE singleton_key
 UNION SELECT (value->>'model')::varchar FROM public.ai_token_budget_policy b,jsonb_array_elements(b.limits)
 UNION SELECT value::varchar FROM jsonb_array_elements_text(p_catalog) WHERE value='ollama-local' OR EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) provider WHERE public.ai_model_provider_matches(provider::varchar,value::varchar))) ids;
 WITH stats AS MATERIALIZED (SELECT * FROM public.ai_token_budget_snapshot(models,month_start,NULL))
 SELECT coalesce(jsonb_agg(jsonb_build_object('model',s.model,'globalLimit',item->>'globalLimit','userLimit',item->>'userLimit','used',s.global_used::text,'held',s.global_held::text,'unresolved',s.global_unresolved,'pendingUnknown',s.global_pending_unknown) ORDER BY s.model),'[]') INTO result
 FROM stats s LEFT JOIN (SELECT value item FROM public.ai_token_budget_policy b,jsonb_array_elements(b.limits)) limits ON item->>'model'=s.model;
 RETURN jsonb_build_object('configurationVersion',rev,'models',result,'resetAt',(month_start AT TIME ZONE 'UTC'+interval '1 month') AT TIME ZONE 'UTC');
END;
$$;

CREATE FUNCTION public.ai_token_budgets_set(p_actor uuid,p_input jsonb,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'model' IS NULL OR ((item->>'model')<>'ollama-local' AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) provider WHERE public.ai_model_provider_matches(provider::varchar,(item->>'model')::varchar)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old.limits) x WHERE x->>'model'=item->>'model')) THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
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

-- Keep the already reviewed admission intact and private behind this wrapper.
ALTER FUNCTION public.ai_generation_begin(uuid,uuid,uuid,jsonb,varchar,bigint,bigint) RENAME TO ai_generation_begin_before_budgets;
REVOKE ALL ON FUNCTION public.ai_generation_begin_before_budgets(uuid,uuid,uuid,jsonb,varchar,bigint,bigint) FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_generation_begin(p_owner uuid,p_thread uuid,p_request uuid,p_payload jsonb,p_model varchar,p_revision bigint,p_config bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;s record;gc numeric;uc numeric;hold bigint;admitted boolean;reason text;month_start timestamptz:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF public.ai_generation_replay(p_owner,p_thread,p_request,p_payload) THEN RETURN false;END IF;
 -- Policy edits serialize against admission/settlement; unrelated model scopes
 -- share this read lock. All scope locks use timezone-independent month keys.
 PERFORM 1 FROM public.ai_token_budget_policy WHERE singleton_key FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-budget-global:'||p_model||':'||extract(epoch FROM month_start)::bigint::text,7313));
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-budget-owner:'||p_model||':'||extract(epoch FROM month_start)::bigint::text||':'||p_owner::text,7313));
 SELECT value INTO item FROM public.ai_token_budget_policy b,jsonb_array_elements(b.limits) WHERE value->>'model'=p_model;
 gc:=(item->>'globalLimit')::numeric;uc:=(item->>'userLimit')::numeric;
 SELECT * INTO s FROM public.ai_token_budget_snapshot(jsonb_build_array(p_model),month_start,p_owner);
 reason:=public.ai_token_budget_reason(gc,uc,s.global_used,s.global_held,s.global_unresolved,s.used,s.held,s.unresolved);
 IF reason='ai_budget_pending' THEN RAISE EXCEPTION 'AI_BUDGET_PENDING' USING ERRCODE='P0001';END IF;
 IF reason='ai_budget_exhausted' THEN RAISE EXCEPTION 'AI_BUDGET_EXHAUSTED' USING ERRCODE='P0001';END IF;
 hold:=least(8192,coalesce(gc-s.global_used-s.global_held,8192),coalesce(uc-s.used-s.held,8192))::bigint;
 admitted:=public.ai_generation_begin_before_budgets(p_owner,p_thread,p_request,p_payload,p_model,p_revision,p_config);
 IF admitted THEN
  INSERT INTO public.ai_token_budget_reservations(owner_principal_id,request_id,model,month_start,amount) VALUES(p_owner,p_request,p_model,month_start,hold);
 END IF;
 RETURN admitted;
END;
$$;

ALTER FUNCTION public.ai_usage_finish(uuid,uuid,varchar,varchar,bigint,bigint,varchar) RENAME TO ai_usage_finish_before_budgets;
REVOKE ALL ON FUNCTION public.ai_usage_finish_before_budgets(uuid,uuid,varchar,varchar,bigint,bigint,varchar) FROM PUBLIC,asalab_app;
CREATE FUNCTION public.ai_usage_finish(p_owner uuid,p_request uuid,p_status varchar,p_error varchar,p_input bigint,p_output bigint,p_model varchar) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE recorded boolean;selection varchar;month_start timestamptz;
BEGIN
 PERFORM 1 FROM public.ai_token_budget_policy WHERE singleton_key FOR SHARE;
 SELECT coalesce(r.model,g.model,CASE WHEN j.provider='ollama' THEN 'ollama-local' ELSE j.requested_model END),coalesce(r.month_start,date_trunc('month',j.admitted_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') INTO selection,month_start
 FROM public.ai_usage_journal j LEFT JOIN public.ai_token_budget_reservations r USING(owner_principal_id,request_id) LEFT JOIN public.ai_generation_receipts g USING(owner_principal_id,request_id) WHERE j.owner_principal_id=p_owner AND j.request_id=p_request;
 IF selection IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-budget-global:'||selection||':'||extract(epoch FROM month_start)::bigint::text,7313));
  PERFORM pg_advisory_xact_lock(hashtextextended('ai-budget-owner:'||selection||':'||extract(epoch FROM month_start)::bigint::text||':'||p_owner::text,7313));
 END IF;
 recorded:=public.ai_usage_finish_before_budgets(p_owner,p_request,p_status,p_error,p_input,p_output,p_model);
 IF recorded THEN
  UPDATE public.ai_token_budget_reservations SET state=CASE WHEN p_input IS NULL OR p_output IS NULL THEN 'pending_unknown' ELSE 'settled' END WHERE owner_principal_id=p_owner AND request_id=p_request;
 END IF;
 RETURN recorded;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_generation_begin(uuid,uuid,uuid,jsonb,varchar,bigint,bigint),public.ai_usage_finish(uuid,uuid,varchar,varchar,bigint,bigint,varchar),public.ai_token_budgets_own(uuid),public.ai_token_budgets_admin(uuid,jsonb),public.ai_token_budgets_set(uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_generation_begin(uuid,uuid,uuid,jsonb,varchar,bigint,bigint),public.ai_usage_finish(uuid,uuid,varchar,varchar,bigint,bigint,varchar),public.ai_token_budgets_own(uuid),public.ai_token_budgets_admin(uuid,jsonb),public.ai_token_budgets_set(uuid,jsonb,uuid) TO asalab_app;
