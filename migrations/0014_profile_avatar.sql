-- Additive profile avatar support. Images are normalized by the web client and
-- constrained to safe raster data URLs; SVG and remote URLs are intentionally
-- excluded.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS avatar_data_url text;

DO $$
BEGIN
    ALTER TABLE profiles
        ADD CONSTRAINT profiles_avatar_data_url_check
        CHECK (
            avatar_data_url IS NULL
            OR (
                octet_length(avatar_data_url) <= 300000
                AND avatar_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
            )
        );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE OR REPLACE FUNCTION auth_account_avatar(p_account_id uuid)
RETURNS TABLE (avatar_data_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.avatar_data_url
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
     WHERE a.id = p_account_id
       AND a.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_update_account_avatar(
    p_account_id uuid,
    p_avatar_data_url text
)
RETURNS TABLE (avatar_data_url text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public.profiles
       SET avatar_data_url = p_avatar_data_url,
           updated_at = now()
     WHERE account_id = p_account_id
       AND EXISTS (
           SELECT 1
             FROM public.accounts a
            WHERE a.id = p_account_id AND a.status = 'active');
    RETURN QUERY
    SELECT * FROM public.auth_account_avatar(p_account_id);
END;
$$;

REVOKE ALL ON FUNCTION auth_account_avatar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_update_account_avatar(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_account_avatar(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_update_account_avatar(uuid, text) TO asalab_app;
