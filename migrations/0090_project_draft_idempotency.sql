-- A retried draft request must return the revision it already created instead
-- of incrementing the project twice. Existing documents and revisions stay
-- untouched; NULL means the row predates this contract.

ALTER TABLE project_drafts
    ADD COLUMN IF NOT EXISTS last_mutation_id uuid;
