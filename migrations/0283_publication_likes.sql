-- One reaction store: legacy rows remain byte-for-byte in their old namespace.
ALTER TABLE public.project_reactions DROP CONSTRAINT project_reactions_pkey;
ALTER TABLE public.project_reactions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.project_reactions ADD COLUMN publication_id uuid
 REFERENCES public.project_publication_state(id) ON DELETE CASCADE;
ALTER TABLE public.project_reactions ADD CONSTRAINT project_reactions_target_check
 CHECK ((project_id IS NOT NULL AND publication_id IS NULL)
     OR (project_id IS NULL AND publication_id IS NOT NULL AND kind='like'));
CREATE UNIQUE INDEX project_reactions_legacy_unique
 ON public.project_reactions(project_id,reactor_principal_id,kind) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX project_reactions_publication_unique
 ON public.project_reactions(publication_id,reactor_principal_id) WHERE publication_id IS NOT NULL;
CREATE INDEX project_reactions_publication_count ON public.project_reactions(publication_id)
 WHERE publication_id IS NOT NULL;
DROP POLICY project_reactions_read ON public.project_reactions;
CREATE POLICY project_reactions_read ON public.project_reactions FOR SELECT
 USING (publication_id IS NULL);

ALTER TABLE public.project_publication_state
 ADD COLUMN reactions_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN reactions_version integer NOT NULL DEFAULT 0 CHECK(reactions_version>=0);

-- Reuse existing verified learner links, never synthesize a second identity.
-- Disabled/unverified links are not evidence that two principals are one person.
CREATE FUNCTION public.publication_reaction_same_identity(p_left uuid,p_right uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT p_left=p_right OR EXISTS (
 SELECT 1 FROM public.principals a JOIN public.principals b ON b.id=p_right
 JOIN public.learner_identity_links la ON
   ((la.link_kind='account' AND la.account_id=a.account_id) OR (la.link_kind='student_seat' AND la.seat_id=a.seat_id))
 JOIN public.learner_identity_links lb ON lb.learner_identity_id=la.learner_identity_id
   AND lb.tenant_id=la.tenant_id AND lb.school_id=la.school_id
   AND ((lb.link_kind='account' AND lb.account_id=b.account_id) OR (lb.link_kind='student_seat' AND lb.seat_id=b.seat_id))
 JOIN public.learner_identities learner ON learner.id=la.learner_identity_id
   AND learner.tenant_id=la.tenant_id AND learner.school_id=la.school_id
 WHERE a.id=p_left AND la.status='active' AND lb.status='active'
 AND la.disabled_at IS NULL AND lb.disabled_at IS NULL AND learner.state='active');
$$;

CREATE FUNCTION public.publication_reaction_actor_lock(p_actor uuid,p_hash varchar)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record;
BEGIN
 SELECT seat.id,seat.tenant_id,seat.classroom_id INTO s FROM public.principals actor
 JOIN public.classroom_student_seats seat ON seat.id=actor.seat_id
 WHERE actor.id=p_actor AND actor.kind='student_seat';
 IF FOUND THEN
   RETURN public.project_distribution_identity_lock(p_actor,s.tenant_id,s.classroom_id,s.id,p_hash) IS NOT NULL;
 END IF;
 PERFORM 1 FROM public.principals actor JOIN public.accounts account ON account.id=actor.account_id
 WHERE actor.id=p_actor AND actor.kind='account' AND account.status='active' FOR SHARE OF account;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.sessions_v2 session WHERE session.principal_id=p_actor
 AND session.token_hash=p_hash AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
 FOR SHARE;
 RETURN FOUND;
END;
$$;

CREATE FUNCTION public.publication_like_count(p_publication uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN public.project_publication_readable(p_publication) THEN
 (SELECT count(*)::integer FROM public.project_reactions WHERE publication_id=p_publication) ELSE 0 END;
$$;

CREATE FUNCTION public.publication_like_state(p_actor uuid,p_publication uuid,p_hash varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record; v_liked boolean; v_self boolean;
BEGIN
 IF NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN
 RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 SELECT state.* INTO s FROM public.project_publication_state state WHERE state.id=p_publication;
 IF NOT FOUND OR NOT public.project_publication_readable(p_publication) THEN
 RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.project_reactions r WHERE r.publication_id=p_publication
 AND public.publication_reaction_same_identity(p_actor,r.reactor_principal_id)) INTO v_liked;
 v_self:=public.publication_reaction_same_identity(p_actor,s.owner_principal_id);
 RETURN jsonb_build_object('publicationId',p_publication,'revisionId',s.current_revision_id,
 'liked',v_liked,'canLike',s.reactions_enabled AND NOT v_self,'canUnlike',v_liked,
 'reactionsEnabled',s.reactions_enabled,'likeCount',public.publication_like_count(p_publication),
 'reason',CASE WHEN v_self THEN 'own_work' WHEN NOT s.reactions_enabled THEN 'reactions_disabled' ELSE NULL END);
END;
$$;

CREATE FUNCTION public.publication_like_write(p_actor uuid,p_publication uuid,p_revision uuid,p_on boolean,p_hash varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; v_project uuid;
BEGIN
 IF NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN
 RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF p_on IS NULL OR p_revision IS NULL THEN RAISE EXCEPTION 'invalid reaction' USING ERRCODE='22023'; END IF;
 -- Same Project -> publication lock order as publish/revoke/moderation.
 SELECT project_id INTO v_project FROM public.project_publication_state WHERE id=p_publication;
 IF v_project IS NOT NULL THEN
   PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
   SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication FOR UPDATE;
 END IF;
 -- Removal is opaque and idempotent even after revoke/hide. Never return source DTO/count.
 IF NOT p_on THEN
   DELETE FROM public.project_reactions r WHERE r.publication_id=p_publication
   AND public.publication_reaction_same_identity(p_actor,r.reactor_principal_id);
   RETURN jsonb_build_object('liked',false);
 END IF;
 IF s.id IS NULL OR NOT public.project_publication_readable(p_publication) THEN
 RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF s.current_revision_id IS DISTINCT FROM p_revision THEN
 RAISE EXCEPTION 'publication changed' USING ERRCODE='P5C02'; END IF;
 IF NOT s.reactions_enabled THEN RAISE EXCEPTION 'reactions disabled' USING ERRCODE='P5R03'; END IF;
 IF public.publication_reaction_same_identity(p_actor,s.owner_principal_id) THEN
 RAISE EXCEPTION 'own work' USING ERRCODE='P5R02'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.project_reactions r WHERE r.publication_id=p_publication
 AND public.publication_reaction_same_identity(p_actor,r.reactor_principal_id)) THEN
 INSERT INTO public.project_reactions(publication_id,reactor_principal_id,kind)
 VALUES(p_publication,p_actor,'like') ON CONFLICT DO NOTHING;
 END IF;
 RETURN jsonb_build_object('liked',true);
END;
$$;

CREATE FUNCTION public.admin_publication_reactions_read(p_actor uuid,p_publications uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
 RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF cardinality(p_publications)>50 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
 RETURN COALESCE((SELECT jsonb_object_agg(state.id,jsonb_build_object(
 'likeCount',(SELECT count(*)::integer FROM public.project_reactions r WHERE r.publication_id=state.id),
 'reactionsEnabled',state.reactions_enabled,'reactionsVersion',state.reactions_version))
 FROM public.project_publication_state state
 JOIN public.project_publication_revisions revision ON revision.id=state.current_revision_id
   AND revision.publication_id=state.id AND revision.schema_version=2
 WHERE state.id=ANY(p_publications)),'{}'::jsonb);
END;
$$;

CREATE FUNCTION public.admin_publications_with_reactions(p_actor uuid,p_offset integer,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb; stats jsonb;
BEGIN
 result:=public.admin_publications_list(p_actor,p_offset,p_limit);
 stats:=public.admin_publication_reactions_read(p_actor,
 ARRAY(SELECT (item->>'publicationId')::uuid FROM jsonb_array_elements(result->'items') item));
 RETURN jsonb_set(result,'{items}',COALESCE((SELECT jsonb_agg(item || COALESCE(stats->(item->>'publicationId'),'{}'::jsonb))
 FROM jsonb_array_elements(result->'items') item),'[]'::jsonb));
END;
$$;

CREATE FUNCTION public.admin_publication_reactions_write(p_actor uuid,p_publication uuid,p_enabled boolean,
 p_version integer,p_revision uuid,p_reason text,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; v_project uuid;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
 RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_enabled IS NULL OR p_version IS NULL OR p_version NOT BETWEEN 0 AND 2147483646
 OR p_revision IS NULL OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500
 OR p_request IS NULL OR length(trim(p_request)) NOT BETWEEN 1 AND 128 THEN
 RAISE EXCEPTION 'invalid reactions setting' USING ERRCODE='22023'; END IF;
 SELECT project_id INTO v_project FROM public.project_publication_state WHERE id=p_publication;
 IF v_project IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 PERFORM 1 FROM public.projects WHERE id=v_project FOR UPDATE;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.project_publication_revisions revision
 WHERE revision.id=s.current_revision_id AND revision.publication_id=s.id AND revision.schema_version=2) THEN
 RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF s.current_revision_id IS DISTINCT FROM p_revision OR s.reactions_version<>p_version
 OR s.reactions_enabled=p_enabled OR EXISTS(SELECT 1 FROM public.administrative_audit_events
 WHERE actor_principal_id=p_actor AND request_id=p_request AND action='publication.reactions') THEN
 RAISE EXCEPTION 'reactions setting changed' USING ERRCODE='P5M09'; END IF;
 UPDATE public.project_publication_state SET reactions_enabled=p_enabled,reactions_version=reactions_version+1
 WHERE id=p_publication;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'publication.reactions',
 'project_publication',p_publication::varchar,'publication_reactions',trim(p_reason)::varchar,
 NULL,p_request,NULL,'succeeded',s.reactions_version::bigint,(s.reactions_version+1)::bigint);
 RETURN (public.admin_publication_reactions_read(p_actor,ARRAY[p_publication]))->p_publication::text;
END;
$$;

REVOKE ALL ON FUNCTION public.publication_reaction_same_identity(uuid,uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.publication_reaction_actor_lock(uuid,varchar) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.publication_like_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publication_like_state(uuid,uuid,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publication_like_write(uuid,uuid,uuid,boolean,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publication_reactions_read(uuid,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publications_with_reactions(uuid,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publication_reactions_write(uuid,uuid,boolean,integer,uuid,text,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publication_like_count(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.publication_like_state(uuid,uuid,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.publication_like_write(uuid,uuid,uuid,boolean,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.admin_publication_reactions_read(uuid,uuid[]) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.admin_publications_with_reactions(uuid,integer,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.admin_publication_reactions_write(uuid,uuid,boolean,integer,uuid,text,varchar) TO asalab_app;
