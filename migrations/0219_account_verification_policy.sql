-- Optional one-time Account confirmation after the first 24 hours. Provider
-- availability is evaluated by the API; it never changes password/proof checks.
CREATE TABLE account_verification_policy (
    singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
    enabled boolean NOT NULL DEFAULT false,
    activated_at timestamptz,
    configuration_version bigint NOT NULL DEFAULT 1,
    updated_by_principal uuid REFERENCES principals(id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT enabled OR activated_at IS NOT NULL)
);
INSERT INTO account_verification_policy (singleton_key) VALUES (true);
ALTER TABLE account_verification_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_verification_policy FROM PUBLIC, asalab_app;

CREATE FUNCTION auth_verification_policy()
RETURNS TABLE (enabled boolean, activated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.enabled, p.activated_at
      FROM public.account_verification_policy p WHERE p.singleton_key;
$$;

CREATE FUNCTION auth_account_verification_state(p_account_id uuid)
RETURNS TABLE (
    enabled boolean,
    activated_at timestamptz,
    first_authenticated_at timestamptz,
    verified_provider varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT settings.enabled, settings.activated_at,
           COALESCE(a.first_authenticated_at, a.created_at),
           CASE WHEN a.email_verification_state = 'verified' THEN 'email'::varchar
                ELSE identity.provider END
      FROM public.accounts a
      CROSS JOIN public.account_verification_policy settings
      LEFT JOIN LATERAL (
          SELECT i.provider FROM public.account_external_identities i
           WHERE i.account_id = a.id
             AND i.provider IN ('max', 'telegram')
             AND i.revoked_at IS NULL AND i.verified_at IS NOT NULL
           ORDER BY i.verified_at, i.id LIMIT 1
      ) identity ON true
     WHERE a.id = p_account_id AND a.status = 'active' AND settings.singleton_key;
$$;

-- Runtime bearer requests resolve their already-authorized principal here.
-- StudentSeat principals have no Account and retain their existing access path.
CREATE FUNCTION auth_verification_principal_account(p_principal_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.account_id FROM public.principals p WHERE p.id = p_principal_id;
$$;

CREATE FUNCTION admin_get_verification_policy(p_actor_principal_id uuid)
RETURNS TABLE (enabled boolean, activated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative verification policy denied' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT p.enabled, p.activated_at
        FROM public.account_verification_policy p WHERE p.singleton_key;
END;
$$;

CREATE FUNCTION admin_set_verification_policy(
    p_actor_principal_id uuid, p_enabled boolean, p_request_id varchar
)
RETURNS TABLE (enabled boolean, activated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_before bigint; v_after bigint;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative verification policy denied' USING ERRCODE = '42501';
    END IF;
    IF p_enabled IS NULL OR p_request_id IS NULL
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid verification policy request' USING ERRCODE = '22023';
    END IF;
    SELECT p.configuration_version INTO STRICT v_before
      FROM public.account_verification_policy p WHERE p.singleton_key FOR UPDATE;
    UPDATE public.account_verification_policy p
       SET enabled = p_enabled,
           activated_at = CASE WHEN p_enabled THEN COALESCE(p.activated_at, now())
                               ELSE p.activated_at END,
           configuration_version = p.configuration_version + 1,
           updated_by_principal = p_actor_principal_id,
           updated_at = now()
     WHERE p.singleton_key RETURNING p.configuration_version INTO v_after;
    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.verification_policy.update', 'authentication', 'verification',
        'admin_console', CASE WHEN p_enabled THEN 'Require account confirmation after 24 hours'
                             ELSE 'Disable required account confirmation' END,
        NULL, p_request_id, p_request_id, 'succeeded', v_before, v_after
    );
    RETURN QUERY SELECT p.enabled, p.activated_at
        FROM public.account_verification_policy p WHERE p.singleton_key;
END;
$$;

REVOKE ALL ON FUNCTION auth_verification_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_verification_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_verification_principal_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_verification_policy(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_verification_policy(uuid, boolean, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_verification_policy() TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_verification_state(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_verification_principal_account(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_get_verification_policy(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_set_verification_policy(uuid, boolean, varchar) TO asalab_app;
