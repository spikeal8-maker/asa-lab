-- R8 editorial choice: voluntary badge for the exact immutable publication revision.
-- No physical pinning/sorting, no changes to Project/Draft/Versions.
CREATE TABLE public.project_publication_editorial (
    publication_id uuid PRIMARY KEY REFERENCES public.project_publication_state(id),
    revision_id uuid NOT NULL,
    featured boolean NOT NULL,
    editorial_version integer NOT NULL CHECK (editorial_version > 0),
    moderation_version integer NOT NULL CHECK (moderation_version >= 0),
    lifecycle_version integer NOT NULL CHECK (lifecycle_version >= 0),
    actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
    acted_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (revision_id, publication_id)
      REFERENCES public.project_publication_revisions(id, publication_id)
);
ALTER TABLE public.project_publication_editorial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_publication_editorial FROM PUBLIC, asalab_app;

-- A new public lifecycle can reuse an immutable revision UUID. Epoch changes
-- therefore cannot be derived from revision_id alone. Keep this counter outside
-- the existing publication state table to preserve historical Project/state rows.
CREATE TABLE public.project_publication_editorial_lifecycle (
    publication_id uuid PRIMARY KEY REFERENCES public.project_publication_state(id),
    lifecycle_version integer NOT NULL CHECK (lifecycle_version > 0)
);
ALTER TABLE public.project_publication_editorial_lifecycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_publication_editorial_lifecycle FROM PUBLIC, asalab_app;

CREATE FUNCTION public.project_publication_editorial_lifecycle_bump()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    -- The UPDATE already owns the state lock; the trigger locks the epoch after
    -- it, preserving Project → state → epoch ordering for publish/revoke.
    INSERT INTO public.project_publication_editorial_lifecycle AS epoch
      (publication_id, lifecycle_version)
    VALUES (NEW.id, 1)
    ON CONFLICT (publication_id) DO UPDATE
      SET lifecycle_version = epoch.lifecycle_version + 1;
    RETURN NEW;
END;
$$;
CREATE TRIGGER project_publication_editorial_lifecycle_update
AFTER UPDATE ON public.project_publication_state
FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state OR
      OLD.current_revision_id IS DISTINCT FROM NEW.current_revision_id)
EXECUTE FUNCTION public.project_publication_editorial_lifecycle_bump();
REVOKE ALL ON FUNCTION public.project_publication_editorial_lifecycle_bump() FROM PUBLIC;

-- Public eligibility can disappear and return without a publication-state
-- mutation: archived→active project and suspended→active account. Any such
-- transition retires the earlier editor decision, even for the same revision.
-- The new counters are isolated from immutable Project/Version bytes.
CREATE FUNCTION public.project_publication_editorial_project_policy_bump()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    -- The Project row is already locked by its canonical writer. Touch only
    -- the separate publication lifecycle counter, never mutate the source.
    INSERT INTO public.project_publication_editorial_lifecycle AS epoch
        (publication_id, lifecycle_version)
    SELECT state.id, 1 FROM public.project_publication_state state
     WHERE state.project_id = NEW.id
    ON CONFLICT (publication_id) DO UPDATE
      SET lifecycle_version = epoch.lifecycle_version + 1;
    RETURN NEW;
END;
$$;
CREATE TRIGGER project_publication_editorial_project_policy_update
AFTER UPDATE OF status, project_scope, classroom_id, owner_principal_id ON public.projects
FOR EACH ROW
WHEN (
    OLD.status IS DISTINCT FROM NEW.status OR
    OLD.project_scope IS DISTINCT FROM NEW.project_scope OR
    OLD.classroom_id IS DISTINCT FROM NEW.classroom_id OR
    OLD.owner_principal_id IS DISTINCT FROM NEW.owner_principal_id
)
EXECUTE FUNCTION public.project_publication_editorial_project_policy_bump();
REVOKE ALL ON FUNCTION public.project_publication_editorial_project_policy_bump() FROM PUBLIC;

CREATE FUNCTION public.project_publication_editorial_account_policy_bump()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    INSERT INTO public.project_publication_editorial_lifecycle AS epoch
        (publication_id, lifecycle_version)
    SELECT state.id, 1
      FROM public.project_publication_state state
      JOIN public.principals owner ON owner.id = state.owner_principal_id
     WHERE owner.account_id = NEW.id
     ORDER BY state.id
    ON CONFLICT (publication_id) DO UPDATE
      SET lifecycle_version = epoch.lifecycle_version + 1;
    RETURN NEW;
END;
$$;
CREATE TRIGGER project_publication_editorial_account_policy_update
AFTER UPDATE OF status ON public.accounts
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.project_publication_editorial_account_policy_bump();
REVOKE ALL ON FUNCTION public.project_publication_editorial_account_policy_bump() FROM PUBLIC;

-- A marker becomes invalid when the author republishes a different revision,
-- moderation takes any subsequent action, or current public access is revoked.
CREATE FUNCTION public.project_publication_featured(p_publication uuid, p_revision uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.project_publication_state state
          JOIN public.project_publication_editorial editorial ON editorial.publication_id = state.id
          LEFT JOIN public.project_publication_moderation moderation
            ON moderation.publication_id = state.id
          LEFT JOIN public.project_publication_editorial_lifecycle epoch
            ON epoch.publication_id = state.id
         WHERE state.id = p_publication
           AND state.current_revision_id = p_revision
           AND editorial.revision_id = p_revision
           AND editorial.featured
           AND editorial.moderation_version = COALESCE(moderation.moderation_version,0)
           AND editorial.lifecycle_version = COALESCE(epoch.lifecycle_version,0)
           AND NOT COALESCE(moderation.hidden,false)
           AND public.project_publication_readable(state.id)
    );
$$;
REVOKE ALL ON FUNCTION public.project_publication_featured(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_publication_featured(uuid,uuid) TO asalab_app;

-- Preserve current admin paging/moderation fields and append separate editorial data.
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
        SELECT state.id, revision.id AS revision_id, revision.title, revision.author_label,
               revision.module_key, revision.published_at, state.state,
               COALESCE(moderation.hidden, false) AS hidden,
               COALESCE(moderation.moderation_version, 0) AS moderation_version, moderation.reason, moderation.acted_at,
               COALESCE(editorial.editorial_version,0) AS editorial_version,
               COALESCE(epoch.lifecycle_version,0) AS lifecycle_version,
               (COALESCE(editorial.featured,false) AND editorial.revision_id = revision.id
                 AND editorial.moderation_version = COALESCE(moderation.moderation_version,0)
                 AND editorial.lifecycle_version = COALESCE(epoch.lifecycle_version,0)
                 AND NOT COALESCE(moderation.hidden,false)) AS featured
          FROM public.project_publication_state state
          JOIN public.project_publication_revisions revision
            ON revision.id = state.current_revision_id AND revision.publication_id = state.id
          LEFT JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
          LEFT JOIN public.project_publication_editorial editorial ON editorial.publication_id = state.id
          LEFT JOIN public.project_publication_editorial_lifecycle epoch ON epoch.publication_id = state.id
         WHERE revision.schema_version = 2 AND (state.state = 'public' OR moderation.hidden)
         ORDER BY revision.published_at DESC, state.id
         LIMIT p_limit + 1 OFFSET p_offset
    ), numbered AS (
        SELECT *, row_number() OVER (ORDER BY published_at DESC, id) AS n FROM page
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'publicationId', id, 'revisionId', revision_id, 'title', title,
        'authorLabel', author_label, 'moduleKey', module_key, 'publishedAt', published_at,
        'state', state, 'hidden', hidden, 'moderationVersion', moderation_version,
        'reason', reason, 'moderatedAt', acted_at,
        'featured', featured, 'editorialVersion', editorial_version,
        'lifecycleVersion', lifecycle_version)
        ORDER BY n) FILTER (WHERE n <= p_limit), '[]'::jsonb), count(*) > p_limit
      INTO v_items, v_more FROM numbered;
    RETURN jsonb_build_object('items', v_items, 'nextOffset', CASE WHEN v_more THEN p_offset + p_limit END);
END;
$$;


REVOKE ALL ON FUNCTION public.admin_publications_list(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publications_list(uuid,integer,integer) TO asalab_app;

CREATE FUNCTION public.admin_publication_feature_set(
    p_actor uuid, p_publication uuid, p_featured boolean, p_request_id varchar,
    p_expected_version integer, p_expected_revision uuid, p_expected_moderation_version integer,
    p_expected_lifecycle_version integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project uuid;
    v_revision uuid;
    v_version integer;
    v_moderation_version integer;
    v_lifecycle_version integer;
    v_current boolean;
BEGIN
    IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_publication IS NULL OR p_featured IS NULL OR
       p_request_id IS NULL OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 OR
       p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 2147483646 OR
       p_expected_moderation_version IS NULL OR p_expected_moderation_version NOT BETWEEN 0 AND 2147483646 OR
       p_expected_lifecycle_version IS NULL OR p_expected_lifecycle_version NOT BETWEEN 0 AND 2147483646 OR
       p_expected_revision IS NULL THEN
        RAISE EXCEPTION 'invalid editorial input' USING ERRCODE = '22023';
    END IF;
    -- Same lock order as publish/revoke/moderation: Project then state.
    SELECT project_id INTO v_project FROM public.project_publication_state WHERE id = p_publication;
    IF v_project IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE = 'P5P04'; END IF;
    PERFORM 1 FROM public.projects WHERE id = v_project FOR UPDATE;
    PERFORM 1 FROM public.project_publication_state state
      JOIN public.project_publication_revisions revision
        ON revision.id = state.current_revision_id AND revision.publication_id = state.id
     WHERE state.id = p_publication AND state.state = 'public' AND revision.schema_version = 2
     FOR UPDATE OF state;
    IF NOT FOUND OR NOT public.project_publication_readable(p_publication) THEN
        RAISE EXCEPTION 'not available' USING ERRCODE = 'P5P04';
    END IF;
    SELECT state.current_revision_id, COALESCE(editorial.editorial_version,0),
           COALESCE(moderation.moderation_version,0), COALESCE(epoch.lifecycle_version,0),
           (COALESCE(editorial.featured,false) AND editorial.revision_id = state.current_revision_id
              AND editorial.moderation_version = COALESCE(moderation.moderation_version,0)
              AND editorial.lifecycle_version = COALESCE(epoch.lifecycle_version,0)
              AND NOT COALESCE(moderation.hidden,false))
      INTO v_revision,v_version,v_moderation_version,v_lifecycle_version,v_current
      FROM public.project_publication_state state
      LEFT JOIN public.project_publication_editorial editorial ON editorial.publication_id = state.id
      LEFT JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
      LEFT JOIN public.project_publication_editorial_lifecycle epoch ON epoch.publication_id = state.id
     WHERE state.id = p_publication;
    IF v_revision IS DISTINCT FROM p_expected_revision OR
       v_version <> p_expected_version OR
       v_moderation_version <> p_expected_moderation_version OR
       v_lifecycle_version <> p_expected_lifecycle_version OR
       v_current IS NOT DISTINCT FROM p_featured OR EXISTS (
        SELECT 1 FROM public.administrative_audit_events
         WHERE actor_principal_id = p_actor AND request_id = trim(p_request_id)
           AND action IN ('publication.feature','publication.unfeature')
    ) THEN RAISE EXCEPTION 'editorial selection changed' USING ERRCODE = 'P5M09'; END IF;

    INSERT INTO public.project_publication_editorial
      (publication_id,revision_id,featured,editorial_version,moderation_version,lifecycle_version,actor_principal_id,acted_at)
    VALUES (p_publication,v_revision,p_featured,v_version+1,v_moderation_version,v_lifecycle_version,p_actor,clock_timestamp())
    ON CONFLICT (publication_id) DO UPDATE SET
      revision_id=EXCLUDED.revision_id, featured=EXCLUDED.featured,
      editorial_version=EXCLUDED.editorial_version, moderation_version=EXCLUDED.moderation_version,
      lifecycle_version=EXCLUDED.lifecycle_version,
      actor_principal_id=EXCLUDED.actor_principal_id, acted_at=EXCLUDED.acted_at;
    PERFORM public.admin_append_audit_event(
        p_actor,'platform',NULL,
        CASE WHEN p_featured THEN 'publication.feature' ELSE 'publication.unfeature' END,
        'project_publication',p_publication::varchar,'publication_editorial',
        CASE WHEN p_featured THEN 'Выбор редакции' ELSE 'Отметка редакции снята' END,
        NULL,p_request_id,NULL,'succeeded',v_version::bigint,(v_version+1)::bigint);
    RETURN jsonb_build_object('publicationId',p_publication,'revisionId',v_revision,
                              'featured',p_featured,'editorialVersion',v_version+1,
                              'lifecycleVersion',v_lifecycle_version);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_publication_feature_set(uuid,uuid,boolean,varchar,integer,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publication_feature_set(uuid,uuid,boolean,varchar,integer,uuid,integer,integer) TO asalab_app;
