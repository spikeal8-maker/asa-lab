-- Exact-publication copying extends the canonical Project writer, not Gallery.
ALTER TABLE public.projects
    ADD COLUMN copied_from_publication_id uuid,
    ADD COLUMN copied_from_revision_id uuid,
    ADD COLUMN copied_from_version_id uuid,
    ADD COLUMN copied_from_license varchar(32),
    ADD CONSTRAINT projects_exact_publication_copy_check CHECK (
        (copied_from_publication_id IS NULL AND copied_from_revision_id IS NULL
         AND copied_from_version_id IS NULL AND copied_from_license IS NULL)
        OR (copied_from_publication_id IS NOT NULL AND copied_from_revision_id IS NOT NULL
            AND copied_from_version_id IS NOT NULL AND copied_from_license IS NOT NULL
            AND copied_from_license = 'public-domain'
            AND copied_from_project_id IS NOT NULL)
    );

CREATE FUNCTION public.projects_exact_copy_origin_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF ROW(NEW.copied_from_publication_id, NEW.copied_from_revision_id,
           NEW.copied_from_version_id, NEW.copied_from_license)
       IS DISTINCT FROM ROW(OLD.copied_from_publication_id, OLD.copied_from_revision_id,
                            OLD.copied_from_version_id, OLD.copied_from_license) THEN
        RAISE EXCEPTION 'immutable publication copy origin';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER projects_exact_copy_origin_immutable BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.projects_exact_copy_origin_immutable();
REVOKE ALL ON FUNCTION public.projects_exact_copy_origin_immutable() FROM PUBLIC;

-- Only this resolver may cross source RLS. Runtime receives no access to the
-- publication tables. Caller must keep its transaction open through createWithDraft.
CREATE FUNCTION public.public_project_copy_source(
    p_actor uuid, p_publication uuid, p_revision uuid
)
RETURNS TABLE (
    destination_tenant_id uuid, destination_user_id uuid,
    source_project_id uuid, publication_id uuid, revision_id uuid, version_id uuid,
    module_key varchar, title varchar, author_label varchar, license varchar,
    document_json jsonb
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project uuid;
    v_state public.project_publication_state%ROWTYPE;
    v_revision public.project_publication_revisions%ROWTYPE;
    v_tenant uuid;
    v_user uuid;
BEGIN
    -- Deliberately no organization/legacy-school fallback. Personal copies live
    -- only in the Account's canonical active Personal Workspace.
    SELECT workspace.tenant_id INTO v_tenant
      FROM public.principals actor
      JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
      JOIN public.workspace_memberships member ON member.account_id = account.id AND member.state = 'active' AND member.role = 'owner'
      JOIN public.workspaces workspace ON workspace.id = member.workspace_id
        AND workspace.kind = 'personal' AND workspace.status = 'active'
     WHERE actor.id = p_actor AND actor.kind = 'account'
     ORDER BY workspace.id LIMIT 1;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'copy_forbidden' USING ERRCODE = 'P5C01';
    END IF;
    SELECT link.user_id INTO v_user
      FROM public.principals actor
      JOIN public.legacy_user_account_links link ON link.account_id = actor.account_id
       AND link.principal_id = actor.id AND link.tenant_id = v_tenant AND link.migration_state = 'active'
     WHERE actor.id = p_actor ORDER BY link.user_id LIMIT 1;

    -- Initial lookup acquires no state lock. Publish, revoke, save, origin
    -- attachment and this resolver serialize on Project before publication state.
    SELECT state.project_id INTO v_project
      FROM public.project_publication_state state WHERE state.id = p_publication;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04';
    END IF;
    PERFORM 1 FROM public.projects project WHERE project.id = v_project FOR UPDATE;
    SELECT * INTO v_state FROM public.project_publication_state state
     WHERE state.id = p_publication AND state.project_id = v_project FOR UPDATE;
    IF NOT FOUND OR NOT public.project_publication_readable(p_publication) THEN
        RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04';
    END IF;
    IF v_state.current_revision_id IS DISTINCT FROM p_revision THEN
        RAISE EXCEPTION 'publication_changed' USING ERRCODE = 'P5C02';
    END IF;
    SELECT * INTO v_revision FROM public.project_publication_revisions revision
     WHERE revision.id = p_revision AND revision.publication_id = p_publication
       AND revision.project_id = v_project AND revision.tenant_id = v_state.tenant_id
       AND revision.schema_version = 2;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
    IF v_revision.license IS DISTINCT FROM 'public-domain'
       OR v_revision.module_key NOT IN ('three-d', 'electronics') THEN
        RAISE EXCEPTION 'copy_forbidden' USING ERRCODE = 'P5C01';
    END IF;
    RETURN QUERY SELECT v_tenant, v_user, v_project, p_publication, p_revision,
        version.id, v_revision.module_key, v_revision.title, v_revision.author_label,
        v_revision.license, version.document_json
      FROM public.project_versions version
     WHERE version.id = v_revision.project_version_id AND version.project_id = v_project
       AND version.tenant_id = v_state.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.public_project_copy_source(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_project_copy_source(uuid,uuid,uuid) TO asalab_app;

-- Anonymous GET uses a bounded read-only projection, never the locking copy
-- command. Bind every document to the metadata page's exact publication/revision.
-- Missing, revoked and superseded entries return no row (capability false).
CREATE FUNCTION public.public_project_copy_documents(
    p_publications uuid[], p_revisions uuid[]
)
RETURNS TABLE (
    publication_id uuid, revision_id uuid, module_key varchar, license varchar,
    document_json jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF cardinality(p_publications) IS NULL OR cardinality(p_revisions) IS NULL
       OR cardinality(p_publications) NOT BETWEEN 1 AND 48
       OR cardinality(p_publications) <> cardinality(p_revisions) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT state.id, revision.id, revision.module_key, revision.license, version.document_json
      FROM unnest(p_publications, p_revisions) AS requested(publication_id, revision_id)
      JOIN public.project_publication_state state
        ON state.id = requested.publication_id AND state.current_revision_id = requested.revision_id
      JOIN public.project_publication_revisions revision
        ON revision.id = state.current_revision_id AND revision.publication_id = state.id
       AND revision.project_id = state.project_id AND revision.tenant_id = state.tenant_id
      JOIN public.project_versions version
        ON version.id = revision.project_version_id AND version.project_id = state.project_id
       AND version.tenant_id = state.tenant_id
     WHERE public.project_publication_readable(state.id)
       AND revision.schema_version = 2 AND revision.license = 'public-domain'
       AND revision.module_key IN ('three-d', 'electronics');
END;
$$;
REVOKE ALL ON FUNCTION public.public_project_copy_documents(uuid[],uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_project_copy_documents(uuid[],uuid[]) TO asalab_app;