-- Record confirmed foreground intervals without storing URLs, device metadata or input.
CREATE TABLE public.product_site_activity_days (
    actor_kind varchar(16) NOT NULL CHECK (actor_kind IN ('account', 'student')),
    actor_id uuid NOT NULL,
    scope_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    day_start timestamptz NOT NULL,
    spans tstzmultirange NOT NULL,
    PRIMARY KEY (actor_kind, actor_id, scope_id, day_start),
    CHECK (spans <> '{}'::tstzmultirange AND octet_length(spans::text) <= 1048576)
);
CREATE INDEX product_site_activity_days_time_idx ON public.product_site_activity_days(day_start);
ALTER TABLE public.product_site_activity_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_site_activity_days FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_site_activity_days FROM PUBLIC, asalab_app;

CREATE FUNCTION public.analytics_ingest_site_activity(
    p_event uuid, p_kind varchar, p_account uuid, p_principal uuid, p_seat uuid,
    p_workspace uuid, p_class uuid, p_intervals jsonb, p_received_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_current jsonb;
    v_from timestamptz;
    v_to timestamptz;
    v_previous timestamptz;
    v_spans tstzmultirange := '{}'::tstzmultirange;
    v_day_zero timestamptz := '2000-01-02T21:00:00Z';
BEGIN
    IF p_event IS NULL OR p_received_at IS NULL OR NOT isfinite(p_received_at)
        OR p_received_at > clock_timestamp() + interval '10 seconds'
        OR p_received_at < clock_timestamp() - interval '2 minutes'
        OR jsonb_typeof(p_intervals) IS DISTINCT FROM 'array'
        OR octet_length(p_intervals::text) > 4096 THEN
        RAISE EXCEPTION 'invalid site activity' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_intervals) NOT BETWEEN 1 AND 16 THEN
        RAISE EXCEPTION 'invalid site activity size' USING ERRCODE = '22023';
    END IF;

    IF p_kind = 'account' AND p_seat IS NULL AND p_class IS NULL THEN
        SELECT w.tenant_id INTO v_tenant
          FROM public.principals p
          JOIN public.workspace_memberships m ON m.account_id = p.account_id AND m.state = 'active'
          JOIN public.workspaces w ON w.id = m.workspace_id AND w.status = 'active'
         WHERE p.id = p_principal AND p.account_id = p_account AND w.id = p_workspace;
    ELSIF p_kind = 'student' AND p_account IS NULL AND p_workspace IS NULL THEN
        SELECT s.tenant_id INTO v_tenant
          FROM public.principals p JOIN public.classroom_student_seats s ON s.id = p.seat_id
         WHERE p.id = p_principal AND s.id = p_seat AND s.classroom_id = p_class
           AND s.status IN ('issued', 'active');
    END IF;
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'site activity actor denied' USING ERRCODE = '42501'; END IF;

    FOR v_current IN SELECT value FROM jsonb_array_elements(p_intervals) LOOP
        IF jsonb_typeof(v_current) IS DISTINCT FROM 'object'
            OR jsonb_typeof(v_current -> 'from') IS DISTINCT FROM 'string'
            OR jsonb_typeof(v_current -> 'to') IS DISTINCT FROM 'string'
            OR (v_current - 'from' - 'to') <> '{}'::jsonb THEN
            RAISE EXCEPTION 'invalid site activity interval' USING ERRCODE = '22023';
        END IF;
        v_from := (v_current ->> 'from')::timestamptz;
        v_to := (v_current ->> 'to')::timestamptz;
        IF NOT isfinite(v_from) OR NOT isfinite(v_to)
            OR v_from < p_received_at - interval '2 minutes'
            OR v_from < v_previous OR v_to > p_received_at + interval '2 seconds'
            OR v_to - v_from NOT BETWEEN interval '1 second' AND interval '90 seconds' THEN
            RAISE EXCEPTION 'invalid site activity time' USING ERRCODE = '22023';
        END IF;
        v_previous := v_to;
        IF v_from < p_received_at THEN
            v_spans := v_spans + tstzmultirange(tstzrange(v_from, least(v_to, p_received_at), '[)'));
        END IF;
    END LOOP;
    IF v_spans = '{}'::tstzmultirange THEN
        RAISE EXCEPTION 'empty site activity' USING ERRCODE = '22023';
    END IF;

    -- Repeating the same intervals or overlapping tabs is idempotent by union.
    INSERT INTO public.product_site_activity_days AS days (actor_kind, actor_id, scope_id, tenant_id, day_start, spans)
    SELECT p_kind, coalesce(p_account, p_seat), coalesce(p_workspace, p_class), v_tenant, day_start,
           range_agg(tstzrange(greatest(lower(span), day_start), least(upper(span), day_start + interval '24 hours'), '[)'))
      FROM unnest(v_spans) AS span
     CROSS JOIN LATERAL generate_series(date_bin(interval '24 hours', lower(span), v_day_zero),
                                        upper(span), interval '24 hours') AS day_start
     WHERE day_start < upper(span)
     GROUP BY day_start
     ORDER BY day_start
    ON CONFLICT (actor_kind, actor_id, scope_id, day_start) DO UPDATE SET spans = days.spans + excluded.spans;

    -- Keep cleanup work per request bounded even after a period with no activity.
    DELETE FROM public.product_site_activity_days days
     WHERE (actor_kind, actor_id, scope_id, day_start) IN (
        SELECT d.actor_kind, d.actor_id, d.scope_id, d.day_start FROM public.product_site_activity_days d
         WHERE d.day_start < date_bin(interval '24 hours', p_received_at, v_day_zero) - interval '720 hours'
         ORDER BY d.day_start LIMIT 16 FOR UPDATE SKIP LOCKED
    );

    RETURN jsonb_build_object('accepted', true, 'state', 'persisted', 'schemaVersion', 2,
        'eventId', p_event, 'operation', 'site.activity', 'receiptId', p_event,
        'receivedAt', p_received_at, 'persistedAt', clock_timestamp());
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_ingest_site_activity(uuid,varchar,uuid,uuid,uuid,uuid,uuid,jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analytics_ingest_site_activity(uuid,varchar,uuid,uuid,uuid,uuid,uuid,jsonb,timestamptz) TO asalab_app;

CREATE FUNCTION public.admin_get_site_activity_overview(
    p_actor uuid, p_scope varchar, p_scope_id uuid,
    p_from timestamptz, p_to timestamptz, p_bucket_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_role varchar := public.admin_authorized_role(p_actor, p_scope, p_scope_id);
    v_result jsonb;
    v_data_from timestamptz;
    v_tenant uuid;
    v_step interval := make_interval(secs => p_bucket_seconds);
    v_origin timestamptz := '2000-01-02T21:00:00Z';
    v_retained_from timestamptz := date_bin(interval '24 hours', now(), v_origin) - interval '720 hours';
BEGIN
    IF v_role IS NULL OR p_scope IS NULL OR p_scope NOT IN ('platform', 'organization')
        OR (p_scope = 'platform' AND (p_scope_id IS NOT NULL OR v_role <> 'platform_admin')) THEN
        RAISE EXCEPTION 'site activity scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to <= p_from
        OR p_bucket_seconds IS NULL OR p_bucket_seconds NOT IN (300,900,1800,3600,21600,86400,604800)
        OR p_to - p_from > 90 * v_step THEN
        RAISE EXCEPTION 'invalid site activity period' USING ERRCODE = '22023';
    END IF;
    IF p_scope = 'organization' THEN SELECT tenant_id INTO v_tenant FROM public.workspaces WHERE id = p_scope_id; END IF;

    SELECT min(lower(spans)) INTO v_data_from
      FROM public.product_site_activity_days
     WHERE day_start >= v_retained_from
       AND (p_scope = 'platform' OR (actor_kind = 'account' AND scope_id = p_scope_id)
            OR (actor_kind = 'student' AND tenant_id = v_tenant));
    IF v_data_from IS NULL THEN RETURN jsonb_build_object('measuredFrom', NULL, 'points', '[]'::jsonb); END IF;

    WITH evidence AS (
        SELECT d.actor_kind, d.actor_id, lower(span) AS started_at, upper(span) AS ended_at
          FROM public.product_site_activity_days d CROSS JOIN LATERAL unnest(d.spans) AS span
         WHERE d.day_start >= v_retained_from AND d.day_start < p_to
           AND d.day_start + interval '24 hours' > greatest(p_from, v_data_from)
           AND (p_scope = 'platform' OR (d.actor_kind = 'account' AND d.scope_id = p_scope_id)
                OR (d.actor_kind = 'student' AND d.tenant_id = v_tenant))
        UNION ALL
        SELECT s.actor_kind, coalesce(s.account_id, s.seat_id), a.started_at, a.ended_at
          FROM public.product_module_activity_slices a JOIN public.product_module_sessions s ON s.id = a.session_id
         WHERE a.started_at < p_to AND a.ended_at > greatest(p_from, v_data_from)
           AND (p_scope = 'platform' OR s.workspace_id = p_scope_id
                OR (s.actor_kind = 'student' AND s.tenant_id = v_tenant))
    ), clipped AS (
        SELECT actor_kind, actor_id, greatest(started_at, p_from, v_data_from) AS started_at,
               least(ended_at, p_to) AS ended_at
          FROM evidence
         WHERE started_at < p_to AND ended_at > greatest(p_from, v_data_from) AND p_to > v_data_from
    ), by_actor AS (
        SELECT bucket.at, actor_kind, actor_id, range_agg(tstzrange(greatest(started_at, bucket.at),
               least(ended_at, bucket.at + v_step), '[)')) AS spans
          FROM clipped CROSS JOIN LATERAL generate_series(date_bin(v_step, started_at, v_origin),
                    ended_at, v_step) AS bucket(at)
         WHERE bucket.at < ended_at
         GROUP BY bucket.at, actor_kind, actor_id
    ), seconds AS (
        SELECT at, actor_kind, actor_id, sum(extract(epoch FROM upper(span) - lower(span))) AS value
          FROM by_actor CROSS JOIN LATERAL unnest(spans) AS span
         GROUP BY at, actor_kind, actor_id
    ), points AS (
        SELECT at,
               round(avg(value) FILTER (WHERE actor_kind = 'account'), 1) AS "accountSeconds",
               round(avg(value) FILTER (WHERE actor_kind = 'student'), 1) AS "studentSeconds"
          FROM seconds GROUP BY at
    )
    SELECT jsonb_build_object('measuredFrom', v_data_from,
        'points', coalesce(jsonb_agg(to_jsonb(points) ORDER BY at), '[]'::jsonb)) INTO v_result FROM points;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_site_activity_overview(uuid,varchar,uuid,timestamptz,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_site_activity_overview(uuid,varchar,uuid,timestamptz,timestamptz,integer) TO asalab_app;
