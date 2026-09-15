-- R7-01B: every publish pins an exact immutable ProjectVersion.
--
-- The existing Gallery function/signature remains the compatibility command.
-- This slice adds the canonical publication write beside the legacy row; it does
-- not yet backfill old publications, redefine unpublish/revoke, or expose a new
-- public read API. Those are later R7-01 slices.
CREATE OR REPLACE FUNCTION gallery_publish(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_owner uuid;
    v_title varchar;
    v_module varchar;
    v_description varchar;
    v_tags text[];
    v_license varchar;
    v_document jsonb;
    v_label varchar;
    v_snapshot_revision integer;
    v_allowed boolean := false;
    v_publisher_user uuid;
    v_publication_id uuid;
    v_current_revision_id uuid;
    v_project_version_id uuid;
    v_version_no integer;
    v_revision_no integer;
    v_current_version_id uuid;
    v_current_title varchar;
    v_current_description text;
    v_current_tags text[];
    v_current_license varchar;
    v_current_snapshot_revision integer;
BEGIN
    -- Lock the Project + Working Draft so checkpoint numbering and the document
    -- captured below cannot race a concurrent save/checkpoint operation.
    SELECT p.tenant_id, p.owner_principal_id, p.title, p.module_key,
           p.description, p.tags, p.license, d.document_json,
           snapshot.source_revision
      INTO v_tenant, v_owner, v_title, v_module,
           v_description, v_tags, v_license, v_document,
           v_snapshot_revision
      FROM public.projects p
      JOIN public.project_drafts d
        ON d.tenant_id = p.tenant_id AND d.project_id = p.id
      JOIN public.project_snapshots snapshot
        ON snapshot.tenant_id = p.tenant_id AND snapshot.project_id = p.id
     WHERE p.id = p_project_id
       -- Preserve the legacy Gallery eligibility semantics in this slice.
       AND p.status <> 'deleted'
     FOR UPDATE OF p, d;
    IF v_tenant IS NULL THEN RETURN false; END IF;

    -- Preserve the existing author / teacher-of-seat authorization exactly.
    IF v_owner = p_principal_id THEN
        v_allowed := true;
    ELSE
        SELECT true INTO v_allowed
          FROM public.principals author
          JOIN public.classroom_student_seats seat ON seat.id = author.seat_id
          JOIN public.classroom_memberships membership
            ON membership.classroom_id = seat.classroom_id
           AND membership.tenant_id = seat.tenant_id
          JOIN public.principals teacher ON teacher.account_id = membership.account_id
         WHERE author.id = v_owner
           AND seat.status <> 'removed'
           AND membership.member_role IN ('owner', 'co_teacher')
           AND teacher.id = p_principal_id
         LIMIT 1;
    END IF;
    IF v_allowed IS NOT true THEN RETURN false; END IF;

    SELECT COALESCE(
             (SELECT seat.display_label
                FROM public.principals author
                JOIN public.classroom_student_seats seat ON seat.id = author.seat_id
               WHERE author.id = v_owner AND seat.status <> 'removed'),
             (SELECT profile.display_name
                FROM public.principals author
                JOIN public.profiles profile ON profile.account_id = author.account_id
               WHERE author.id = v_owner),
             'Автор')
      INTO v_label;

    -- The legacy user id is optional after Account/Principal convergence. The
    -- principal is always stored, so StudentSeat and personal-workspace actors
    -- can create a checkpoint without inventing a legacy user.
    SELECT link.user_id
      INTO v_publisher_user
      FROM public.legacy_user_account_links link
     WHERE link.tenant_id = v_tenant
       AND link.principal_id = p_principal_id
       AND link.migration_state = 'active'
     LIMIT 1;

    -- One stable publication identity per Project. Link/private/revoke
    -- convergence remains deliberately outside R7-01B; Gallery is still the
    -- compatibility read projection until the later slices.
    INSERT INTO public.project_publication_state AS state
        (tenant_id, project_id, owner_principal_id, created_by_principal_id,
         state, published_at, revoked_at)
    VALUES (v_tenant, p_project_id, v_owner, p_principal_id,
            'public', now(), NULL)
    ON CONFLICT (tenant_id, project_id) DO UPDATE
        SET owner_principal_id = EXCLUDED.owner_principal_id,
            state = 'public',
            published_at = COALESCE(state.published_at, EXCLUDED.published_at),
            revoked_at = NULL
    RETURNING state.id, state.current_revision_id
         INTO v_publication_id, v_current_revision_id;

    -- Reuse an existing immutable checkpoint when it already represents this
    -- exact Working Draft. Otherwise create the next ProjectVersion atomically.
    SELECT version.id
      INTO v_project_version_id
      FROM public.project_versions version
     WHERE version.tenant_id = v_tenant
       AND version.project_id = p_project_id
       AND version.document_json = v_document
     ORDER BY version.version_no DESC
     LIMIT 1;

    IF v_project_version_id IS NULL THEN
        SELECT COALESCE(max(version.version_no), 0) + 1
          INTO v_version_no
          FROM public.project_versions version
         WHERE version.tenant_id = v_tenant
           AND version.project_id = p_project_id;

        INSERT INTO public.project_versions
            (tenant_id, project_id, version_no, document_json, label,
             created_by, created_by_principal_id)
        VALUES (v_tenant, p_project_id, v_version_no, v_document,
                'Публикация', v_publisher_user, p_principal_id)
        RETURNING id INTO v_project_version_id;
    END IF;

    IF v_current_revision_id IS NOT NULL THEN
        SELECT revision.project_version_id, revision.title,
               revision.description, revision.tags, revision.license,
               revision.preview_snapshot_revision
          INTO v_current_version_id, v_current_title,
               v_current_description, v_current_tags, v_current_license,
               v_current_snapshot_revision
          FROM public.project_publication_revisions revision
         WHERE revision.id = v_current_revision_id
           AND revision.publication_id = v_publication_id;
    END IF;

    -- Repeated publish/visibility calls with unchanged content and metadata are
    -- idempotent: they do not manufacture extra ProjectVersions or revisions.
    IF v_current_revision_id IS NULL
       OR v_current_version_id IS DISTINCT FROM v_project_version_id
       OR v_current_title IS DISTINCT FROM v_title
       OR v_current_description IS DISTINCT FROM v_description
       OR v_current_tags IS DISTINCT FROM v_tags
       OR v_current_license IS DISTINCT FROM v_license
       OR v_current_snapshot_revision IS DISTINCT FROM v_snapshot_revision THEN
        SELECT COALESCE(max(revision.revision_no), 0) + 1
          INTO v_revision_no
          FROM public.project_publication_revisions revision
         WHERE revision.publication_id = v_publication_id;

        INSERT INTO public.project_publication_revisions
            (publication_id, tenant_id, project_id, revision_no,
             project_version_id, title, description, tags, license,
             preview_snapshot_revision, published_by_principal_id)
        VALUES (v_publication_id, v_tenant, p_project_id, v_revision_no,
                v_project_version_id, v_title, v_description, v_tags, v_license,
                v_snapshot_revision, p_principal_id)
        RETURNING id INTO v_current_revision_id;
    END IF;

    UPDATE public.project_publication_state
       SET current_revision_id = v_current_revision_id,
           state = 'public',
           published_at = COALESCE(published_at, now()),
           revoked_at = NULL
     WHERE id = v_publication_id;

    -- Keep the pre-R7 Gallery projection byte-for-byte compatible at the API
    -- boundary. Existing reactions, list/detail, and visibility functions keep
    -- reading this row until their dedicated convergence slices.
    INSERT INTO public.project_publications
        (project_id, tenant_id, owner_principal_id, published_by_principal_id,
         title, module_key, author_label, snapshot_revision)
    VALUES (p_project_id, v_tenant, v_owner, p_principal_id,
            v_title, v_module, v_label, v_snapshot_revision)
    ON CONFLICT (project_id) DO UPDATE
        SET title = EXCLUDED.title,
            author_label = EXCLUDED.author_label,
            snapshot_revision = EXCLUDED.snapshot_revision,
            published_at = now();

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION gallery_publish(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gallery_publish(uuid, uuid) TO asalab_app;
