-- Additive distribution control; originals and immutable revisions stay untouched.
CREATE TABLE public.project_publication_moderation (
    publication_id uuid PRIMARY KEY REFERENCES public.project_publication_state(id),
    hidden boolean NOT NULL,
    reason text,
    acted_at timestamptz NOT NULL DEFAULT now(),
    actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
    CHECK ((hidden AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 500)
        OR (NOT hidden AND reason IS NULL))
);
ALTER TABLE public.project_publication_moderation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_publication_moderation FROM PUBLIC, asalab_app;
CREATE OR REPLACE FUNCTION public.project_publication_readable(p_publication_id uuid)
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
          AND NOT EXISTS (
              SELECT 1 FROM public.project_publication_moderation moderation
               WHERE moderation.publication_id = state.id AND moderation.hidden
          )
          AND revision.schema_version = 2
          AND public.project_publication_policy_reason(state.project_id) IS NULL
    );
$$;

-- Owner-only reason projection. A platform administrator gets no owner identity
-- shortcut here; administrative reads use the separately authorized functions.
CREATE FUNCTION public.project_publication_owner_moderation_reason(p_actor uuid, p_project uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT moderation.reason
      FROM public.projects project
      JOIN public.principals actor ON actor.id = project.owner_principal_id AND actor.kind = 'account'
      JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
      JOIN public.project_publication_state state
        ON state.project_id = project.id AND state.owner_principal_id = actor.id
       AND state.tenant_id = project.tenant_id
      JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
     WHERE project.id = p_project AND actor.id = p_actor AND moderation.hidden;
$$;
REVOKE ALL ON FUNCTION public.project_publication_owner_moderation_reason(uuid,uuid) FROM PUBLIC, asalab_app;

CREATE OR REPLACE FUNCTION public.project_publication_status(p_principal_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reason text; v_publication jsonb; v_moderation_reason text;
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

    v_moderation_reason := public.project_publication_owner_moderation_reason(p_principal_id, p_project_id);
    RETURN jsonb_build_object('publication', v_publication,
                              'canPublish', v_reason IS NULL, 'reasonCode', v_reason)
        || CASE WHEN v_moderation_reason IS NOT NULL
                THEN jsonb_build_object('moderationReason', v_moderation_reason)
                ELSE '{}'::jsonb END;
END;
$$;


CREATE FUNCTION public.admin_publications_list(p_actor uuid, p_offset integer, p_limit integer)
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
               COALESCE(moderation.hidden, false) AS hidden, moderation.reason, moderation.acted_at
          FROM public.project_publication_state state
          JOIN public.project_publication_revisions revision
            ON revision.id = state.current_revision_id AND revision.publication_id = state.id
          LEFT JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
         WHERE revision.schema_version = 2 AND (state.state = 'public' OR moderation.hidden)
         ORDER BY revision.published_at DESC, state.id
         LIMIT p_limit + 1 OFFSET p_offset
    ), numbered AS (
        SELECT *, row_number() OVER (ORDER BY published_at DESC, id) AS n FROM page
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'publicationId', id, 'revisionId', revision_id, 'title', title,
        'authorLabel', author_label, 'moduleKey', module_key, 'publishedAt', published_at,
        'state', state, 'hidden', hidden, 'reason', reason, 'moderatedAt', acted_at)
        ORDER BY n) FILTER (WHERE n <= p_limit), '[]'::jsonb), count(*) > p_limit
      INTO v_items, v_more FROM numbered;
    RETURN jsonb_build_object('items', v_items, 'nextOffset', CASE WHEN v_more THEN p_offset + p_limit END);
END;
$$;

CREATE FUNCTION public.admin_publication_image(p_actor uuid, p_publication uuid)
RETURNS TABLE (image bytea, content_type varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative scope denied' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT revision.preview_image, revision.preview_content_type
      FROM public.project_publication_state state
      JOIN public.project_publication_revisions revision
        ON revision.id = state.current_revision_id AND revision.publication_id = state.id
      LEFT JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
     WHERE state.id = p_publication AND revision.schema_version = 2
       AND (state.state = 'public' OR moderation.hidden);
END;
$$;

CREATE FUNCTION public.admin_publication_transition(
    p_actor uuid, p_publication uuid, p_hidden boolean, p_reason text, p_request_id varchar
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_project uuid; v_before boolean; v_at timestamptz;
BEGIN
    IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_hidden IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500
       OR p_request_id IS NULL OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid moderation input' USING ERRCODE = '22023';
    END IF;
    -- Initial lookup acquires no state lock. Publish/revoke/copy lock Project first.
    SELECT project_id INTO v_project FROM public.project_publication_state WHERE id = p_publication;
    IF v_project IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE = 'P5P04'; END IF;
    PERFORM 1 FROM public.projects WHERE id = v_project FOR UPDATE;
    PERFORM 1 FROM public.project_publication_state state
      JOIN public.project_publication_revisions revision
        ON revision.id = state.current_revision_id AND revision.publication_id = state.id
     WHERE state.id = p_publication AND revision.schema_version = 2
     FOR UPDATE OF state;
    IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE = 'P5P04'; END IF;
    SELECT COALESCE((SELECT hidden FROM public.project_publication_moderation
                     WHERE publication_id = p_publication), false) INTO v_before;
    IF v_before = p_hidden OR EXISTS (
        SELECT 1 FROM public.administrative_audit_events
         WHERE actor_principal_id = p_actor AND request_id = trim(p_request_id)
           AND action IN ('publication.hide', 'publication.restore')
    ) THEN RAISE EXCEPTION 'moderation state changed' USING ERRCODE = 'P5M09'; END IF;
    v_at := clock_timestamp();
    INSERT INTO public.project_publication_moderation
        (publication_id, hidden, reason, acted_at, actor_principal_id)
    VALUES (p_publication, p_hidden, CASE WHEN p_hidden THEN trim(p_reason) END, v_at, p_actor)
    ON CONFLICT (publication_id) DO UPDATE SET hidden = EXCLUDED.hidden, reason = EXCLUDED.reason,
        acted_at = EXCLUDED.acted_at, actor_principal_id = EXCLUDED.actor_principal_id;
    PERFORM public.admin_append_audit_event(p_actor, 'platform', NULL,
        CASE WHEN p_hidden THEN 'publication.hide' ELSE 'publication.restore' END,
        'project_publication', p_publication::varchar, 'publication_moderation', trim(p_reason)::varchar,
        NULL, p_request_id, NULL, 'succeeded', v_before::integer::bigint, p_hidden::integer::bigint);
    RETURN jsonb_build_object('publicationId', p_publication, 'hidden', p_hidden,
        'reason', CASE WHEN p_hidden THEN trim(p_reason) END, 'moderatedAt', v_at);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_publications_list(uuid,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publication_image(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publication_transition(uuid,uuid,boolean,text,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publications_list(uuid,integer,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.admin_publication_image(uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.admin_publication_transition(uuid,uuid,boolean,text,varchar) TO asalab_app;
