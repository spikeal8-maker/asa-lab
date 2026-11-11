CREATE FUNCTION admin_get_product_dashboard_v3(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_from timestamptz,
    p_to timestamptz,
    p_bucket_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_payload jsonb;
    v_attendance jsonb;
    v_tenant_id uuid;
    v_tail jsonb;
    v_tail_from timestamptz;
    v_tail_seconds integer;
    v_today_from timestamptz := date_trunc('day', p_to AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow';
BEGIN
    -- The previous dashboard validates the time window and the actor's exact scope.
    v_payload := public.admin_get_product_dashboard_v2(
        p_actor_principal_id, p_scope_kind, p_scope_id, p_from, p_to, p_bucket_seconds
    );
    -- The yearly window ends with a one-day partial bucket. Preserve it in each series.
    v_tail_from := date_bin(make_interval(secs => p_bucket_seconds), p_to, p_from);
    v_tail_seconds := floor(extract(epoch FROM p_to - v_tail_from));
    IF v_tail_seconds >= 60 THEN
        v_tail := public.admin_get_product_dashboard_v2(
            p_actor_principal_id, p_scope_kind, p_scope_id, v_tail_from, p_to, v_tail_seconds
        );
        v_payload := v_payload || jsonb_build_object(
            'timeline', (v_payload -> 'timeline') || (v_tail -> 'timeline'),
            'modules', (v_payload -> 'modules') || (v_tail -> 'modules'),
            'loginMethods', (v_payload -> 'loginMethods') || (v_tail -> 'loginMethods'),
            'actions', (v_payload -> 'actions') || (v_tail -> 'actions')
        );
    END IF;
    IF p_scope_kind = 'organization' THEN
        SELECT tenant_id INTO v_tenant_id FROM public.workspaces WHERE id = p_scope_id;
    END IF;

    WITH activity AS MATERIALIZED (
        SELECT e.occurred_at,
               CASE WHEN e.actor_kind = 'account' THEN e.account_id END AS account_id,
               CASE WHEN e.actor_kind = 'student' THEN e.seat_id END AS seat_id,
               e.event_type = 'auth.class_join' AND e.auth_method = 'class_code'
                   AND e.actor_kind = 'student' AND e.seat_id IS NOT NULL AS student_login
          FROM public.product_analytics_events e
         WHERE e.occurred_at >= LEAST(p_from, v_today_from) AND e.occurred_at < p_to
           AND e.outcome = 'succeeded'
           AND ((e.actor_kind = 'account' AND e.account_id IS NOT NULL)
                OR (e.actor_kind = 'student' AND e.seat_id IS NOT NULL))
           AND (p_scope_kind = 'platform' OR e.workspace_id = p_scope_id
                OR (e.actor_kind = 'student' AND e.tenant_id = v_tenant_id))
    ), totals AS (
        SELECT count(DISTINCT account_id) FILTER (WHERE occurred_at >= p_from) AS range_accounts,
               count(DISTINCT seat_id) FILTER (WHERE occurred_at >= p_from) AS range_seats,
               count(*) FILTER (WHERE occurred_at >= p_from AND student_login) AS range_logins,
               count(DISTINCT account_id) FILTER (WHERE occurred_at >= v_today_from) AS today_accounts,
               count(DISTINCT seat_id) FILTER (WHERE occurred_at >= v_today_from) AS today_seats,
               count(*) FILTER (WHERE occurred_at >= v_today_from AND student_login) AS today_logins
          FROM activity
    ), buckets AS (
        SELECT date_bin(make_interval(secs => p_bucket_seconds), occurred_at, p_from) AS at,
               count(DISTINCT account_id) AS accounts, count(DISTINCT seat_id) AS seats,
               count(*) FILTER (WHERE student_login) AS logins
          FROM activity
         WHERE occurred_at >= p_from
         GROUP BY 1
    )
    SELECT jsonb_build_object(
        'summary', (v_payload -> 'summary') || jsonb_build_object(
            'activeAccounts', range_accounts, 'activeStudents', range_seats, 'studentLogins', range_logins
        ),
        'todayMsk', jsonb_build_object(
            'from', v_today_from, 'to', p_to,
            'activeAccounts', today_accounts, 'activeStudents', today_seats, 'studentLogins', today_logins,
            'newStudents', (SELECT count(*) FROM public.classroom_student_seats seat
                 WHERE seat.created_at >= v_today_from AND seat.created_at < p_to
                   AND seat.status <> 'removed'
                   AND (p_scope_kind = 'platform' OR seat.tenant_id = v_tenant_id))
        ),
        'timeline', COALESCE((
            SELECT jsonb_agg(point || jsonb_build_object(
                'activeAccounts', COALESCE(bucket.accounts, 0),
                'activeStudents', COALESCE(bucket.seats, 0),
                'studentLogins', COALESCE(bucket.logins, 0)
            ) ORDER BY (point ->> 'at')::timestamptz)
              FROM jsonb_array_elements(v_payload -> 'timeline') point
              LEFT JOIN buckets bucket ON bucket.at = (point ->> 'at')::timestamptz
        ), '[]'::jsonb)
    ) INTO v_attendance FROM totals;

    RETURN v_payload || v_attendance;
END;
$$;

REVOKE ALL ON FUNCTION admin_get_product_dashboard_v3(uuid, varchar, uuid, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_product_dashboard_v3(uuid, varchar, uuid, timestamptz, timestamptz, integer) TO asalab_app;
