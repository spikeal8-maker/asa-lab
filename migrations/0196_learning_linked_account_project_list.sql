-- A5-B: an Account may list a linked Seat's exact immutable-origin Project,
-- even when its Project tenant differs from the Account's active workspace.
-- This reader returns only card fields and reuses the exact linked access
-- predicate; the app role has no direct origin-table privilege.
CREATE FUNCTION public.learning_linked_account_project_list(
    p_viewer_principal_id uuid, p_status text, p_module text,
    p_search text, p_exclude_games boolean, p_sort text,
    p_after_id uuid, p_after_value text, p_limit integer
)
RETURNS TABLE (project jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH linked AS MATERIALIZED (
      SELECT DISTINCT origin.project_id
        FROM public.learning_project_origins origin
        JOIN public.principals actor ON actor.id = p_viewer_principal_id
          AND actor.kind = 'account'
        JOIN public.learner_identity_links account_link
          ON account_link.account_id = actor.account_id
         AND account_link.tenant_id = origin.school_tenant_id
         AND account_link.school_id = origin.school_id
         AND account_link.learner_identity_id = origin.learner_identity_id
         AND account_link.link_kind = 'account'
         AND account_link.status = 'active'
       WHERE public.learning_linked_project_access(
         p_viewer_principal_id, origin.project_id)
    )
    SELECT jsonb_build_object(
        'id', p.id,
        'project_scope', p.project_scope,
        'classroom_id', p.classroom_id,
        'module_key', p.module_key,
        'title', p.title,
        'status', p.status,
        'created_at', p.created_at,
        'updated_at', d.updated_at,
        'preview_json', d.preview_json,
        'preview_digest', d.preview_digest,
        'snapshot_revision', s.source_revision,
        'copied_from_project_id', p.copied_from_project_id,
        'copied_from_author', p.copied_from_author,
        'copied_from_title', p.copied_from_title,
        'copied_at', p.copied_at,
        'description', p.description,
        'tags', p.tags,
        'license', p.license
    )
      FROM linked
      JOIN public.projects p ON p.id = linked.project_id
      JOIN public.project_drafts d ON d.tenant_id = p.tenant_id
        AND d.project_id = p.id
      LEFT JOIN public.project_snapshots s ON s.tenant_id = p.tenant_id
        AND s.project_id = p.id
     WHERE EXISTS (
         SELECT 1 FROM public.project_context_for_principal(
           p_viewer_principal_id, p.id))
       AND p.project_scope = 'personal'
       AND p.status = p_status
       AND (p_module IS NULL OR p.module_key = p_module)
       AND (p_search IS NULL OR strpos(lower(p.title),lower(p_search)) > 0)
       AND (NOT p_exclude_games OR p.module_key NOT IN ('chess','checkers'))
       AND (p_after_id IS NULL OR CASE p_sort
            WHEN 'title' THEN (p.title COLLATE "C",p.id) >
              (p_after_value COLLATE "C",p_after_id)
            WHEN 'oldest' THEN
              (date_trunc('milliseconds',d.updated_at),p.id) >
              (p_after_value::timestamptz,p_after_id)
            WHEN 'recent' THEN
              (date_trunc('milliseconds',d.updated_at),p.id) <
              (p_after_value::timestamptz,p_after_id)
            ELSE false END)
       AND p_sort IN ('recent','oldest','title')
       AND p_limit BETWEEN 1 AND 100
     ORDER BY
       CASE WHEN p_sort = 'title' THEN p.title COLLATE "C" END ASC,
       CASE WHEN p_sort = 'oldest' THEN date_trunc('milliseconds',d.updated_at) END ASC,
       CASE WHEN p_sort = 'recent' THEN date_trunc('milliseconds',d.updated_at) END DESC,
       CASE WHEN p_sort IN ('title','oldest') THEN p.id END ASC,
       CASE WHEN p_sort = 'recent' THEN p.id END DESC
     LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.learning_linked_account_project_list(
    uuid,text,text,text,boolean,text,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_linked_account_project_list(
    uuid,text,text,text,boolean,text,uuid,text,integer) TO asalab_app;
