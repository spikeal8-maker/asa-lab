-- ASA Checkers is an active first-party Project Core module. Keep the
-- database allow-list aligned with the server registry while continuing to
-- reject arbitrary module keys.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_module_key_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_module_key_check
  CHECK (module_key IN ('electronics', 'chess', 'three-d', 'checkers'));
