-- Administrative metadata includes retained legacy publications.
-- Public reads, images, copy, moderation and immutable snapshots are unchanged.
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
               COALESCE(revision.module_key, 'legacy') AS module_key,
               revision.published_at, revision.schema_version, state.state,
               COALESCE(moderation.hidden, false) AS hidden,
               COALESCE(moderation.moderation_version, 0) AS moderation_version, moderation.reason, moderation.acted_at,
               COALESCE(editorial.editorial_version,0) AS editorial_version,
               COALESCE(epoch.lifecycle_version,0) AS lifecycle_version,
               (COALESCE(editorial.featured,false) AND editorial.revision_id = revision.id
                 AND editorial.moderation_version = COALESCE(moderation.moderation_version,0)
                 AND editorial.lifecycle_version = COALESCE(epoch.lifecycle_version,0)
                 AND NOT COALESCE(moderation.hidden,false)
                 AND public.project_publication_readable(state.id)) AS featured,
               (state.state = 'public' AND NOT COALESCE(moderation.hidden,false)
                 AND public.project_publication_readable(state.id)) AS editorial_eligible
          FROM public.project_publication_state state
          JOIN public.project_publication_revisions revision
            ON revision.id = state.current_revision_id AND revision.publication_id = state.id
          LEFT JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
          LEFT JOIN public.project_publication_editorial editorial ON editorial.publication_id = state.id
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
        'editorialVersion', editorial_version, 'lifecycleVersion', lifecycle_version)
        ORDER BY n) FILTER (WHERE n <= p_limit), '[]'::jsonb), count(*) > p_limit
      INTO v_items, v_more FROM numbered;
    RETURN jsonb_build_object('items', v_items, 'nextOffset', CASE WHEN v_more THEN p_offset + p_limit END);
END;
$$;


REVOKE ALL ON FUNCTION public.admin_publications_list(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publications_list(uuid,integer,integer) TO asalab_app;

