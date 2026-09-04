-- Accurate client provenance and bounded module-presence telemetry.
--
-- A private/local address describes transport, not ownership. It is therefore
-- never promoted to the semantic "school" label automatically. Historical
-- events remain "unknown" because retroactively guessing their origin would
-- make the administrative evidence less trustworthy.

ALTER TABLE product_analytics_events
    ADD COLUMN network_kind varchar(24) NOT NULL DEFAULT 'unknown'
    CHECK (network_kind IN ('public', 'local_network', 'local_device', 'proxy', 'unknown'));

CREATE INDEX product_analytics_events_network_time_idx
    ON product_analytics_events (network_kind, occurred_at DESC);

CREATE FUNCTION analytics_record_event(
    p_actor_kind varchar,
    p_account_id uuid,
    p_principal_id uuid,
    p_seat_id uuid,
    p_workspace_id uuid,
    p_event_type varchar,
    p_outcome varchar,
    p_auth_method varchar,
    p_module_key varchar,
    p_flow_id uuid,
    p_ip_address inet,
    p_user_agent_summary varchar,
    p_network_kind varchar
) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
    IF p_network_kind NOT IN ('public', 'local_network', 'local_device', 'proxy', 'unknown') THEN
        RAISE EXCEPTION 'invalid analytics network kind' USING ERRCODE = '22023';
    END IF;
    v_id := public.analytics_record_event(
        p_actor_kind, p_account_id, p_principal_id, p_seat_id, p_workspace_id,
        p_event_type, p_outcome, p_auth_method, p_module_key, p_flow_id,
        p_ip_address, p_user_agent_summary
    );
    UPDATE public.product_analytics_events
       SET network_kind = p_network_kind
     WHERE id = v_id
       AND network_kind IN ('unknown', p_network_kind);
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION analytics_record_event(
    varchar, uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar,
    uuid, inet, varchar, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_record_event(
    varchar, uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar,
    uuid, inet, varchar, varchar
) TO asalab_app;

CREATE TABLE product_module_sessions (
    id                  uuid PRIMARY KEY,
    actor_kind          varchar(16) NOT NULL CHECK (actor_kind IN ('account', 'student')),
    account_id          uuid REFERENCES accounts(id),
    principal_id        uuid NOT NULL REFERENCES principals(id),
    seat_id             uuid REFERENCES classroom_student_seats(id),
    workspace_id        uuid REFERENCES workspaces(id),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    project_id          uuid NOT NULL REFERENCES projects(id),
    module_key          varchar(64) NOT NULL
                        CHECK (module_key IN ('electronics', 'three-d', 'chess', 'checkers')),
    ip_address          inet,
    network_kind        varchar(24) NOT NULL
                        CHECK (network_kind IN ('public', 'local_network', 'local_device', 'proxy', 'unknown')),
    user_agent_summary  varchar(128),
    started_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_seen_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at            timestamptz,
    CHECK (
        (actor_kind = 'account' AND account_id IS NOT NULL AND seat_id IS NULL)
        OR (actor_kind = 'student' AND account_id IS NULL AND seat_id IS NOT NULL)
    )
);

CREATE TABLE product_module_activity_slices (
    id              bigserial PRIMARY KEY,
    session_id      uuid NOT NULL REFERENCES product_module_sessions(id),
    started_at      timestamptz NOT NULL,
    ended_at        timestamptz NOT NULL,
    active_seconds  integer NOT NULL CHECK (active_seconds BETWEEN 1 AND 90),
    CHECK (ended_at > started_at)
);

CREATE INDEX product_module_sessions_actor_time_idx
    ON product_module_sessions (principal_id, started_at DESC);
CREATE INDEX product_module_sessions_module_time_idx
    ON product_module_sessions (module_key, started_at DESC);
CREATE INDEX product_module_activity_slices_time_idx
    ON product_module_activity_slices (started_at, ended_at);

ALTER TABLE product_module_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_module_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE product_module_activity_slices ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_module_activity_slices FORCE ROW LEVEL SECURITY;
REVOKE ALL ON product_module_sessions FROM PUBLIC, asalab_app;
REVOKE ALL ON product_module_activity_slices FROM PUBLIC, asalab_app;
REVOKE ALL ON SEQUENCE product_module_activity_slices_id_seq FROM PUBLIC, asalab_app;

CREATE FUNCTION analytics_start_module_session(
    p_session_id uuid,
    p_actor_kind varchar,
    p_account_id uuid,
    p_principal_id uuid,
    p_seat_id uuid,
    p_workspace_id uuid,
    p_module_key varchar,
    p_project_id uuid,
    p_ip_address inet,
    p_network_kind varchar,
    p_user_agent_summary varchar
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant_id uuid;
    v_inserted integer;
BEGIN
    IF p_actor_kind NOT IN ('account', 'student')
       OR p_module_key NOT IN ('electronics', 'three-d', 'chess', 'checkers')
       OR p_network_kind NOT IN ('public', 'local_network', 'local_device', 'proxy', 'unknown') THEN
        RAISE EXCEPTION 'invalid module session' USING ERRCODE = '22023';
    END IF;

    IF p_actor_kind = 'account' THEN
        SELECT workspace.tenant_id INTO v_tenant_id
          FROM public.principals principal
          JOIN public.workspace_memberships membership
            ON membership.account_id = principal.account_id
           AND membership.workspace_id = p_workspace_id
           AND membership.state = 'active'
          JOIN public.workspaces workspace
            ON workspace.id = membership.workspace_id AND workspace.status = 'active'
         WHERE principal.id = p_principal_id
           AND principal.account_id = p_account_id
           AND p_seat_id IS NULL;
    ELSE
        SELECT seat.tenant_id INTO v_tenant_id
          FROM public.principals principal
          JOIN public.classroom_student_seats seat ON seat.id = p_seat_id
         WHERE principal.id = p_principal_id
           AND principal.seat_id = seat.id
           AND p_account_id IS NULL
           AND seat.status IN ('issued', 'active');
        p_workspace_id := NULL;
    END IF;
    IF v_tenant_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.projects project
         WHERE project.id = p_project_id
           AND project.tenant_id = v_tenant_id
           AND project.module_key = p_module_key
    ) THEN
        RAISE EXCEPTION 'module session context denied' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.product_module_sessions (
        id, actor_kind, account_id, principal_id, seat_id, workspace_id,
        tenant_id, project_id, module_key, ip_address, network_kind, user_agent_summary
    ) VALUES (
        p_session_id, p_actor_kind, p_account_id, p_principal_id, p_seat_id, p_workspace_id,
        v_tenant_id, p_project_id, p_module_key, p_ip_address, p_network_kind,
        left(NULLIF(trim(p_user_agent_summary), ''), 128)
    ) ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted = 0 AND NOT EXISTS (
        SELECT 1 FROM public.product_module_sessions session
         WHERE session.id = p_session_id
           AND session.actor_kind = p_actor_kind
           AND session.principal_id = p_principal_id
           AND session.project_id = p_project_id
           AND session.module_key = p_module_key
    ) THEN
        RAISE EXCEPTION 'module session identifier collision' USING ERRCODE = '42501';
    END IF;

    IF v_inserted = 1 THEN
        PERFORM public.analytics_record_event(
            p_actor_kind, p_account_id, p_principal_id, p_seat_id, p_workspace_id,
            'module.opened', 'succeeded', NULL, p_module_key, p_session_id,
            p_ip_address, p_user_agent_summary, p_network_kind
        );
    END IF;
    RETURN p_session_id;
END;
$$;

CREATE FUNCTION analytics_touch_module_session(
    p_session_id uuid,
    p_actor_kind varchar,
    p_account_id uuid,
    p_principal_id uuid,
    p_closed boolean
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session public.product_module_sessions%ROWTYPE;
    v_now timestamptz := clock_timestamp();
    v_seconds integer;
BEGIN
    SELECT * INTO v_session
      FROM public.product_module_sessions session
     WHERE session.id = p_session_id
     FOR UPDATE;
    IF NOT FOUND
       OR v_session.actor_kind <> p_actor_kind
       OR v_session.principal_id <> p_principal_id
       OR v_session.account_id IS DISTINCT FROM p_account_id THEN
        RAISE EXCEPTION 'module session denied' USING ERRCODE = '42501';
    END IF;
    IF v_session.ended_at IS NOT NULL THEN
        RETURN 0;
    END IF;

    v_seconds := floor(extract(epoch FROM (v_now - v_session.last_seen_at)))::integer;
    IF v_seconds BETWEEN 5 AND 90 THEN
        INSERT INTO public.product_module_activity_slices
            (session_id, started_at, ended_at, active_seconds)
        VALUES (v_session.id, v_session.last_seen_at, v_now, v_seconds);
    ELSE
        v_seconds := 0;
    END IF;
    UPDATE public.product_module_sessions
       SET last_seen_at = v_now,
           ended_at = CASE WHEN p_closed THEN v_now ELSE NULL END
     WHERE id = p_session_id;
    RETURN v_seconds;
END;
$$;

REVOKE ALL ON FUNCTION analytics_start_module_session(
    uuid, varchar, uuid, uuid, uuid, uuid, varchar, uuid, inet, varchar, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_start_module_session(
    uuid, varchar, uuid, uuid, uuid, uuid, varchar, uuid, inet, varchar, varchar
) TO asalab_app;
REVOKE ALL ON FUNCTION analytics_touch_module_session(
    uuid, varchar, uuid, uuid, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_touch_module_session(
    uuid, varchar, uuid, uuid, boolean
) TO asalab_app;

CREATE FUNCTION admin_get_product_dashboard_v2(
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
    v_summary jsonb;
    v_tenant_id uuid;
    v_timeline jsonb;
    v_modules jsonb;
    v_methods jsonb;
BEGIN
    v_payload := public.admin_get_product_dashboard(
        p_actor_principal_id, p_scope_kind, p_scope_id, p_from, p_to, p_bucket_seconds
    );
    IF p_scope_kind = 'organization' THEN
        SELECT tenant_id INTO v_tenant_id FROM public.workspaces WHERE id = p_scope_id;
    END IF;

    WITH scoped_events AS (
        SELECT event.* FROM public.product_analytics_events event
         WHERE event.occurred_at >= p_from AND event.occurred_at < p_to
           AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id
                OR (event.actor_kind = 'student' AND event.tenant_id = v_tenant_id))
    )
    SELECT (v_payload -> 'summary') || jsonb_build_object(
        'successfulRegistrations', count(*) FILTER (
            WHERE event_type = 'auth.register' AND outcome = 'succeeded'),
        'authenticatedSessions', count(*) FILTER (
            WHERE event_type IN ('auth.login', 'auth.register', 'auth.max') AND outcome = 'succeeded'),
        'rejectedAuthAttempts', count(*) FILTER (
            WHERE event_type IN ('auth.login', 'auth.register', 'auth.max', 'auth.class_join')
              AND outcome IN ('failed', 'blocked')),
        'distinctIpAddresses', count(DISTINCT ip_address) FILTER (
            WHERE account_id IS NOT NULL AND outcome = 'succeeded' AND ip_address IS NOT NULL
              AND network_kind IN ('public', 'local_network', 'local_device')
              AND event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')),
        'accountsWithMultipleIps', (SELECT count(*) FROM (
            SELECT account_id FROM scoped_events
             WHERE account_id IS NOT NULL AND outcome = 'succeeded' AND ip_address IS NOT NULL
               AND network_kind IN ('public', 'local_network', 'local_device')
               AND event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')
             GROUP BY account_id HAVING count(DISTINCT ip_address) > 1
        ) multi_ip),
        'localNetworkAccounts', count(DISTINCT account_id) FILTER (
            WHERE account_id IS NOT NULL AND outcome = 'succeeded'
              AND network_kind IN ('local_network', 'local_device')),
        'unclassifiedNetworkEvents', count(*) FILTER (
            WHERE event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')
              AND network_kind IN ('unknown', 'proxy'))
    ) INTO v_summary FROM scoped_events;

    WITH scoped_events AS (
        SELECT event.* FROM public.product_analytics_events event
         WHERE event.occurred_at >= p_from AND event.occurred_at < p_to
           AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id
                OR (event.actor_kind = 'student' AND event.tenant_id = v_tenant_id))
    )
    SELECT COALESCE(jsonb_agg(
        point || jsonb_build_object(
            'successfulRegistrations', (SELECT count(*) FROM scoped_events event
                WHERE event.occurred_at >= (point ->> 'at')::timestamptz
                  AND event.occurred_at < LEAST(
                      (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                  AND event.event_type = 'auth.register' AND event.outcome = 'succeeded'),
            'authenticatedSessions', (SELECT count(*) FROM scoped_events event
                WHERE event.occurred_at >= (point ->> 'at')::timestamptz
                  AND event.occurred_at < LEAST(
                      (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                  AND event.event_type IN ('auth.login', 'auth.register', 'auth.max')
                  AND event.outcome = 'succeeded'),
            'rejectedAuthAttempts', (SELECT count(*) FROM scoped_events event
                WHERE event.occurred_at >= (point ->> 'at')::timestamptz
                  AND event.occurred_at < LEAST(
                      (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                  AND event.event_type IN ('auth.login', 'auth.register', 'auth.max', 'auth.class_join')
                  AND event.outcome IN ('failed', 'blocked'))
        ) ORDER BY (point ->> 'at')::timestamptz
    ), '[]'::jsonb) INTO v_timeline
      FROM jsonb_array_elements(v_payload -> 'timeline') point;

    SELECT COALESCE(jsonb_agg(
        point || jsonb_build_object(
            'activePeople', COALESCE((
                SELECT count(DISTINCT presence.actor_key) FROM (
                    SELECT CASE
                        WHEN session.actor_kind = 'account' THEN 'account:' || session.account_id::text
                        ELSE 'student:' || session.seat_id::text
                    END AS actor_key
                      FROM public.product_module_sessions session
                     WHERE session.module_key = point ->> 'moduleKey'
                       AND session.started_at >= (point ->> 'at')::timestamptz
                       AND session.started_at < LEAST(
                           (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                       AND (p_scope_kind = 'platform' OR session.workspace_id = p_scope_id
                            OR (session.actor_kind = 'student' AND session.tenant_id = v_tenant_id))
                    UNION ALL
                    SELECT CASE
                        WHEN event.actor_kind = 'account' THEN 'account:' || event.account_id::text
                        ELSE 'student:' || event.seat_id::text
                    END AS actor_key
                      FROM public.product_analytics_events event
                     WHERE event.event_type = 'module.opened'
                       AND event.outcome = 'succeeded'
                       AND event.flow_id IS NULL
                       AND event.module_key = point ->> 'moduleKey'
                       AND event.occurred_at >= (point ->> 'at')::timestamptz
                       AND event.occurred_at < LEAST(
                           (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                       AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id
                            OR (event.actor_kind = 'student' AND event.tenant_id = v_tenant_id))
                ) presence
            ), 0),
            'launches', COALESCE((
                SELECT count(*)
                  FROM public.product_module_sessions session
                 WHERE session.module_key = point ->> 'moduleKey'
                   AND session.started_at >= (point ->> 'at')::timestamptz
                   AND session.started_at < LEAST(
                       (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                   AND (p_scope_kind = 'platform' OR session.workspace_id = p_scope_id
                        OR (session.actor_kind = 'student' AND session.tenant_id = v_tenant_id))
            ), 0) + COALESCE((
                SELECT count(*)
                  FROM public.product_analytics_events event
                 WHERE event.event_type = 'module.opened'
                   AND event.outcome = 'succeeded'
                   AND event.flow_id IS NULL
                   AND event.module_key = point ->> 'moduleKey'
                   AND event.occurred_at >= (point ->> 'at')::timestamptz
                   AND event.occurred_at < LEAST(
                       (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                   AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id
                        OR (event.actor_kind = 'student' AND event.tenant_id = v_tenant_id))
            ), 0),
            'activeSeconds', COALESCE((
                SELECT floor(sum(greatest(0, extract(epoch FROM (
                    least(slice.ended_at, LEAST(
                        (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to))
                    - greatest(slice.started_at, (point ->> 'at')::timestamptz)
                )))))::integer
                  FROM public.product_module_activity_slices slice
                  JOIN public.product_module_sessions session ON session.id = slice.session_id
                 WHERE session.module_key = point ->> 'moduleKey'
                   AND slice.ended_at > (point ->> 'at')::timestamptz
                   AND slice.started_at < LEAST(
                       (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
                   AND (p_scope_kind = 'platform' OR session.workspace_id = p_scope_id
                        OR (session.actor_kind = 'student' AND session.tenant_id = v_tenant_id))
            ), 0)
        ) ORDER BY (point ->> 'at')::timestamptz, point ->> 'moduleKey'
    ), '[]'::jsonb) INTO v_modules
      FROM jsonb_array_elements(v_payload -> 'modules') point;

    SELECT COALESCE((v_payload -> 'loginMethods') || jsonb_agg(jsonb_build_object(
        'at', point ->> 'at',
        'method', 'registration',
        'successfulLogins', (
            SELECT count(*) FROM public.product_analytics_events event
             WHERE event.occurred_at >= (point ->> 'at')::timestamptz
               AND event.occurred_at < LEAST(
                   (point ->> 'at')::timestamptz + make_interval(secs => p_bucket_seconds), p_to)
               AND event.event_type = 'auth.register' AND event.outcome = 'succeeded'
               AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id)
        )
    ) ORDER BY (point ->> 'at')::timestamptz), v_payload -> 'loginMethods') INTO v_methods
      FROM jsonb_array_elements(v_payload -> 'timeline') point;

    RETURN v_payload
        || jsonb_build_object('summary', v_summary)
        || jsonb_build_object('timeline', v_timeline)
        || jsonb_build_object('modules', v_modules)
        || jsonb_build_object('loginMethods', v_methods);
END;
$$;

REVOKE ALL ON FUNCTION admin_get_product_dashboard_v2(
    uuid, varchar, uuid, timestamptz, timestamptz, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_product_dashboard_v2(
    uuid, varchar, uuid, timestamptz, timestamptz, integer
) TO asalab_app;

CREATE FUNCTION admin_list_accounts_v2(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_search varchar,
    p_limit integer,
    p_before timestamptz,
    p_before_id uuid
) RETURNS TABLE (
    account_id uuid, principal_id uuid, email varchar, display_name varchar, username varchar,
    account_status varchar, email_verification_state varchar, created_at timestamptz,
    organization_role varchar, membership_state varchar, active_session_count bigint,
    last_seen_at timestamptz, has_ever_signed_in boolean, is_platform_admin boolean,
    last_ip_address text, last_network_kind varchar, last_device varchar, recent_activity_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT base.account_id, base.principal_id, base.email, base.display_name, base.username,
           base.account_status, base.email_verification_state, base.created_at,
           base.organization_role, base.membership_state, base.active_session_count,
           base.last_seen_at, base.has_ever_signed_in, base.is_platform_admin,
           base.last_ip_address,
           (SELECT event.network_kind FROM public.product_analytics_events event
             WHERE event.account_id = base.account_id
               AND event.ip_address IS NOT NULL
               AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id)
             ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1)::varchar,
           base.last_device, base.recent_activity_count
      FROM public.admin_list_accounts(
          p_actor_principal_id, p_scope_kind, p_scope_id, p_search, p_limit, p_before, p_before_id
      ) base;
$$;

REVOKE ALL ON FUNCTION admin_list_accounts_v2(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_accounts_v2(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
) TO asalab_app;

CREATE FUNCTION admin_get_account_crm_v2(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_target_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_payload jsonb;
    v_activity jsonb;
    v_addresses jsonb;
    v_modules jsonb;
BEGIN
    v_payload := public.admin_get_account_crm(
        p_actor_principal_id, p_scope_kind, p_scope_id, p_target_account_id
    );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', recent.id, 'occurredAt', recent.occurred_at,
        'eventType', recent.event_type, 'outcome', recent.outcome,
        'authMethod', recent.auth_method, 'moduleKey', recent.module_key,
        'ipAddress', CASE WHEN recent.ip_address IS NULL THEN NULL ELSE host(recent.ip_address) END,
        'networkKind', recent.network_kind, 'device', recent.user_agent_summary
    ) ORDER BY recent.occurred_at DESC, recent.id DESC), '[]'::jsonb) INTO v_activity
      FROM (
          SELECT event.* FROM public.product_analytics_events event
           WHERE event.account_id = p_target_account_id
             AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id)
           ORDER BY event.occurred_at DESC, event.id DESC LIMIT 100
      ) recent;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'address', activity.address, 'firstSeenAt', activity.first_seen_at,
        'lastSeenAt', activity.last_seen_at, 'eventCount', activity.event_count,
        'device', activity.device, 'networkKind', activity.network_kind,
        'labelKind', label.label_kind, 'label', label.label
    ) ORDER BY activity.last_seen_at DESC, activity.address), '[]'::jsonb) INTO v_addresses
      FROM (
          SELECT host(event.ip_address) AS address,
                 min(event.occurred_at) AS first_seen_at,
                 max(event.occurred_at) AS last_seen_at,
                 count(*)::bigint AS event_count,
                 (array_agg(event.user_agent_summary ORDER BY event.occurred_at DESC)
                    FILTER (WHERE event.user_agent_summary IS NOT NULL))[1] AS device,
                 (array_agg(event.network_kind ORDER BY event.occurred_at DESC))[1] AS network_kind
            FROM public.product_analytics_events event
           WHERE event.account_id = p_target_account_id
             AND event.ip_address IS NOT NULL
             AND event.network_kind <> 'proxy'
             AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id)
           GROUP BY host(event.ip_address)
           ORDER BY max(event.occurred_at) DESC LIMIT 30
      ) activity
      LEFT JOIN public.admin_ip_labels label
        ON label.scope_kind = p_scope_kind
       AND label.scope_id IS NOT DISTINCT FROM p_scope_id
       AND host(label.ip_address) = activity.address;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'moduleKey', usage.module_key, 'projectCount', usage.project_count,
        'launches', usage.launches, 'activeSeconds', usage.active_seconds,
        'lastOpenedAt', usage.last_opened_at
    ) ORDER BY usage.last_opened_at DESC, usage.module_key), '[]'::jsonb) INTO v_modules
      FROM (
          SELECT session.module_key,
                 count(DISTINCT session.project_id)::bigint AS project_count,
                 count(DISTINCT session.id)::bigint AS launches,
                 COALESCE(sum(slice.active_seconds), 0)::bigint AS active_seconds,
                 max(session.started_at) AS last_opened_at
            FROM public.product_module_sessions session
            LEFT JOIN public.product_module_activity_slices slice ON slice.session_id = session.id
           WHERE session.account_id = p_target_account_id
             AND (p_scope_kind = 'platform' OR session.workspace_id = p_scope_id)
           GROUP BY session.module_key
      ) usage;

    RETURN v_payload
        || jsonb_build_object('activity', v_activity)
        || jsonb_build_object('ipAddresses', v_addresses)
        || jsonb_build_object('moduleUsage', v_modules);
END;
$$;

REVOKE ALL ON FUNCTION admin_get_account_crm_v2(uuid, varchar, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_account_crm_v2(uuid, varchar, uuid, uuid) TO asalab_app;

CREATE FUNCTION admin_list_account_ip_activity_v2(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_from timestamptz,
    p_to timestamptz,
    p_min_distinct integer,
    p_limit integer
) RETURNS TABLE (
    account_id uuid, email varchar, display_name varchar, distinct_ip_count bigint,
    last_seen_at timestamptz, addresses text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_role varchar;
BEGIN
    IF p_scope_kind NOT IN ('platform', 'organization')
       OR (p_scope_kind = 'platform' AND p_scope_id IS NOT NULL)
       OR p_from >= p_to OR extract(epoch FROM (p_to - p_from)) > 370 * 86400
       OR p_min_distinct NOT BETWEEN 1 AND 100 OR p_limit NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'invalid IP activity query' USING ERRCODE = '22023';
    END IF;
    v_role := public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id);
    IF v_role IS NULL OR (p_scope_kind = 'platform' AND v_role <> 'platform_admin') THEN
        RAISE EXCEPTION 'administrative IP activity scope denied' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT account.id, account.email, profile.display_name,
           activity.distinct_count, activity.last_seen, activity.address_list
      FROM public.accounts account
      JOIN public.profiles profile ON profile.account_id = account.id
      JOIN LATERAL (
          SELECT count(DISTINCT event.ip_address)::bigint AS distinct_count,
                 max(event.occurred_at) AS last_seen,
                 ARRAY(
                     SELECT host(recent.ip_address)
                       FROM public.product_analytics_events recent
                      WHERE recent.account_id = account.id
                        AND recent.ip_address IS NOT NULL
                        AND recent.network_kind IN ('public', 'local_network', 'local_device')
                        AND recent.outcome = 'succeeded'
                        AND recent.event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')
                        AND recent.occurred_at >= p_from AND recent.occurred_at < p_to
                      GROUP BY recent.ip_address
                      ORDER BY max(recent.occurred_at) DESC LIMIT 8
                 ) AS address_list
            FROM public.product_analytics_events event
           WHERE event.account_id = account.id
             AND event.ip_address IS NOT NULL
             AND event.network_kind IN ('public', 'local_network', 'local_device')
             AND event.outcome = 'succeeded'
             AND event.event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')
             AND event.occurred_at >= p_from AND event.occurred_at < p_to
      ) activity ON activity.distinct_count >= p_min_distinct
     WHERE p_scope_kind = 'platform' OR EXISTS (
         SELECT 1 FROM public.workspace_memberships membership
          WHERE membership.account_id = account.id
            AND membership.workspace_id = p_scope_id AND membership.state = 'active'
     )
     ORDER BY activity.distinct_count DESC, activity.last_seen DESC, account.id
     LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_account_ip_activity_v2(
    uuid, varchar, uuid, timestamptz, timestamptz, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_account_ip_activity_v2(
    uuid, varchar, uuid, timestamptz, timestamptz, integer, integer
) TO asalab_app;

CREATE FUNCTION admin_clear_account_ip_label(
    p_actor_principal_id uuid,
    p_target_account_id uuid,
    p_ip_address inet,
    p_request_id varchar
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_removed boolean := false;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative IP label denied' USING ERRCODE = '42501';
    END IF;
    IF length(trim(p_request_id)) NOT BETWEEN 1 AND 128
       OR NOT EXISTS (
           SELECT 1 FROM public.product_analytics_events event
            WHERE event.account_id = p_target_account_id
              AND event.ip_address = p_ip_address
       ) THEN
        RAISE EXCEPTION 'invalid administrative IP label' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.admin_ip_labels
     WHERE scope_kind = 'platform'
       AND scope_id IS NULL
       AND ip_address = p_ip_address;
    v_removed := FOUND;

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.ip.label.clear',
        'account', p_target_account_id::text,
        'admin_console', CASE WHEN v_removed THEN 'removed' ELSE 'already absent' END,
        NULL, p_request_id, p_request_id, 'succeeded', NULL, NULL
    );
    RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION admin_clear_account_ip_label(uuid, uuid, inet, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_clear_account_ip_label(uuid, uuid, inet, varchar) TO asalab_app;
