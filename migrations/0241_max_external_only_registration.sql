-- Owner decision: native MAX creates a real external-only Account. No fake credentials.
ALTER TABLE public.accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.accounts ALTER COLUMN password_hash DROP NOT NULL;
-- Canonical personal teaching mirrors these real absent credentials into its legacy actor.
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

CREATE OR REPLACE FUNCTION auth_account_bootstrap_internal(
    p_email varchar,
    p_password_hash text,
    p_display_name varchar,
    p_username varchar,
    p_birth_date date,
    p_country varchar,
    p_policy_version varchar,
    p_token_hash text,
    p_ttl_hours integer
)
RETURNS TABLE (account_id uuid, principal_id uuid, workspace_id uuid, tenant_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account uuid;
    v_principal uuid;
    v_tenant uuid;
    v_workspace uuid;
    v_title varchar(255);
BEGIN
    v_title := COALESCE(NULLIF(p_display_name, ''), p_username);
    INSERT INTO public.accounts (email, password_hash, birth_date, country, password_configured)
    VALUES (lower(p_email), p_password_hash, p_birth_date, upper(p_country), p_password_hash IS NOT NULL)
    RETURNING id INTO v_account;
    INSERT INTO public.profiles (account_id, username, display_name)
    VALUES (v_account, lower(p_username), v_title);
    INSERT INTO public.principals (kind, account_id)
    VALUES ('account', v_account)
    RETURNING id INTO v_principal;
    INSERT INTO public.capability_grants
        (account_id, capability, state, policy_version, granted_by)
    VALUES (v_account, 'creator', 'verified', p_policy_version, 'server');
    INSERT INTO public.tenants (workspace_slug, title)
    VALUES ('personal-' || replace(v_account::text, '-', ''), v_title)
    RETURNING id INTO v_tenant;
    INSERT INTO public.tenant_placements (tenant_id, mode)
    VALUES (v_tenant, 'SHARED_CLUSTER');
    INSERT INTO public.workspaces (tenant_id, kind, title)
    VALUES (v_tenant, 'personal', v_title)
    RETURNING id INTO v_workspace;
    INSERT INTO public.workspace_memberships (account_id, workspace_id, role)
    VALUES (v_account, v_workspace, 'owner');
    INSERT INTO public.sessions_v2
        (principal_id, active_workspace_id, token_hash, expires_at)
    VALUES (v_principal, v_workspace, p_token_hash,
            now() + make_interval(hours => p_ttl_hours));
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES (v_tenant, NULL, 'account', v_account, 'account.registered',
            jsonb_build_object('workspaceKind', 'personal',
                               'policyVersion', p_policy_version));
    RETURN QUERY SELECT v_account, v_principal, v_workspace, v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION auth_account_bootstrap_internal(varchar,text,varchar,varchar,date,varchar,varchar,text,integer) FROM PUBLIC, asalab_app;

-- Preserve the ordinary credential boundary. Only the private MAX writer below
-- may call the canonical bootstrap with absent credentials.
CREATE OR REPLACE FUNCTION auth_register_account(
    p_email varchar, p_password_hash text, p_display_name varchar, p_username varchar,
    p_birth_date date, p_country varchar, p_policy_version varchar, p_token_hash text, p_ttl_hours integer
) RETURNS TABLE (account_id uuid, principal_id uuid, workspace_id uuid, tenant_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_email IS NULL OR p_password_hash IS NULL THEN
        RAISE EXCEPTION 'account credentials required' USING ERRCODE='22023';
    END IF;
    RETURN QUERY SELECT * FROM public.auth_account_bootstrap_internal(
        p_email,p_password_hash,p_display_name,p_username,p_birth_date,p_country,p_policy_version,p_token_hash,p_ttl_hours);
END;
$$;

CREATE FUNCTION auth_max_pairing_register_external(
    p_token_hash text, p_nonce_hash text, p_display_name varchar, p_username varchar,
    p_birth_date date, p_country varchar, p_policy_version varchar,
    p_session_hash text, p_ttl_hours integer
) RETURNS TABLE (result varchar, account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_pair public.auth_provider_pairings%ROWTYPE; v_version bigint;
        v_account uuid; v_identity uuid;
BEGIN
    IF p_birth_date IS NULL OR p_birth_date < DATE '1900-01-01'
       OR p_display_name IS NULL OR length(trim(p_display_name)) NOT BETWEEN 1 AND 255
       OR p_username IS NULL OR p_username !~ '^[A-Za-z0-9_.-]{3,40}$'
       OR p_country IS NULL OR upper(p_country) !~ '^[A-Z]{2}$'
       OR p_policy_version IS NULL OR length(p_policy_version) NOT BETWEEN 1 AND 32 THEN
        RETURN QUERY SELECT 'validation_error'::varchar,NULL::uuid; RETURN;
    END IF;
    IF p_birth_date > (current_date - interval '18 years')::date THEN
        RETURN QUERY SELECT 'age_routed'::varchar,NULL::uuid; RETURN;
    END IF;
    IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
       OR p_nonce_hash IS NULL OR p_nonce_hash !~ '^[a-f0-9]{64}$'
       OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$'
       OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 24 THEN
        RETURN QUERY SELECT 'unavailable'::varchar,NULL::uuid; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('auth-provider:max',0));
    SELECT s.configuration_version INTO v_version FROM public.auth_provider_settings s
     WHERE s.provider='max' AND s.enabled;
    SELECT * INTO v_pair FROM public.auth_provider_pairings p
     WHERE p.provider='max' AND p.token_hash=p_token_hash AND p.browser_nonce_hash=p_nonce_hash
     FOR UPDATE;
    IF v_pair.id IS NULL OR v_version IS NULL OR v_pair.configuration_version<>v_version
       OR v_pair.invalidated_at IS NOT NULL OR v_pair.expires_at<=now()
       OR v_pair.consumed_at IS NOT NULL OR v_pair.approved_at IS NULL OR v_pair.purpose='link'
       OR v_pair.provider_subject IS NULL OR v_pair.provider_subject !~ '^[0-9]{1,64}$'
       OR v_pair.assertion_id IS NULL OR v_pair.auth_date IS NULL THEN
        RETURN QUERY SELECT 'unavailable'::varchar,NULL::uuid; RETURN;
    END IF;
    IF EXISTS(SELECT 1 FROM public.account_external_identities i WHERE i.provider='max' AND i.subject=v_pair.provider_subject) THEN
        RETURN QUERY SELECT 'identity_taken'::varchar,NULL::uuid; RETURN;
    END IF;
    IF EXISTS(SELECT 1 FROM public.external_auth_assertions a WHERE a.provider='max' AND a.assertion_id=v_pair.assertion_id) THEN
        RETURN QUERY SELECT 'assertion_replayed'::varchar,NULL::uuid; RETURN;
    END IF;
    SELECT created.account_id INTO v_account FROM public.auth_account_bootstrap_internal(
        NULL,NULL,p_display_name,p_username,p_birth_date,p_country,p_policy_version,p_session_hash,p_ttl_hours) created;
    UPDATE public.sessions_v2 SET client_metadata=jsonb_build_object('authenticationProvider','max') WHERE token_hash=p_session_hash;
    INSERT INTO public.account_external_identities(provider,subject,account_id,username,display_name,last_used_at,verified_at)
    VALUES('max',v_pair.provider_subject,v_account,NULLIF(trim(v_pair.provider_username),''),
           NULLIF(trim(v_pair.provider_display_name),''),now(),now()) RETURNING id INTO v_identity;
    INSERT INTO public.external_auth_assertions(provider,assertion_id,account_id,issued_at)
    VALUES('max',v_pair.assertion_id,v_account,to_timestamp(v_pair.auth_date::double precision));
    INSERT INTO public.account_external_identity_events(identity_id,account_id,provider,event)
    VALUES(v_identity,v_account,'max','verified');
    UPDATE public.auth_provider_pairings SET consumed_at=now() WHERE id=v_pair.id;
    UPDATE public.auth_provider_settings SET
        native_confirmation_configuration_version=v_pair.configuration_version,
        native_confirmation_verified_at=now()
     WHERE provider='max' AND configuration_version=v_pair.configuration_version;
    RETURN QUERY SELECT 'authenticated'::varchar,v_account;
END;
$$;
REVOKE ALL ON FUNCTION auth_max_pairing_register_external(text,text,varchar,varchar,date,varchar,varchar,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_max_pairing_register_external(text,text,varchar,varchar,date,varchar,varchar,text,integer) TO asalab_app;
