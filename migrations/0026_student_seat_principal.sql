-- A student seat becomes someone who can own work.
--
-- Until now a seat could sign in and be greeted, and that was all it could do:
-- projects belong to a principal, and only an account could be one. A learner
-- therefore had no way to make anything, which is the opposite of the point.
--
-- The seat does not become an account. It has no email, no password, no
-- capabilities and nothing outside its class; it gains exactly one thing — an
-- identity the project tables can point at. Everything already built for
-- personal projects then applies to a learner unchanged, because
-- projects.owner_principal_id and project_context_for_principal were already
-- written against a principal rather than a user (0010, 0022).

ALTER TABLE principals DROP CONSTRAINT IF EXISTS principals_kind_check;
ALTER TABLE principals
    ADD CONSTRAINT principals_kind_check CHECK (kind IN ('account', 'student_seat'));

ALTER TABLE principals ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE principals
    ADD COLUMN IF NOT EXISTS seat_id uuid REFERENCES classroom_student_seats(id);

-- A principal is one subject or the other, never both and never neither.
ALTER TABLE principals DROP CONSTRAINT IF EXISTS principals_subject_check;
ALTER TABLE principals
    ADD CONSTRAINT principals_subject_check CHECK (
        (kind = 'account' AND account_id IS NOT NULL AND seat_id IS NULL)
        OR (kind = 'student_seat' AND seat_id IS NOT NULL AND account_id IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS principals_seat_idx
    ON principals (seat_id) WHERE seat_id IS NOT NULL;

-- Resolves the identity of a seat, creating it the first time the learner
-- needs one. It is created on demand rather than when the teacher issues the
-- seat, so a roster that is never used leaves nothing behind, and a seat
-- created before this migration works the moment its owner signs in.
--
-- The runtime role may not write to principals directly; this is the only door,
-- and it opens only for a seat that still exists and is not suspended.
CREATE OR REPLACE FUNCTION student_seat_principal(p_seat_id uuid)
RETURNS TABLE (principal_id uuid, tenant_id uuid, classroom_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_principal uuid;
    v_tenant    uuid;
    v_classroom uuid;
BEGIN
    SELECT seat.tenant_id, seat.classroom_id
      INTO v_tenant, v_classroom
      FROM public.classroom_student_seats seat
     WHERE seat.id = p_seat_id
       AND seat.status IN ('issued', 'active');
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;

    SELECT principal.id INTO v_principal
      FROM public.principals principal
     WHERE principal.seat_id = p_seat_id;

    IF v_principal IS NULL THEN
        INSERT INTO public.principals (kind, seat_id)
        VALUES ('student_seat', p_seat_id)
        RETURNING id INTO v_principal;
    END IF;

    RETURN QUERY SELECT v_principal, v_tenant, v_classroom;
END;
$$;

REVOKE ALL ON FUNCTION student_seat_principal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION student_seat_principal(uuid) TO asalab_app;
