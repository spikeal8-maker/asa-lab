-- C1.1 entry flow — universal sign-in and class-code resolution (PR #59 UX review).
--
-- Two additive capabilities the public entry needs and nothing more:
--
--   1. sign in with an email OR a username, because a person should not have
--      to remember which of the two ASA Lab stored;
--   2. resolve a class code into a preview, so a student sees the class before
--      choosing how to identify themselves.
--
-- Resolving a code deliberately creates no membership and no session: it only
-- answers "which class is this". StudentSeat, PIN policy and joining itself
-- stay in their own milestones.

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
-- Class code: a short, human-readable locator for an existing classroom.
-- ---------------------------------------------------------------------------
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS join_code varchar(16);

/**
 * Six characters from an alphabet without look-alikes (no O/0, I/1, L).
 * The code is a locator, never a credential: resolving it grants nothing.
 */
CREATE OR REPLACE FUNCTION classroom_generate_join_code()
RETURNS varchar
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v_code     varchar(16);
    v_index    int;
BEGIN
    LOOP
        v_code := '';
        FOR v_index IN 1..6 LOOP
            v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.classrooms c WHERE c.join_code = v_code);
    END LOOP;
    RETURN v_code;
END;
$$;

-- Existing classrooms get a code so the entry flow works for them too.
DO $$
DECLARE
    v_id uuid;
BEGIN
    FOR v_id IN SELECT id FROM public.classrooms WHERE join_code IS NULL LOOP
        UPDATE public.classrooms SET join_code = public.classroom_generate_join_code() WHERE id = v_id;
    END LOOP;
END;
$$;

ALTER TABLE classrooms ALTER COLUMN join_code SET DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS classrooms_join_code_idx ON classrooms (join_code)
    WHERE join_code IS NOT NULL;

/**
 * Every classroom carries a code from the moment it exists, so a teacher never
 * has to "enable" one. The trigger owns the generation because the runtime
 * role has no rights on the generator itself.
 */
CREATE OR REPLACE FUNCTION classroom_set_join_code()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.join_code IS NULL THEN
        NEW.join_code := public.classroom_generate_join_code();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS classrooms_set_join_code ON classrooms;
CREATE TRIGGER classrooms_set_join_code
    BEFORE INSERT ON classrooms
    FOR EACH ROW EXECUTE FUNCTION classroom_set_join_code();

/**
 * Resolve a class code into a preview.
 *
 * SECURITY DEFINER on purpose: the visitor has no tenant context yet, so
 * row-level security cannot answer for them. The function therefore returns
 * only what the confirmation screen shows — the class title and the teacher's
 * display name — and never the roster, the tenant or any identifier a caller
 * could enumerate from.
 *
 * Spaces, dashes and case are normalized so a code copied from a whiteboard
 * still works.
 */
CREATE OR REPLACE FUNCTION classroom_resolve_join_code(p_code varchar)
RETURNS TABLE (classroom_id uuid, title varchar, educator_display_name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, u.display_name
      FROM public.classrooms c
      JOIN public.users u ON u.tenant_id = c.tenant_id AND u.id = c.created_by
     WHERE c.join_code = upper(regexp_replace(p_code, '[[:space:]-]', '', 'g'))
       AND c.status = 'active'
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION classroom_resolve_join_code(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_generate_join_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_resolve_join_code(varchar) TO asalab_app;
