CREATE TABLE session_refresh_families (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid NOT NULL UNIQUE REFERENCES sessions_v2(id) ON DELETE CASCADE,
    source              varchar(32) NOT NULL CHECK (source IN ('password', 'max', 'organization')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    absolute_expires_at timestamptz NOT NULL,
    revoked_at          timestamptz,
    reuse_detected_at   timestamptz
);

CREATE TABLE session_refresh_tokens (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id      uuid NOT NULL REFERENCES session_refresh_families(id) ON DELETE CASCADE,
    token_hash     text NOT NULL UNIQUE,
    generation     integer NOT NULL CHECK (generation >= 1),
    issued_at      timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,
    used_at        timestamptz,
    replaced_by_id uuid REFERENCES session_refresh_tokens(id),
    revoked_at     timestamptz,
    UNIQUE (family_id, generation)
);

CREATE INDEX session_refresh_tokens_family_active_idx
    ON session_refresh_tokens (family_id, generation DESC)
    WHERE revoked_at IS NULL;

REVOKE ALL ON session_refresh_families, session_refresh_tokens FROM asalab_app;
ALTER TABLE session_refresh_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_refresh_tokens ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION session_refresh_attach(
    p_access_hash text,
    p_refresh_hash text,
    p_source varchar,
    p_ttl_days integer
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_session_id uuid;
    v_family_id uuid;
    v_absolute_expires_at timestamptz;
BEGIN
    IF length(p_access_hash) NOT BETWEEN 32 AND 255
       OR length(p_refresh_hash) NOT BETWEEN 32 AND 255
       OR p_source NOT IN ('password', 'max', 'organization')
       OR p_ttl_days NOT BETWEEN 1 AND 90 THEN
        RETURN false;
    END IF;

    SELECT s.id INTO v_session_id
      FROM public.sessions_v2 s
      JOIN public.principals p ON p.id = s.principal_id
      JOIN public.accounts a ON a.id = p.account_id
     WHERE s.token_hash = p_access_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND a.status = 'active'
     FOR UPDATE OF s;
    IF v_session_id IS NULL THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM public.session_refresh_families f WHERE f.session_id = v_session_id) THEN
        RETURN false;
    END IF;

    v_absolute_expires_at := now() + make_interval(days => p_ttl_days);
    INSERT INTO public.session_refresh_families (session_id, source, absolute_expires_at)
    VALUES (v_session_id, p_source, v_absolute_expires_at)
    RETURNING id INTO v_family_id;
    INSERT INTO public.session_refresh_tokens
        (family_id, token_hash, generation, expires_at)
    VALUES (v_family_id, p_refresh_hash, 1, v_absolute_expires_at);
    RETURN true;
END;
$$;

CREATE FUNCTION session_refresh_rotate(
    p_refresh_hash text,
    p_new_access_hash text,
    p_new_refresh_hash text,
    p_access_ttl_hours integer
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_token public.session_refresh_tokens%ROWTYPE;
    v_family public.session_refresh_families%ROWTYPE;
    v_session public.sessions_v2%ROWTYPE;
    v_account_status varchar;
    v_next_token_id uuid;
BEGIN
    IF length(p_refresh_hash) NOT BETWEEN 32 AND 255
       OR length(p_new_access_hash) NOT BETWEEN 32 AND 255
       OR length(p_new_refresh_hash) NOT BETWEEN 32 AND 255
       OR p_access_ttl_hours NOT BETWEEN 1 AND 24 THEN
        RETURN 'invalid';
    END IF;

    SELECT * INTO v_token
      FROM public.session_refresh_tokens
     WHERE token_hash = p_refresh_hash
     FOR UPDATE;
    IF v_token.id IS NULL THEN RETURN 'invalid'; END IF;

    SELECT * INTO v_family
      FROM public.session_refresh_families
     WHERE id = v_token.family_id
     FOR UPDATE;
    SELECT * INTO v_session
      FROM public.sessions_v2
     WHERE id = v_family.session_id
     FOR UPDATE;
    SELECT a.status INTO v_account_status
      FROM public.principals p
      JOIN public.accounts a ON a.id = p.account_id
     WHERE p.id = v_session.principal_id;

    IF v_token.used_at IS NOT NULL THEN
        -- A second tab can submit the shared cookie while the first tab is
        -- rotating it. During this short grace window the browser retries with
        -- the newly set cookie; an old token used later is a real replay.
        IF v_token.used_at > now() - interval '60 seconds'
           AND v_family.revoked_at IS NULL THEN
            RETURN 'stale';
        END IF;
        UPDATE public.session_refresh_families
           SET revoked_at = COALESCE(revoked_at, now()), reuse_detected_at = now()
         WHERE id = v_family.id;
        UPDATE public.sessions_v2
           SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = v_family.session_id;
        RETURN 'reused';
    END IF;

    IF v_token.revoked_at IS NOT NULL
       OR v_token.expires_at <= now()
       OR v_family.revoked_at IS NOT NULL
       OR v_family.absolute_expires_at <= now()
       OR v_session.revoked_at IS NOT NULL
       OR v_account_status IS DISTINCT FROM 'active' THEN
        UPDATE public.session_refresh_families
           SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = v_family.id;
        UPDATE public.sessions_v2
           SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = v_family.session_id;
        RETURN 'invalid';
    END IF;

    UPDATE public.session_refresh_tokens SET used_at = now() WHERE id = v_token.id;
    UPDATE public.sessions_v2
       SET token_hash = p_new_access_hash,
           expires_at = now() + make_interval(hours => p_access_ttl_hours),
           last_seen_at = now()
     WHERE id = v_family.session_id;
    INSERT INTO public.session_refresh_tokens
        (family_id, token_hash, generation, expires_at)
    VALUES
        (v_family.id, p_new_refresh_hash, v_token.generation + 1, v_family.absolute_expires_at)
    RETURNING id INTO v_next_token_id;
    UPDATE public.session_refresh_tokens
       SET replaced_by_id = v_next_token_id
     WHERE id = v_token.id;
    RETURN 'rotated';
END;
$$;

CREATE FUNCTION session_refresh_revoke(p_refresh_hash text, p_access_hash text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_family_id uuid;
    v_session_id uuid;
BEGIN
    SELECT f.id, f.session_id INTO v_family_id, v_session_id
      FROM public.session_refresh_families f
      LEFT JOIN public.session_refresh_tokens t ON t.family_id = f.id
      LEFT JOIN public.sessions_v2 s ON s.id = f.session_id
     WHERE t.token_hash = p_refresh_hash OR s.token_hash = p_access_hash
     ORDER BY t.generation DESC NULLS LAST
     LIMIT 1
     FOR UPDATE OF f;
    IF v_family_id IS NULL THEN RETURN false; END IF;
    UPDATE public.session_refresh_families
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = v_family_id;
    UPDATE public.session_refresh_tokens
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE family_id = v_family_id AND revoked_at IS NULL;
    UPDATE public.sessions_v2
       SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = v_session_id;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION session_refresh_attach(text, text, varchar, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_refresh_rotate(text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_refresh_revoke(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_refresh_attach(text, text, varchar, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_refresh_rotate(text, text, text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_refresh_revoke(text, text) TO asalab_app;
