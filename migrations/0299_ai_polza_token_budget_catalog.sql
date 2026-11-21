-- Include selected credential-current Polza chat models before user publication.
-- Preserve admin authorization, private statistics, and all existing provider rows.
CREATE OR REPLACE FUNCTION public.ai_token_budgets_admin(p_actor uuid,p_catalog jsonb DEFAULT '[]') RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;rev bigint;models jsonb;month_start timestamptz:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 SELECT revision INTO rev FROM public.ai_token_budget_policy WHERE singleton_key;
 IF jsonb_typeof(p_catalog) IS DISTINCT FROM 'array' OR jsonb_array_length(p_catalog)>2400 THEN RAISE EXCEPTION 'AI_BUDGET_INVALID' USING ERRCODE='22023';END IF;
 SELECT coalesce(jsonb_agg(m),'[]') INTO models FROM (SELECT jsonb_array_elements_text(allowed_models)::varchar m FROM public.ai_generation_policy WHERE singleton_key
 UNION SELECT (value->>'model')::varchar FROM public.ai_token_budget_policy b,jsonb_array_elements(b.limits)
 UNION SELECT id::varchar FROM public.ai_polza_models WHERE public.ai_model_available('polza',id,statement_timestamp())
 UNION SELECT value::varchar FROM jsonb_array_elements_text(p_catalog) WHERE value='ollama-local' OR EXISTS(SELECT 1 FROM unnest(ARRAY['openai','deepseek','ollama-cloud']) provider WHERE public.ai_model_provider_matches(provider::varchar,value::varchar))) ids;
 WITH stats AS MATERIALIZED (SELECT * FROM public.ai_token_budget_snapshot(models,month_start,NULL))
 SELECT coalesce(jsonb_agg(jsonb_build_object('model',s.model,'globalLimit',item->>'globalLimit','userLimit',item->>'userLimit','used',s.global_used::text,'held',s.global_held::text,'unresolved',s.global_unresolved,'pendingUnknown',s.global_pending_unknown) ORDER BY s.model),'[]') INTO result
 FROM stats s LEFT JOIN (SELECT value item FROM public.ai_token_budget_policy b,jsonb_array_elements(b.limits)) limits ON item->>'model'=s.model;
 RETURN jsonb_build_object('configurationVersion',rev,'models',result,'resetAt',(month_start AT TIME ZONE 'UTC'+interval '1 month') AT TIME ZONE 'UTC');
END;
$$;
