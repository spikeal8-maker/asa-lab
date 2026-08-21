-- Administrative Control Plane: safe, read-only platform operations status.
--
-- The function deliberately returns aggregates and migration metadata only.
-- Database addresses, credentials, session tokens, IP addresses and user
-- content never cross this boundary.

CREATE OR REPLACE FUNCTION admin_get_operations_status(
    p_actor_principal_id uuid
) RETURNS TABLE (
    database_time timestamptz,
    migration_version varchar,
    migration_name varchar,
    migration_applied_at timestamptz,
    total_account_count bigint,
    active_account_count bigint,
    suspended_account_count bigint,
    organization_count bigint,
    active_session_count bigint,
    audit_event_count_24h bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative operations scope denied' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT now(),
           migration.version,
           migration.name,
           migration.applied_at,
           (SELECT count(*)::bigint FROM public.accounts),
           (SELECT count(*)::bigint FROM public.accounts a WHERE a.status = 'active'),
           (SELECT count(*)::bigint FROM public.accounts a WHERE a.status = 'suspended'),
           (SELECT count(*)::bigint
              FROM public.workspaces w
             WHERE w.kind = 'organization' AND w.status = 'active'),
           (SELECT count(*)::bigint
              FROM public.sessions_v2 s
             WHERE s.revoked_at IS NULL AND s.expires_at > now()),
           (SELECT count(*)::bigint
              FROM public.administrative_audit_events e
             WHERE e.occurred_at >= now() - interval '24 hours')
      FROM LATERAL (
          SELECT m.version, m.name, m.applied_at
            FROM public.schema_migrations m
           ORDER BY m.applied_at DESC, m.id DESC
           LIMIT 1
      ) migration;
END;
$$;

REVOKE ALL ON FUNCTION admin_get_operations_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_operations_status(uuid) TO asalab_app;
