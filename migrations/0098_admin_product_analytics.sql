-- Product analytics for the integrated ASA Lab administrative dashboard.
--
-- This is an append-only, server-written stream. The runtime role cannot read
-- or mutate the table directly: authenticated recording and scoped
-- SECURITY DEFINER projections are the only public database boundary.

CREATE TABLE product_analytics_events (
    id                  bigserial PRIMARY KEY,
    occurred_at         timestamptz NOT NULL DEFAULT now(),
    actor_kind          varchar(16) NOT NULL
                        CHECK (actor_kind IN ('account', 'student', 'anonymous')),
    account_id          uuid REFERENCES accounts(id),
    principal_id        uuid REFERENCES principals(id),
    seat_id             uuid REFERENCES classroom_student_seats(id),
    workspace_id        uuid REFERENCES workspaces(id),
    tenant_id           uuid REFERENCES tenants(id),
    event_type          varchar(48) NOT NULL
                        CHECK (event_type IN (
                            'auth.login', 'auth.register', 'auth.max',
                            'auth.class_join', 'session.observed', 'module.opened'
                        )),
    outcome             varchar(16) NOT NULL
                        CHECK (outcome IN ('succeeded', 'failed', 'blocked')),
    auth_method         varchar(24)
                        CHECK (auth_method IS NULL OR auth_method IN (
                            'password', 'organization', 'max', 'class_code'
                        )),
    module_key          varchar(64)
                        CHECK (module_key IS NULL OR module_key IN (
                            'electronics', 'three-d', 'chess', 'checkers'
                        )),
    flow_id             uuid,
    ip_address          inet,
    user_agent_summary  varchar(128),
    CHECK (
        (event_type = 'module.opened' AND module_key IS NOT NULL)
        OR (event_type <> 'module.opened' AND module_key IS NULL)
    ),
    CHECK (
        (actor_kind = 'account' AND account_id IS NOT NULL AND principal_id IS NOT NULL
                                AND seat_id IS NULL)
        OR (actor_kind = 'student' AND account_id IS NULL AND principal_id IS NOT NULL
                                AND seat_id IS NOT NULL)
        OR (actor_kind = 'anonymous' AND account_id IS NULL AND principal_id IS NULL
                                AND seat_id IS NULL)
    )
);

CREATE INDEX product_analytics_events_time_idx
    ON product_analytics_events (occurred_at DESC);
CREATE INDEX product_analytics_events_module_time_idx
    ON product_analytics_events (module_key, occurred_at DESC)
    WHERE event_type = 'module.opened';
CREATE INDEX product_analytics_events_account_time_idx
    ON product_analytics_events (account_id, occurred_at DESC)
    WHERE account_id IS NOT NULL;
CREATE INDEX product_analytics_events_flow_idx
    ON product_analytics_events (flow_id, occurred_at DESC)
    WHERE flow_id IS NOT NULL;
CREATE INDEX product_analytics_events_scope_time_idx
    ON product_analytics_events (workspace_id, occurred_at DESC);

REVOKE ALL ON product_analytics_events FROM asalab_app;
REVOKE ALL ON SEQUENCE product_analytics_events_id_seq FROM asalab_app;
ALTER TABLE product_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_analytics_events FORCE ROW LEVEL SECURITY;

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
    p_user_agent_summary varchar
) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id bigint;
    v_tenant_id uuid;
BEGIN
    IF p_actor_kind NOT IN ('account', 'student', 'anonymous')
       OR p_event_type NOT IN ('auth.login', 'auth.register', 'auth.max',
                               'auth.class_join', 'session.observed', 'module.opened')
       OR p_outcome NOT IN ('succeeded', 'failed', 'blocked')
       OR (p_auth_method IS NOT NULL
           AND p_auth_method NOT IN ('password', 'organization', 'max', 'class_code'))
       OR (p_module_key IS NOT NULL
           AND p_module_key NOT IN ('electronics', 'three-d', 'chess', 'checkers'))
       OR ((p_event_type = 'module.opened') IS DISTINCT FROM (p_module_key IS NOT NULL)) THEN
        RAISE EXCEPTION 'invalid analytics event' USING ERRCODE = '22023';
    END IF;

    IF p_actor_kind = 'account' THEN
        SELECT w.tenant_id INTO v_tenant_id
          FROM public.principals principal
          JOIN public.workspace_memberships membership
            ON membership.account_id = principal.account_id
           AND membership.workspace_id = p_workspace_id
           AND membership.state = 'active'
          JOIN public.workspaces w
            ON w.id = membership.workspace_id AND w.status = 'active'
         WHERE principal.id = p_principal_id
           AND principal.account_id = p_account_id;
        IF v_tenant_id IS NULL THEN
            RAISE EXCEPTION 'analytics account context denied' USING ERRCODE = '42501';
        END IF;
    ELSIF p_actor_kind = 'student' THEN
        SELECT seat.tenant_id INTO v_tenant_id
          FROM public.principals principal
          JOIN public.classroom_student_seats seat ON seat.id = p_seat_id
         WHERE principal.id = p_principal_id
           AND principal.seat_id = seat.id
           AND seat.status IN ('issued', 'active');
        IF v_tenant_id IS NULL THEN
            RAISE EXCEPTION 'analytics student context denied' USING ERRCODE = '42501';
        END IF;
    ELSE
        p_account_id := NULL;
        p_principal_id := NULL;
        p_seat_id := NULL;
        p_workspace_id := NULL;
    END IF;

    -- Session checks happen on page reload and token refresh. One observation
    -- per actor/address in a short window is enough to discover a new IP and
    -- prevents authenticated polling from turning telemetry into write spam.
    IF p_event_type = 'session.observed'
       AND p_outcome = 'succeeded'
       AND p_principal_id IS NOT NULL THEN
        SELECT event.id INTO v_id
          FROM public.product_analytics_events event
         WHERE event.event_type = 'session.observed'
           AND event.outcome = 'succeeded'
           AND event.actor_kind = p_actor_kind
           AND event.principal_id = p_principal_id
           AND event.ip_address IS NOT DISTINCT FROM p_ip_address
           AND event.occurred_at >= clock_timestamp() - interval '15 minutes'
         ORDER BY event.occurred_at DESC, event.id DESC
         LIMIT 1;
        IF v_id IS NOT NULL THEN
            RETURN v_id;
        END IF;
    END IF;

    INSERT INTO public.product_analytics_events (
        actor_kind, account_id, principal_id, seat_id, workspace_id, tenant_id,
        event_type, outcome, auth_method, module_key, flow_id, ip_address,
        user_agent_summary
    ) VALUES (
        p_actor_kind, p_account_id, p_principal_id, p_seat_id, p_workspace_id,
        v_tenant_id, p_event_type, p_outcome, p_auth_method, p_module_key,
        p_flow_id, p_ip_address, left(NULLIF(trim(p_user_agent_summary), ''), 128)
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION analytics_record_event(
    varchar, uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar,
    uuid, inet, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_record_event(
    varchar, uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar,
    uuid, inet, varchar
) TO asalab_app;

CREATE FUNCTION admin_get_product_dashboard(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_from timestamptz,
    p_to timestamptz,
    p_bucket_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_role varchar;
    v_tenant_id uuid;
    v_payload jsonb;
BEGIN
    IF p_scope_kind NOT IN ('platform', 'organization')
       OR p_from >= p_to
       OR p_bucket_seconds NOT BETWEEN 60 AND 2678400
       OR extract(epoch FROM (p_to - p_from)) > 370 * 86400 THEN
        RAISE EXCEPTION 'invalid dashboard query' USING ERRCODE = '22023';
    END IF;

    v_role := public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id);
    IF v_role IS NULL
       OR (p_scope_kind = 'platform' AND v_role <> 'platform_admin') THEN
        RAISE EXCEPTION 'administrative dashboard scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_scope_kind = 'platform' AND p_scope_id IS NOT NULL THEN
        RAISE EXCEPTION 'platform dashboard has no scope id' USING ERRCODE = '22023';
    END IF;
    IF p_scope_kind = 'organization' THEN
        SELECT tenant_id INTO v_tenant_id
          FROM public.workspaces
         WHERE id = p_scope_id AND kind = 'organization' AND status = 'active';
        IF v_tenant_id IS NULL THEN
            RAISE EXCEPTION 'organization dashboard unavailable' USING ERRCODE = '42501';
        END IF;
    END IF;

    WITH
    bucket AS (
        SELECT point AS bucket_start,
               LEAST(point + make_interval(secs => p_bucket_seconds), p_to) AS bucket_end
          FROM generate_series(
              p_from,
              p_to - make_interval(secs => p_bucket_seconds),
              make_interval(secs => p_bucket_seconds)
          ) point
    ),
    scoped_events AS (
        SELECT event.*
          FROM public.product_analytics_events event
         WHERE event.occurred_at >= p_from AND event.occurred_at < p_to
           AND (p_scope_kind = 'platform'
                OR event.workspace_id = p_scope_id
                OR (event.actor_kind = 'student' AND event.tenant_id = v_tenant_id))
    ),
    scoped_accounts AS (
        SELECT account.id, account.created_at, account.first_authenticated_at
          FROM public.accounts account
         WHERE p_scope_kind = 'platform'
            OR EXISTS (
                SELECT 1 FROM public.workspace_memberships membership
                 WHERE membership.account_id = account.id
                   AND membership.workspace_id = p_scope_id
                   AND membership.state = 'active')
    ),
    scoped_students AS (
        SELECT seat.id, seat.created_at
          FROM public.classroom_student_seats seat
         WHERE seat.status <> 'removed'
           AND (p_scope_kind = 'platform' OR seat.tenant_id = v_tenant_id)
    ),
    failed_flows AS (
        SELECT failure.id, failure.occurred_at,
               COALESCE(failure.flow_id::text, failure.id::text) AS flow_key
          FROM scoped_events failure
         WHERE failure.event_type IN ('auth.login', 'auth.max')
           AND failure.outcome IN ('failed', 'blocked')
           AND NOT EXISTS (
               SELECT 1 FROM scoped_events success
                WHERE success.flow_id = failure.flow_id
                  AND failure.flow_id IS NOT NULL
                  AND success.event_type IN ('auth.login', 'auth.max')
                  AND success.outcome = 'succeeded')
    ),
    timeline AS (
        SELECT bucket.bucket_start,
               (SELECT count(*) FROM scoped_accounts account
                 WHERE account.created_at >= bucket.bucket_start
                   AND account.created_at < bucket.bucket_end) AS new_accounts,
               (SELECT count(DISTINCT principal.account_id)
                  FROM public.sessions_v2 session
                  JOIN public.principals principal ON principal.id = session.principal_id
                 WHERE session.last_seen_at >= bucket.bucket_start
                   AND session.last_seen_at < bucket.bucket_end
                   AND (p_scope_kind = 'platform' OR session.active_workspace_id = p_scope_id))
                    AS active_accounts,
               (SELECT count(*) FROM scoped_events event
                 WHERE event.occurred_at >= bucket.bucket_start
                   AND event.occurred_at < bucket.bucket_end
                   AND event.event_type IN ('auth.login', 'auth.max')
                   AND event.outcome = 'succeeded') AS successful_logins,
               (SELECT count(DISTINCT failed.flow_key) FROM failed_flows failed
                 WHERE failed.occurred_at >= bucket.bucket_start
                   AND failed.occurred_at < bucket.bucket_end) AS failed_logins,
               (SELECT count(*) FROM scoped_students student
                 WHERE student.created_at >= bucket.bucket_start
                   AND student.created_at < bucket.bucket_end) AS new_students,
               (SELECT count(DISTINCT session.seat_id)
                  FROM public.classroom_student_sessions session
                  JOIN public.classroom_student_seats seat ON seat.id = session.seat_id
                 WHERE session.last_seen_at >= bucket.bucket_start
                   AND session.last_seen_at < bucket.bucket_end
                   AND (p_scope_kind = 'platform' OR seat.tenant_id = v_tenant_id))
                    AS active_students
          FROM bucket
    ),
    module_timeline AS (
        SELECT bucket.bucket_start, module.module_key,
               count(DISTINCT CASE
                   WHEN event.actor_kind = 'account' THEN 'account:' || event.account_id::text
                   WHEN event.actor_kind = 'student' THEN 'student:' || event.seat_id::text
                   ELSE NULL END) AS active_people,
               count(event.id) AS launches
          FROM bucket
          CROSS JOIN (VALUES ('electronics'), ('three-d'), ('chess'), ('checkers')) module(module_key)
          LEFT JOIN scoped_events event
            ON event.event_type = 'module.opened'
           AND event.outcome = 'succeeded'
           AND event.module_key = module.module_key
           AND event.occurred_at >= bucket.bucket_start
           AND event.occurred_at < bucket.bucket_end
         GROUP BY bucket.bucket_start, module.module_key
    ),
    method_timeline AS (
        SELECT bucket.bucket_start, method.auth_method,
               count(event.id) AS successful_logins
          FROM bucket
          CROSS JOIN (VALUES ('password'), ('organization'), ('max'), ('class_code')) method(auth_method)
          LEFT JOIN scoped_events event
            ON event.auth_method = method.auth_method
           AND event.event_type IN ('auth.login', 'auth.max', 'auth.class_join')
           AND event.outcome = 'succeeded'
           AND event.occurred_at >= bucket.bucket_start
           AND event.occurred_at < bucket.bucket_end
         GROUP BY bucket.bucket_start, method.auth_method
    ),
    action_timeline AS (
        SELECT bucket.bucket_start,
               (SELECT count(*) FROM public.classrooms classroom
                 WHERE classroom.created_at >= bucket.bucket_start
                   AND classroom.created_at < bucket.bucket_end
                   AND (p_scope_kind = 'platform' OR classroom.tenant_id = v_tenant_id))
                    AS classes_created,
               (SELECT count(*) FROM public.projects project
                 WHERE project.created_at >= bucket.bucket_start
                   AND project.created_at < bucket.bucket_end
                   AND (p_scope_kind = 'platform' OR project.tenant_id = v_tenant_id))
                    AS projects_created,
               (SELECT count(*) FROM public.account_external_identity_events identity_event
                  JOIN scoped_accounts account ON account.id = identity_event.account_id
                 WHERE identity_event.event = 'linked'
                   AND identity_event.occurred_at >= bucket.bucket_start
                   AND identity_event.occurred_at < bucket.bucket_end)
                    AS max_linked
          FROM bucket
    )
    SELECT jsonb_build_object(
        'generatedAt', now(),
        'analyticsStartedAt', (SELECT min(occurred_at) FROM scoped_events),
        'from', p_from,
        'to', p_to,
        'bucketSeconds', p_bucket_seconds,
        'summary', jsonb_build_object(
            'newAccounts', (SELECT count(*) FROM scoped_accounts WHERE created_at >= p_from AND created_at < p_to),
            'activeAccounts', (SELECT count(DISTINCT principal.account_id)
                FROM public.sessions_v2 session
                JOIN public.principals principal ON principal.id = session.principal_id
                WHERE session.last_seen_at >= p_from AND session.last_seen_at < p_to
                  AND (p_scope_kind = 'platform' OR session.active_workspace_id = p_scope_id)),
            'successfulLogins', (SELECT count(*) FROM scoped_events
                WHERE event_type IN ('auth.login', 'auth.max') AND outcome = 'succeeded'),
            'failedLogins', (SELECT count(DISTINCT flow_key) FROM failed_flows),
            'newStudents', (SELECT count(*) FROM scoped_students WHERE created_at >= p_from AND created_at < p_to),
            'activeStudents', (SELECT count(DISTINCT session.seat_id)
                FROM public.classroom_student_sessions session
                JOIN public.classroom_student_seats seat ON seat.id = session.seat_id
                WHERE session.last_seen_at >= p_from AND session.last_seen_at < p_to
                  AND (p_scope_kind = 'platform' OR seat.tenant_id = v_tenant_id)),
            'distinctIpAddresses', (SELECT count(DISTINCT ip_address) FROM scoped_events
                WHERE account_id IS NOT NULL AND outcome = 'succeeded' AND ip_address IS NOT NULL
                  AND event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')),
            'accountsWithMultipleIps', (SELECT count(*) FROM (
                SELECT account_id FROM scoped_events
                 WHERE account_id IS NOT NULL AND outcome = 'succeeded' AND ip_address IS NOT NULL
                   AND event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')
                 GROUP BY account_id HAVING count(DISTINCT ip_address) > 1
            ) multi_ip)
        ),
        'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'at', bucket_start,
            'newAccounts', new_accounts,
            'activeAccounts', active_accounts,
            'successfulLogins', successful_logins,
            'failedLogins', failed_logins,
            'newStudents', new_students,
            'activeStudents', active_students
        ) ORDER BY bucket_start) FROM timeline), '[]'::jsonb),
        'modules', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'at', bucket_start, 'moduleKey', module_key,
            'activePeople', active_people, 'launches', launches
        ) ORDER BY bucket_start, module_key) FROM module_timeline), '[]'::jsonb),
        'loginMethods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'at', bucket_start, 'method', auth_method, 'successfulLogins', successful_logins
        ) ORDER BY bucket_start, auth_method) FROM method_timeline), '[]'::jsonb),
        'actions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'at', bucket_start, 'classesCreated', classes_created,
            'projectsCreated', projects_created, 'maxLinked', max_linked,
            'passwordRecoveryAvailable', false
        ) ORDER BY bucket_start) FROM action_timeline), '[]'::jsonb),
        'max', jsonb_build_object(
            'linkedAccounts', (SELECT count(DISTINCT identity.account_id)
                FROM public.account_external_identities identity
                JOIN scoped_accounts account ON account.id = identity.account_id
                WHERE identity.provider = 'max' AND identity.revoked_at IS NULL),
            'promptDueAccounts', (SELECT count(*) FROM scoped_accounts account
                WHERE account.first_authenticated_at IS NOT NULL
                  AND account.first_authenticated_at + interval '24 hours' <= now()
                  AND NOT EXISTS (SELECT 1 FROM public.account_external_identities identity
                      WHERE identity.account_id = account.id AND identity.provider = 'max'
                        AND identity.revoked_at IS NULL))
        )
    ) INTO v_payload;
    RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION admin_get_product_dashboard(
    uuid, varchar, uuid, timestamptz, timestamptz, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_product_dashboard(
    uuid, varchar, uuid, timestamptz, timestamptz, integer
) TO asalab_app;

CREATE FUNCTION admin_list_account_ip_activity(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_from timestamptz,
    p_to timestamptz,
    p_min_distinct integer,
    p_limit integer
) RETURNS TABLE (
    account_id uuid,
    email varchar,
    display_name varchar,
    distinct_ip_count bigint,
    last_seen_at timestamptz,
    addresses text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_role varchar;
BEGIN
    IF p_scope_kind NOT IN ('platform', 'organization')
       OR (p_scope_kind = 'platform' AND p_scope_id IS NOT NULL)
       OR p_from >= p_to
       OR extract(epoch FROM (p_to - p_from)) > 370 * 86400
       OR p_min_distinct NOT BETWEEN 1 AND 100
       OR p_limit NOT BETWEEN 1 AND 200 THEN
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
                        AND recent.outcome = 'succeeded'
                        AND recent.event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')
                        AND recent.occurred_at >= p_from AND recent.occurred_at < p_to
                      GROUP BY recent.ip_address
                      ORDER BY max(recent.occurred_at) DESC
                      LIMIT 8
                 ) AS address_list
            FROM public.product_analytics_events event
           WHERE event.account_id = account.id
             AND event.ip_address IS NOT NULL
             AND event.outcome = 'succeeded'
             AND event.event_type IN ('auth.login', 'auth.register', 'auth.max', 'session.observed')
             AND event.occurred_at >= p_from AND event.occurred_at < p_to
      ) activity ON activity.distinct_count >= p_min_distinct
     WHERE p_scope_kind = 'platform'
        OR EXISTS (
            SELECT 1 FROM public.workspace_memberships membership
             WHERE membership.account_id = account.id
               AND membership.workspace_id = p_scope_id
               AND membership.state = 'active')
     ORDER BY activity.distinct_count DESC, activity.last_seen DESC, account.id
     LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION admin_list_account_ip_activity(
    uuid, varchar, uuid, timestamptz, timestamptz, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_account_ip_activity(
    uuid, varchar, uuid, timestamptz, timestamptz, integer, integer
) TO asalab_app;
