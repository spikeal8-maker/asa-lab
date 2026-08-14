-- ASA 3D becomes a first-party Project Core module. Keep the database
-- allow-list aligned with the server registry so unsupported arbitrary module
-- keys remain impossible to persist.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_module_key_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_module_key_check
  CHECK (module_key IN ('electronics', 'chess', 'three-d'));
