-- ASA Chess is an active project module and uses the same project shell,
-- mutable draft and immutable checkpoint tables as Electronics.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_module_key_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_module_key_check
  CHECK (module_key IN ('electronics', 'chess'));
