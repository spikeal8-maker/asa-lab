-- A picture of the project as its editor actually draws it.
--
-- The computed figure on the draft (0024) is derived from the document and is
-- always current, but it is a diagram of the work rather than a view of it: a
-- 3D scene becomes a plan, a circuit becomes coloured blocks. A learner
-- recognises their own project by how it looked on screen, so the editor also
-- uploads a raster snapshot of its own canvas and the card prefers it.
--
-- The snapshot lives in its own table rather than beside the document. It is
-- written on a different schedule from the draft, it is one to two orders of
-- magnitude larger than a preview figure, and every list query joins the draft
-- row — pulling image bytes into that join would put a megabyte on the busiest
-- screen in the product. Cards receive a URL; only that URL fetches the bytes.
--
-- Raster only, and only the two formats a browser canvas produces. SVG is
-- excluded on purpose: these images are uploaded by one learner and displayed
-- to classmates and teachers, and an SVG is a document that can carry script
-- and remote references. The same rule already governs profile avatars.

CREATE TABLE IF NOT EXISTS project_snapshots (
    project_id      uuid NOT NULL,
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    image           bytea NOT NULL,
    content_type    varchar(24) NOT NULL,
    width           integer NOT NULL,
    height          integer NOT NULL,
    -- The draft revision this picture was taken from. It makes the delivery URL
    -- change whenever the work changes, so the image itself can be cached
    -- forever, and it lets a reader tell a current snapshot from a stale one.
    source_revision integer NOT NULL,
    captured_at     timestamptz NOT NULL DEFAULT now(),
    captured_by     uuid,
    captured_by_principal_id uuid NOT NULL REFERENCES principals(id),
    PRIMARY KEY (project_id),
    UNIQUE (tenant_id, project_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    CONSTRAINT project_snapshots_format_check
        CHECK (content_type IN ('image/png', 'image/webp')),
    -- A card is a thumbnail. These bounds are the last line after the
    -- application's own validation, so a bug there cannot fill the table.
    CONSTRAINT project_snapshots_size_check
        CHECK (octet_length(image) BETWEEN 64 AND 262144),
    CONSTRAINT project_snapshots_dimensions_check
        CHECK (width BETWEEN 16 AND 2048 AND height BETWEEN 16 AND 2048),
    CONSTRAINT project_snapshots_revision_check
        CHECK (source_revision > 0)
);

GRANT SELECT, INSERT, UPDATE ON project_snapshots TO asalab_app;

ALTER TABLE project_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_snapshots FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_snapshots_tenant ON project_snapshots;
CREATE POLICY project_snapshots_tenant ON project_snapshots
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
