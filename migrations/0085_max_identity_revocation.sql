-- Complete the MAX lifecycle with auditable self-service and administrator
-- revocation. Password sessions are deliberately preserved; only session
-- families created through MAX are revoked.

CREATE FUNCTION auth_max_unlink_self(
    p_account_id uuid,
    p_actor_principal_id uuid
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_actor_account_id uuid;
    v_identity_id uuid;
BEGIN
    SELECT p.account_id INTO v_actor_account_id
      FROM public.principals p
     WHERE p.id = p_actor_principal_id;
    IF v_actor_account_id IS DISTINCT FROM p_account_id THEN
        RAISE EXCEPTION 'MAX self-service identity mismatch' USING ERRCODE = '42501';
    END IF;

    SELECT i.id INTO v_identity_id
      FROM public.account_external_identities i
     WHERE i.account_id = p_account_id
       AND i.provider = 'max'
       AND i.revoked_at IS NULL
     FOR UPDATE;
    IF v_identity_id IS NULL THEN RETURN false; END IF;

    UPDATE public.account_external_identities
       SET revoked_at = now(),
           revoked_by_principal_id = p_actor_principal_id,
           revoke_reason = 'self-service unlink'
     WHERE id = v_identity_id;
    INSERT INTO public.account_external_identity_events
        (identity_id, account_id, provider, event, actor_principal_id, reason)
    VALUES
        (v_identity_id, p_account_id, 'max', 'revoked', p_actor_principal_id,
         'self-service unlink');

    UPDATE public.session_refresh_tokens t
       SET revoked_at = COALESCE(t.revoked_at, now())
      FROM public.session_refresh_families f
      JOIN public.sessions_v2 s ON s.id = f.session_id
      JOIN public.principals p ON p.id = s.principal_id
     WHERE t.family_id = f.id
       AND f.source = 'max'
       AND p.account_id = p_account_id;
    UPDATE public.session_refresh_families f
       SET revoked_at = COALESCE(f.revoked_at, now())
      FROM public.sessions_v2 s
      JOIN public.principals p ON p.id = s.principal_id
     WHERE f.session_id = s.id
       AND f.source = 'max'
       AND p.account_id = p_account_id;
    UPDATE public.sessions_v2 s
       SET revoked_at = COALESCE(s.revoked_at, now())
      FROM public.principals p,
           public.session_refresh_families f
     WHERE p.id = s.principal_id
       AND p.account_id = p_account_id
       AND f.session_id = s.id
       AND f.source = 'max';
    RETURN true;
END;
$$;

CREATE FUNCTION admin_max_identity_status(
    p_actor_principal_id uuid,
    p_target_account_id uuid
) RETURNS TABLE (
    linked boolean,
    verified_at timestamptz,
    last_revoked_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative MAX status denied' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT active_identity.id IS NOT NULL,
           active_identity.verified_at,
           history.last_revoked_at
      FROM public.accounts a
      LEFT JOIN LATERAL (
          SELECT i.id, i.verified_at
            FROM public.account_external_identities i
           WHERE i.account_id = a.id
             AND i.provider = 'max'
             AND i.revoked_at IS NULL
           LIMIT 1
      ) active_identity ON true
      LEFT JOIN LATERAL (
          SELECT max(i.revoked_at) AS last_revoked_at
            FROM public.account_external_identities i
           WHERE i.account_id = a.id AND i.provider = 'max'
      ) history ON true
     WHERE a.id = p_target_account_id;
END;
$$;

CREATE FUNCTION admin_revoke_max_identity(
    p_actor_principal_id uuid,
    p_target_account_id uuid,
    p_reason varchar,
    p_request_id varchar
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_identity_id uuid;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative MAX revocation denied' USING ERRCODE = '42501';
    END IF;
    IF length(trim(p_reason)) NOT BETWEEN 3 AND 500
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid MAX revocation request' USING ERRCODE = '22023';
    END IF;

    SELECT i.id INTO v_identity_id
      FROM public.account_external_identities i
     WHERE i.account_id = p_target_account_id
       AND i.provider = 'max'
       AND i.revoked_at IS NULL
     FOR UPDATE;
    IF v_identity_id IS NULL THEN RETURN false; END IF;

    UPDATE public.account_external_identities
       SET revoked_at = now(),
           revoked_by_principal_id = p_actor_principal_id,
           revoke_reason = trim(p_reason)
     WHERE id = v_identity_id;
    INSERT INTO public.account_external_identity_events
        (identity_id, account_id, provider, event, actor_principal_id, reason)
    VALUES
        (v_identity_id, p_target_account_id, 'max', 'revoked',
         p_actor_principal_id, trim(p_reason));

    UPDATE public.session_refresh_tokens t
       SET revoked_at = COALESCE(t.revoked_at, now())
      FROM public.session_refresh_families f
      JOIN public.sessions_v2 s ON s.id = f.session_id
      JOIN public.principals p ON p.id = s.principal_id
     WHERE t.family_id = f.id
       AND f.source = 'max'
       AND p.account_id = p_target_account_id;
    UPDATE public.session_refresh_families f
       SET revoked_at = COALESCE(f.revoked_at, now())
      FROM public.sessions_v2 s
      JOIN public.principals p ON p.id = s.principal_id
     WHERE f.session_id = s.id
       AND f.source = 'max'
       AND p.account_id = p_target_account_id;
    UPDATE public.sessions_v2 s
       SET revoked_at = COALESCE(s.revoked_at, now())
      FROM public.principals p,
           public.session_refresh_families f
     WHERE p.id = s.principal_id
       AND p.account_id = p_target_account_id
       AND f.session_id = s.id
       AND f.source = 'max';

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.max_identity.revoke',
        'account', p_target_account_id::text,
        'admin_console', trim(p_reason), NULL,
        p_request_id, p_request_id, 'succeeded', NULL, NULL
    );
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION auth_max_unlink_self(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_max_identity_status(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_revoke_max_identity(uuid, uuid, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_max_unlink_self(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_max_identity_status(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_revoke_max_identity(uuid, uuid, varchar, varchar) TO asalab_app;
