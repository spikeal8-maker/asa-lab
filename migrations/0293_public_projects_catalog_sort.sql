-- Server-side catalog ordering happens before pagination. Existing callers retain newest-first behavior.
CREATE FUNCTION public.public_projects_catalog_read(p_publication_id uuid,p_query text,p_module_key varchar,p_limit integer,p_offset integer,p_sort text)
RETURNS TABLE(publication_id uuid,revision_id uuid,revision_no integer,version_no integer,
title varchar,summary text,description text,tags text[],license varchar,module_key varchar,author_label varchar,published_at timestamptz,
preview_content_type varchar,preview_width integer,preview_height integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT state.id,revision.id,revision.revision_no,version.version_no,revision.title,revision.summary,revision.description,revision.tags,revision.license,
 revision.module_key,public.project_publication_author_label(revision.published_by_principal_id,revision.author_label),revision.published_at,
 revision.preview_content_type,revision.preview_width,revision.preview_height
 FROM public.project_publication_state state JOIN public.project_publication_revisions revision ON revision.id=state.current_revision_id AND revision.publication_id=state.id
 JOIN public.project_versions version ON version.id=revision.project_version_id
 WHERE p_sort IN('newest','oldest','likes','copies') AND public.project_publication_readable(state.id) AND revision.module_key IN('three-d','electronics','blocks')
 AND (p_publication_id IS NULL OR state.id=p_publication_id) AND(p_module_key IS NULL OR revision.module_key=p_module_key)
 AND(NULLIF(trim(p_query),'') IS NULL OR strpos(lower(concat_ws(' ',revision.title,revision.description,array_to_string(revision.tags,' '))),lower(left(trim(p_query),120)))>0)
 ORDER BY CASE WHEN p_sort='newest' THEN public.project_publication_pinned(state.id,revision.id) ELSE false END DESC,
 CASE WHEN p_sort='likes' THEN public.publication_like_count(state.id) END DESC,
 CASE WHEN p_sort='copies' THEN public.publication_copy_count(state.id) END DESC,
 CASE WHEN p_sort='oldest' THEN revision.published_at END ASC,revision.published_at DESC,state.id DESC
 LIMIT greatest(1,least(COALESCE(p_limit,24),49)) OFFSET greatest(0,least(COALESCE(p_offset,0),1000000));
$$;
REVOKE ALL ON FUNCTION public.public_projects_catalog_read(uuid,text,varchar,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_projects_catalog_read(uuid,text,varchar,integer,integer,text) TO asalab_app;

CREATE OR REPLACE FUNCTION public.public_projects_catalog_read(p_publication_id uuid,p_query text,p_module_key varchar,p_limit integer,p_offset integer)
RETURNS TABLE(publication_id uuid,revision_id uuid,revision_no integer,version_no integer,
title varchar,summary text,description text,tags text[],license varchar,module_key varchar,author_label varchar,published_at timestamptz,
preview_content_type varchar,preview_width integer,preview_height integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT * FROM public.public_projects_catalog_read(p_publication_id,p_query,p_module_key,p_limit,p_offset,'newest');
$$;
