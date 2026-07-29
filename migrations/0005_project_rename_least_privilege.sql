-- Correct broad UPDATE grants introduced by migrations 0003/0004 without
-- changing checksums of already-applied migrations.
--
-- The runtime role may:
--   * rename a project through projects.title;
--   * update the mutable draft document, revision metadata and editor identity.
--
-- It may not rewrite project/draft ownership, tenant lineage, project identity,
-- classroom/scope, module identity, idempotency metadata or creation metadata
-- through direct runtime SQL. Row-level tenant policies remain in force.

REVOKE UPDATE ON projects FROM asalab_app;
GRANT UPDATE (title) ON projects TO asalab_app;

REVOKE UPDATE ON project_drafts FROM asalab_app;
GRANT UPDATE (document_json, revision, updated_at, updated_by)
  ON project_drafts TO asalab_app;
