-- Blocks Project Core schema support.
-- This migration permits the module key without activating the product module;
-- runtime/product availability remains controlled by the module registry milestone gate.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_module_key_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_module_key_check
  CHECK (module_key IN ('electronics', 'chess', 'three-d', 'checkers', 'blocks'));
