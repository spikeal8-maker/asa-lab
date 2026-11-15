-- ASAI-01: a bounded, administrator-only projection of the existing journal.
-- Admission rows already have immutable (owner_principal_id, request_id) identity;
-- do not join messages or count provider rounds/replayed reads as new requests.
CREATE INDEX ai_usage_admitted_time_idx ON public.ai_usage_journal(admitted_at);

CREATE FUNCTION public.ai_usage_overview(
    p_actor uuid,
    p_at timestamptz DEFAULT statement_timestamp()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE
    v_to timestamptz := p_at;
    v_day timestamp;
    v_from timestamptz;
    v_result jsonb;
BEGIN
    IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';
    END IF;
    IF v_to IS NULL OR NOT isfinite(v_to) THEN
        RAISE EXCEPTION 'AI_USAGE_PERIOD_INVALID' USING ERRCODE='22023';
    END IF;
    -- A single cutoff/snapshot supplies both cards and all seven daily buckets.
    -- p_at is internal to this fixed-window reader (including deterministic SQL
    -- tests); the HTTP endpoint always uses the database statement timestamp.
    v_day := date_trunc('day',v_to AT TIME ZONE 'UTC');
    v_from := (v_day-interval '6 days') AT TIME ZONE 'UTC';
    WITH usage AS MATERIALIZED (
        SELECT admitted_at,input_tokens,output_tokens
        FROM public.ai_usage_journal
        WHERE admitted_at>=v_from AND admitted_at<v_to
    ), totals AS (
        SELECT count(*) AS requests,
               count(input_tokens) AS input_known,
               count(output_tokens) AS output_known,
               sum(input_tokens) AS input_sum,
               sum(output_tokens) AS output_sum
        FROM usage
    ), by_day AS (
        SELECT (admitted_at AT TIME ZONE 'UTC')::date AS day,count(*) AS requests
        FROM usage GROUP BY 1
    ), days AS (
        SELECT (v_day-interval '6 days'+n*interval '1 day')::date AS day
        FROM generate_series(0,6) n
    )
    SELECT jsonb_build_object(
        'schemaVersion',1,
        'period',jsonb_build_object(
            'from',to_char(v_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'to',to_char(v_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'timeZone','UTC','days',7
        ),
        'generatedAt',to_char(v_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'requests',t.requests,
        'inputTokens',jsonb_build_object(
            'known',CASE WHEN t.requests=0 THEN '0' ELSE t.input_sum::text END,
            'knownOperations',t.input_known,
            'unknownOperations',t.requests-t.input_known
        ),
        'outputTokens',jsonb_build_object(
            'known',CASE WHEN t.requests=0 THEN '0' ELSE t.output_sum::text END,
            'knownOperations',t.output_known,
            'unknownOperations',t.requests-t.output_known
        ),
        'daily',(SELECT jsonb_agg(jsonb_build_object(
            'date',to_char(d.day,'YYYY-MM-DD'),'requests',coalesce(b.requests,0)
        ) ORDER BY d.day) FROM days d LEFT JOIN by_day b ON b.day=d.day),
        'state',CASE WHEN t.requests=0 THEN 'empty'
                     WHEN t.input_known<t.requests OR t.output_known<t.requests THEN 'partial'
                     ELSE 'complete' END
    ) INTO v_result FROM totals t;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_overview(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_usage_overview(uuid,timestamptz) TO asalab_app;
-- ai_usage_journal remains RLS-enabled and inaccessible directly to asalab_app.
