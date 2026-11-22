-- C3 / #1127. Forward-only, after released 0322. Old migration bytes are immutable.
-- One ordinary duplicate inherits immutable provenance without creating a new
-- public acquisition receipt. Do not mutate existing Project rows or guess origin.
LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;

-- A PRIVATE companion table avoids rewriting any existing projects row or
-- changing its JSON snapshot shape in historical prefix/upgrade contracts.
-- Missing evidence means 'unknown' for legacy, direct-SQL and unmarked writers.
-- Coverage v1 attests a trusted platform writer path, not human originality.
CREATE TABLE public.project_writer_evidence (
    project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
    writer_lineage_coverage varchar(12) NOT NULL
      CHECK (writer_lineage_coverage IN ('unknown','v1')),
    writer_operation varchar(20) NOT NULL
      CHECK (writer_operation IN ('native','public_acquisition','ordinary_duplicate')),
    recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE public.project_writer_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_writer_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_writer_evidence FROM PUBLIC,asalab_app;

-- An UPDATE changes projects.xmin without creating a new Project. A private
-- witness is emitted by the actual Project INSERT trigger, not by UPDATE.
-- Existing historical Projects have no witness and cannot be backfilled.
CREATE TABLE public.project_writer_insert_witness (
    project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
    inserting_xid bigint NOT NULL
);
ALTER TABLE public.project_writer_insert_witness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_writer_insert_witness FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_writer_insert_witness FROM PUBLIC,asalab_app;

CREATE FUNCTION public.record_project_insert_witness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
    INSERT INTO public.project_writer_insert_witness(project_id,inserting_xid)
    VALUES(NEW.id,txid_current());
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_project_insert_witness() FROM PUBLIC,asalab_app;
CREATE TRIGGER project_insert_witness AFTER INSERT ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.record_project_insert_witness();

-- No UPDATE or external DELETE can revise a previously issued writer marker.
-- Cascading deletion of a private Project may remove its companion row; durable
-- public acquisition receipts remain in the separate 0287 event table.
CREATE FUNCTION public.project_writer_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'project writer evidence is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER project_writer_evidence_immutable BEFORE UPDATE ON public.project_writer_evidence
    FOR EACH ROW EXECUTE FUNCTION public.project_writer_evidence_immutable();
REVOKE ALL ON FUNCTION public.project_writer_evidence_immutable() FROM PUBLIC,asalab_app;

-- Called only by PgProjectRepository immediately after its Project INSERT, in
-- the SAME transaction; never an HTTP field or separate public Project writer.
-- Binding to the inserting xact prevents retroactive stamping of old projects.
CREATE FUNCTION public.record_project_writer_evidence(
    p_actor uuid,p_destination uuid,p_kind varchar,p_inherited_source uuid
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
    v_project public.projects%ROWTYPE;
    v_source public.projects%ROWTYPE;
    v_coverage varchar(12);
    v_source_coverage varchar(12);
    v_insert_xid bigint;
BEGIN
    IF p_actor IS NULL OR p_destination IS NULL OR p_kind IS NULL OR p_kind NOT IN
         ('native','public_acquisition','ordinary_duplicate') THEN
       RAISE EXCEPTION 'invalid project writer evidence' USING ERRCODE='42501';
    END IF;

    SELECT project.* INTO v_project
      FROM public.projects project WHERE project.id=p_destination FOR UPDATE;
    IF NOT FOUND THEN
       RAISE EXCEPTION 'project writer evidence forbidden' USING ERRCODE='42501';
    END IF;
    -- An updated historical row may have current xmin, but never a witness
    -- emitted by an INSERT in this same transaction.
    SELECT witness.inserting_xid INTO v_insert_xid
      FROM public.project_writer_insert_witness witness
      WHERE witness.project_id=p_destination FOR UPDATE;
    IF v_project.owner_principal_id IS DISTINCT FROM p_actor
       OR current_setting('app.tenant_id',true) IS DISTINCT FROM v_project.tenant_id::text
       OR v_insert_xid IS DISTINCT FROM txid_current() THEN
       RAISE EXCEPTION 'project writer evidence forbidden' USING ERRCODE='42501';
    END IF;

    IF p_kind='ordinary_duplicate' THEN
        IF p_inherited_source IS NULL OR p_inherited_source=p_destination THEN
           RAISE EXCEPTION 'invalid ordinary duplicate source' USING ERRCODE='42501';
        END IF;
        SELECT source.* INTO v_source FROM public.projects source
          WHERE source.id=p_inherited_source AND source.tenant_id=v_project.tenant_id
          FOR SHARE;
        IF NOT FOUND OR v_source.project_scope IS DISTINCT FROM v_project.project_scope
           OR v_source.classroom_id IS DISTINCT FROM v_project.classroom_id
           OR v_source.module_key IS DISTINCT FROM v_project.module_key
           OR ROW(v_source.copied_from_project_id,v_source.copied_from_author,
                   v_source.copied_from_title,v_source.copied_at,
                   v_source.copied_from_publication_id,v_source.copied_from_revision_id,
                   v_source.copied_from_version_id,v_source.copied_from_license)
              IS DISTINCT FROM
              ROW(v_project.copied_from_project_id,v_project.copied_from_author,
                  v_project.copied_from_title,v_project.copied_at,
                  v_project.copied_from_publication_id,v_project.copied_from_revision_id,
                  v_project.copied_from_version_id,v_project.copied_from_license) THEN
          RAISE EXCEPTION 'ordinary duplicate lineage mismatch' USING ERRCODE='42501';
        END IF;
        SELECT evidence.writer_lineage_coverage INTO v_source_coverage
          FROM public.project_writer_evidence evidence
          WHERE evidence.project_id=p_inherited_source;
        v_coverage:=COALESCE(v_source_coverage,'unknown');
    ELSIF p_kind='native' THEN
        IF p_inherited_source IS NOT NULL
           OR ROW(v_project.copied_from_project_id,v_project.copied_from_author,
                  v_project.copied_from_title,v_project.copied_at,
                  v_project.copied_from_publication_id,v_project.copied_from_revision_id,
                  v_project.copied_from_version_id,v_project.copied_from_license)
              IS DISTINCT FROM ROW(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) THEN
          RAISE EXCEPTION 'native writer cannot claim copied origin' USING ERRCODE='42501';
        END IF;
        v_coverage:='v1';
    ELSE
        IF p_inherited_source IS NOT NULL
           OR v_project.copied_from_project_id IS NULL
           OR v_project.copied_from_publication_id IS NULL
           OR v_project.copied_from_revision_id IS NULL
           OR v_project.copied_from_version_id IS NULL
           OR v_project.copied_from_license IS DISTINCT FROM 'public-domain' THEN
          RAISE EXCEPTION 'public acquisition origin incomplete' USING ERRCODE='42501';
        END IF;
        v_coverage:='unknown';
    END IF;
    INSERT INTO public.project_writer_evidence(project_id,writer_lineage_coverage,writer_operation)
    VALUES(p_destination,v_coverage,p_kind);
    -- One-time transactional witness: neither replay nor later UPDATE can
    -- create or reuse native evidence for a previously persisted Project.
    DELETE FROM public.project_writer_insert_witness WHERE project_id=p_destination;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_project_writer_evidence(uuid,uuid,varchar,uuid)
    FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.record_project_writer_evidence(uuid,uuid,varchar,uuid)
    TO asalab_app;

-- Released 0287 counted ALL INSERTs carrying copied_from_publication_id.
-- Preserve old receipts and the historical zero-arg helper, but replace its
-- indiscriminate AFTER INSERT trigger with an explicit acquisition boundary.
DROP TRIGGER record_publication_copy_created ON public.projects;

CREATE FUNCTION public.record_publication_copy_acquisition(
    p_actor uuid, p_destination uuid, p_publication uuid, p_revision uuid
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
    v_project public.projects%ROWTYPE;
    v_operation varchar(20);
    v_source_valid boolean;
    v_receipt uuid;
BEGIN
    IF p_actor IS NULL OR p_destination IS NULL
       OR p_publication IS NULL OR p_revision IS NULL THEN
      RAISE EXCEPTION 'copy acquisition requires exact identifiers' USING ERRCODE='42501';
    END IF;
    SELECT p.* INTO v_project FROM public.projects p WHERE p.id=p_destination FOR UPDATE;
    SELECT evidence.writer_operation INTO v_operation
      FROM public.project_writer_evidence evidence
      WHERE evidence.project_id=p_destination;
    IF NOT FOUND OR v_project.owner_principal_id IS DISTINCT FROM p_actor
       OR v_operation IS DISTINCT FROM 'public_acquisition'
       OR v_project.project_scope NOT IN ('personal','classroom')
       OR v_project.copied_from_publication_id IS DISTINCT FROM p_publication
       OR v_project.copied_from_revision_id IS DISTINCT FROM p_revision
       OR v_project.copied_from_project_id IS NULL
       OR v_project.copied_from_version_id IS NULL
       OR v_project.copied_from_license IS DISTINCT FROM 'public-domain'
       OR current_setting('app.tenant_id',true) IS DISTINCT FROM v_project.tenant_id::text THEN
      RAISE EXCEPTION 'copy acquisition forbidden' USING ERRCODE='42501';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.project_publication_state state
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
        AND EXISTS (SELECT 1 FROM public.publication_acquisition_settings settings
                    WHERE settings.singleton_key AND settings.enabled)
    ) INTO v_source_valid;
    IF NOT v_source_valid THEN
      RAISE EXCEPTION 'copy acquisition source not admitted' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.publication_copy_events
      (destination_project_id,publication_id,created_at)
    VALUES(v_project.id,p_publication,v_project.created_at)
    ON CONFLICT (destination_project_id) DO NOTHING;
    IF FOUND THEN RETURN true; END IF;
    SELECT event.publication_id INTO v_receipt FROM public.publication_copy_events event
      WHERE event.destination_project_id=p_destination;
    IF v_receipt IS DISTINCT FROM p_publication THEN
      RAISE EXCEPTION 'conflicting acquisition receipt' USING ERRCODE='23514';
    END IF;
    RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.record_publication_copy_acquisition(uuid,uuid,uuid,uuid)
    FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.record_publication_copy_acquisition(uuid,uuid,uuid,uuid)
    TO asalab_app;
