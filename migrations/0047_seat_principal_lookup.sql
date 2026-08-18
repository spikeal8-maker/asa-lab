-- Which principal a class seat is.
--
-- The gallery deals in principals: it is the one thing an account holder and a
-- child on a class seat both have, so a wall that both can look at cannot be
-- written against either kind of session. Turning a seat session into its
-- principal needed a read of `principals`, which the runtime role does not have
-- and should not be given — a table that maps every identity on the platform is
-- not something a web process should be able to page through.
--
-- So it gets a door exactly one row wide instead.

CREATE OR REPLACE FUNCTION principal_for_seat(p_seat_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.id FROM public.principals p WHERE p.seat_id = p_seat_id;
$$;

REVOKE ALL ON FUNCTION principal_for_seat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION principal_for_seat(uuid) TO asalab_app;
