-- Self-service educator mode and school creation for the local pilot.
-- Email verification is intentionally not a prerequisite yet: the UI and API
-- can exercise the complete teacher -> school admin -> classroom journey.

CREATE OR REPLACE FUNCTION auth_set_educator_mode(
    p_account_id uuid,
    p_enabled boolean
)
RETURNS TABLE (eligible boolean, grant_state varchar, changed boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_birth_date date;
    v_state varchar(32);
    v_changed boolean := false;
    v_rows integer := 0;
    v_tenant_id uuid;
BEGIN
    SELECT a.birth_date
      INTO v_birth_date
      FROM public.accounts a
     WHERE a.id = p_account_id
       AND a.status = 'active'
     FOR UPDATE;

    IF v_birth_date IS NULL
       OR (p_enabled AND v_birth_date > (current_date - make_interval(years => 18))::date)
    THEN
        RETURN QUERY SELECT false, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT g.state
      INTO v_state
      FROM public.capability_grants g
     WHERE g.account_id = p_account_id
       AND g.capability = 'educator'
     FOR UPDATE;

    IF p_enabled THEN
        IF v_state IN ('provisional', 'verified') THEN
            RETURN QUERY SELECT true, v_state, false;
            RETURN;
        END IF;
        IF v_state = 'suspended' THEN
            RETURN QUERY SELECT true, v_state, false;
            RETURN;
        END IF;

        INSERT INTO public.capability_grants
            (account_id, capability, state, policy_version, granted_by)
        VALUES
            (p_account_id, 'educator', 'provisional',
             'educator-self-select-v1', 'self_attestation')
        ON CONFLICT (account_id, capability) DO UPDATE
            SET state = CASE
                    WHEN public.capability_grants.state = 'revoked' THEN 'provisional'
                    ELSE public.capability_grants.state
                END,
                policy_version = CASE
                    WHEN public.capability_grants.state = 'revoked'
                    THEN 'educator-self-select-v1'
                    ELSE public.capability_grants.policy_version
                END,
                granted_by = CASE
                    WHEN public.capability_grants.state = 'revoked'
                    THEN 'self_attestation'
                    ELSE public.capability_grants.granted_by
                END;

        SELECT g.state
          INTO v_state
          FROM public.capability_grants g
         WHERE g.account_id = p_account_id
           AND g.capability = 'educator';
        v_changed := true;
    ELSE
        IF v_state IS NULL THEN
            RETURN QUERY SELECT true, NULL::varchar, false;
            RETURN;
        END IF;
        IF v_state = 'suspended' THEN
            RETURN QUERY SELECT true, v_state, false;
            RETURN;
        END IF;

        UPDATE public.capability_grants
           SET state = 'revoked',
               policy_version = 'educator-self-select-v1'
         WHERE account_id = p_account_id
           AND capability = 'educator'
           AND state IN ('provisional', 'verified');
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_changed := v_rows > 0;
        v_state := 'revoked';
    END IF;

    IF v_changed THEN
        SELECT w.tenant_id
          INTO v_tenant_id
          FROM public.workspace_memberships m
          JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE m.account_id = p_account_id
           AND m.state = 'active'
           AND w.kind = 'personal'
           AND w.status = 'active'
         LIMIT 1;

        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_tenant_id, NULL, 'account', p_account_id,
             CASE WHEN p_enabled
                  THEN 'capability.educator_enabled'
                  ELSE 'capability.educator_disabled'
             END,
             jsonb_build_object(
                 'capability', 'educator',
                 'state', v_state,
                 'policyVersion', 'educator-self-select-v1'));
    END IF;

    RETURN QUERY SELECT true, v_state, v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION auth_create_school_workspace(
    p_account_id uuid,
    p_title varchar
)
RETURNS TABLE (
    workspace_id uuid,
    tenant_id uuid,
    school_id uuid,
    user_id uuid,
    title varchar,
    role varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_title varchar(255);
    v_email varchar(255);
    v_password_hash text;
    v_display_name varchar(255);
    v_principal_id uuid;
    v_tenant_id uuid;
    v_school_id uuid;
    v_workspace_id uuid;
    v_user_id uuid;
    v_year integer;
BEGIN
    v_title := trim(p_title);
    IF v_title IS NULL OR char_length(v_title) < 2 OR char_length(v_title) > 120 THEN
        RETURN;
    END IF;

    SELECT a.email, a.password_hash, p.display_name, pr.id
      INTO v_email, v_password_hash, v_display_name, v_principal_id
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.principals pr ON pr.account_id = a.id AND pr.kind = 'account'
     WHERE a.id = p_account_id
       AND a.status = 'active'
       AND EXISTS (
           SELECT 1
             FROM public.capability_grants g
            WHERE g.account_id = a.id
              AND g.capability = 'educator'
              AND g.state IN ('provisional', 'verified'))
     FOR UPDATE OF a;

    IF v_email IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.tenants (workspace_slug, title)
    VALUES ('school-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24), v_title)
    RETURNING id INTO v_tenant_id;

    INSERT INTO public.tenant_placements (tenant_id, mode)
    VALUES (v_tenant_id, 'SHARED_CLUSTER');

    INSERT INTO public.schools (tenant_id, title)
    VALUES (v_tenant_id, v_title)
    RETURNING id INTO v_school_id;

    v_year := extract(year FROM current_date)::integer;
    INSERT INTO public.academic_periods
        (tenant_id, school_id, title, starts_on, ends_on, is_active)
    VALUES
        (v_tenant_id, v_school_id, v_year::text,
         make_date(v_year, 1, 1), make_date(v_year, 12, 31), true);

    INSERT INTO public.workspaces (tenant_id, kind, title, status)
    VALUES (v_tenant_id, 'organization', v_title, 'active')
    RETURNING id INTO v_workspace_id;

    INSERT INTO public.workspace_memberships
        (account_id, workspace_id, role, state)
    VALUES
        (p_account_id, v_workspace_id, 'school_admin', 'active');

    INSERT INTO public.users
        (tenant_id, school_id, role, email, display_name, password_hash, status)
    VALUES
        (v_tenant_id, v_school_id, 'teacher', v_email, v_display_name,
         v_password_hash, 'active')
    RETURNING id INTO v_user_id;

    INSERT INTO public.legacy_user_account_links
        (tenant_id, user_id, account_id, principal_id, migration_state)
    VALUES
        (v_tenant_id, v_user_id, p_account_id, v_principal_id, 'active');

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_tenant_id, v_user_id, 'school', v_school_id, 'school.created',
         jsonb_build_object(
             'title', v_title,
             'workspaceId', v_workspace_id,
             'role', 'school_admin',
             'emailVerificationRequired', false));

    RETURN QUERY
    SELECT v_workspace_id, v_tenant_id, v_school_id, v_user_id,
           v_title::varchar, 'school_admin'::varchar;
END;
$$;

REVOKE ALL ON FUNCTION auth_set_educator_mode(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_create_school_workspace(uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_set_educator_mode(uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_create_school_workspace(uuid, varchar) TO asalab_app;
