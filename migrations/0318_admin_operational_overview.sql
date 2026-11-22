CREATE FUNCTION admin_get_operational_overview(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_from timestamptz,
    p_to timestamptz,
    p_bucket_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_base jsonb;
    v_overview jsonb;
    v_tenant_id uuid;
    v_step interval := make_interval(secs => p_bucket_seconds);
    -- Monday midnight in Moscow, including for daily and weekly buckets.
    v_origin timestamptz := '2000-01-02T21:00:00Z';
    v_recent_from timestamptz := p_to - interval '5 minutes';
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_bucket_seconds IS NULL
       OR p_bucket_seconds NOT IN (300, 900, 1800, 3600, 21600, 86400, 604800)
       OR p_to - p_from > 90 * v_step THEN
        RAISE EXCEPTION 'invalid operational overview interval' USING ERRCODE = '22023';
    END IF;
    v_base := public.admin_get_product_dashboard_v3(
        p_actor_principal_id, p_scope_kind, p_scope_id, p_from, p_to, p_bucket_seconds
    );
    IF p_scope_kind = 'organization' THEN
        SELECT tenant_id INTO v_tenant_id FROM public.workspaces WHERE id = p_scope_id;
    END IF;

    WITH buckets AS (
        SELECT at, greatest(at, p_from) AS start_at, least(at + v_step, p_to) AS end_at
          FROM generate_series(date_bin(v_step, p_from, v_origin), p_to, v_step) at
         WHERE at < p_to
    ), events AS MATERIALIZED (
        SELECT occurred_at, actor_kind,
               CASE WHEN actor_kind = 'account' THEN account_id
                    WHEN actor_kind = 'student' THEN seat_id END AS actor_id,
               event_type, auth_method, module_key, flow_id, ip_address, network_kind
          FROM public.product_analytics_events e
         WHERE occurred_at >= p_from AND occurred_at < p_to AND outcome = 'succeeded'
           AND (p_scope_kind = 'platform' OR e.workspace_id = p_scope_id
                OR (e.actor_kind = 'student' AND e.tenant_id = v_tenant_id))
    ), activity AS (
        SELECT bucket.at, session.actor_kind, session.module_key,
               CASE WHEN session.actor_kind = 'account' THEN session.account_id
                    WHEN session.actor_kind = 'student' THEN session.seat_id END AS actor_id,
               tstzrange(greatest(slice.started_at, bucket.start_at),
                         least(slice.ended_at, bucket.end_at), '[)') AS span
          FROM public.product_module_activity_slices slice
          JOIN public.product_module_sessions session ON session.id = slice.session_id
          JOIN buckets bucket ON slice.ended_at > bucket.start_at AND slice.started_at < bucket.end_at
         WHERE slice.started_at < p_to AND slice.ended_at > p_from
           AND (p_scope_kind = 'platform' OR session.workspace_id = p_scope_id
                OR (session.actor_kind = 'student' AND session.tenant_id = v_tenant_id))
    ), measured AS (
        SELECT at, actor_kind, actor_id, module_key, range_agg(span) AS spans
          FROM activity WHERE actor_id IS NOT NULL
         GROUP BY GROUPING SETS ((at, actor_kind, actor_id), (at, actor_kind, actor_id, module_key))
    ), measured_seconds AS (
        SELECT at, actor_kind, actor_id, module_key, sum(extract(epoch FROM upper(span) - lower(span))) AS seconds
          FROM measured CROSS JOIN LATERAL unnest(spans) span
         GROUP BY at, actor_kind, actor_id, module_key
    ), people AS (
        SELECT date_bin(v_step, occurred_at, v_origin) AS at, actor_kind, actor_id
          FROM events WHERE actor_id IS NOT NULL
        UNION
        SELECT at, actor_kind, actor_id FROM measured_seconds WHERE module_key IS NULL
    ), attendance AS (
        SELECT people.at,
               count(*) FILTER (WHERE people.actor_kind = 'account') AS accounts,
               count(*) FILTER (WHERE people.actor_kind = 'student') AS students,
               round(avg(measured_seconds.seconds) FILTER (WHERE people.actor_kind = 'account'), 1) AS account_seconds,
               round(avg(measured_seconds.seconds) FILTER (WHERE people.actor_kind = 'student'), 1) AS student_seconds
          FROM people LEFT JOIN measured_seconds
            ON (measured_seconds.at, measured_seconds.actor_kind, measured_seconds.actor_id)
                 = (people.at, people.actor_kind, people.actor_id)
           AND measured_seconds.module_key IS NULL
         GROUP BY people.at
    ), logins AS (
        SELECT date_bin(v_step, occurred_at, v_origin) AS at, auth_method AS method, count(*) AS total
          FROM events
         WHERE actor_id IS NOT NULL AND auth_method IS NOT NULL
           AND event_type IN ('auth.login', 'auth.max', 'auth.telegram', 'auth.class_join')
         GROUP BY 1, 2
    ), seats AS (
        SELECT date_bin(v_step, created_at, v_origin) AS at, count(*) AS total
          FROM public.classroom_student_seats
         WHERE created_at >= p_from AND created_at < p_to AND status <> 'removed'
           AND (p_scope_kind = 'platform' OR tenant_id = v_tenant_id)
         GROUP BY 1
    ), launches AS (
        SELECT date_bin(v_step, started_at, v_origin) AS at, session.module_key
          FROM public.product_module_sessions session
         WHERE started_at >= p_from AND started_at < p_to
           AND (p_scope_kind = 'platform' OR session.workspace_id = p_scope_id
                OR (session.actor_kind = 'student' AND session.tenant_id = v_tenant_id))
        UNION ALL
        SELECT date_bin(v_step, occurred_at, v_origin), module_key
          FROM events WHERE event_type = 'module.opened' AND flow_id IS NULL AND module_key IS NOT NULL
    ), module_totals AS (
        SELECT at, module_key, sum(launches) AS launches, round(sum(seconds), 1) AS seconds
          FROM (
              SELECT at, module_key, count(*) AS launches, 0 AS seconds FROM launches GROUP BY 1, 2
              UNION ALL
              SELECT at, module_key, 0, seconds FROM measured_seconds WHERE module_key IS NOT NULL
          ) data
         GROUP BY 1, 2
    ), recent AS (
        SELECT actor_kind, actor_id FROM events WHERE occurred_at >= v_recent_from AND actor_id IS NOT NULL
        UNION
        SELECT actor_kind, actor_id FROM activity WHERE upper(span) > v_recent_from AND actor_id IS NOT NULL
    ), connections AS (
        SELECT actor_kind, actor_id, ip_address,
               ip_address IS NOT NULL AND network_kind IN ('public', 'local_network', 'local_device') AS resolved
          FROM events WHERE actor_id IS NOT NULL
           AND event_type IN ('auth.login', 'auth.register', 'auth.max', 'auth.telegram',
                              'auth.class_join', 'session.observed', 'visit.observed')
    ), action_events AS (
        SELECT created_at AS occurred_at, 'class' AS kind FROM public.classrooms
         WHERE created_at >= p_from AND created_at < p_to
           AND (p_scope_kind = 'platform' OR tenant_id = v_tenant_id)
        UNION ALL
        SELECT created_at, 'project' FROM public.projects
         WHERE created_at >= p_from AND created_at < p_to
           AND (p_scope_kind = 'platform' OR tenant_id = v_tenant_id)
        UNION ALL
        SELECT occurred_at, 'linked' FROM public.account_external_identity_events link
         WHERE occurred_at >= p_from AND occurred_at < p_to AND event = 'linked'
           AND (p_scope_kind = 'platform' OR EXISTS (
               SELECT 1 FROM public.workspace_memberships member
                WHERE member.account_id = link.account_id AND member.workspace_id = p_scope_id
                  AND member.state = 'active'
           ))
    ), actions AS (
        SELECT date_bin(v_step, occurred_at, v_origin) AS at,
               count(*) FILTER (WHERE kind = 'class') AS classes,
               count(*) FILTER (WHERE kind = 'project') AS projects,
               count(*) FILTER (WHERE kind = 'linked') AS linked
          FROM action_events GROUP BY 1
    )
    SELECT jsonb_build_object(
        'points', (SELECT jsonb_agg(jsonb_build_object(
            'at', bucket.at, 'from', bucket.start_at, 'to', bucket.end_at,
            'activeAccounts', coalesce(attendance.accounts, 0), 'activeStudents', coalesce(attendance.students, 0),
            'accountSeconds', attendance.account_seconds, 'studentSeconds', attendance.student_seconds,
            'accountLogins', coalesce((SELECT sum(total) FROM logins WHERE at = bucket.at AND method <> 'class_code'), 0),
            'studentLogins', coalesce((SELECT total FROM logins WHERE at = bucket.at AND method = 'class_code'), 0),
            'newStudents', coalesce(seats.total, 0)
        ) ORDER BY bucket.at) FROM buckets bucket LEFT JOIN attendance USING (at) LEFT JOIN seats USING (at)),
        'modules', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'at', at, 'moduleKey', module_key, 'launches', launches, 'activeSeconds', seconds
        ) ORDER BY at, module_key) FROM module_totals), '[]'::jsonb),
        'loginMethods', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'at', at, 'method', method, 'successfulLogins', total
        ) ORDER BY at, method) FROM logins), '[]'::jsonb),
        'actions', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'at', at, 'classesCreated', classes, 'projectsCreated', projects, 'maxLinked', linked
        ) ORDER BY at) FROM actions), '[]'::jsonb),
        'recentAccounts', (SELECT count(*) FROM recent WHERE actor_kind = 'account'),
        'recentStudents', (SELECT count(*) FROM recent WHERE actor_kind = 'student'),
        'network', (SELECT jsonb_build_object(
            'addresses', count(DISTINCT ip_address) FILTER (WHERE resolved),
            'resolvedEvents', count(*) FILTER (WHERE resolved),
            'unresolvedEvents', count(*) FILTER (WHERE NOT resolved),
            'peopleWithMultipleAddresses', (SELECT count(*) FROM (
                SELECT actor_kind, actor_id FROM connections WHERE resolved GROUP BY 1, 2
                HAVING count(DISTINCT ip_address) > 1
            ) multiple)
        ) FROM connections)
    ) INTO v_overview;
    RETURN v_base || jsonb_build_object('overview', v_overview);
END;
$$;

REVOKE ALL ON FUNCTION admin_get_operational_overview(uuid, varchar, uuid, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_operational_overview(uuid, varchar, uuid, timestamptz, timestamptz, integer) TO asalab_app;
