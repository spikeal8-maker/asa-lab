-- DEC-PROJ-124: registration display_name is already the public author name.
-- Whole-profile visibility never grants access to other fields through this helper.
-- Existing immutable revisions retain their attribution history; authorized read
-- projections resolve this single field from their recorded publishing identity.
CREATE FUNCTION public.project_publication_author_label(p_author uuid, p_fallback varchar)
RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
    SELECT COALESCE((
        SELECT NULLIF(left(trim(profile.display_name),120),'')
          FROM public.principals actor
          JOIN public.profiles profile ON profile.account_id=actor.account_id
         WHERE actor.id=p_author AND actor.kind='account'
    ), NULLIF(left(trim(p_fallback),120),''), 'Автор проекта')::varchar;
$$;
REVOKE ALL ON FUNCTION public.project_publication_author_label(uuid,varchar) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION public.project_publication_publish_admitted(
    p_principal_id uuid, p_project_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project public.projects%ROWTYPE;
    v_snapshot public.project_snapshots%ROWTYPE;
    v_current public.project_publication_revisions%ROWTYPE;
    v_draft public.project_drafts%ROWTYPE;
    v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
    v_reason text; v_title varchar; v_description text; v_tags text[]; v_license varchar;
    v_author varchar; v_user uuid; v_publication_id uuid; v_revision_id uuid;
    v_version_id uuid; v_version_no integer; v_revision_no integer;
BEGIN
    -- Editor transactions without an immutable Learning origin acquire Project
    -- FOR UPDATE before Draft. Keep that order and strength, then freeze Draft
    -- + Snapshot. Protected originals are rejected below before touching Draft;
    -- their existing School writer order is not changed by publication.
    SELECT * INTO v_project FROM public.projects project
     WHERE project.id = p_project_id AND project.owner_principal_id = p_principal_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
    v_reason := public.project_publication_policy_reason(p_project_id);
    IF v_reason IS NULL AND NOT public.project_distribution_allowed(p_project_id,'publish') THEN v_reason:='publication_forbidden'; END IF;
    IF v_reason = 'learning_work_protected' THEN
        RAISE EXCEPTION 'learning_work_protected' USING ERRCODE = 'P5L01';
    ELSIF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;

    IF jsonb_typeof(v_metadata) IS DISTINCT FROM 'object'
       OR v_metadata - ARRAY['title','description','tags','license'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'invalid publication metadata' USING ERRCODE = 'P5P03';
    END IF;
    IF v_metadata ? 'title' AND jsonb_typeof(v_metadata->'title') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid publication title' USING ERRCODE = 'P5P03';
    END IF;
    IF v_metadata ? 'description' AND jsonb_typeof(v_metadata->'description') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'invalid publication description' USING ERRCODE = 'P5P03';
    END IF;
    IF v_metadata ? 'license' AND jsonb_typeof(v_metadata->'license') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid publication license' USING ERRCODE = 'P5P03';
    END IF;
    v_title := trim(CASE WHEN v_metadata ? 'title' THEN v_metadata->>'title' ELSE v_project.title END);
    v_description := NULLIF(trim(CASE WHEN v_metadata ? 'description'
        THEN v_metadata->>'description' ELSE v_project.description END), '');
    v_license := trim(CASE WHEN v_metadata ? 'license' THEN v_metadata->>'license' ELSE v_project.license END);
    v_tags := v_project.tags;
    IF v_metadata ? 'tags' THEN
        IF jsonb_typeof(v_metadata->'tags') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'invalid publication tags' USING ERRCODE = 'P5P03';
        END IF;
        IF jsonb_array_length(v_metadata->'tags') > 10 OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_metadata->'tags') item
            WHERE jsonb_typeof(item) <> 'string'
               OR length(trim(item #>> '{}')) NOT BETWEEN 1 AND 32
        ) THEN RAISE EXCEPTION 'invalid publication tags' USING ERRCODE = 'P5P03'; END IF;
        SELECT COALESCE(array_agg(tag ORDER BY tag), '{}'::text[]) INTO v_tags
        FROM (SELECT DISTINCT lower(trim(value)) AS tag
                FROM jsonb_array_elements_text(v_metadata->'tags')) normalized;
    END IF;
    IF length(v_title) NOT BETWEEN 1 AND 255 OR length(v_description) > 2000
       OR v_license NOT IN ('reserved','public-domain','cc-by','cc-by-sa','cc-by-nc') THEN
        RAISE EXCEPTION 'invalid publication metadata' USING ERRCODE = 'P5P03';
    END IF;

    SELECT * INTO v_draft FROM public.project_drafts draft
     WHERE draft.tenant_id = v_project.tenant_id AND draft.project_id = p_project_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'preview_required' USING ERRCODE = 'P5P02'; END IF;
    SELECT * INTO v_snapshot FROM public.project_snapshots snapshot
     WHERE snapshot.tenant_id = v_project.tenant_id AND snapshot.project_id = p_project_id
       AND snapshot.source_revision = v_draft.revision
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'preview_required' USING ERRCODE = 'P5P02'; END IF;

    SELECT public.project_publication_author_label(p_principal_id, 'Автор проекта'::varchar) INTO v_author;
    SELECT link.user_id INTO v_user FROM public.legacy_user_account_links link
     WHERE link.tenant_id = v_project.tenant_id AND link.principal_id = p_principal_id
       AND link.migration_state = 'active' LIMIT 1;

    INSERT INTO public.project_publication_state AS state
        (tenant_id, project_id, owner_principal_id, created_by_principal_id)
    VALUES (v_project.tenant_id, p_project_id, p_principal_id, p_principal_id)
    ON CONFLICT (tenant_id, project_id) DO UPDATE
        SET owner_principal_id = EXCLUDED.owner_principal_id
    RETURNING state.id, state.current_revision_id INTO v_publication_id, v_revision_id;

    SELECT version.id INTO v_version_id FROM public.project_versions version
     WHERE version.tenant_id = v_project.tenant_id AND version.project_id = p_project_id
       AND version.document_json = v_draft.document_json
     ORDER BY version.version_no DESC LIMIT 1;
    IF v_version_id IS NULL THEN
        SELECT COALESCE(max(version.version_no), 0) + 1 INTO v_version_no
          FROM public.project_versions version
         WHERE version.tenant_id = v_project.tenant_id AND version.project_id = p_project_id;
        INSERT INTO public.project_versions
            (tenant_id, project_id, version_no, document_json, label, created_by, created_by_principal_id)
        VALUES (v_project.tenant_id, p_project_id, v_version_no, v_draft.document_json,
                'Публикация', v_user, p_principal_id)
        RETURNING id INTO v_version_id;
    END IF;

    SELECT * INTO v_current FROM public.project_publication_revisions revision
     WHERE revision.id = v_revision_id AND revision.publication_id = v_publication_id;
    IF v_current.id IS NULL OR v_current.schema_version <> 2
       OR v_current.project_version_id IS DISTINCT FROM v_version_id
       OR v_current.title IS DISTINCT FROM v_title
       OR v_current.description IS DISTINCT FROM v_description
       OR v_current.tags IS DISTINCT FROM v_tags
       OR v_current.license IS DISTINCT FROM v_license
       OR v_current.module_key IS DISTINCT FROM v_project.module_key
       OR v_current.author_label IS DISTINCT FROM v_author
       OR v_current.preview_snapshot_revision IS DISTINCT FROM v_snapshot.source_revision
       OR v_current.preview_image IS DISTINCT FROM v_snapshot.image
       OR v_current.preview_content_type IS DISTINCT FROM v_snapshot.content_type
       OR v_current.preview_width IS DISTINCT FROM v_snapshot.width
       OR v_current.preview_height IS DISTINCT FROM v_snapshot.height THEN
        SELECT COALESCE(max(revision.revision_no), 0) + 1 INTO v_revision_no
          FROM public.project_publication_revisions revision
         WHERE revision.publication_id = v_publication_id;
        INSERT INTO public.project_publication_revisions
            (publication_id, tenant_id, project_id, revision_no, project_version_id,
             title, summary, description, tags, license, preview_snapshot_revision,
             published_by_principal_id, schema_version, module_key, author_label,
             preview_image, preview_content_type, preview_width, preview_height)
        VALUES (v_publication_id, v_project.tenant_id, p_project_id, v_revision_no, v_version_id,
                v_title, left(v_description, 240), v_description, v_tags, v_license,
                v_snapshot.source_revision, p_principal_id, 2, v_project.module_key, v_author,
                v_snapshot.image, v_snapshot.content_type, v_snapshot.width, v_snapshot.height)
        RETURNING id INTO v_revision_id;
    END IF;
    UPDATE public.project_publication_state
       SET current_revision_id = v_revision_id, state = 'public',
           published_at = COALESCE(published_at, now()), revoked_at = NULL
     WHERE id = v_publication_id;

    -- Only an explicitly published schema-2 revision has a compatibility row.
    -- Compatibility readers below never use that row as content authority.
    INSERT INTO public.project_publications
        (project_id, tenant_id, owner_principal_id, published_by_principal_id,
         title, module_key, author_label, snapshot_revision, visibility)
    VALUES (p_project_id, v_project.tenant_id, p_principal_id, p_principal_id,
            v_title, v_project.module_key, v_author, v_snapshot.source_revision, 'public')
    ON CONFLICT (project_id) DO UPDATE
        SET owner_principal_id = EXCLUDED.owner_principal_id,
            published_by_principal_id = EXCLUDED.published_by_principal_id,
            title = EXCLUDED.title, module_key = EXCLUDED.module_key,
            author_label = EXCLUDED.author_label, snapshot_revision = EXCLUDED.snapshot_revision,
            visibility = 'public', published_at = now();
    RETURN public.project_publication_status(p_principal_id, p_project_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.public_projects_read(
    p_publication_id uuid, p_query text, p_module_key varchar, p_limit integer, p_offset integer
)
RETURNS TABLE (
    publication_id uuid, revision_id uuid, revision_no integer, version_no integer,
    title varchar, summary text, description text, tags text[], license varchar,
    module_key varchar, author_label varchar, published_at timestamptz,
    preview_content_type varchar, preview_width integer, preview_height integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT state.id, revision.id, revision.revision_no, version.version_no,
           revision.title, revision.summary, revision.description, revision.tags, revision.license,
           revision.module_key, public.project_publication_author_label(revision.published_by_principal_id, revision.author_label), revision.published_at,
           revision.preview_content_type, revision.preview_width, revision.preview_height
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision
      ON revision.id = state.current_revision_id AND revision.publication_id = state.id
    JOIN public.project_versions version ON version.id = revision.project_version_id
    WHERE public.project_publication_readable(state.id)
      AND (p_publication_id IS NULL OR state.id = p_publication_id)
      AND (p_module_key IS NULL OR revision.module_key = p_module_key)
      AND (NULLIF(trim(p_query), '') IS NULL OR strpos(lower(concat_ws(' ',
           revision.title, revision.description, array_to_string(revision.tags, ' '))),
           lower(left(trim(p_query), 120))) > 0)
    ORDER BY public.project_publication_pinned(state.id, revision.id) DESC,
             revision.published_at DESC, state.id DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 24), 49))
    OFFSET greatest(0, least(COALESCE(p_offset, 0), 1000000));
$$;

CREATE OR REPLACE FUNCTION public.admin_publications_list(p_actor uuid, p_offset integer, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_items jsonb; v_more boolean;
BEGIN
    IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'invalid page' USING ERRCODE = '22023';
    END IF;
    WITH page AS (
        SELECT state.id, revision.id AS revision_id, revision.title, public.project_publication_author_label(revision.published_by_principal_id, revision.author_label) AS author_label,
               COALESCE(revision.module_key, 'legacy') AS module_key,
               revision.published_at, revision.schema_version, state.state,
               COALESCE(moderation.hidden, false) AS hidden,
               COALESCE(moderation.moderation_version, 0) AS moderation_version, moderation.reason, moderation.acted_at,
               COALESCE(editorial.editorial_version,0) AS editorial_version,
               COALESCE(pin.pin_version,0) AS pin_version,
               COALESCE(epoch.lifecycle_version,0) AS lifecycle_version,
               (COALESCE(editorial.featured,false) AND editorial.revision_id = revision.id
                 AND editorial.moderation_version = COALESCE(moderation.moderation_version,0)
                 AND editorial.lifecycle_version = COALESCE(epoch.lifecycle_version,0)
                 AND NOT COALESCE(moderation.hidden,false)
                 AND public.project_publication_readable(state.id)) AS featured,
               public.project_publication_pinned(state.id, revision.id) AS pinned,
               (state.state = 'public' AND NOT COALESCE(moderation.hidden,false)
                 AND public.project_publication_readable(state.id)) AS editorial_eligible
          FROM public.project_publication_state state
          JOIN public.project_publication_revisions revision
            ON revision.id = state.current_revision_id AND revision.publication_id = state.id
          LEFT JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
          LEFT JOIN public.project_publication_editorial editorial ON editorial.publication_id = state.id
          LEFT JOIN public.project_publication_pin pin ON pin.publication_id = state.id
          LEFT JOIN public.project_publication_editorial_lifecycle epoch ON epoch.publication_id = state.id
         WHERE (state.state = 'public' OR moderation.hidden)
         ORDER BY revision.published_at DESC, state.id
         LIMIT p_limit + 1 OFFSET p_offset
    ), numbered AS (
        SELECT *, row_number() OVER (ORDER BY published_at DESC, id) AS n FROM page
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'publicationId', id, 'revisionId', revision_id, 'title', title,
        'schemaVersion', schema_version, 'moderationSupported', schema_version = 2,
        'authorLabel', author_label, 'moduleKey', module_key, 'publishedAt', published_at,
        'state', state, 'hidden', hidden, 'moderationVersion', moderation_version,
        'reason', reason, 'moderatedAt', acted_at,
        'featured', featured, 'editorialEligible', editorial_eligible,
        'pinned', pinned, 'pinVersion', pin_version,
        'editorialVersion', editorial_version, 'lifecycleVersion', lifecycle_version)
        ORDER BY n) FILTER (WHERE n <= p_limit), '[]'::jsonb), count(*) > p_limit
      INTO v_items, v_more FROM numbered;
    RETURN jsonb_build_object('items', v_items, 'nextOffset', CASE WHEN v_more THEN p_offset + p_limit END);
END;
$$;

CREATE OR REPLACE FUNCTION public.public_project_copy_source_admitted(
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
        version.id, v_revision.module_key, v_revision.title, public.project_publication_author_label(v_revision.published_by_principal_id, v_revision.author_label),
        v_revision.license, version.document_json
      FROM public.project_versions version
     WHERE version.id = v_revision.project_version_id AND version.project_id = v_project
       AND version.tenant_id = v_state.tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.collection_items_list(p_principal_id uuid, p_collection_id uuid)
RETURNS TABLE (
    project_id uuid, title varchar, module_key varchar, author_label varchar,
    snapshot_revision integer, editors_choice boolean, published boolean, added_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT project.id,
           CASE WHEN project.owner_principal_id = p_principal_id THEN project.title ELSE revision.title END,
           CASE WHEN project.owner_principal_id = p_principal_id THEN project.module_key ELSE revision.module_key END,
           CASE WHEN project.owner_principal_id = p_principal_id THEN 'Ваша работа'::varchar ELSE public.project_publication_author_label(revision.published_by_principal_id, revision.author_label) END,
           CASE WHEN project.owner_principal_id = p_principal_id THEN COALESCE(snapshot.source_revision, 0)
                ELSE revision.preview_snapshot_revision END,
           false, public.project_publication_readable(state.id), item.added_at
    FROM public.collections collection
    JOIN public.collection_items item ON item.collection_id = collection.id
    JOIN public.projects project ON project.id = item.project_id
    LEFT JOIN public.project_publication_state state ON state.project_id = project.id
    LEFT JOIN public.project_publication_revisions revision ON revision.id = state.current_revision_id
    LEFT JOIN public.project_snapshots snapshot
      ON snapshot.project_id = project.id AND project.owner_principal_id = p_principal_id
    WHERE collection.id = p_collection_id AND collection.owner_principal_id = p_principal_id
      AND (project.owner_principal_id = p_principal_id OR public.project_publication_readable(state.id))
    ORDER BY item.added_at DESC, project.id;
$$;

-- Existing public function grants are preserved; internal helper remains private.
