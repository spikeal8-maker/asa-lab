-- C3 / #1127: provenance preserved across ordinary Project duplicates.
-- Database version frontier 0322; this is the only forward migration.
-- Existing copy receipts are durable and remain untouched.
LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;

-- Strictly private platform-writer/lineage coverage, NOT a claim of human originality.
-- Historical rows and legacy/direct SQL writers retain 'unknown' without backfill.
ALTER TABLE public.projects
  ADD COLUMN writer_lineage_coverage varchar(12) NOT NULL DEFAULT 'unknown'
    CONSTRAINT projects_writer_lineage_coverage_check
      CHECK (writer_lineage_coverage IN ('unknown','v1'));

-- Private trusted server operation identity, never a public API flag. The
-- database default for legacy/direct SQL writers is unknown, not acquisition.
ALTER TABLE public.projects
  ADD COLUMN writer_operation varchar(20) NOT NULL DEFAULT 'unknown'
    CONSTRAINT projects_writer_operation_check
      CHECK (writer_operation IN ('unknown','native','public_acquisition','ordinary_duplicate'));

CREATE FUNCTION public.projects_writer_lineage_coverage_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF NEW.writer_lineage_coverage IS DISTINCT FROM OLD.writer_lineage_coverage
     OR NEW.writer_operation IS DISTINCT FROM OLD.writer_operation THEN
    RAISE EXCEPTION 'immutable project writer evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_writer_lineage_coverage_immutable BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_writer_lineage_coverage_immutable();
REVOKE ALL ON FUNCTION public.projects_writer_lineage_coverage_immutable() FROM PUBLIC,asalab_app;

-- 0287's original AFTER INSERT trigger cannot distinguish a fresh acquisition
-- from a later ordinary duplicate carrying the same immutable eight origin fields.
-- Do not rewrite 0287 or remove its historical receipt data or zero-arg function.
DROP TRIGGER record_publication_copy_created ON public.projects;

-- Explicit trusted-server acquisition receipt; no public request flag, raw-table
-- grant, new Project writer or speculative historical recovery.
-- Called ONLY for a newly inserted public-copy destination in the private
-- PgProjectRepository.createWithDraft branch, inside its existing transaction.
CREATE FUNCTION public.record_publication_copy_acquisition(
  p_actor uuid, p_destination uuid, p_publication uuid, p_revision uuid
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_project public.projects%ROWTYPE;
  v_origin_valid boolean;
  v_existing uuid;
BEGIN
  IF p_actor IS NULL OR p_destination IS NULL
     OR p_publication IS NULL OR p_revision IS NULL THEN
    RAISE EXCEPTION 'copy acquisition requires exact identifiers' USING ERRCODE='42501';
  END IF;

  SELECT p.* INTO v_project
    FROM public.projects p WHERE p.id=p_destination FOR UPDATE;
  IF NOT FOUND
     OR v_project.owner_principal_id IS DISTINCT FROM p_actor
     OR v_project.writer_operation IS DISTINCT FROM 'public_acquisition'
     OR v_project.project_scope NOT IN ('personal','classroom')
     OR v_project.copied_from_publication_id IS DISTINCT FROM p_publication
     OR v_project.copied_from_revision_id IS DISTINCT FROM p_revision
     OR v_project.copied_from_project_id IS NULL
     OR v_project.copied_from_version_id IS NULL
     OR v_project.copied_from_license IS DISTINCT FROM 'public-domain'
     OR current_setting('app.tenant_id',true) IS DISTINCT FROM v_project.tenant_id::text THEN
    RAISE EXCEPTION 'copy acquisition forbidden' USING ERRCODE='42501';
  END IF;

  -- Source must still be a currently admitted, published, coherent exact
  -- revision. The existing public copy resolver has already locked the
  -- original Project and publication state in this same transaction.
  SELECT EXISTS (
     SELECT 1
       FROM public.project_publication_state state
       JOIN public.project_publication_revisions revision
         ON revision.id=p_revision
        AND revision.publication_id=state.id
        AND revision.project_id=state.project_id
        AND revision.tenant_id=state.tenant_id
       JOIN public.project_versions version
         ON version.id=revision.project_version_id
        AND version.project_id=state.project_id
        AND version.tenant_id=state.tenant_id
      WHERE state.id=p_publication
        AND state.current_revision_id=p_revision
        AND state.acquisition_allowed
        AND public.project_publication_readable(state.id)
        AND revision.project_id=v_project.copied_from_project_id
        AND revision.project_version_id=v_project.copied_from_version_id
        AND revision.license='public-domain'
        AND revision.schema_version=2
        AND revision.module_key IN ('three-d','electronics')
        AND EXISTS (SELECT 1 FROM public.publication_acquisition_settings setting
                     WHERE setting.singleton_key AND setting.enabled)
  ) INTO v_origin_valid;
  IF NOT v_origin_valid THEN
    RAISE EXCEPTION 'copy acquisition source not admitted' USING ERRCODE='42501';
  END IF;

  -- The receipt's PK is the destination Project. A replay is idempotent and
  -- must never increase createdCopies or claim an inconsistent publication.
  INSERT INTO public.publication_copy_events
    (destination_project_id,publication_id,created_at)
  VALUES (v_project.id,p_publication,v_project.created_at)
  ON CONFLICT (destination_project_id) DO NOTHING;
  IF FOUND THEN RETURN true; END IF;
  SELECT event.publication_id INTO v_existing FROM public.publication_copy_events event
   WHERE event.destination_project_id=p_destination;
  IF v_existing IS DISTINCT FROM p_publication THEN
    RAISE EXCEPTION 'conflicting acquisition receipt' USING ERRCODE='23514';
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.record_publication_copy_acquisition(uuid,uuid,uuid,uuid)
  FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.record_publication_copy_acquisition(uuid,uuid,uuid,uuid)
  TO asalab_app;
