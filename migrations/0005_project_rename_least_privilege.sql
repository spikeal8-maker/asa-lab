-- Correct the broad UPDATE grant introduced by migration 0004 without changing
-- the checksum of an already-applied migration. The runtime role may rename a
-- project, but ownership, tenant lineage, classroom/scope, module identity,
-- status, idempotency metadata and timestamps remain immutable through direct
-- runtime SQL.

REVOKE UPDATE ON projects FROM asalab_app;
GRANT UPDATE (title) ON projects TO asalab_app;
