-- Service migration table. Tracks applied schema migrations.
-- Tenant-owned business tables are introduced by later vertical-slice tasks.
CREATE TABLE IF NOT EXISTS schema_migrations (
    id            bigserial PRIMARY KEY,
    version       varchar(64) NOT NULL UNIQUE,
    name          varchar(255) NOT NULL,
    checksum      varchar(128) NOT NULL,
    applied_at    timestamptz NOT NULL DEFAULT now()
);
