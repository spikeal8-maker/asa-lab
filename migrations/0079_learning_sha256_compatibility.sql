-- PostgreSQL provides sha256(bytea) in core, while digest(bytea, text) belongs
-- to the optional pgcrypto extension. The assessment foundation must run on
-- the stock PostgreSQL image, so provide the narrow algorithm contract it uses
-- without installing an extension or weakening the digest to MD5.

CREATE OR REPLACE FUNCTION learning_digest_sha256(
    p_value bytea,
    p_algorithm text
)
RETURNS bytea
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF lower(p_algorithm) <> 'sha256' THEN
        RAISE EXCEPTION 'unsupported learning digest algorithm: %', p_algorithm;
    END IF;
    RETURN sha256(p_value);
END;
$$;

-- The already-published 0077 function names digest() in its stored body. The
-- public schema is not writable by PUBLIC (enforced since migration 0002), so
-- this compatibility alias is safe in the SECURITY DEFINER search path.
CREATE OR REPLACE FUNCTION digest(bytea, text)
RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.learning_digest_sha256($1, $2);
$$;

ALTER FUNCTION learning_project_submission_create(uuid, uuid, varchar)
    SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION learning_digest_sha256(bytea, text) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION digest(bytea, text) FROM PUBLIC, asalab_app;
