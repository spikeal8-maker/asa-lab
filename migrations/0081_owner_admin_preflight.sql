CREATE FUNCTION runtime_owner_admin_ready(p_email varchar)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
      SELECT 1
      FROM public.accounts a
      JOIN public.principals p ON p.account_id = a.id AND p.kind = 'account'
      JOIN public.workspace_memberships m ON m.account_id = a.id AND m.state = 'active'
      JOIN public.workspaces w ON w.id = m.workspace_id AND w.status = 'active'
      JOIN public.capability_grants g
        ON g.account_id = a.id
       AND g.capability = 'platform_admin'
       AND g.state = 'verified'
      WHERE lower(a.email) = lower(trim(p_email))
        AND a.status = 'active'
        AND w.kind = 'personal'
  )
$$;

REVOKE ALL ON FUNCTION runtime_owner_admin_ready(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION runtime_owner_admin_ready(varchar) TO asalab_app;
