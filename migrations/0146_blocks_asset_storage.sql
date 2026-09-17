-- VSCR-M1-005B: tenant-private immutable Scratch asset metadata.
-- Physical object bytes live in the configured private S3-compatible store;
-- project documents keep only logical digests/size and never an object key.

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
  created_at timestamptz NOT NULL DEFAULT now(),  PRIMARY KEY (tenant_id, asset_id, data_format),
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