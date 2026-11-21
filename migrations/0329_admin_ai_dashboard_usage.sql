-- Bounded dashboard projection of the existing chat and image admission journal.
CREATE FUNCTION public.admin_get_ai_dashboard_usage(
    p_actor uuid, p_from timestamptz, p_to timestamptz, p_bucket_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
        OR p_to <= p_from OR p_to - p_from > interval '365 days'
        OR p_bucket_seconds IS NULL OR p_bucket_seconds NOT IN (300,900,1800,3600,21600,86400,604800) THEN
        RAISE EXCEPTION 'AI_USAGE_PERIOD_INVALID' USING ERRCODE='22023';
    END IF;
    WITH admitted AS MATERIALIZED (
        SELECT date_bin(make_interval(secs=>p_bucket_seconds), admitted_at,
                        '2000-01-02T21:00:00Z'::timestamptz) AS at,
               owner_principal_id, status
        FROM public.ai_usage_journal
        WHERE admitted_at >= p_from AND admitted_at < p_to
    ), by_bucket AS (
        SELECT at, count(*) AS requests,
               count(*) FILTER (WHERE status='succeeded') AS completed,
               count(DISTINCT owner_principal_id) AS people
        FROM admitted GROUP BY at
    )
    SELECT jsonb_build_object(
        'journalFrom', (SELECT min(admitted_at) FROM public.ai_usage_journal),
        'requests', count(*),
        'completed', count(*) FILTER (WHERE status='succeeded'),
        'people', count(DISTINCT owner_principal_id),
        'points', coalesce((SELECT jsonb_agg(to_jsonb(by_bucket) ORDER BY at) FROM by_bucket),'[]'::jsonb)
    ) INTO v_result FROM admitted;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_ai_dashboard_usage(uuid,timestamptz,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_ai_dashboard_usage(uuid,timestamptz,timestamptz,integer) TO asalab_app;

-- The legacy timeline is aligned to the request start. Registration counts
-- for the operational charts must instead use the same Moscow bucket origin.
CREATE FUNCTION public.admin_get_dashboard_registrations(
    p_actor uuid, p_scope varchar, p_scope_id uuid,
    p_from timestamptz, p_to timestamptz, p_bucket_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
    v_role varchar := public.admin_authorized_role(p_actor,p_scope,p_scope_id);
    v_result jsonb;
BEGIN
    IF v_role IS NULL OR p_scope IS NULL OR p_scope NOT IN ('platform','organization')
        OR (p_scope='platform' AND (p_scope_id IS NOT NULL OR v_role <> 'platform_admin')) THEN
        RAISE EXCEPTION 'administrative dashboard scope denied' USING ERRCODE='42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to)
        OR p_to <= p_from OR p_to - p_from > interval '365 days'
        OR p_bucket_seconds IS NULL OR p_bucket_seconds NOT IN (300,900,1800,3600,21600,86400,604800) THEN
        RAISE EXCEPTION 'invalid registration interval' USING ERRCODE='22023';
    END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(bucket) ORDER BY at),'[]'::jsonb) INTO v_result
    FROM (
        SELECT date_bin(make_interval(secs=>p_bucket_seconds),a.created_at,
                        '2000-01-02T21:00:00Z'::timestamptz) AS at,
               count(*) AS count
        FROM public.accounts a
        WHERE a.created_at >= p_from AND a.created_at < p_to
            AND (p_scope='platform' OR EXISTS (
                SELECT 1 FROM public.workspace_memberships m
                WHERE m.account_id=a.id AND m.workspace_id=p_scope_id AND m.state='active'))
        GROUP BY 1
    ) bucket;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_dashboard_registrations(uuid,varchar,uuid,timestamptz,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_registrations(uuid,varchar,uuid,timestamptz,timestamptz,integer) TO asalab_app;
