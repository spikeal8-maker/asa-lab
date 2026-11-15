-- Publication discussion. Class comment permission is independent of publish/download.
ALTER TABLE public.classroom_project_policies ADD COLUMN comments boolean NOT NULL DEFAULT false;
ALTER TABLE public.classroom_project_seat_overrides ADD COLUMN comments text NOT NULL DEFAULT 'inherit'
 CHECK(comments IN ('inherit','allow','deny'));
ALTER TABLE public.project_publication_state
 ADD COLUMN comments_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN comments_admin_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN comments_version integer NOT NULL DEFAULT 0 CHECK(comments_version>=0);

CREATE OR REPLACE FUNCTION public.classroom_project_policy_read(p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.classroom_games_teacher(p_actor,p_tenant,p_class) THEN RETURN NULL; END IF;
 IF p_seat IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.classroom_student_seats s
 WHERE s.id=p_seat AND s.classroom_id=p_class AND s.tenant_id=p_tenant AND s.status<>'removed') THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('publish',COALESCE(p.publish,false),'download',COALESCE(p.download,false),
 'comments',COALESCE(p.comments,false),'version',COALESCE(p.version,0)) INTO result FROM public.classrooms c
 LEFT JOIN public.classroom_project_policies p ON p.classroom_id=c.id AND p.tenant_id=c.tenant_id
 WHERE c.id=p_class AND c.tenant_id=p_tenant;
 IF p_seat IS NOT NULL THEN
 SELECT result||jsonb_build_object('publishOverride',COALESCE(o.publish,'inherit'),
 'downloadOverride',COALESCE(o.download,'inherit'),'commentsOverride',COALESCE(o.comments,'inherit')) INTO result FROM public.classroom_student_seats s
 LEFT JOIN public.classroom_project_seat_overrides o ON o.seat_id=s.id
 AND o.classroom_id=s.classroom_id AND o.tenant_id=s.tenant_id WHERE s.id=p_seat;
 END IF;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.classroom_project_policy_write(p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_expected integer;
BEGIN
 PERFORM 1 FROM public.classrooms c WHERE c.id=p_class AND c.tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR NOT public.classroom_games_teacher(p_actor,p_tenant,p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF p_seat IS NOT NULL THEN
 PERFORM 1 FROM public.classroom_student_seats s WHERE s.id=p_seat AND s.classroom_id=p_class
 AND s.tenant_id=p_tenant AND s.status<>'removed' FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"forbidden"}'; END IF;
 END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR length(p_request) NOT BETWEEN 1 AND 120 OR p_request IS NULL
 OR jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number'
 OR (p_input->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$' THEN RETURN '{"error":"invalid_policy"}'; END IF;
 BEGIN v_expected:=(p_input->>'expectedVersion')::integer;
 EXCEPTION WHEN numeric_value_out_of_range THEN RETURN '{"error":"invalid_policy"}'; END;
 IF p_seat IS NULL THEN
 IF p_input-ARRAY['publish','download','comments','expectedVersion']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'publish') IS DISTINCT FROM 'boolean'
 OR (p_input ? 'comments' AND jsonb_typeof(p_input->'comments') IS DISTINCT FROM 'boolean')
 OR jsonb_typeof(p_input->'download') IS DISTINCT FROM 'boolean' THEN RETURN '{"error":"invalid_policy"}'; END IF;
 ELSE
 IF p_input-ARRAY['publishOverride','downloadOverride','commentsOverride','expectedVersion']<>'{}'::jsonb
 OR COALESCE(p_input->>'publishOverride','') NOT IN ('inherit','allow','deny')
 OR (p_input ? 'commentsOverride' AND COALESCE(p_input->>'commentsOverride','') NOT IN ('inherit','allow','deny'))
 OR COALESCE(p_input->>'downloadOverride','') NOT IN ('inherit','allow','deny') THEN RETURN '{"error":"invalid_policy"}'; END IF;
 END IF;
 v_before:=public.classroom_project_policy_read(p_actor,p_tenant,p_class,p_seat);
 IF (v_before->>'version')::integer<>v_expected OR v_expected=2147483647 THEN RETURN '{"error":"version_conflict"}'; END IF;
 INSERT INTO public.classroom_project_policies(classroom_id,tenant_id) VALUES(p_class,p_tenant) ON CONFLICT DO NOTHING;
 IF p_seat IS NULL THEN
 UPDATE public.classroom_project_policies SET publish=(p_input->>'publish')::boolean,download=(p_input->>'download')::boolean,comments=CASE WHEN p_input ? 'comments' THEN (p_input->>'comments')::boolean ELSE comments END WHERE classroom_id=p_class;
 ELSE
 INSERT INTO public.classroom_project_seat_overrides(seat_id,tenant_id,classroom_id,publish,download,comments)
 VALUES(p_seat,p_tenant,p_class,p_input->>'publishOverride',p_input->>'downloadOverride',COALESCE(p_input->>'commentsOverride',(SELECT comments FROM public.classroom_project_seat_overrides WHERE seat_id=p_seat),'inherit'))
 ON CONFLICT(seat_id) DO UPDATE SET tenant_id=excluded.tenant_id,classroom_id=excluded.classroom_id,publish=excluded.publish,download=excluded.download,comments=excluded.comments;
 END IF;
 UPDATE public.classroom_project_policies SET version=version+1 WHERE classroom_id=p_class;
 v_after:=public.classroom_project_policy_read(p_actor,p_tenant,p_class,p_seat);
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(p_tenant,'classroom',p_class,'classroom.projects.policy',jsonb_build_object(
 'actorId',p_actor,'seatId',p_seat,'before',v_before,'after',v_after,'requestId',p_request));
 RETURN v_after;
END; $$;


CREATE TABLE public.publication_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 publication_id uuid NOT NULL REFERENCES public.project_publication_state(id),
 revision_id uuid NOT NULL REFERENCES public.project_publication_revisions(id),
 author_principal_id uuid NOT NULL REFERENCES public.principals(id),
 parent_id uuid REFERENCES public.publication_comments(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 mutation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 author_deleted boolean NOT NULL DEFAULT false,
 owner_hidden boolean NOT NULL DEFAULT false,
 moderator_hidden boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 UNIQUE(author_principal_id,mutation_id)
);
CREATE INDEX publication_comments_page ON public.publication_comments(publication_id,parent_id,created_at DESC,id DESC);
CREATE INDEX publication_comments_actor_rate ON public.publication_comments(author_principal_id,created_at DESC);
-- Reply counters are looked up by parent alone; avoid a table scan per root.
CREATE INDEX publication_comments_replies ON public.publication_comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE TABLE public.publication_comment_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 comment_id uuid NOT NULL REFERENCES public.publication_comments(id),
 reporter_principal_id uuid NOT NULL REFERENCES public.principals(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_at timestamptz,
 UNIQUE(comment_id,reporter_principal_id)
);
CREATE INDEX publication_comment_reports_open ON public.publication_comment_reports(comment_id) WHERE resolved_at IS NULL;
CREATE INDEX publication_comment_reports_rate ON public.publication_comment_reports(reporter_principal_id,created_at DESC);
ALTER TABLE public.publication_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.publication_comment_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_comment_reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.publication_comments,public.publication_comment_reports FROM PUBLIC,asalab_app;

CREATE FUNCTION public.publication_comment_allowed(p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals a JOIN public.accounts account ON account.id=a.account_id
 WHERE a.id=p_actor AND a.kind='account' AND account.status='active') OR EXISTS(
 SELECT 1 FROM public.principals a JOIN public.classroom_student_seats seat ON seat.id=a.seat_id
 LEFT JOIN public.classroom_project_policies p ON p.classroom_id=seat.classroom_id AND p.tenant_id=seat.tenant_id
 LEFT JOIN public.classroom_project_seat_overrides o ON o.seat_id=seat.id AND o.classroom_id=seat.classroom_id AND o.tenant_id=seat.tenant_id
 WHERE a.id=p_actor AND a.kind='student_seat'
 AND public.project_publication_seat_active(p_actor,seat.tenant_id,seat.classroom_id)
 AND CASE COALESCE(o.comments,'inherit') WHEN 'allow' THEN true WHEN 'deny' THEN false ELSE COALESCE(p.comments,false) END);
$$;

CREATE FUNCTION public.publication_comment_label(p_actor uuid)
RETURNS varchar LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.project_publication_author_label(p_actor,
 COALESCE((SELECT left(trim(s.display_label),120)::varchar FROM public.principals a
 JOIN public.classroom_student_seats s ON s.id=a.seat_id WHERE a.id=p_actor),'Участник'::varchar));
$$;

CREATE FUNCTION public.publication_comment_state(p_actor uuid,p_publication uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('authenticated',p_actor IS NOT NULL,'enabled',s.comments_enabled,'adminEnabled',s.comments_admin_enabled,
 'version',s.comments_version,'revisionId',s.current_revision_id,'canManage',COALESCE(s.owner_principal_id=p_actor,false),
 'canComment',COALESCE(s.comments_enabled AND s.comments_admin_enabled AND public.publication_comment_allowed(p_actor),false),
 'reason',CASE WHEN NOT s.comments_enabled OR NOT s.comments_admin_enabled THEN 'closed'
 WHEN p_actor IS NULL THEN 'sign_in' WHEN NOT public.publication_comment_allowed(p_actor) THEN 'permission' ELSE NULL END)
 FROM public.project_publication_state s WHERE s.id=p_publication;
$$;

CREATE FUNCTION public.publication_comment_dto(c public.publication_comments,p_actor uuid,p_owner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',c.id,'parentId',c.parent_id,'createdAt',c.created_at,'version',c.version,
 'status',CASE WHEN c.author_deleted THEN 'deleted' WHEN c.moderator_hidden THEN 'moderator_hidden' WHEN c.owner_hidden THEN 'owner_hidden' ELSE 'visible' END,
 'body',CASE WHEN c.author_deleted OR c.moderator_hidden OR c.owner_hidden THEN NULL ELSE c.body END,
 'author',CASE WHEN c.author_deleted OR c.moderator_hidden OR c.owner_hidden THEN NULL ELSE public.publication_comment_label(c.author_principal_id) END,
 'canDelete',COALESCE(c.author_principal_id=p_actor AND NOT c.author_deleted,false),
 'canManage',COALESCE(p_owner=p_actor AND NOT c.author_deleted AND NOT c.moderator_hidden,false),
 'replyCount',(SELECT count(*)::integer FROM public.publication_comments r WHERE r.parent_id=c.id));
$$;

CREATE FUNCTION public.publication_comments_read(p_actor uuid,p_hash varchar,p_publication uuid,p_parent uuid,p_before uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; cursor_row public.publication_comments%ROWTYPE; items jsonb; more boolean; last_id uuid;
BEGIN
 IF p_actor IS NOT NULL AND NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN
 RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication;
 IF NOT FOUND OR NOT public.project_publication_readable(p_publication) THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF p_parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.publication_comments c
 WHERE c.id=p_parent AND c.publication_id=p_publication AND c.parent_id IS NULL
 AND NOT c.author_deleted AND NOT c.owner_hidden AND NOT c.moderator_hidden) THEN
 RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF p_before IS NOT NULL THEN
 SELECT * INTO cursor_row FROM public.publication_comments WHERE id=p_before AND publication_id=p_publication AND parent_id IS NOT DISTINCT FROM p_parent;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid cursor' USING ERRCODE='22023'; END IF;
 END IF;
 WITH page AS MATERIALIZED (SELECT c.* FROM public.publication_comments c WHERE c.publication_id=p_publication
 AND c.parent_id IS NOT DISTINCT FROM p_parent
 AND (p_before IS NULL OR (c.created_at,c.id)<(cursor_row.created_at,cursor_row.id))
 ORDER BY c.created_at DESC,c.id DESC LIMIT p_limit+1), visible_page AS MATERIALIZED (
 SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT COALESCE(jsonb_agg(public.publication_comment_dto(v,p_actor,s.owner_principal_id) ORDER BY v.created_at DESC,v.id DESC),'[]'::jsonb),
 (SELECT count(*)>p_limit FROM page), (SELECT id FROM visible_page ORDER BY created_at,id LIMIT 1) INTO items,more,last_id FROM visible_page v;
 RETURN jsonb_build_object('state',public.publication_comment_state(p_actor,p_publication),'items',items,'nextCursor',CASE WHEN more THEN last_id ELSE NULL END);
END; $$;

CREATE FUNCTION public.publication_comment_write(p_actor uuid,p_hash varchar,p_publication uuid,p_action text,p_input jsonb,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; c public.publication_comments%ROWTYPE; prior public.publication_comments%ROWTYPE;
 v_project uuid; v_parent uuid; v_mutation uuid; v_body text; v_id uuid; v_enabled boolean; v_owner boolean; result jsonb; count_recent integer;
BEGIN
 IF NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('create','delete','hide','restore','settings','report')
 OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR p_request IS NULL OR length(p_request) NOT BETWEEN 1 AND 128 THEN
 RAISE EXCEPTION 'invalid command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text,9289));
 SELECT project_id INTO v_project FROM public.project_publication_state WHERE id=p_publication;
 PERFORM 1 FROM public.projects WHERE id=v_project FOR SHARE;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication FOR UPDATE;
 IF NOT FOUND OR NOT public.project_publication_readable(p_publication) THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 v_owner:=s.owner_principal_id=p_actor;
 IF p_action='create' THEN
 IF p_input-ARRAY['body','parentId','mutationId','revisionId']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'body') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid comment' USING ERRCODE='22023'; END IF;
 v_body:=trim(p_input->>'body');
 IF length(v_body) NOT BETWEEN 1 AND 2000 OR v_body !~ '[^[:space:]]' THEN RAISE EXCEPTION 'invalid comment' USING ERRCODE='22023'; END IF;
 v_mutation:=(p_input->>'mutationId')::uuid; v_parent:=NULLIF(p_input->>'parentId','')::uuid;
 IF v_mutation IS NULL THEN RAISE EXCEPTION 'missing mutation id' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM public.publication_comments WHERE author_principal_id=p_actor AND mutation_id=v_mutation;
 IF FOUND THEN
 IF prior.publication_id<>p_publication OR prior.parent_id IS DISTINCT FROM v_parent OR prior.body<>v_body THEN
 RAISE EXCEPTION 'comment command conflict' USING ERRCODE='P5D03'; END IF;
 RETURN jsonb_build_object('id',prior.id,'replayed',true,'comment',public.publication_comment_dto(prior,p_actor,s.owner_principal_id),'parentReplyCount',(SELECT count(*) FROM public.publication_comments WHERE parent_id=prior.parent_id));
 END IF;
 IF (p_input->>'revisionId')::uuid IS DISTINCT FROM s.current_revision_id THEN RAISE EXCEPTION 'publication changed' USING ERRCODE='P5D03'; END IF;
 IF NOT s.comments_enabled OR NOT s.comments_admin_enabled OR NOT public.publication_comment_allowed(p_actor) THEN
 RAISE EXCEPTION 'comments unavailable' USING ERRCODE='P5D01'; END IF;
 IF v_parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.publication_comments parent WHERE parent.id=v_parent
 AND parent.publication_id=p_publication AND parent.parent_id IS NULL AND NOT parent.author_deleted AND NOT parent.owner_hidden AND NOT parent.moderator_hidden) THEN
 RAISE EXCEPTION 'invalid parent' USING ERRCODE='22023'; END IF;
 SELECT count(*) INTO count_recent FROM public.publication_comments WHERE author_principal_id=p_actor AND created_at>clock_timestamp()-interval '1 minute';
 IF count_recent>=10 OR (SELECT count(*) FROM public.publication_comments WHERE author_principal_id=p_actor AND created_at>clock_timestamp()-interval '1 hour')>=100 THEN
 RAISE EXCEPTION 'comment rate exceeded' USING ERRCODE='P5D02'; END IF;
 INSERT INTO public.publication_comments(publication_id,revision_id,author_principal_id,parent_id,body,mutation_id)
 VALUES(p_publication,s.current_revision_id,p_actor,v_parent,v_body,v_mutation) RETURNING id INTO v_id;
 ELSIF p_action='settings' THEN
 IF NOT v_owner THEN RAISE EXCEPTION 'owner denied' USING ERRCODE='42501'; END IF;
 IF p_input-ARRAY['enabled','expectedVersion']<>'{}'::jsonb OR jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid setting' USING ERRCODE='22023'; END IF;
 IF (p_input->>'expectedVersion')::integer<>s.comments_version OR s.comments_version=2147483647 THEN RAISE EXCEPTION 'setting conflict' USING ERRCODE='P5D03'; END IF;
 v_enabled:=(p_input->>'enabled')::boolean;
 IF v_enabled=s.comments_enabled THEN RETURN public.publication_comment_state(p_actor,p_publication); END IF;
 UPDATE public.project_publication_state SET comments_enabled=v_enabled,comments_version=comments_version+1 WHERE id=p_publication;
 ELSE
 IF p_input-ARRAY['commentId','expectedVersion','reason']<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid command' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.publication_comments WHERE id=(p_input->>'commentId')::uuid AND publication_id=p_publication FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 v_id:=c.id;
 IF p_action='report' THEN
 IF c.author_deleted OR c.owner_hidden OR c.moderator_hidden THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' OR length(trim(p_input->>'reason')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid reason' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.publication_comment_reports WHERE comment_id=c.id AND reporter_principal_id=p_actor) THEN RETURN '{"reported":true}'; END IF;
 IF (SELECT count(*) FROM public.publication_comment_reports WHERE reporter_principal_id=p_actor AND created_at>clock_timestamp()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'report rate exceeded' USING ERRCODE='P5D02'; END IF;
 INSERT INTO public.publication_comment_reports(comment_id,reporter_principal_id,reason) VALUES(c.id,p_actor,trim(p_input->>'reason'));
 ELSE
 IF jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number' OR (p_input->>'expectedVersion')::integer<>c.version OR c.version=2147483647 THEN RAISE EXCEPTION 'comment conflict' USING ERRCODE='P5D03'; END IF;
 IF p_action='delete' AND c.author_principal_id=p_actor THEN
 UPDATE public.publication_comments SET author_deleted=true,version=version+1 WHERE id=c.id;
 ELSIF p_action IN ('hide','restore') AND v_owner THEN
 UPDATE public.publication_comments SET owner_hidden=(p_action='hide'),version=version+1 WHERE id=c.id;
 ELSE RAISE EXCEPTION 'comment action denied' USING ERRCODE='42501'; END IF;
 END IF;
 END IF;
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(s.tenant_id,'project_publication',p_publication,'publication.comment.'||p_action,
 jsonb_build_object('actorId',p_actor,'commentId',v_id,'requestId',p_request));
 IF p_action='settings' THEN RETURN public.publication_comment_state(p_actor,p_publication); END IF;
 SELECT * INTO c FROM public.publication_comments WHERE id=v_id;
 RETURN jsonb_build_object('id',v_id,'succeeded',true,'comment',public.publication_comment_dto(c,p_actor,s.owner_principal_id),'parentReplyCount',(SELECT count(*) FROM public.publication_comments WHERE parent_id=c.parent_id));
END; $$;

CREATE FUNCTION public.admin_publication_comments_read(p_actor uuid,p_hash varchar,p_publication uuid,p_before uuid,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; cursor_row public.publication_comments%ROWTYPE; items jsonb; more boolean; last_id uuid;
BEGIN
 IF NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'admin denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'invalid page' USING ERRCODE='22023'; END IF;
 IF p_before IS NOT NULL THEN
 SELECT * INTO cursor_row FROM public.publication_comments WHERE id=p_before AND publication_id=p_publication;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid cursor' USING ERRCODE='22023'; END IF;
 END IF;
 WITH page AS MATERIALIZED (SELECT c.* FROM public.publication_comments c WHERE c.publication_id=p_publication
 AND (p_before IS NULL OR (c.created_at,c.id)<(cursor_row.created_at,cursor_row.id)) ORDER BY c.created_at DESC,c.id DESC LIMIT p_limit+1),
 shown AS MATERIALIZED (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'parentId',c.parent_id,'body',c.body,
 'author',public.publication_comment_label(c.author_principal_id),'createdAt',c.created_at,'version',c.version,
 'authorDeleted',c.author_deleted,'ownerHidden',c.owner_hidden,'moderatorHidden',c.moderator_hidden,
 'openReportCount',(SELECT count(*) FROM public.publication_comment_reports r WHERE r.comment_id=c.id AND r.resolved_at IS NULL),
 'reports',COALESCE((SELECT jsonb_agg(jsonb_build_object('reason',r.reason,'createdAt',r.created_at) ORDER BY r.created_at DESC,r.id DESC)
 FROM (SELECT * FROM public.publication_comment_reports report WHERE report.comment_id=c.id AND report.resolved_at IS NULL
 ORDER BY report.created_at DESC,report.id DESC LIMIT 20) r),'[]'::jsonb)) ORDER BY c.created_at DESC,c.id DESC),'[]'::jsonb),
 (SELECT count(*)>p_limit FROM page),(SELECT id FROM shown ORDER BY created_at,id LIMIT 1) INTO items,more,last_id FROM shown c;
 RETURN jsonb_build_object('state',public.publication_comment_state(p_actor,p_publication),'items',items,'nextCursor',CASE WHEN more THEN last_id ELSE NULL END);
END; $$;

CREATE FUNCTION public.admin_publication_comment_write(p_actor uuid,p_hash varchar,p_publication uuid,p_action text,p_input jsonb,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.project_publication_state%ROWTYPE; c public.publication_comments%ROWTYPE; v_project uuid; before_version integer; after_version integer; target uuid; v_reason text;
BEGIN
 IF NOT public.publication_reaction_actor_lock(p_actor,p_hash) THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='P5R01'; END IF;
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'admin denied' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('hide','restore','resolve','settings') OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
 OR p_input-ARRAY['commentId','reason','expectedVersion','enabled']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number'
 OR p_request IS NULL OR length(trim(p_request)) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'invalid moderation command' USING ERRCODE='22023'; END IF;
 v_reason:=trim(p_input->>'reason');
 IF length(v_reason) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid reason' USING ERRCODE='22023'; END IF;
 SELECT project_id INTO v_project FROM public.project_publication_state WHERE id=p_publication;
 PERFORM 1 FROM public.projects WHERE id=v_project FOR SHARE;
 SELECT * INTO s FROM public.project_publication_state WHERE id=p_publication FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF p_action='settings' THEN
 IF jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid setting' USING ERRCODE='22023'; END IF;
 IF (p_input->>'expectedVersion')::integer<>s.comments_version OR s.comments_version=2147483647 THEN RAISE EXCEPTION 'setting conflict' USING ERRCODE='P5D03'; END IF;
 before_version:=s.comments_version; after_version:=before_version+1; target:=s.id;
 UPDATE public.project_publication_state SET comments_admin_enabled=(p_input->>'enabled')::boolean,comments_version=after_version WHERE id=p_publication;
 ELSE
 SELECT * INTO c FROM public.publication_comments WHERE id=(p_input->>'commentId')::uuid AND publication_id=p_publication FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='P5P04'; END IF;
 IF (p_input->>'expectedVersion')::integer<>c.version OR c.version=2147483647 THEN RAISE EXCEPTION 'comment conflict' USING ERRCODE='P5D03'; END IF;
 before_version:=c.version; after_version:=before_version+1; target:=c.id;
 UPDATE public.publication_comments SET moderator_hidden=CASE WHEN p_action='hide' THEN true WHEN p_action='restore' THEN false ELSE moderator_hidden END,
 version=after_version WHERE id=c.id;
 IF p_action IN ('hide','resolve') THEN UPDATE public.publication_comment_reports SET resolved_at=clock_timestamp() WHERE comment_id=c.id AND resolved_at IS NULL; END IF;
 END IF;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'publication.comment.'||p_action,
 'project_publication_comment',target::varchar,'publication_comments',v_reason::varchar,
 NULL,p_request,NULL,'succeeded',before_version::bigint,after_version::bigint);
 RETURN jsonb_build_object('succeeded',true,'version',after_version);
END; $$;

REVOKE ALL ON FUNCTION public.publication_comment_allowed(uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.publication_comment_label(uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.publication_comment_state(uuid,uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.publication_comment_dto(public.publication_comments,uuid,uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.publication_comments_read(uuid,varchar,uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publication_comment_write(uuid,varchar,uuid,text,jsonb,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publication_comments_read(uuid,varchar,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_publication_comment_write(uuid,varchar,uuid,text,jsonb,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publication_comments_read(uuid,varchar,uuid,uuid,uuid,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.publication_comment_write(uuid,varchar,uuid,text,jsonb,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.admin_publication_comments_read(uuid,varchar,uuid,uuid,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.admin_publication_comment_write(uuid,varchar,uuid,text,jsonb,varchar) TO asalab_app;
