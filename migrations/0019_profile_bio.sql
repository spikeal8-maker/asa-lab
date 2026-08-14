-- Public-facing profile biography. The existing profile functions remain in
-- place for compatibility; V2 functions expose the additional field without
-- changing an already-published SQL signature.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS bio varchar(960) NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION auth_account_profile_v2(p_account_id uuid)
RETURNS TABLE (
    email varchar,
    email_verification_state varchar,
    username varchar,
    display_name varchar,
    bio varchar,
    birth_date date,
    country varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.email, a.email_verification_state, p.username, p.display_name,
           p.bio, a.birth_date, a.country
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
     WHERE a.id = p_account_id
       AND a.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_update_account_profile_v2(
    p_account_id uuid,
    p_username varchar,
    p_display_name varchar,
    p_bio varchar
)
RETURNS TABLE (
    email varchar,
    email_verification_state varchar,
    username varchar,
    display_name varchar,
    bio varchar,
    birth_date date,
    country varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public.profiles
       SET username = lower(trim(p_username)),
           display_name = trim(p_display_name),
           bio = trim(p_bio),
           updated_at = now()
     WHERE account_id = p_account_id
       AND EXISTS (
           SELECT 1
             FROM public.accounts a
            WHERE a.id = p_account_id AND a.status = 'active');
    RETURN QUERY
    SELECT * FROM public.auth_account_profile_v2(p_account_id);
END;
$$;

REVOKE ALL ON FUNCTION auth_account_profile_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_update_account_profile_v2(uuid, varchar, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_account_profile_v2(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_update_account_profile_v2(uuid, varchar, varchar, varchar) TO asalab_app;
