-- R7-01C: converge legacy Gallery publications without destroying compatibility state.
--
-- Existing project_publications rows remain the stable compatibility anchor because
-- project_reactions and collection_items still reference project_id there with
-- ON DELETE CASCADE. This migration builds canonical publication state beside
-- those rows; destructive unpublish semantics are changed only in R7-01D.

ALTER TABLE project_publication_revisions
  ADD COLUMN legacy_convergence boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN project_publication_revisions.legacy_convergence IS
  'True only when R7-01C captured convergence-time project state for a legacy Gallery publication; it is not a claim about the historical published document.';

DO $$
DECLARE
  legacy record;
  publication_id uuid;
  current_revision_id uuid;
  project_version_id uuid;
  next_version_no integer;
  next_revision_no integer;
BEGIN
  FOR legacy IN
    SELECT pub.project_id,
           pub.tenant_id,
           pub.owner_principal_id,
           pub.published_by_principal_id,
           pub.title,
           pub.snapshot_revision,
           pub.published_at,
           project.description,
           project.tags,
           project.license,
           draft.document_json
      FROM public.project_publications pub
      JOIN public.projects project
        ON project.tenant_id = pub.tenant_id
       AND project.id = pub.project_id
      JOIN public.project_drafts draft
        ON draft.tenant_id = pub.tenant_id
       AND draft.project_id = pub.project_id
     ORDER BY pub.project_id
  LOOP
    publication_id := NULL;
    current_revision_id := NULL;
    project_version_id := NULL;

    SELECT state.id, state.current_revision_id
      INTO publication_id, current_revision_id
      FROM public.project_publication_state state
     WHERE state.tenant_id = legacy.tenant_id
       AND state.project_id = legacy.project_id
     FOR UPDATE;

    IF publication_id IS NULL THEN
      INSERT INTO public.project_publication_state
          (tenant_id, project_id, owner_principal_id, created_by_principal_id,
           state, created_at, published_at, revoked_at)
      VALUES
          (legacy.tenant_id, legacy.project_id, legacy.owner_principal_id,
           legacy.published_by_principal_id, 'public', legacy.published_at,
           legacy.published_at, NULL)
      RETURNING id, current_revision_id
           INTO publication_id, current_revision_id;
    END IF;

    -- R7-01B already wrote an exact immutable revision for republished work.
    -- Never replace that stronger evidence with a convergence approximation.
    IF current_revision_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    SELECT version.id
      INTO project_version_id
      FROM public.project_versions version
     WHERE version.tenant_id = legacy.tenant_id
       AND version.project_id = legacy.project_id
       AND version.document_json = legacy.document_json
     ORDER BY version.version_no DESC
     LIMIT 1;

    IF project_version_id IS NULL THEN
      SELECT COALESCE(max(version.version_no), 0) + 1
        INTO next_version_no
        FROM public.project_versions version
       WHERE version.tenant_id = legacy.tenant_id
         AND version.project_id = legacy.project_id;

      INSERT INTO public.project_versions
          (tenant_id, project_id, version_no, document_json, label,
           created_by_principal_id)
      VALUES
          (legacy.tenant_id, legacy.project_id, next_version_no,
           legacy.document_json, 'Legacy publication convergence',
           legacy.published_by_principal_id)
      RETURNING id INTO project_version_id;
    END IF;

    SELECT COALESCE(max(revision.revision_no), 0) + 1
      INTO next_revision_no
      FROM public.project_publication_revisions revision
     WHERE revision.publication_id = publication_id;

    INSERT INTO public.project_publication_revisions
        (publication_id, tenant_id, project_id, revision_no,
         project_version_id, title, description, tags, license,
         preview_snapshot_revision, published_by_principal_id, published_at,
         legacy_convergence)
    VALUES
        (publication_id, legacy.tenant_id, legacy.project_id, next_revision_no,
         project_version_id, legacy.title, legacy.description,
         COALESCE(legacy.tags, '{}'::text[]),
         COALESCE(legacy.license, 'reserved'), legacy.snapshot_revision,
         legacy.published_by_principal_id, legacy.published_at, true)
    RETURNING id INTO current_revision_id;

    UPDATE public.project_publication_state
       SET current_revision_id = current_revision_id,
           state = 'public',
           published_at = COALESCE(published_at, legacy.published_at),
           revoked_at = NULL
     WHERE id = publication_id;
  END LOOP;
END;
$$;
