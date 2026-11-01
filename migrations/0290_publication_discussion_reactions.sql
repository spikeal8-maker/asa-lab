-- Persisted comment reactions and a single pinned root per publication.
ALTER TABLE public.publication_comments ADD COLUMN like_count integer NOT NULL DEFAULT 0 CHECK(like_count>=0);
ALTER TABLE public.project_publication_state ADD COLUMN pinned_comment_id uuid REFERENCES public.publication_comments(id);
CREATE INDEX publication_comments_popular ON public.publication_comments(publication_id,parent_id,like_count DESC,created_at DESC,id DESC);
CREATE TABLE public.publication_comment_likes (
 comment_id uuid NOT NULL REFERENCES public.publication_comments(id),
 principal_id uuid NOT NULL REFERENCES public.principals(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(comment_id,principal_id)
);
ALTER TABLE public.publication_comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_comment_likes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.publication_comment_likes FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION public.publication_comment_state(p_actor uuid,p_publication uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('authenticated',p_actor IS NOT NULL,'enabled',s.comments_enabled,'adminEnabled',s.comments_admin_enabled,
 'version',s.comments_version,'revisionId',s.current_revision_id,'canManage',COALESCE(s.owner_principal_id=p_actor,false),
 'canPin',COALESCE(s.owner_principal_id=p_actor,false) OR public.admin_authorized_role(p_actor,'platform',NULL) IS NOT DISTINCT FROM 'platform_admin',
 'canComment',COALESCE(s.comments_enabled AND s.comments_admin_enabled AND public.publication_comment_allowed(p_actor),false),
 'reason',CASE WHEN NOT s.comments_enabled OR NOT s.comments_admin_enabled THEN 'closed'
 WHEN p_actor IS NULL THEN 'sign_in' WHEN NOT public.publication_comment_allowed(p_actor) THEN 'permission' ELSE NULL END)
 FROM public.project_publication_state s WHERE s.id=p_publication;
$$;

CREATE OR REPLACE FUNCTION public.publication_comment_dto(c public.publication_comments,p_actor uuid,p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',c.id,'parentId',c.parent_id,'createdAt',c.created_at,'version',c.version,
 'status',CASE WHEN c.author_deleted THEN 'deleted' WHEN c.moderator_hidden THEN 'moderator_hidden' WHEN c.owner_hidden THEN 'owner_hidden' ELSE 'visible' END,
 'body',CASE WHEN c.author_deleted OR c.moderator_hidden OR c.owner_hidden THEN NULL ELSE c.body END,
 'author',CASE WHEN c.author_deleted OR c.moderator_hidden OR c.owner_hidden THEN NULL ELSE public.publication_comment_label(c.author_principal_id) END,
 'canDelete',COALESCE(c.author_principal_id=p_actor AND NOT c.author_deleted,false),
 'canManage',COALESCE(p_owner=p_actor AND NOT c.author_deleted AND NOT c.moderator_hidden,false),
 'replyCount',(SELECT count(*)::integer FROM public.publication_comments r WHERE r.parent_id=c.id),
 'likeCount',CASE WHEN c.author_deleted OR c.owner_hidden OR c.moderator_hidden THEN 0 ELSE c.like_count END,
 'liked',EXISTS(SELECT 1 FROM public.publication_comment_likes l WHERE l.comment_id=c.id AND public.publication_reaction_same_identity(p_actor,l.principal_id)),
 'canLike',p_actor IS NOT NULL AND NOT(c.author_deleted OR c.owner_hidden OR c.moderator_hidden)
 AND NOT public.publication_reaction_same_identity(p_actor,c.author_principal_id),
 'pinned',EXISTS(SELECT 1 FROM public.project_publication_state s WHERE s.id=c.publication_id AND s.pinned_comment_id=c.id));
$$;

CREATE FUNCTION public.publication_comments_read(p_actor uuid,p_hash varchar,p_publication uuid,p_parent uuid,p_before uuid,p_limit integer,p_sort text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; cursor_row public.publication_comments%ROWTYPE;
 pin public.publication_comments%ROWTYPE; items jsonb; more boolean; last_id uuid;
BEGIN
 IF p_actor IS NOT NULL AND NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF p_sort IS NULL OR p_sort NOT IN('newest','oldest','popular') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication;
 IF NOT FOUND OR NOT public.project_publication_readable(p_publication) THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF p_parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.publication_comments c WHERE c.id=p_parent AND c.publication_id=p_publication
 AND c.parent_id IS NULL AND NOT(c.author_deleted OR c.owner_hidden OR c.moderator_hidden)) THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF p_parent IS NULL THEN SELECT * INTO pin FROM public.publication_comments c WHERE c.id=s.pinned_comment_id AND c.publication_id=p_publication
 AND c.parent_id IS NULL AND NOT(c.author_deleted OR c.owner_hidden OR c.moderator_hidden); END IF;
 IF p_before IS NOT NULL THEN
 SELECT * INTO cursor_row FROM public.publication_comments WHERE id=p_before AND publication_id=p_publication AND parent_id IS NOT DISTINCT FROM p_parent;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid cursor' USING ERRCODE='22023'; END IF;
 END IF;
 WITH page AS MATERIALIZED (SELECT c.* FROM public.publication_comments c WHERE c.publication_id=p_publication
 -- Keep the pinned root in ordinary pages as well: older clients ignore the
 -- extra pinnedComment projection and must not lose access to that comment.
 AND c.parent_id IS NOT DISTINCT FROM p_parent
 AND (p_before IS NULL OR CASE WHEN p_sort='oldest' THEN (c.created_at,c.id)>(cursor_row.created_at,cursor_row.id)
 WHEN p_sort='popular' THEN (c.like_count,c.created_at,c.id)<(cursor_row.like_count,cursor_row.created_at,cursor_row.id)
 ELSE (c.created_at,c.id)<(cursor_row.created_at,cursor_row.id) END)
 ORDER BY CASE WHEN p_sort='popular' THEN c.like_count ELSE 0 END DESC,
 CASE WHEN p_sort='oldest' THEN c.created_at END ASC,
 CASE WHEN p_sort<>'oldest' THEN c.created_at END DESC,
 CASE WHEN p_sort='oldest' THEN c.id END ASC,CASE WHEN p_sort<>'oldest' THEN c.id END DESC LIMIT p_limit+1),
 shown AS MATERIALIZED (SELECT * FROM page ORDER BY CASE WHEN p_sort='popular' THEN like_count ELSE 0 END DESC,
 CASE WHEN p_sort='oldest' THEN created_at END ASC,CASE WHEN p_sort<>'oldest' THEN created_at END DESC,
 CASE WHEN p_sort='oldest' THEN id END ASC,CASE WHEN p_sort<>'oldest' THEN id END DESC LIMIT p_limit)
 SELECT COALESCE(jsonb_agg(public.publication_comment_dto(c,p_actor,s.owner_principal_id) ORDER BY
 CASE WHEN p_sort='popular' THEN c.like_count ELSE 0 END DESC,
 CASE WHEN p_sort='oldest' THEN c.created_at END ASC,CASE WHEN p_sort<>'oldest' THEN c.created_at END DESC,
 CASE WHEN p_sort='oldest' THEN c.id END ASC,CASE WHEN p_sort<>'oldest' THEN c.id END DESC),'[]'::jsonb),
 (SELECT count(*)>p_limit FROM page),
 (SELECT id FROM shown ORDER BY CASE WHEN p_sort='popular' THEN like_count ELSE 0 END ASC,
 CASE WHEN p_sort='oldest' THEN created_at END DESC,CASE WHEN p_sort<>'oldest' THEN created_at END ASC,
 CASE WHEN p_sort='oldest' THEN id END DESC,CASE WHEN p_sort<>'oldest' THEN id END ASC LIMIT 1)
 INTO items,more,last_id FROM shown c;
 RETURN jsonb_build_object('state',public.publication_comment_state(p_actor,p_publication),'items',items,
 'pinnedComment',CASE WHEN pin.id IS NULL THEN NULL ELSE public.publication_comment_dto(pin,p_actor,s.owner_principal_id) END,
 'nextCursor',CASE WHEN more THEN last_id ELSE NULL END);
END; $$;

CREATE OR REPLACE FUNCTION public.publication_comments_read(p_actor uuid,p_hash varchar,p_publication uuid,p_parent uuid,p_before uuid,p_limit integer)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.publication_comments_read(p_actor,p_hash,p_publication,p_parent,p_before,p_limit,'newest');
$$;

CREATE FUNCTION public.publication_comment_react(p_actor uuid,p_hash varchar,p_publication uuid,p_comment uuid,p_on boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; c public.publication_comments%ROWTYPE; n integer; v_project uuid;
BEGIN
 IF NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF p_on IS NULL THEN RAISE EXCEPTION 'invalid reaction' USING ERRCODE='22023'; END IF;
 SELECT project_id INTO v_project FROM public.project_publication_state WHERE id=p_publication;
 PERFORM 1 FROM public.projects WHERE id=v_project FOR SHARE;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 SELECT * INTO c FROM public.publication_comments WHERE id=p_comment AND publication_id=p_publication FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF NOT p_on THEN
 DELETE FROM public.publication_comment_likes l WHERE comment_id=c.id AND public.publication_reaction_same_identity(p_actor,l.principal_id);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n>0 THEN UPDATE public.publication_comments SET like_count=like_count-n WHERE id=c.id RETURNING * INTO c; END IF;
 IF NOT public.project_publication_readable(p_publication) THEN RETURN '{"removed":true}'; END IF;
 ELSE
 IF NOT public.project_publication_readable(p_publication) OR c.author_deleted OR c.owner_hidden OR c.moderator_hidden THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF public.publication_reaction_same_identity(p_actor,c.author_principal_id) THEN RAISE EXCEPTION 'own comment' USING ERRCODE='P5D01'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.publication_comment_likes l WHERE l.comment_id=c.id AND public.publication_reaction_same_identity(p_actor,l.principal_id)) THEN
 INSERT INTO public.publication_comment_likes(comment_id,principal_id) VALUES(c.id,p_actor);
 UPDATE public.publication_comments SET like_count=like_count+1 WHERE id=c.id RETURNING * INTO c;
 END IF;
 END IF;
 RETURN jsonb_build_object('comment',public.publication_comment_dto(c,p_actor,s.owner_principal_id));
END; $$;

CREATE FUNCTION public.publication_comment_pin(p_actor uuid,p_hash varchar,p_publication uuid,p_comment uuid,p_on boolean,p_version integer,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; c public.publication_comments%ROWTYPE; v_project uuid; is_admin boolean;
BEGIN
 IF NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF p_on IS NULL OR p_version IS NULL OR p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'invalid pin' USING ERRCODE='22023'; END IF;
 SELECT project_id INTO v_project FROM public.project_publication_state WHERE id=p_publication;
 PERFORM 1 FROM public.projects WHERE id=v_project FOR SHARE;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication FOR UPDATE;
 IF NOT FOUND OR NOT public.project_publication_readable(p_publication) THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 is_admin:=public.admin_authorized_role(p_actor,'platform',NULL) IS NOT DISTINCT FROM 'platform_admin';
 IF s.owner_principal_id<>p_actor AND NOT is_admin THEN RAISE EXCEPTION 'pin denied' USING ERRCODE='42501'; END IF;
 IF p_version<>s.comments_version OR s.comments_version=2147483647 THEN RAISE EXCEPTION 'pin conflict' USING ERRCODE='P5D03'; END IF;
 SELECT * INTO c FROM public.publication_comments WHERE id=p_comment AND publication_id=p_publication AND parent_id IS NULL;
 IF NOT FOUND OR (p_on AND (c.author_deleted OR c.owner_hidden OR c.moderator_hidden)) THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF NOT p_on AND s.pinned_comment_id IS DISTINCT FROM c.id THEN RAISE EXCEPTION 'pin changed' USING ERRCODE='P5D03'; END IF;
 UPDATE public.project_publication_state SET pinned_comment_id=CASE WHEN p_on THEN c.id ELSE NULL END,comments_version=comments_version+1 WHERE id=s.id;
 IF is_admin THEN
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'publication.comment.pin','project_publication_comment',c.id::varchar,
 'publication_comments','Закрепление комментария в обсуждении',NULL,p_request,NULL,'succeeded',s.comments_version::bigint,(s.comments_version+1)::bigint);
 ELSE
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json) VALUES(s.tenant_id,'project_publication',s.id,'publication.comment.pin',jsonb_build_object('actorId',p_actor,'commentId',c.id,'pinned',p_on,'requestId',p_request));
 END IF;
 RETURN jsonb_build_object('succeeded',true);
END; $$;

REVOKE ALL ON FUNCTION public.publication_comments_read(uuid,varchar,uuid,uuid,uuid,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publication_comment_react(uuid,varchar,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publication_comment_pin(uuid,varchar,uuid,uuid,boolean,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publication_comments_read(uuid,varchar,uuid,uuid,uuid,integer,text) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.publication_comment_react(uuid,varchar,uuid,uuid,boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.publication_comment_pin(uuid,varchar,uuid,uuid,boolean,integer,varchar) TO asalab_app;
