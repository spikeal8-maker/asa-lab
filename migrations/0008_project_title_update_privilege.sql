-- The runtime role may rename an accessible project, but may not mutate any
-- other project column. Row-level security and repository ownership checks
-- continue to restrict which rows can be renamed.
REVOKE UPDATE ON TABLE projects FROM asalab_app;
GRANT UPDATE (title) ON TABLE projects TO asalab_app;
