-- Public comment appearance only. No Account/Seat IDs or classroom metadata.
CREATE FUNCTION public.publication_comment_avatar(p_publication uuid,p_comment uuid,p_pixels boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.publication_comments%ROWTYPE; actor public.principals%ROWTYPE; image text; key text; available boolean;
BEGIN
 IF NOT public.project_publication_readable(p_publication) THEN RETURN NULL; END IF;
 SELECT * INTO c FROM public.publication_comments WHERE id=p_comment AND publication_id=p_publication
 AND NOT(author_deleted OR owner_hidden OR moderator_hidden);
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF c.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.publication_comments parent WHERE parent.id=c.parent_id
 AND parent.publication_id=p_publication AND NOT(parent.author_deleted OR parent.owner_hidden OR parent.moderator_hidden)) THEN RETURN NULL; END IF;
 SELECT * INTO actor FROM public.principals WHERE id=c.author_principal_id;
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
 RETURN jsonb_build_object('url','/api/public-projects/'||p_publication||'/comments/'||p_comment||'/avatar',
 'dataUrl',image,'builtinKey',key);
END; $$;
REVOKE ALL ON FUNCTION public.publication_comment_avatar(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publication_comment_avatar(uuid,uuid,boolean) TO asalab_app;

CREATE OR REPLACE FUNCTION public.publication_comment_dto(c public.publication_comments,p_actor uuid,p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',c.id,'parentId',c.parent_id,'createdAt',c.created_at,'version',c.version,
 'status',CASE WHEN c.author_deleted THEN 'deleted' WHEN c.moderator_hidden THEN 'moderator_hidden' WHEN c.owner_hidden THEN 'owner_hidden' ELSE 'visible' END,
 'body',CASE WHEN c.author_deleted OR c.moderator_hidden OR c.owner_hidden THEN NULL ELSE c.body END,
 'author',CASE WHEN c.author_deleted OR c.moderator_hidden OR c.owner_hidden THEN NULL ELSE public.publication_comment_label(c.author_principal_id) END,
 'avatarUrl',(public.publication_comment_avatar(c.publication_id,c.id,false)->>'url'),
 'canDelete',COALESCE(c.author_principal_id=p_actor AND NOT c.author_deleted,false),
 'canManage',COALESCE(p_owner=p_actor AND NOT c.author_deleted AND NOT c.moderator_hidden,false),
 'replyCount',(SELECT count(*)::integer FROM public.publication_comments r WHERE r.parent_id=c.id),
 'likeCount',CASE WHEN c.author_deleted OR c.owner_hidden OR c.moderator_hidden THEN 0 ELSE c.like_count END,
 'liked',EXISTS(SELECT 1 FROM public.publication_comment_likes l WHERE l.comment_id=c.id AND public.publication_reaction_same_identity(p_actor,l.principal_id)),
 'canLike',p_actor IS NOT NULL AND NOT(c.author_deleted OR c.owner_hidden OR c.moderator_hidden)
 AND NOT public.publication_reaction_same_identity(p_actor,c.author_principal_id),
 'pinned',EXISTS(SELECT 1 FROM public.project_publication_state s WHERE s.id=c.publication_id AND s.pinned_comment_id=c.id));
$$;
