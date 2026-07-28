-- R1 / C1.1 entry flow — universal sign-in and class codes.
--
-- Two additive capabilities the public entry needs, and nothing more:
--
--   1. sign in with an email OR a username, because a person should not have
--      to remember which of the two ASA Lab stored;
--   2. resolve a class code into a preview, so a student sees which class they
--      are about to enter before being asked who they are.
--
-- Resolving a code creates no membership, no session and no seat. StudentSeat,
-- PIN policy, roster and the teacher-facing code lifecycle stay in their own
-- milestones.
--
-- A class code is never stored in readable form: the application generates it
-- with a CSPRNG, keeps only a keyed digest here, and shows the code exactly
-- once — at issue or rotation.

-- ---------------------------------------------------------------------------
-- Universal sign-in: look up an account by its pseudonym.
-- ---------------------------------------------------------------------------
/** Password verification by username; mirrors auth_find_account by email. */
CREATE OR REPLACE FUNCTION auth_find_account_by_username(p_username_lower varchar)
RETURNS TABLE (id uuid, email varchar, password_hash text, status varchar, email_verification_state varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.email, a.password_hash, a.status, a.email_verification_state
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
     WHERE lower(p.username) = p_username_lower AND a.status = 'active'
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_find_account_by_username(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_account_by_username(varchar) TO asalab_app;

-- ---------------------------------------------------------------------------
-- Class codes: versioned, digest-only, rotatable.
-- ---------------------------------------------------------------------------
/**
 * One row per issued class code.
 *
 * `lookup_digest` is a keyed digest (HMAC with a server-side pepper) of the
 * normalized code, so a copy of the database alone does not reveal a working
 * code. The plaintext code is never written here.
 */
CREATE TABLE IF NOT EXISTS classroom_join_codes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    classroom_id  uuid NOT NULL,
    version       integer NOT NULL,
    lookup_digest text    NOT NULL,
    status        varchar(16) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'revoked', 'expired')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    rotated_at    timestamptz,
    revoked_at    timestamptz,
    expires_at    timestamptz,
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    UNIQUE (classroom_id, version)
);
-- A digest resolves to at most one class, and a class has at most one active
-- code: rotation is therefore a replacement, not an accumulation.
CREATE UNIQUE INDEX IF NOT EXISTS classroom_join_codes_digest_idx
    ON classroom_join_codes (lookup_digest) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS classroom_join_codes_one_active_idx
    ON classroom_join_codes (classroom_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS classroom_join_codes_classroom_idx
    ON classroom_join_codes (tenant_id, classroom_id);

-- The runtime role reaches codes only through the functions below.
ALTER TABLE classroom_join_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_join_codes FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON classroom_join_codes FROM asalab_app;

/**
 * Issue a code for a classroom: the previous active code is rotated out in the
 * same statement, so exactly one code is valid at a time.
 *
 * The caller supplies the digest of a code it generated with a CSPRNG. The
 * database never sees the code and never invents one.
 */
CREATE OR REPLACE FUNCTION classroom_issue_join_code(
    p_tenant_id uuid,
    p_classroom_id uuid,
    p_lookup_digest text
)
RETURNS TABLE (join_code_id uuid, version integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_version integer;
    v_id      uuid;
BEGIN
    UPDATE public.classroom_join_codes
       SET status = 'revoked', rotated_at = now(), revoked_at = now()
     WHERE classroom_id = p_classroom_id AND status = 'active';

    SELECT COALESCE(max(c.version), 0) + 1 INTO v_version
      FROM public.classroom_join_codes c
     WHERE c.classroom_id = p_classroom_id;

    INSERT INTO public.classroom_join_codes (tenant_id, classroom_id, version, lookup_digest)
    VALUES (p_tenant_id, p_classroom_id, v_version, p_lookup_digest)
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_id, v_version;
END;
$$;

/** Revoke the active code of a classroom without issuing a new one. */
CREATE OR REPLACE FUNCTION classroom_revoke_join_code(p_tenant_id uuid, p_classroom_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE public.classroom_join_codes
       SET status = 'revoked', revoked_at = now()
     WHERE tenant_id = p_tenant_id AND classroom_id = p_classroom_id AND status = 'active';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

/**
 * Resolve an active digest into a class preview.
 *
 * SECURITY DEFINER on purpose: the visitor has no tenant context yet, so
 * row-level security cannot answer for them. The function returns only what
 * the confirmation screen shows — the class title, the teacher's display name
 * and the code version the answer was built from — and grants nothing.
 */
CREATE OR REPLACE FUNCTION classroom_resolve_join_digest(p_lookup_digest text)
RETURNS TABLE (classroom_id uuid, tenant_id uuid, title varchar, educator_display_name varchar, code_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.tenant_id, c.title, u.display_name, j.version
      FROM public.classroom_join_codes j
      JOIN public.classrooms c ON c.tenant_id = j.tenant_id AND c.id = j.classroom_id
      JOIN public.users u ON u.tenant_id = c.tenant_id AND u.id = c.created_by
     WHERE j.lookup_digest = p_lookup_digest
       AND j.status = 'active'
       AND (j.expires_at IS NULL OR j.expires_at > now())
       AND c.status = 'active'
     LIMIT 1;
$$;

/**
 * Preview of a class the server has already identified from a verified
 * join-intent token. It takes an identifier the browser never saw, so it can
 * only be reached through a token the server itself signed.
 */
CREATE OR REPLACE FUNCTION classroom_preview_by_id(p_classroom_id uuid)
RETURNS TABLE (classroom_id uuid, tenant_id uuid, title varchar, educator_display_name varchar, code_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.tenant_id, c.title, u.display_name,
           (SELECT j.version FROM public.classroom_join_codes j
             WHERE j.classroom_id = c.id AND j.status = 'active' LIMIT 1)
      FROM public.classrooms c
      JOIN public.users u ON u.tenant_id = c.tenant_id AND u.id = c.created_by
     WHERE c.id = p_classroom_id AND c.status = 'active'
     LIMIT 1;
$$;

/** Is this class-code version still the active one? Used to check a join intent. */
CREATE OR REPLACE FUNCTION classroom_join_code_version_active(
    p_classroom_id uuid,
    p_version integer
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.classroom_join_codes j
         WHERE j.classroom_id = p_classroom_id
           AND j.version = p_version
           AND j.status = 'active'
           AND (j.expires_at IS NULL OR j.expires_at > now()));
$$;

/** Count of active codes in the database, for start-up safety checks. */
CREATE OR REPLACE FUNCTION classroom_active_join_code_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT count(*)::int FROM public.classroom_join_codes WHERE status = 'active';
$$;

REVOKE ALL ON FUNCTION classroom_issue_join_code(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_revoke_join_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_resolve_join_digest(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_preview_by_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_join_code_version_active(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_active_join_code_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_issue_join_code(uuid, uuid, text) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_revoke_join_code(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_resolve_join_digest(text) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_preview_by_id(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_join_code_version_active(uuid, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_active_join_code_count() TO asalab_app;
