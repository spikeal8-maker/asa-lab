-- Reuse the same selected avatar sources for comments and publication authors.
CREATE FUNCTION public.publication_actor_avatar_source(p_actor uuid,p_pixels boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor public.principals%ROWTYPE; image text; key text; available boolean;
BEGIN
 SELECT * INTO actor FROM public.principals WHERE id=p_actor;
 IF actor.kind='account' THEN
 SELECT true,CASE WHEN p_pixels THEN profile.avatar_data_url ELSE NULL END INTO available,image
 FROM public.profiles profile JOIN public.accounts account ON account.id=profile.account_id AND account.status='active'
 WHERE profile.account_id=actor.account_id AND profile.avatar_data_url IS NOT NULL;
 ELSIF actor.kind='student_seat' THEN
 IF NOT EXISTS(SELECT 1 FROM public.classroom_student_seats seat WHERE seat.id=actor.seat_id
 AND public.project_publication_seat_active(actor.id,seat.tenant_id,seat.classroom_id)) THEN RETURN NULL; END IF;
 SELECT true,CASE WHEN p_pixels THEN avatar.data_url ELSE NULL END INTO available,image
 FROM public.classroom_custom_avatar_choices choice JOIN public.classroom_custom_avatars avatar ON avatar.id=choice.avatar_id
 WHERE choice.seat_id=actor.seat_id AND public.classroom_participant_avatar_available(actor.seat_id,avatar.id);
 IF NOT COALESCE(available,false) THEN
 SELECT avatar_key INTO key FROM public.classroom_student_seats WHERE id=actor.seat_id;
 available:=key ~ '^asa-avatar-(0[1-9]|[1-5][0-9]|6[0-7])$';
 END IF;
 END IF;
 IF NOT COALESCE(available,false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('dataUrl',image,'builtinKey',key);
END; $$;
REVOKE ALL ON FUNCTION public.publication_actor_avatar_source(uuid,boolean) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION public.publication_comment_avatar(p_publication uuid,p_comment uuid,p_pixels boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.publication_comments%ROWTYPE; source jsonb;
BEGIN
 IF NOT public.project_publication_readable(p_publication) THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.publication_comments WHERE id=p_comment AND publication_id=p_publication
 AND NOT(author_deleted OR owner_hidden OR moderator_hidden);
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF c.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.publication_comments parent WHERE parent.id=c.parent_id
 AND parent.publication_id=p_publication AND NOT(parent.author_deleted OR parent.owner_hidden OR parent.moderator_hidden)) THEN RETURN NULL; END IF;
 source:=public.publication_actor_avatar_source(c.author_principal_id,p_pixels);
 IF source IS NULL THEN RETURN NULL; END IF;
 RETURN source||jsonb_build_object('url','/api/public-projects/'||p_publication||'/comments/'||p_comment||'/avatar');
END; $$;

CREATE FUNCTION public.project_publication_author_avatar(p_publication uuid,p_pixels boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE author uuid; source jsonb;
BEGIN
 IF NOT public.project_publication_readable(p_publication) THEN RETURN NULL; END IF;
 SELECT revision.published_by_principal_id INTO author FROM public.project_publication_state state
 JOIN public.project_publication_revisions revision ON revision.id=state.current_revision_id AND revision.publication_id=state.id WHERE state.id=p_publication;
 source:=public.publication_actor_avatar_source(author,p_pixels);
 IF source IS NULL THEN RETURN NULL; END IF;
 RETURN source||jsonb_build_object('url','/api/public-projects/'||p_publication||'/author-avatar');
END; $$;
REVOKE ALL ON FUNCTION public.project_publication_author_avatar(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_publication_author_avatar(uuid,boolean) TO asalab_app;

-- A catalog projection only: Games storage, publication links and game APIs stay intact.
CREATE FUNCTION public.public_projects_catalog_read(p_publication_id uuid,p_query text,p_module_key varchar,p_limit integer,p_offset integer)
RETURNS TABLE(publication_id uuid,revision_id uuid,revision_no integer,version_no integer,
title varchar,summary text,description text,tags text[],license varchar,module_key varchar,author_label varchar,published_at timestamptz,
preview_content_type varchar,preview_width integer,preview_height integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT state.id,revision.id,revision.revision_no,version.version_no,revision.title,revision.summary,revision.description,revision.tags,revision.license,
 revision.module_key,public.project_publication_author_label(revision.published_by_principal_id,revision.author_label),revision.published_at,
 revision.preview_content_type,revision.preview_width,revision.preview_height
 FROM public.project_publication_state state JOIN public.project_publication_revisions revision ON revision.id=state.current_revision_id AND revision.publication_id=state.id
 JOIN public.project_versions version ON version.id=revision.project_version_id
 WHERE public.project_publication_readable(state.id) AND revision.module_key IN('three-d','electronics','blocks')
 AND (p_publication_id IS NULL OR state.id=p_publication_id) AND(p_module_key IS NULL OR revision.module_key=p_module_key)
 AND(NULLIF(trim(p_query),'') IS NULL OR strpos(lower(concat_ws(' ',revision.title,revision.description,array_to_string(revision.tags,' '))),lower(left(trim(p_query),120)))>0)
 ORDER BY public.project_publication_pinned(state.id,revision.id) DESC,revision.published_at DESC,state.id DESC
 LIMIT greatest(1,least(COALESCE(p_limit,24),49)) OFFSET greatest(0,least(COALESCE(p_offset,0),1000000));
$$;
REVOKE ALL ON FUNCTION public.public_projects_catalog_read(uuid,text,varchar,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_projects_catalog_read(uuid,text,varchar,integer,integer) TO asalab_app;
