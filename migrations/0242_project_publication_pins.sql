-- R8-03C: independent pin for exact immutable publication revisions.
-- Existing Project/Draft/Version bytes and migration history remain unchanged.
CREATE TABLE public.project_publication_pin (
    publication_id uuid PRIMARY KEY REFERENCES public.project_publication_state(id),
    revision_id uuid NOT NULL,
    pinned boolean NOT NULL,
    pin_version integer NOT NULL CHECK (pin_version > 0),
    moderation_version integer NOT NULL CHECK (moderation_version >= 0),
    lifecycle_version integer NOT NULL CHECK (lifecycle_version >= 0),
    actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
    acted_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (revision_id, publication_id)
      REFERENCES public.project_publication_revisions(id, publication_id)
);
ALTER TABLE public.project_publication_pin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_publication_pin FROM PUBLIC, asalab_app;

CREATE FUNCTION public.project_publication_pinned(p_publication uuid, p_revision uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.project_publication_state state
          JOIN public.project_publication_pin pin ON pin.publication_id = state.id
          LEFT JOIN public.project_publication_moderation moderation
            ON moderation.publication_id = state.id
          LEFT JOIN public.project_publication_editorial_lifecycle epoch
            ON epoch.publication_id = state.id
         WHERE state.id = p_publication
           AND state.current_revision_id = p_revision
           AND pin.revision_id = p_revision
           AND pin.pinned
           AND pin.moderation_version = COALESCE(moderation.moderation_version,0)
           AND pin.lifecycle_version = COALESCE(epoch.lifecycle_version,0)
           AND NOT COALESCE(moderation.hidden,false)
           AND public.project_publication_readable(state.id)
    );
$$;
REVOKE ALL ON FUNCTION public.project_publication_pinned(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_publication_pinned(uuid,uuid) TO asalab_app;

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
    ORDER BY public.project_publication_pinned(state.id, revision.id) DESC,
             revision.published_at DESC, state.id DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 24), 49))
    OFFSET greatest(0, least(COALESCE(p_offset, 0), 1000000));
$$;

REVOKE ALL ON FUNCTION public.public_projects_read(uuid,text,varchar,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_projects_read(uuid,text,varchar,integer,integer) TO asalab_app;

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
        'featured', featured, 'editorialEligible', editorial_eligible,
        'pinned', pinned, 'pinVersion', pin_version,
        'editorialVersion', editorial_version, 'lifecycleVersion', lifecycle_version)
        ORDER BY n) FILTER (WHERE n <= p_limit), '[]'::jsonb), count(*) > p_limit
      INTO v_items, v_more FROM numbered;
    RETURN jsonb_build_object('items', v_items, 'nextOffset', CASE WHEN v_more THEN p_offset + p_limit END);
END;
$$;


REVOKE ALL ON FUNCTION public.admin_publications_list(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publications_list(uuid,integer,integer) TO asalab_app;

CREATE FUNCTION public.admin_publication_pin_set(
    p_actor uuid, p_publication uuid, p_pinned boolean, p_request_id varchar,
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
    IF p_publication IS NULL OR p_pinned IS NULL OR
       p_request_id IS NULL OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 OR
       p_expected_version IS NULL OR p_expected_version NOT BETWEEN 0 AND 2147483646 OR
       p_expected_moderation_version IS NULL OR p_expected_moderation_version NOT BETWEEN 0 AND 2147483646 OR
       p_expected_lifecycle_version IS NULL OR p_expected_lifecycle_version NOT BETWEEN 0 AND 2147483646 OR
       p_expected_revision IS NULL THEN
        RAISE EXCEPTION 'invalid pin input' USING ERRCODE = '22023';
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
    SELECT state.current_revision_id, COALESCE(pin.pin_version,0),
           COALESCE(moderation.moderation_version,0), COALESCE(epoch.lifecycle_version,0),
           (COALESCE(pin.pinned,false) AND pin.revision_id = state.current_revision_id
              AND pin.moderation_version = COALESCE(moderation.moderation_version,0)
              AND pin.lifecycle_version = COALESCE(epoch.lifecycle_version,0)
              AND NOT COALESCE(moderation.hidden,false))
      INTO v_revision,v_version,v_moderation_version,v_lifecycle_version,v_current
      FROM public.project_publication_state state
      LEFT JOIN public.project_publication_pin pin ON pin.publication_id = state.id
      LEFT JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
      LEFT JOIN public.project_publication_editorial_lifecycle epoch ON epoch.publication_id = state.id
     WHERE state.id = p_publication;
    IF v_revision IS DISTINCT FROM p_expected_revision OR
       v_version <> p_expected_version OR
       v_moderation_version <> p_expected_moderation_version OR
       v_lifecycle_version <> p_expected_lifecycle_version OR
       v_current IS NOT DISTINCT FROM p_pinned OR EXISTS (
        SELECT 1 FROM public.administrative_audit_events
         WHERE actor_principal_id = p_actor AND request_id = trim(p_request_id)
           AND action IN ('publication.pin','publication.unpin')
    ) THEN RAISE EXCEPTION 'pin selection changed' USING ERRCODE = 'P5M09'; END IF;

    INSERT INTO public.project_publication_pin
      (publication_id,revision_id,pinned,pin_version,moderation_version,lifecycle_version,actor_principal_id,acted_at)
    VALUES (p_publication,v_revision,p_pinned,v_version+1,v_moderation_version,v_lifecycle_version,p_actor,clock_timestamp())
    ON CONFLICT (publication_id) DO UPDATE SET
      revision_id=EXCLUDED.revision_id, pinned=EXCLUDED.pinned,
      pin_version=EXCLUDED.pin_version, moderation_version=EXCLUDED.moderation_version,
      lifecycle_version=EXCLUDED.lifecycle_version,
      actor_principal_id=EXCLUDED.actor_principal_id, acted_at=EXCLUDED.acted_at;
    PERFORM public.admin_append_audit_event(
        p_actor,'platform',NULL,
        CASE WHEN p_pinned THEN 'publication.pin' ELSE 'publication.unpin' END,
        'project_publication',p_publication::varchar,'publication_pin',
        CASE WHEN p_pinned THEN 'Публикация закреплена' ELSE 'Закрепление снято' END,
        NULL,p_request_id,NULL,'succeeded',v_version::bigint,(v_version+1)::bigint);
    RETURN jsonb_build_object('publicationId',p_publication,'revisionId',v_revision,
                              'pinned',p_pinned,'pinVersion',v_version+1,
                              'lifecycleVersion',v_lifecycle_version);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_publication_pin_set(uuid,uuid,boolean,varchar,integer,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publication_pin_set(uuid,uuid,boolean,varchar,integer,uuid,integer,integer) TO asalab_app;
