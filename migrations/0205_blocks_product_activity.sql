-- Scratch uses existing ProductAnalytics sessions/slices and the unchanged
-- participant draft-edit trigger/range union. No historical events are created.
ALTER TABLE public.product_analytics_events
 DROP CONSTRAINT product_analytics_events_module_key_check,
 ADD CONSTRAINT product_analytics_events_module_key_check
 CHECK (module_key IS NULL OR module_key IN ('electronics','three-d','chess','checkers','blocks'));
ALTER TABLE public.product_module_sessions
 DROP CONSTRAINT product_module_sessions_module_key_check,
 ADD CONSTRAINT product_module_sessions_module_key_check
 CHECK (module_key IN ('electronics','three-d','chess','checkers','blocks'));

-- Preserve the existing recording/admin projections verbatim except the two
-- module enumerations. Fail closed if their reviewed baseline has changed.
DO $migration$
DECLARE definition text; updated text;
BEGIN
 definition := pg_get_functiondef('public.analytics_record_event(character varying,uuid,uuid,uuid,uuid,character varying,character varying,character varying,character varying,uuid,inet,character varying)'::regprocedure);
 updated := replace(definition, $old$'electronics', 'three-d', 'chess', 'checkers'$old$, $new$'electronics', 'three-d', 'chess', 'checkers', 'blocks'$new$);
 IF updated = definition THEN RAISE EXCEPTION 'analytics module allowlist baseline changed'; END IF;
 EXECUTE updated;
 definition := pg_get_functiondef('public.admin_get_product_dashboard(uuid,character varying,uuid,timestamp with time zone,timestamp with time zone,integer)'::regprocedure);
 updated := replace(definition, $old$('electronics'), ('three-d'), ('chess'), ('checkers')$old$, $new$('electronics'), ('three-d'), ('chess'), ('checkers'), ('blocks')$new$);
 IF updated = definition THEN RAISE EXCEPTION 'analytics dashboard modules baseline changed'; END IF;
 EXECUTE updated;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.analytics_start_module_session(
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
    IF p_session_id IS NULL OR p_principal_id IS NULL OR p_project_id IS NULL
       OR p_actor_kind IS NULL OR p_module_key IS NULL OR p_network_kind IS NULL
       OR p_actor_kind NOT IN ('account', 'student')
       OR p_module_key NOT IN ('electronics', 'three-d', 'chess', 'checkers', 'blocks')
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
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'module session actor denied' USING ERRCODE = '42501';
    END IF;
    -- Reuse actual Project Core access, including canonical linked Account work.
    SELECT project.tenant_id INTO v_tenant_id
      FROM public.projects project
      JOIN public.project_context_for_principal(p_principal_id,p_project_id) access
        ON access.tenant_id = project.tenant_id
     WHERE project.id = p_project_id AND project.module_key = p_module_key
       AND project.status <> 'trashed';
    IF v_tenant_id IS NULL THEN
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
           AND session.account_id IS NOT DISTINCT FROM p_account_id
           AND session.seat_id IS NOT DISTINCT FROM p_seat_id
           AND session.workspace_id IS NOT DISTINCT FROM p_workspace_id
           AND session.ended_at IS NULL
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

CREATE OR REPLACE FUNCTION public.analytics_touch_module_session(
    p_session_id uuid,
    p_actor_kind varchar,
    p_account_id uuid,
    p_principal_id uuid,
    p_closed boolean
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session public.product_module_sessions%ROWTYPE;
    v_now timestamptz;
    v_seconds integer;
BEGIN
    SELECT * INTO v_session
      FROM public.product_module_sessions session
     WHERE session.id = p_session_id
     FOR UPDATE;
    IF NOT FOUND
       OR v_session.actor_kind IS DISTINCT FROM p_actor_kind
       OR v_session.principal_id IS DISTINCT FROM p_principal_id
       OR v_session.account_id IS DISTINCT FROM p_account_id THEN
        RAISE EXCEPTION 'module session denied' USING ERRCODE = '42501';
    END IF;
    IF v_session.ended_at IS NOT NULL THEN
        RETURN 0;
    END IF;
    -- Sample after acquiring the row lock: concurrent touches cannot move the
    -- session clock backwards or generate overlapping slices within a session.
    v_now := clock_timestamp();

    IF p_closed IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.project_context_for_principal(p_principal_id,v_session.project_id) access
          ON access.tenant_id = project.tenant_id
        WHERE project.id = v_session.project_id
          AND project.module_key = v_session.module_key AND project.status <> 'trashed'
    ) THEN
        RAISE EXCEPTION 'module session project denied' USING ERRCODE = '42501';
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
