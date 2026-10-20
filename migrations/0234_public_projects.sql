-- Explicit Public Projects cutover. Old Gallery rows are not backfilled,
-- re-published, or deleted by this migration. Project Core and Learning stay
-- authoritative; schema 2 identifies a new, explicit publication.
ALTER TABLE public.project_publication_revisions
    ADD COLUMN module_key varchar(64),
    ADD COLUMN author_label varchar(120),
    ADD COLUMN preview_image bytea,
    ADD COLUMN preview_content_type varchar(24),
    ADD COLUMN preview_width integer,
    ADD COLUMN preview_height integer,
    ADD CONSTRAINT project_publication_revision_v2_preview_check CHECK (
        schema_version <> 2 OR (
            module_key IS NOT NULL AND author_label IS NOT NULL
            AND preview_image IS NOT NULL AND preview_content_type IS NOT NULL
            AND preview_width IS NOT NULL AND preview_height IS NOT NULL
            AND preview_snapshot_revision IS NOT NULL
            AND preview_content_type IN ('image/png', 'image/webp')
            AND octet_length(preview_image) BETWEEN 64 AND 262144
            AND preview_width BETWEEN 16 AND 2048
            AND preview_height BETWEEN 16 AND 2048
            AND length(trim(title)) > 0
            AND license IN ('reserved', 'public-domain', 'cc-by', 'cc-by-sa', 'cc-by-nc')
            AND cardinality(tags) <= 10
        )
    );

CREATE INDEX project_publication_state_project_lookup_idx
    ON public.project_publication_state(project_id);

-- A custom GUC is reset to an empty string after SET LOCAL/COMMIT on a pooled
-- connection. Treat it like the original absent context, which matches no
-- tenant, instead of raising 22P02 during RLS planning before the ACL denial.
-- The existing tenant boundary, FORCE RLS and table grants remain unchanged.
ALTER POLICY project_publication_state_tenant ON public.project_publication_state
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER POLICY project_publication_revisions_tenant ON public.project_publication_revisions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Internal lock classification, not authorization. Project Core still resolves
-- the actor's Project context and checks its existing EDIT_ACCESS_SQL. Keep this
-- reader free of the School row locks taken by linked-access helpers: it also
-- runs after the caller has acquired Project FOR UPDATE.
-- Only durable origins are evidence here. Both tables reject UPDATE/DELETE,
-- and their runtime INSERT paths acquire Project first (0176/0192). Mutable eligibility,
-- classroom scope, owner kind and linked Account/Seat flags are not classifiers.
CREATE FUNCTION public.project_editor_has_immutable_learning_origin(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
    IF v_tenant IS NULL OR p_project_id IS NULL THEN RETURN false; END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.projects project
         WHERE project.id = p_project_id AND project.tenant_id = v_tenant
           AND (EXISTS (
               SELECT 1 FROM public.learning_project_origins origin
                WHERE origin.project_id = project.id
                  AND origin.project_tenant_id = project.tenant_id
           ) OR EXISTS (
               SELECT 1 FROM public.learning_legacy_project_origins origin
                WHERE origin.project_id = project.id
                  AND origin.project_tenant_id = project.tenant_id
           ))
    );
END;
$$;

-- This is the single eligibility policy used by every public/compatibility
-- read and by publishing. Snapshot freshness is deliberately NOT part of it:
-- saving Working Draft V2 must not hide the already published V1.
CREATE FUNCTION public.project_publication_policy_reason(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_project record;
BEGIN
    SELECT p.project_scope, p.classroom_id, p.status, actor.kind, actor.account_id,
           account.status AS account_status
      INTO v_project
      FROM public.projects p
      LEFT JOIN public.principals actor ON actor.id = p.owner_principal_id
      LEFT JOIN public.accounts account ON account.id = actor.account_id
     WHERE p.id = p_project_id;
    IF NOT FOUND THEN RETURN 'not_available'; END IF;

    IF EXISTS (SELECT 1 FROM public.learning_project_origins o WHERE o.project_id = p_project_id)
       OR EXISTS (SELECT 1 FROM public.learning_legacy_project_origins o WHERE o.project_id = p_project_id)
       OR EXISTS (SELECT 1 FROM public.classroom_assignment_work w WHERE w.project_id = p_project_id) THEN
        RETURN 'learning_work_protected';
    END IF;
    IF v_project.project_scope IS DISTINCT FROM 'personal'
       OR v_project.classroom_id IS NOT NULL
       OR v_project.status IS DISTINCT FROM 'active'
       OR v_project.kind IS DISTINCT FROM 'account'
       OR v_project.account_status IS DISTINCT FROM 'active' THEN
        RETURN 'publication_forbidden';
    END IF;

    -- Classroom and Seat-owned sources are ineligible regardless of their Safe
    -- Mode flag. The policy is re-evaluated for every read, so changing the
    -- Project's own scope/origin closes existing public access. A linked Seat
    -- or a school membership does not govern an Account's independent personal
    -- Project and must never become a global Account publication ban.
    RETURN NULL;
END;
$$;

CREATE FUNCTION public.project_publication_readable(p_publication_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_publication_state state
        JOIN public.project_publication_revisions revision
          ON revision.id = state.current_revision_id AND revision.publication_id = state.id
        JOIN public.projects project
          ON project.id = state.project_id AND project.tenant_id = state.tenant_id
         AND project.owner_principal_id = state.owner_principal_id
        WHERE state.id = p_publication_id AND state.state = 'public'
          AND revision.schema_version = 2
          AND public.project_publication_policy_reason(state.project_id) IS NULL
    );
$$;

CREATE FUNCTION public.project_publication_status(p_principal_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reason text; v_publication jsonb;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals actor ON actor.id = project.owner_principal_id AND actor.kind = 'account'
        JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
        WHERE project.id = p_project_id AND actor.id = p_principal_id
    ) THEN RETURN NULL; END IF;

    v_reason := public.project_publication_policy_reason(p_project_id);
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

    RETURN jsonb_build_object('publication', v_publication,
                              'canPublish', v_reason IS NULL, 'reasonCode', v_reason);
END;
$$;

-- The 0141 exact-version/dedup algorithm remains the only publishing writer.
-- Metadata supplied here belongs to this immutable publication revision; it
-- does not silently rewrite the private Project properties.
CREATE FUNCTION public.project_publication_publish(
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
    IF NOT EXISTS (
        SELECT 1 FROM public.principals actor
        JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
        WHERE actor.id = p_principal_id AND actor.kind = 'account'
    ) THEN RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01'; END IF;

    -- Editor transactions without an immutable Learning origin acquire Project
    -- FOR UPDATE before Draft. Keep that order and strength, then freeze Draft
    -- + Snapshot. Protected originals are rejected below before touching Draft;
    -- their existing School writer order is not changed by publication.
    SELECT * INTO v_project FROM public.projects project
     WHERE project.id = p_project_id AND project.owner_principal_id = p_principal_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
    v_reason := public.project_publication_policy_reason(p_project_id);
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

    SELECT COALESCE((
        SELECT NULLIF(left(trim(profile.display_name), 120), '')
        FROM public.profiles profile
        JOIN public.principals actor ON actor.account_id = profile.account_id
        WHERE actor.id = p_principal_id AND profile.visibility = 'public'
    ), 'Автор проекта') INTO v_author;
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

CREATE FUNCTION public.project_publication_revoke(p_principal_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM 1 FROM public.projects project
    JOIN public.principals actor ON actor.id = project.owner_principal_id AND actor.kind = 'account'
    JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
    WHERE project.id = p_project_id AND actor.id = p_principal_id
    FOR NO KEY UPDATE OF project;
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.project_publication_state
       SET state = 'revoked', revoked_at = COALESCE(revoked_at, now())
     WHERE project_id = p_project_id;
    -- Explicit owner revoke retires its legacy projection, not Project Core or
    -- revision history. Collections reference projects since migration 0052.
    DELETE FROM public.project_publications WHERE project_id = p_project_id;
    RETURN true;
END;
$$;

CREATE FUNCTION public.public_projects_read(
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
           revision.module_key, revision.author_label, revision.published_at,
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
    ORDER BY revision.published_at DESC, state.id DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 24), 49))
    OFFSET greatest(0, least(COALESCE(p_offset, 0), 1000000));
$$;

CREATE FUNCTION public.public_project_image(p_publication_id uuid, p_revision_id uuid DEFAULT NULL)
RETURNS TABLE (image bytea, content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT revision.preview_image, revision.preview_content_type
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision
      ON revision.id = state.current_revision_id AND revision.publication_id = state.id
    WHERE state.id = p_publication_id AND public.project_publication_readable(state.id)
      AND (p_revision_id IS NULL OR revision.id = p_revision_id);
$$;

-- All old mutation names converge on the same policy/writer. The unprotected
-- 0141 implementation remains inaccessible to both PUBLIC and the runtime.
-- Preserve the old *denial* contract for a protected learner original: its
-- owner or scoped teacher receives P5L01 even without a preview or after the
-- legacy work row was removed. This confers no right to publish; all successful
-- writes still require the Account owner through project_publication_publish.
CREATE FUNCTION public.project_publication_legacy_learning_guard(
    p_principal_id uuid, p_project_id uuid
)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.project_publication_policy_reason(p_project_id) = 'learning_work_protected'
       AND EXISTS (
        SELECT 1 FROM public.projects project
        WHERE project.id = p_project_id
          AND (project.owner_principal_id = p_principal_id OR EXISTS (
            SELECT 1 FROM public.principals author
            JOIN public.classroom_student_seats seat ON seat.id = author.seat_id
            JOIN public.classroom_memberships membership
              ON membership.classroom_id = seat.classroom_id
             AND membership.tenant_id = seat.tenant_id
            JOIN public.principals teacher ON teacher.account_id = membership.account_id
            JOIN public.accounts account ON account.id = teacher.account_id
            WHERE author.id = project.owner_principal_id
              AND seat.status <> 'removed'
              AND membership.member_role IN ('owner', 'co_teacher')
              AND teacher.id = p_principal_id AND teacher.kind = 'account'
              AND account.status = 'active'
          ))
       ) THEN
        RAISE EXCEPTION 'learning_work_protected' USING ERRCODE = 'P5L01';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.gallery_publish(p_principal_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM public.project_publication_legacy_learning_guard(p_principal_id, p_project_id);
    PERFORM public.project_publication_publish(p_principal_id, p_project_id, '{}'::jsonb);
    RETURN true;
EXCEPTION WHEN SQLSTATE 'P5P02' OR SQLSTATE 'P5P04' THEN
    RETURN false;
END;
$$;
CREATE OR REPLACE FUNCTION public.gallery_unpublish(p_principal_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.project_publication_revoke(p_principal_id, p_project_id);
$$;

CREATE OR REPLACE FUNCTION public.project_visibility_set(
    p_principal_id uuid, p_project_id uuid, p_visibility varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_publication_id uuid; v_reason text;
BEGIN
    IF p_visibility IS NULL OR p_visibility NOT IN ('private', 'link', 'public') THEN RETURN false; END IF;
    IF p_visibility = 'private' THEN
        RETURN public.project_publication_revoke(p_principal_id, p_project_id);
    END IF;
    PERFORM public.project_publication_legacy_learning_guard(p_principal_id, p_project_id);
    IF NOT EXISTS (
        SELECT 1 FROM public.principals actor
        JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
        WHERE actor.id = p_principal_id AND actor.kind = 'account'
    ) THEN RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01'; END IF;
    PERFORM 1 FROM public.projects project
     WHERE project.id = p_project_id AND project.owner_principal_id = p_principal_id
     FOR NO KEY UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    v_reason := public.project_publication_policy_reason(p_project_id);
    IF v_reason = 'learning_work_protected' THEN
        RAISE EXCEPTION 'learning_work_protected' USING ERRCODE = 'P5L01';
    ELSIF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;
    SELECT state.id INTO v_publication_id FROM public.project_publication_state state
     WHERE state.project_id = p_project_id;
    IF p_visibility = 'link' THEN
        -- This retires public access. It grants no tokenless unlisted read.
        IF v_publication_id IS NULL THEN RETURN false; END IF;
        UPDATE public.project_publication_state SET state = 'unlisted'
         WHERE id = v_publication_id;
        UPDATE public.project_publications SET visibility = 'link' WHERE project_id = p_project_id;
        RETURN true;
    END IF;
    -- A legacy properties dialog re-sends visibility with ordinary metadata.
    -- Keeping public visibility must neither republish a newer draft nor
    -- silently convert a historical publication into schema 2.
    IF EXISTS (SELECT 1 FROM public.project_publication_state state
                WHERE state.id = v_publication_id AND state.state = 'public')
       OR (v_publication_id IS NULL AND EXISTS (
            SELECT 1 FROM public.project_publications publication
             WHERE publication.project_id = p_project_id AND publication.visibility = 'public'
       )) THEN RETURN true; END IF;
    RETURN public.gallery_publish(p_principal_id, p_project_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.gallery_list(
    p_principal_id uuid, p_sort varchar, p_module_key varchar, p_limit integer, p_offset integer
)
RETURNS TABLE (
    project_id uuid, title varchar, module_key varchar, author_label varchar,
    published_at timestamptz, snapshot_revision integer, editors_choice boolean,
    like_count integer, wow_count integer, viewer_liked boolean,
    viewer_wowed boolean, viewer_may_remove boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    -- Catalog consumers now use publication IDs. The retired list must not
    -- expose working Project IDs or accidentally resurrect historical rows.
    SELECT NULL::uuid, NULL::varchar, NULL::varchar, NULL::varchar,
           NULL::timestamptz, NULL::integer, false, 0, 0, false, false, false
    WHERE false;
$$;

CREATE OR REPLACE FUNCTION public.gallery_work(p_principal_id uuid, p_project_id uuid)
RETURNS TABLE (
    project_id uuid, title varchar, module_key varchar, author_label varchar,
    published_at timestamptz, snapshot_revision integer, editors_choice boolean,
    like_count integer, wow_count integer, viewer_liked boolean, viewer_wowed boolean,
    viewer_may_remove boolean, viewer_is_author boolean, document_json jsonb,
    copied_from_author varchar, copied_from_title varchar, description varchar,
    tags text[], license varchar, visibility varchar, copy_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    -- Detail moved to Public Projects; no legacy detail/document projection.
    SELECT NULL::uuid, NULL::varchar, NULL::varchar, NULL::varchar,
           NULL::timestamptz, NULL::integer, false, 0, 0, false, false, false, false,
           NULL::jsonb, NULL::varchar, NULL::varchar, NULL::varchar,
           NULL::text[], NULL::varchar, NULL::varchar, 0
    WHERE false;
$$;

CREATE OR REPLACE FUNCTION public.gallery_snapshot(p_project_id uuid)
RETURNS TABLE (image bytea, content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT revision.preview_image, revision.preview_content_type
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision ON revision.id = state.current_revision_id
    WHERE state.project_id = p_project_id AND public.project_publication_readable(state.id);
$$;

CREATE OR REPLACE FUNCTION public.gallery_state(p_principal_id uuid, p_project_id uuid)
RETURNS TABLE (published boolean, visibility varchar, published_at timestamptz, like_count integer, wow_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT true, 'public'::varchar, revision.published_at, 0, 0
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision ON revision.id = state.current_revision_id
    WHERE state.project_id = p_project_id AND state.owner_principal_id = p_principal_id
      AND public.project_publication_readable(state.id);
$$;

-- Retired raw-draft copy and social mutation routes stay fail-closed until the
-- corresponding new, reviewed capabilities are implemented. No second stack.
CREATE OR REPLACE FUNCTION public.gallery_copy_to_projects(p_principal_id uuid, p_project_id uuid, p_title varchar)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT NULL::uuid;
$$;
CREATE OR REPLACE FUNCTION public.gallery_react(p_principal_id uuid, p_project_id uuid, p_kind varchar, p_on boolean)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT false;
$$;
CREATE OR REPLACE FUNCTION public.gallery_editors_choice(p_principal_id uuid, p_project_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT false;
$$;

CREATE OR REPLACE FUNCTION public.collection_set_item(
    p_principal_id uuid, p_collection_id uuid, p_project_id uuid, p_inside boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.collections c
                    WHERE c.id = p_collection_id AND c.owner_principal_id = p_principal_id) THEN
        RETURN false;
    END IF;
    IF p_inside THEN
        IF NOT EXISTS (SELECT 1 FROM public.projects p
                        WHERE p.id = p_project_id AND p.owner_principal_id = p_principal_id)
           AND NOT EXISTS (SELECT 1 FROM public.project_publication_state state
                            WHERE state.project_id = p_project_id
                              AND public.project_publication_readable(state.id)) THEN
            RETURN false;
        END IF;
        INSERT INTO public.collection_items(collection_id, project_id)
        VALUES (p_collection_id, p_project_id) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.collection_items WHERE collection_id = p_collection_id AND project_id = p_project_id;
    END IF;
    RETURN true;
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
           CASE WHEN project.owner_principal_id = p_principal_id THEN 'Ваша работа'::varchar ELSE revision.author_label END,
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

CREATE OR REPLACE FUNCTION public.collection_list(p_principal_id uuid)
RETURNS TABLE (id uuid, title varchar, item_count integer, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT collection.id, collection.title,
           (SELECT count(*)::integer FROM public.collection_items_list(p_principal_id, collection.id)),
           collection.created_at
    FROM public.collections collection WHERE collection.owner_principal_id = p_principal_id
    ORDER BY collection.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.project_publication_policy_reason(uuid) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.project_editor_has_immutable_learning_origin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_publication_readable(uuid) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.project_publication_legacy_learning_guard(uuid,uuid) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.gallery_publish_unprotected(uuid,uuid) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.project_publication_status(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_publication_publish(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_publication_revoke(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_projects_read(uuid,text,varchar,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_project_image(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_publication_status(uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.project_editor_has_immutable_learning_origin(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.project_publication_publish(uuid,uuid,jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.project_publication_revoke(uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.public_projects_read(uuid,text,varchar,integer,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.public_project_image(uuid,uuid) TO asalab_app;
-- Existing replacement functions retain their already restricted grants.
