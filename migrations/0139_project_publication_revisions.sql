-- R7-01A: immutable Public Projects publication foundation.
--
-- This migration is deliberately additive. Legacy project_publications remains
-- the Gallery compatibility projection until the later convergence slices.
-- No existing publication rows are backfilled here and no Gallery function is
-- changed here.

-- A composite key lets a PublicationRevision prove that an exact version
-- belongs to the same tenant and Project without a validation trigger.
ALTER TABLE project_versions
  ADD CONSTRAINT project_versions_tenant_project_id_id_key
  UNIQUE (tenant_id, project_id, id);

-- Stable publication identity/current state. This survives later revoke and is
-- separate from the legacy Gallery row, which is still destructively removed
-- by gallery_unpublish() until R7-01D.
CREATE TABLE project_publication_state (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  project_id               uuid NOT NULL,
  owner_principal_id       uuid NOT NULL REFERENCES principals(id),
  created_by_principal_id  uuid NOT NULL REFERENCES principals(id),
  state                    varchar(16) NOT NULL DEFAULT 'draft'
                           CHECK (state IN ('draft','public','unlisted','revoked')),
  current_revision_id      uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  published_at             timestamptz,
  revoked_at               timestamptz,
  UNIQUE (tenant_id, project_id),
  UNIQUE (id, tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id)
);

CREATE TABLE project_publication_revisions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id            uuid NOT NULL,
  tenant_id                 uuid NOT NULL,
  project_id                uuid NOT NULL,
  revision_no               integer NOT NULL CHECK (revision_no > 0),
  project_version_id        uuid NOT NULL,
  title                     varchar(255) NOT NULL,
  summary                   text,
  description               text,
  tags                      text[] NOT NULL DEFAULT '{}'::text[],
  license                   varchar(64) NOT NULL DEFAULT 'reserved',
  preview_snapshot_revision integer CHECK (preview_snapshot_revision IS NULL OR preview_snapshot_revision > 0),
  published_by_principal_id uuid NOT NULL REFERENCES principals(id),
  published_at              timestamptz NOT NULL DEFAULT now(),
  schema_version            integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  UNIQUE (publication_id, revision_no),
  UNIQUE (id, publication_id),
  FOREIGN KEY (publication_id, tenant_id, project_id)
    REFERENCES project_publication_state (id, tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id, project_version_id)
    REFERENCES project_versions (tenant_id, project_id, id)
);

-- A live pointer can only target a revision belonging to this publication.
ALTER TABLE project_publication_state
  ADD CONSTRAINT project_publication_state_current_revision_fk
  FOREIGN KEY (current_revision_id, id)
  REFERENCES project_publication_revisions (id, publication_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX project_publication_revisions_project_idx
  ON project_publication_revisions (tenant_id, project_id, revision_no DESC);

CREATE OR REPLACE FUNCTION project_publication_revisions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'project_publication_revisions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_publication_revisions_no_update
  BEFORE UPDATE OR DELETE ON project_publication_revisions
  FOR EACH ROW EXECUTE FUNCTION project_publication_revisions_immutable();

-- No direct application access is opened in R7-01A. Later slices expose only
-- narrowly authorized SECURITY DEFINER mutations and sanitized public reads.
REVOKE ALL ON TABLE project_publication_state FROM PUBLIC;
REVOKE ALL ON TABLE project_publication_state FROM asalab_app;
REVOKE ALL ON TABLE project_publication_revisions FROM PUBLIC;
REVOKE ALL ON TABLE project_publication_revisions FROM asalab_app;
REVOKE ALL ON FUNCTION project_publication_revisions_immutable() FROM PUBLIC;

ALTER TABLE project_publication_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_publication_state FORCE ROW LEVEL SECURITY;
CREATE POLICY project_publication_state_tenant ON project_publication_state
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE project_publication_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_publication_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY project_publication_revisions_tenant ON project_publication_revisions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);