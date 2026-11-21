-- Public acquisition extends the existing singleton administrative-settings and
-- append-only administrative audit pattern. No publication or copy is deleted.
CREATE TABLE public.publication_acquisition_settings (
 singleton_key boolean PRIMARY KEY DEFAULT true CHECK(singleton_key),
 enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0)
);
INSERT INTO public.publication_acquisition_settings(singleton_key) VALUES(true);
ALTER TABLE public.publication_acquisition_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_acquisition_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.publication_acquisition_settings FROM PUBLIC,asalab_app;
ALTER TABLE public.project_publication_state
 ADD COLUMN acquisition_allowed boolean NOT NULL DEFAULT false,
 ADD COLUMN acquisition_version integer NOT NULL DEFAULT 0 CHECK(acquisition_version>=0);

CREATE FUNCTION public.admin_publication_acquisition_read(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
 RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('enabled',enabled,'version',version) FROM public.publication_acquisition_settings WHERE singleton_key);
END; $$;
CREATE FUNCTION public.admin_publication_acquisition_write(p_actor uuid,p_enabled boolean,p_version integer,p_reason text,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before public.publication_acquisition_settings%ROWTYPE;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
 RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_enabled IS NULL OR p_version IS NULL OR p_version<0 OR p_version>=2147483647
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500
 OR p_request IS NULL OR length(trim(p_request)) NOT BETWEEN 1 AND 128 THEN
 RAISE EXCEPTION 'invalid settings' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_before FROM public.publication_acquisition_settings WHERE singleton_key FOR UPDATE;
 IF v_before.version<>p_version OR EXISTS(SELECT 1 FROM public.administrative_audit_events
 WHERE actor_principal_id=p_actor AND request_id=p_request AND action='publication.acquisition') THEN
 RAISE EXCEPTION 'settings changed' USING ERRCODE='P5M09'; END IF;
 UPDATE public.publication_acquisition_settings SET enabled=p_enabled,version=version+1 WHERE singleton_key;
 INSERT INTO public.administrative_audit_events(actor_principal_id,actor_account_id,actor_role,scope_kind,
 action,target_type,target_id,reason_code,reason_text,request_id,result,before_version,after_version,metadata_json)
 SELECT p_actor,a.account_id,'platform_admin','platform','publication.acquisition','publication_settings','acquisition',
 'admin_console',trim(p_reason),p_request,'succeeded',v_before.version,v_before.version+1,
 jsonb_build_object('before',jsonb_build_object('enabled',v_before.enabled,'version',v_before.version),
 'after',jsonb_build_object('enabled',p_enabled,'version',v_before.version+1)) FROM public.principals a WHERE a.id=p_actor;
 RETURN public.admin_publication_acquisition_read(p_actor);
END; $$;

-- Owner consent changes no immutable revision, preview, or private draft.
CREATE FUNCTION public.project_publication_acquisition_write(p_actor uuid,p_project uuid,p_enabled boolean,p_version integer,p_revision uuid,p_hash varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record; v_state public.project_publication_state%ROWTYPE;
BEGIN
 SELECT seat.id,seat.tenant_id,seat.classroom_id INTO s FROM public.principals a
 JOIN public.classroom_student_seats seat ON seat.id=a.seat_id WHERE a.id=p_actor AND a.kind='student_seat';
 IF FOUND THEN
 IF public.project_distribution_identity_lock(p_actor,s.tenant_id,s.classroom_id,s.id,p_hash) IS NULL THEN
 RAISE EXCEPTION 'forbidden' USING ERRCODE='P5C01'; END IF;
 ELSE
 PERFORM 1 FROM public.principals a JOIN public.accounts account ON account.id=a.account_id
 WHERE a.id=p_actor AND a.kind='account' AND account.status='active' FOR SHARE OF account;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P5C01'; END IF;
 END IF;
 PERFORM 1 FROM public.projects WHERE id=p_project AND owner_principal_id=p_actor
 AND (s.id IS NULL OR (tenant_id=s.tenant_id AND (classroom_id IS NULL OR classroom_id=s.classroom_id))) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 SELECT * INTO v_state FROM public.project_publication_state WHERE project_id=p_project AND owner_principal_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF p_enabled IS NULL OR p_version IS NULL OR p_version<0 OR p_version>=2147483647 THEN
 RAISE EXCEPTION 'invalid consent' USING ERRCODE='P5P03'; END IF;
 IF v_state.acquisition_version<>p_version OR v_state.current_revision_id IS DISTINCT FROM p_revision THEN
 RAISE EXCEPTION 'publication changed' USING ERRCODE='P5C02'; END IF;
 UPDATE public.project_publication_state SET acquisition_allowed=p_enabled,acquisition_version=acquisition_version+1 WHERE id=v_state.id;
 RETURN public.project_publication_status(p_actor,p_project);
END; $$;

CREATE OR REPLACE FUNCTION public.project_publication_status(p_principal_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reason text; v_publication jsonb; v_moderation_reason text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals actor ON actor.id = project.owner_principal_id
        LEFT JOIN public.accounts account ON account.id = actor.account_id
        WHERE project.id = p_project_id AND actor.id = p_principal_id
 AND ((actor.kind='account' AND account.status='active') OR public.project_publication_seat_active(actor.id,project.tenant_id,project.classroom_id))
    ) THEN RETURN NULL; END IF;

    v_reason := public.project_publication_policy_reason(p_project_id);
    IF v_reason IS NULL AND NOT public.project_distribution_allowed(p_project_id,'publish') THEN v_reason:='publication_forbidden'; END IF;
    IF v_reason IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.project_drafts draft
        JOIN public.project_snapshots snapshot
          ON snapshot.project_id = draft.project_id AND snapshot.tenant_id = draft.tenant_id
         AND snapshot.source_revision = draft.revision
        WHERE draft.project_id = p_project_id
    ) THEN v_reason := 'preview_required'; END IF;

    SELECT jsonb_build_object(
        'publicationId', state.id, 'revisionId', revision.id,
        'revisionNo', revision.revision_no, 'versionNo', version.version_no,
        'state', state.state, 'publishedAt', revision.published_at,
        'publicPath', CASE WHEN public.project_publication_readable(state.id)
                          THEN '#/public-projects/' || state.id::text ELSE NULL END
    ) INTO v_publication
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision
      ON revision.id = state.current_revision_id AND revision.publication_id = state.id
    JOIN public.project_versions version ON version.id = revision.project_version_id
    WHERE state.project_id = p_project_id AND state.owner_principal_id = p_principal_id
      AND revision.schema_version = 2;

    v_moderation_reason := public.project_publication_owner_moderation_reason(p_principal_id, p_project_id);
    RETURN jsonb_build_object('publication', v_publication,
                              'canPublish', v_reason IS NULL, 'reasonCode', v_reason)
        || CASE WHEN v_publication IS NOT NULL THEN jsonb_build_object('acquisition', (SELECT jsonb_build_object('allowed',s.acquisition_allowed,'version',s.acquisition_version) FROM public.project_publication_state s WHERE s.project_id=p_project_id AND s.owner_principal_id=p_principal_id)) ELSE '{}'::jsonb END
        || CASE WHEN v_moderation_reason IS NOT NULL
                THEN jsonb_build_object('moderationReason', v_moderation_reason)
                ELSE '{}'::jsonb END;
END;
$$;


CREATE FUNCTION public.public_project_copy_source_admitted(
    p_actor uuid, p_publication uuid, p_revision uuid, p_hash varchar
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
    v_seat record;
    v_admission jsonb;
BEGIN
    -- Global -> actor identity/class/session -> source Project -> publication.
    -- OFF waits for earlier copies; later requests observe OFF before any writer.
    PERFORM 1 FROM public.publication_acquisition_settings WHERE singleton_key AND enabled FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'acquisition_disabled' USING ERRCODE='P5C03'; END IF;
    SELECT s.id,s.tenant_id,s.classroom_id INTO v_seat FROM public.principals a
      JOIN public.classroom_student_seats s ON s.id=a.seat_id
      WHERE a.id=p_actor AND a.kind='student_seat';
    IF FOUND THEN
      v_admission:=public.classroom_project_admission_lock(p_actor,v_seat.tenant_id,v_seat.classroom_id,v_seat.id,p_hash);
      IF NOT COALESCE((v_admission->>'download')::boolean,false) THEN
        RAISE EXCEPTION 'copy_forbidden' USING ERRCODE='P5C01';
      END IF;
      v_tenant:=v_seat.tenant_id;
    ELSE
    -- Deliberately no organization/legacy-school fallback. Personal copies live
    -- only in the Account's canonical active Personal Workspace.
    SELECT workspace.tenant_id INTO v_tenant
      FROM public.principals actor
      JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
      JOIN public.workspace_memberships member ON member.account_id = account.id AND member.state = 'active' AND member.role = 'owner'
      JOIN public.workspaces workspace ON workspace.id = member.workspace_id
        AND workspace.kind = 'personal' AND workspace.status = 'active'
     WHERE actor.id = p_actor AND actor.kind = 'account'
     ORDER BY workspace.id LIMIT 1 FOR SHARE OF account,member,workspace;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'copy_forbidden' USING ERRCODE = 'P5C01';
    END IF;
    SELECT link.user_id INTO v_user
      FROM public.principals actor
      JOIN public.legacy_user_account_links link ON link.account_id = actor.account_id
       AND link.principal_id = actor.id AND link.tenant_id = v_tenant AND link.migration_state = 'active'
     WHERE actor.id = p_actor ORDER BY link.user_id LIMIT 1;

    END IF;

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
    IF NOT v_state.acquisition_allowed THEN RAISE EXCEPTION 'copy_forbidden' USING ERRCODE='P5C01'; END IF;
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
CREATE OR REPLACE FUNCTION public.public_project_copy_source(p_actor uuid,p_publication uuid,p_revision uuid)
RETURNS TABLE(destination_tenant_id uuid,destination_user_id uuid,source_project_id uuid,publication_id uuid,revision_id uuid,version_id uuid,module_key varchar,title varchar,author_label varchar,license varchar,document_json jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT * FROM public.public_project_copy_source_admitted(p_actor,p_publication,p_revision,NULL);
$$;
CREATE FUNCTION public.public_project_copy_source_seat(p_actor uuid,p_publication uuid,p_revision uuid,p_hash varchar)
RETURNS TABLE(destination_tenant_id uuid,destination_user_id uuid,source_project_id uuid,publication_id uuid,revision_id uuid,version_id uuid,module_key varchar,title varchar,author_label varchar,license varchar,document_json jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT * FROM public.public_project_copy_source_admitted(p_actor,p_publication,p_revision,p_hash);
$$;
REVOKE ALL ON FUNCTION public.public_project_copy_source_admitted(uuid,uuid,uuid,varchar) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.public_project_copy_source_seat(uuid,uuid,uuid,varchar),
public.admin_publication_acquisition_read(uuid),public.admin_publication_acquisition_write(uuid,boolean,integer,text,varchar),
public.project_publication_acquisition_write(uuid,uuid,boolean,integer,uuid,varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.public_project_copy_source_seat(uuid,uuid,uuid,varchar),
public.admin_publication_acquisition_read(uuid),public.admin_publication_acquisition_write(uuid,boolean,integer,text,varchar),
public.project_publication_acquisition_write(uuid,uuid,boolean,integer,uuid,varchar) TO asalab_app;
CREATE OR REPLACE FUNCTION public.public_project_copy_documents(
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
     WHERE state.acquisition_allowed
       AND EXISTS(SELECT 1 FROM public.publication_acquisition_settings WHERE singleton_key AND enabled)
       AND public.project_publication_readable(state.id)
       AND revision.schema_version = 2 AND revision.license = 'public-domain'
       AND revision.module_key IN ('three-d', 'electronics');
END;
$$;
REVOKE ALL ON FUNCTION public.public_project_copy_documents(uuid[],uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_project_copy_documents(uuid[],uuid[]) TO asalab_app;