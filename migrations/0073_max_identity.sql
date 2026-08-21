-- MAX mini-app authentication. A signed MAX identity can only be attached to
-- an existing ASA Lab account; it never bypasses registration, age routing or
-- the account's own status. Runtime code reaches the data only through the two
-- SECURITY DEFINER functions below.

CREATE TABLE account_external_identities (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider     varchar(32) NOT NULL CHECK (provider = 'max'),
    subject      varchar(64) NOT NULL CHECK (subject ~ '^[0-9]+$'),
    account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    username     varchar(64),
    display_name varchar(255),
    linked_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    UNIQUE (provider, subject),
    UNIQUE (provider, account_id)
);

CREATE TABLE external_auth_assertions (
    provider     varchar(32) NOT NULL CHECK (provider = 'max'),
    assertion_id varchar(255) NOT NULL,
    account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    issued_at    timestamptz NOT NULL,
    consumed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, assertion_id)
);
CREATE INDEX external_auth_assertions_consumed_idx
    ON external_auth_assertions (consumed_at);

REVOKE ALL ON account_external_identities, external_auth_assertions FROM asalab_app;
ALTER TABLE account_external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_auth_assertions ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION auth_max_login(
    p_subject varchar,
    p_query_id varchar,
    p_auth_date bigint,
    p_username varchar,
    p_display_name varchar,
    p_token_hash text,
    p_ttl_hours integer,
    p_user_agent_summary varchar
) RETURNS TABLE (result varchar, account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account_id uuid;
    v_account_status varchar(32);
    v_principal_id uuid;
    v_workspace_id uuid;
    v_inserted integer := 0;
BEGIN
    IF p_subject !~ '^[0-9]{1,64}$'
       OR length(p_query_id) NOT BETWEEN 1 AND 255
       OR p_auth_date <= 0
       OR length(p_token_hash) NOT BETWEEN 32 AND 255
       OR p_ttl_hours NOT BETWEEN 1 AND 24 THEN
        RETURN QUERY SELECT 'unavailable'::varchar, NULL::uuid;
        RETURN;
    END IF;

    SELECT i.account_id, a.status
      INTO v_account_id, v_account_status
      FROM public.account_external_identities i
      JOIN public.accounts a ON a.id = i.account_id
     WHERE i.provider = 'max' AND i.subject = p_subject;
    IF v_account_id IS NULL THEN
        RETURN QUERY SELECT 'link_required'::varchar, NULL::uuid;
        RETURN;
    END IF;
    IF v_account_status <> 'active' THEN
        RETURN QUERY SELECT 'account_suspended'::varchar, v_account_id;
        RETURN;
    END IF;

    SELECT pr.id, w.id
      INTO v_principal_id, v_workspace_id
      FROM public.principals pr
      JOIN public.workspace_memberships m ON m.account_id = pr.account_id
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE pr.account_id = v_account_id
       AND pr.kind = 'account'
       AND m.state = 'active'
       AND w.kind = 'personal'
       AND w.status = 'active'
     LIMIT 1;
    IF v_principal_id IS NULL OR v_workspace_id IS NULL THEN
        RETURN QUERY SELECT 'unavailable'::varchar, v_account_id;
        RETURN;
    END IF;

    -- Signed launch assertions expire at the API boundary after one hour. A
    -- small rolling table is sufficient to reject every still-valid replay.
    DELETE FROM public.external_auth_assertions
     WHERE consumed_at < now() - interval '2 hours';
    INSERT INTO public.external_auth_assertions
        (provider, assertion_id, account_id, issued_at)
    VALUES
        ('max', p_query_id, v_account_id, to_timestamp(p_auth_date::double precision))
    ON CONFLICT (provider, assertion_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted <> 1 THEN
        RETURN QUERY SELECT 'assertion_replayed'::varchar, v_account_id;
        RETURN;
    END IF;

    INSERT INTO public.sessions_v2
        (principal_id, active_workspace_id, token_hash, expires_at, client_metadata)
    VALUES
        (v_principal_id, v_workspace_id, p_token_hash,
         now() + make_interval(hours => p_ttl_hours),
         jsonb_strip_nulls(jsonb_build_object(
             'authenticationProvider', 'max',
             'userAgentSummary', NULLIF(trim(p_user_agent_summary), '')
         )));
    UPDATE public.account_external_identities
       SET username = COALESCE(NULLIF(trim(p_username), ''), username),
           display_name = COALESCE(NULLIF(trim(p_display_name), ''), display_name),
           last_used_at = now()
     WHERE provider = 'max' AND subject = p_subject;

    RETURN QUERY SELECT 'authenticated'::varchar, v_account_id;
END;
$$;

CREATE FUNCTION auth_max_link(
    p_account_id uuid,
    p_subject varchar,
    p_query_id varchar,
    p_auth_date bigint,
    p_username varchar,
    p_display_name varchar
) RETURNS TABLE (result varchar)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_status varchar(32);
    v_subject_account_id uuid;
    v_account_subject varchar(64);
    v_tenant_id uuid;
    v_inserted integer := 0;
BEGIN
    IF p_subject !~ '^[0-9]{1,64}$'
       OR length(p_query_id) NOT BETWEEN 1 AND 255
       OR p_auth_date <= 0 THEN
        RETURN QUERY SELECT 'unavailable'::varchar;
        RETURN;
    END IF;

    -- Serialize both sides of the one-to-one relationship, including the case
    -- where neither row exists yet.
    PERFORM pg_advisory_xact_lock(hashtextextended('max-subject:' || p_subject, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('max-account:' || p_account_id::text, 0));

    SELECT a.status INTO v_status
      FROM public.accounts a
     WHERE a.id = p_account_id
     FOR UPDATE;
    IF v_status IS NULL OR v_status <> 'active' THEN
        RETURN QUERY SELECT 'account_suspended'::varchar;
        RETURN;
    END IF;

    SELECT i.account_id INTO v_subject_account_id
      FROM public.account_external_identities i
     WHERE i.provider = 'max' AND i.subject = p_subject;
    IF v_subject_account_id IS NOT NULL AND v_subject_account_id <> p_account_id THEN
        RETURN QUERY SELECT 'identity_taken'::varchar;
        RETURN;
    END IF;
    SELECT i.subject INTO v_account_subject
      FROM public.account_external_identities i
     WHERE i.provider = 'max' AND i.account_id = p_account_id;
    IF v_account_subject IS NOT NULL AND v_account_subject <> p_subject THEN
        RETURN QUERY SELECT 'account_already_linked'::varchar;
        RETURN;
    END IF;

    DELETE FROM public.external_auth_assertions
     WHERE consumed_at < now() - interval '2 hours';
    INSERT INTO public.external_auth_assertions
        (provider, assertion_id, account_id, issued_at)
    VALUES
        ('max', p_query_id, p_account_id, to_timestamp(p_auth_date::double precision))
    ON CONFLICT (provider, assertion_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted <> 1 THEN
        RETURN QUERY SELECT 'assertion_replayed'::varchar;
        RETURN;
    END IF;

    INSERT INTO public.account_external_identities
        (provider, subject, account_id, username, display_name, last_used_at)
    VALUES
        ('max', p_subject, p_account_id,
         NULLIF(trim(p_username), ''), NULLIF(trim(p_display_name), ''), now())
    ON CONFLICT (provider, subject) DO UPDATE
       SET username = COALESCE(EXCLUDED.username, account_external_identities.username),
           display_name = COALESCE(EXCLUDED.display_name, account_external_identities.display_name),
           last_used_at = now();

    SELECT w.tenant_id INTO v_tenant_id
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = p_account_id
       AND w.kind = 'personal'
     LIMIT 1;
    IF v_subject_account_id IS NULL AND v_tenant_id IS NOT NULL THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_tenant_id, NULL, 'account', p_account_id,
             'auth.max_linked', jsonb_build_object('provider', 'max'));
    END IF;

    RETURN QUERY SELECT CASE
        WHEN v_subject_account_id IS NULL THEN 'linked'::varchar
        ELSE 'already_linked'::varchar
    END;
END;
$$;

REVOKE ALL ON FUNCTION auth_max_login(
    varchar, varchar, bigint, varchar, varchar, text, integer, varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_link(
    uuid, varchar, varchar, bigint, varchar, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_max_login(
    varchar, varchar, bigint, varchar, varchar, text, integer, varchar
) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_link(
    uuid, varchar, varchar, bigint, varchar, varchar
) TO asalab_app;
