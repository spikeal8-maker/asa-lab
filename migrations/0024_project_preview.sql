-- Project cards show a picture of the work, not just its title.
--
-- The preview lives on the draft rather than being derived when a list is
-- requested. The project list is the screen every visitor opens, and deriving
-- would mean fetching and parsing every document on every request, in the
-- server process, for a picture that only changes when the document changes.
-- Writing it once per save costs a single JSON encode on a path that is already
-- writing the document itself.
--
-- The column is nullable on purpose. Drafts written before this migration have
-- no preview, and a project whose module draws nothing yet (an empty circuit,
-- an empty scene) stores none either; both cases fall back to the summary line
-- the card already shows.

ALTER TABLE project_drafts
    ADD COLUMN IF NOT EXISTS preview_json jsonb;

-- The fingerprint the client compares to decide whether a cached card is still
-- current. Kept beside the preview so a list query never has to hash anything.
ALTER TABLE project_drafts
    ADD COLUMN IF NOT EXISTS preview_digest varchar(32);
