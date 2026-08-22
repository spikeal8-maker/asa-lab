CREATE OR REPLACE FUNCTION runtime_schema_version()
RETURNS TABLE(version integer, name text, applied_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT sm.version::integer, sm.name, sm.applied_at
  FROM public.schema_migrations AS sm
  ORDER BY sm.version::integer DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION runtime_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION runtime_schema_version() TO asalab_app;
