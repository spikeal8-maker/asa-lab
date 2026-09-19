-- Forward repair for installations which reached 0150 before late migration
-- 0146 was published. Never rewrite 0146 or fabricate its migration ledger row.
DO $forward$
DECLARE
  has_0146 boolean;
  has_blobs boolean;
  has_aliases boolean;
  expected_policy text := $policy$(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)$policy$;
  table_name text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '0146')
    INTO has_0146;
  has_blobs := to_regclass('public.blocks_blobs') IS NOT NULL;
  has_aliases := to_regclass('public.blocks_asset_aliases') IS NOT NULL;

  IF has_0146 THEN
    IF NOT has_blobs OR NOT has_aliases THEN
      RAISE EXCEPTION '0151: recorded 0146 is missing its asset tables';
    END IF;
    -- Preserve all existing data and permissions; reject inconsistent security
    -- instead of silently repairing it as part of this additive upgrade.
    IF (SELECT count(*) FROM pg_class
        WHERE oid IN ('public.blocks_blobs'::regclass,
                      'public.blocks_asset_aliases'::regclass)
          AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity) <> 2
      OR NOT EXISTS (SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.blocks_blobs'::regclass
          AND polname = 'blocks_blobs_tenant' AND polcmd = '*'
          AND polroles = ARRAY[0::oid] AND polpermissive
          AND pg_get_expr(polqual, polrelid) = expected_policy
          AND pg_get_expr(polwithcheck, polrelid) = expected_policy)
      OR NOT EXISTS (SELECT 1 FROM pg_policy
        WHERE polrelid = 'public.blocks_asset_aliases'::regclass
          AND polname = 'blocks_asset_aliases_tenant' AND polcmd = '*'
          AND polroles = ARRAY[0::oid] AND polpermissive
          AND pg_get_expr(polqual, polrelid) = expected_policy
          AND pg_get_expr(polwithcheck, polrelid) = expected_policy)
      OR (SELECT count(*) FROM pg_policy
          WHERE polrelid IN ('public.blocks_blobs'::regclass,
                             'public.blocks_asset_aliases'::regclass)) <> 2
    THEN
      RAISE EXCEPTION '0151: existing asset security differs from recorded 0146';
    END IF;
    FOREACH table_name IN ARRAY ARRAY['public.blocks_blobs', 'public.blocks_asset_aliases'] LOOP
      IF NOT has_table_privilege('asalab_app', table_name, 'SELECT')
        OR NOT has_table_privilege('asalab_app', table_name, 'INSERT')
        OR has_table_privilege('asalab_app', table_name, 'UPDATE')
        OR has_table_privilege('asalab_app', table_name, 'DELETE')
        OR has_table_privilege('asalab_app', table_name, 'TRUNCATE')
      THEN
        RAISE EXCEPTION '0151: existing asset grants differ from recorded 0146';
      END IF;
    END LOOP;
    RETURN;
  END IF;

  IF has_blobs OR has_aliases THEN
    RAISE EXCEPTION '0151: unrecorded or partial asset tables require separate recovery';
  END IF;

  CREATE TABLE public.blocks_blobs (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    sha256 varchar(64) NOT NULL,
    data_format varchar(8) NOT NULL,
    size_bytes bigint NOT NULL,
    object_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sha256, data_format),
    UNIQUE (tenant_id, object_key),
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (data_format IN ('svg', 'png', 'jpg', 'wav', 'mp3')),
    CHECK (size_bytes > 0)
  );
  CREATE TABLE public.blocks_asset_aliases (
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    asset_id varchar(32) NOT NULL,
    data_format varchar(8) NOT NULL,
    sha256 varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, asset_id, data_format),
    FOREIGN KEY (tenant_id, sha256, data_format)
      REFERENCES public.blocks_blobs(tenant_id, sha256, data_format)
      ON DELETE RESTRICT,
    CHECK (asset_id ~ '^[0-9a-f]{32}$'),
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CHECK (data_format IN ('svg', 'png', 'jpg', 'wav', 'mp3'))
  );
  ALTER TABLE public.blocks_blobs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.blocks_blobs FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.blocks_asset_aliases ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.blocks_asset_aliases FORCE ROW LEVEL SECURITY;
  CREATE POLICY blocks_blobs_tenant ON public.blocks_blobs
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  CREATE POLICY blocks_asset_aliases_tenant ON public.blocks_asset_aliases
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  GRANT SELECT, INSERT ON public.blocks_blobs TO asalab_app;
  GRANT SELECT, INSERT ON public.blocks_asset_aliases TO asalab_app;
END;
$forward$;
