-- Native MAX bot confirmation for passwordless sign-in and account linking.
-- The browser keeps only a short-lived random capability. MAX returns that
-- capability in a signed webhook together with its own immutable user id.

ALTER TABLE max_browser_pairings
    ADD COLUMN requested_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

CREATE FUNCTION auth_max_pairing_start(
    p_token_hash text,
    p_ttl_minutes integer,
    p_requested_account_id uuid
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF length(p_token_hash) NOT BETWEEN 32 AND 255 OR p_ttl_minutes NOT BETWEEN 1 AND 15 THEN
        RETURN false;
    END IF;
    IF p_requested_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.accounts account
         WHERE account.id = p_requested_account_id AND account.status = 'active'
    ) THEN
        RETURN false;
    END IF;
    DELETE FROM public.max_browser_pairings
     WHERE expires_at < now() - interval '1 hour' OR consumed_at < now() - interval '1 hour';
    INSERT INTO public.max_browser_pairings (token_hash, expires_at, requested_account_id)
    VALUES (
        p_token_hash,
        now() + make_interval(mins => p_ttl_minutes),
        p_requested_account_id
    );
    RETURN true;
END;
$$;

CREATE FUNCTION auth_max_pairing_target(p_token_hash text)
RETURNS TABLE (result varchar, requested_account_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_pairing public.max_browser_pairings%ROWTYPE;
BEGIN
    SELECT * INTO v_pairing
      FROM public.max_browser_pairings pairing
     WHERE pairing.token_hash = p_token_hash
     FOR UPDATE;
    IF v_pairing.id IS NULL THEN
        RETURN QUERY SELECT 'invalid'::varchar, NULL::uuid;
    ELSIF v_pairing.expires_at <= now() THEN
        RETURN QUERY SELECT 'expired'::varchar, NULL::uuid;
    ELSIF v_pairing.consumed_at IS NOT NULL THEN
        RETURN QUERY SELECT 'consumed'::varchar, NULL::uuid;
    ELSIF v_pairing.approved_account_id IS NOT NULL THEN
        RETURN QUERY SELECT 'approved'::varchar, v_pairing.requested_account_id;
    ELSE
        RETURN QUERY SELECT 'pending'::varchar, v_pairing.requested_account_id;
    END IF;
END;
$$;

-- Registration through the older helper creates a normal session. A bot
-- pairing must instead create its browser session only when the original tab
-- consumes the capability, so discard the inaccessible provisional session.
CREATE FUNCTION auth_max_discard_provisional_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer;
BEGIN
    UPDATE public.sessions_v2 session
       SET revoked_at = COALESCE(session.revoked_at, now())
     WHERE session.token_hash = p_token_hash
       AND session.client_metadata ->> 'authenticationProvider' = 'max';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION auth_max_pairing_start(text, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_pairing_target(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_discard_provisional_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_max_pairing_start(text, integer, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_pairing_target(text) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_discard_provisional_session(text) TO asalab_app;
