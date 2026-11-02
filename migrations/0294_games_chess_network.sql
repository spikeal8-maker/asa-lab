-- Platform-owned casual Chess. Existing education/Chess Live RLS remains unchanged.
CREATE SCHEMA games;
REVOKE ALL ON SCHEMA games FROM PUBLIC;
GRANT USAGE ON SCHEMA games TO asalab_app;
CREATE TABLE games.players (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_id uuid REFERENCES games.players(id),
 alias text NOT NULL CHECK(length(alias) BETWEEN 1 AND 80), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE games.player_sources (
 source_kind text NOT NULL CHECK(source_kind IN ('account','student_seat')), source_id uuid NOT NULL,
 player_id uuid NOT NULL REFERENCES games.players(id), PRIMARY KEY(source_kind,source_id)
);
CREATE TABLE games.player_alias_events (
 old_player_id uuid PRIMARY KEY REFERENCES games.players(id), canonical_player_id uuid NOT NULL REFERENCES games.players(id),
 reason text NOT NULL CHECK(reason='verified_account_link'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE games.classroom_network_policies (
 classroom_id uuid PRIMARY KEY REFERENCES public.classrooms(id), enabled boolean NOT NULL DEFAULT false,
 scope text NOT NULL DEFAULT 'classroom' CHECK(scope IN ('classroom','school','platform')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), updated_by uuid NOT NULL REFERENCES public.principals(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE games.chess_invites (
 id uuid PRIMARY KEY, creator_id uuid NOT NULL REFERENCES games.players(id), code varchar(32) NOT NULL UNIQUE,
 scope text NOT NULL CHECK(scope IN ('classroom','school','platform')), status text NOT NULL CHECK(status IN ('open','accepted','cancelled','expired')),
 initial_ms integer NOT NULL CHECK(initial_ms BETWEEN 60000 AND 3600000), increment_ms integer NOT NULL CHECK(increment_ms BETWEEN 0 AND 60000),
 color_preference text NOT NULL CHECK(color_preference IN ('white','black','random')),
 expires_at bigint NOT NULL, match_id uuid, version integer NOT NULL DEFAULT 1,
 bindings jsonb NOT NULL DEFAULT '[]', grant_marks jsonb NOT NULL DEFAULT '[]', source_kind text NOT NULL, source_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE games.chess_matches (
 id uuid PRIMARY KEY, game_key text NOT NULL DEFAULT 'chess' CHECK(game_key='chess'),
 game_version text NOT NULL DEFAULT 'asa-chess-v1', rules_version text NOT NULL DEFAULT 'standard-v1',
 state_schema_version integer NOT NULL DEFAULT 1, protocol_version text NOT NULL DEFAULT 'chess-network-v1',
 rating_policy_version text CHECK(rating_policy_version IS NULL), admission_kind text NOT NULL DEFAULT 'invite',
 competition_kind text NOT NULL DEFAULT 'casual' CHECK(competition_kind='casual'),
 scope_kind text NOT NULL CHECK(scope_kind IN ('classroom','workspace','global')),
 runtime_kind text NOT NULL DEFAULT 'command', topology text NOT NULL DEFAULT 'duel',
 status text NOT NULL CHECK(status IN ('waiting','ready','active','finishing','finished','cancelled','aborted')),
 lifecycle_version integer NOT NULL DEFAULT 1, version integer NOT NULL DEFAULT 1, sequence integer NOT NULL DEFAULT 1,
 scope text NOT NULL CHECK(scope IN ('classroom','school','platform')),
 scope_bindings jsonb NOT NULL DEFAULT '[]', state jsonb NOT NULL, termination text NOT NULL DEFAULT '', updated_at bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE games.chess_invites ADD CONSTRAINT chess_invite_match_fk FOREIGN KEY(match_id) REFERENCES games.chess_matches(id);
CREATE TABLE games.chess_participants (
 match_id uuid NOT NULL REFERENCES games.chess_matches(id), player_id uuid NOT NULL REFERENCES games.players(id),
 color text NOT NULL CHECK(color IN ('white','black')), bindings jsonb NOT NULL DEFAULT '[]', grant_marks jsonb NOT NULL DEFAULT '[]',
 source_kind text NOT NULL, source_id uuid NOT NULL,
 PRIMARY KEY(match_id,player_id), UNIQUE(match_id,color)
);
CREATE TABLE games.match_teams (
 id uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES games.chess_matches(id), team_key text NOT NULL,
 UNIQUE(match_id,team_key)
);
CREATE TABLE games.chess_events (
 match_id uuid NOT NULL REFERENCES games.chess_matches(id), sequence integer NOT NULL,
 kind text NOT NULL, actor_id uuid REFERENCES games.players(id), payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(match_id,sequence)
);
CREATE TABLE games.command_receipts (
 actor_id uuid NOT NULL REFERENCES games.players(id), command_id varchar(128) NOT NULL,
 kind text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE games.outbox (
 event_id uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES games.chess_matches(id),
 event_kind text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(match_id,event_kind)
);
CREATE INDEX games_player_alias_parent ON games.players(canonical_id);
CREATE INDEX games_source_player ON games.player_sources(player_id);
CREATE INDEX chess_participant_history ON games.chess_participants(player_id,match_id);
CREATE INDEX chess_invite_creator ON games.chess_invites(creator_id,created_at);
CREATE INDEX games_receipt_limits ON games.command_receipts(actor_id,created_at);
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['players','player_sources','player_alias_events','classroom_network_policies','chess_invites','chess_matches','chess_participants','match_teams','chess_events','command_receipts','outbox'] LOOP
 EXECUTE format('ALTER TABLE games.%I ENABLE ROW LEVEL SECURITY',item);
 EXECUTE format('ALTER TABLE games.%I FORCE ROW LEVEL SECURITY',item);
 EXECUTE format('REVOKE ALL ON games.%I FROM PUBLIC,asalab_app',item);
 END LOOP;
END $$;

CREATE FUNCTION games.canonical(p_id uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_id uuid:=p_id; v_next uuid; i integer;
BEGIN
 FOR i IN 1..32 LOOP
 SELECT canonical_id INTO v_next FROM games.players WHERE id=v_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_next IS NULL THEN RETURN v_id; END IF;
 v_id:=v_next;
 END LOOP;
 RAISE EXCEPTION 'invalid_games_identity_lineage';
END $$;
CREATE FUNCTION games.lineage(p_id uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH RECURSIVE family(id) AS (SELECT p_id UNION SELECT p.id FROM games.players p JOIN family f ON p.canonical_id=f.id) SELECT id FROM family;
$$;
CREATE FUNCTION games.seat_accounts(p_seat uuid) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT array_agg(DISTINCT linked.account_id) FROM (
 SELECT s.account_id FROM public.classroom_student_seats s WHERE s.id=p_seat AND s.account_id IS NOT NULL
 UNION SELECT al.account_id FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
 JOIN public.learner_identity_links sl ON sl.seat_id=s.id AND sl.link_kind='student_seat' AND sl.tenant_id=c.tenant_id AND sl.school_id=c.school_id
 JOIN public.learner_identity_links al ON al.learner_identity_id=sl.learner_identity_id AND al.tenant_id=sl.tenant_id AND al.school_id=sl.school_id
 WHERE s.id=p_seat AND al.link_kind='account' AND al.status='active' AND al.disabled_at IS NULL AND al.account_id IS NOT NULL
 ) linked;
$$;
CREATE FUNCTION games.ensure_player(p_kind text,p_source uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('games-source:'||p_kind||':'||p_source::text,0));
 SELECT player_id INTO result FROM games.player_sources WHERE source_kind=p_kind AND source_id=p_source;
 IF result IS NULL THEN
 IF p_kind='account' THEN
 SELECT games.canonical(source.player_id) INTO result FROM games.player_sources source
 JOIN games.players profile ON profile.id=games.canonical(source.player_id)
 WHERE source.source_kind='student_seat' AND games.seat_accounts(source.source_id)=ARRAY[p_source]
 ORDER BY profile.created_at,profile.id LIMIT 1;
 END IF;
 IF result IS NULL THEN
 result:=gen_random_uuid();
 INSERT INTO games.players(id,alias) VALUES(result,'Игрок '||substr(result::text,1,6));
 END IF;
 INSERT INTO games.player_sources(source_kind,source_id,player_id) VALUES(p_kind,p_source,result);
 END IF;
 RETURN games.canonical(result);
END $$;
CREATE FUNCTION games.authenticate(p_kind text,p_hash varchar) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_source uuid; v_account uuid; v_player uuid; v_seat_player uuid; v_seat record; v_accounts uuid[]; v_linked_seat uuid; v_existing_player uuid;
BEGIN
 IF p_kind='account' THEN
 SELECT account_id INTO v_account FROM public.session_v2_context(p_hash);
 IF v_account IS NULL THEN
 SELECT l.account_id INTO v_account FROM public.auth_resolve_session(p_hash) s
 JOIN public.legacy_user_account_links l ON l.tenant_id=s.tenant_id AND l.user_id=s.user_id;
 END IF;
 IF v_account IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=v_account AND status='active') THEN RETURN NULL; END IF;
 v_source:=v_account;
 ELSIF p_kind='student_seat' THEN
 SELECT s.* INTO v_seat FROM public.classroom_student_session_context(p_hash) context
 JOIN public.classroom_student_seats s ON s.id=context.seat_id AND s.status='active'
 JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id AND c.status='active'
 WHERE EXISTS(SELECT 1 FROM public.learner_identity_links sl JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.state='active' AND learner.tenant_id=c.tenant_id AND learner.school_id=c.school_id WHERE sl.seat_id=s.id AND sl.link_kind='student_seat' AND sl.status='active' AND sl.disabled_at IS NULL AND sl.tenant_id=c.tenant_id AND sl.school_id=c.school_id);
 IF NOT FOUND THEN RETURN NULL; END IF;
 v_source:=v_seat.id;
 v_accounts:=games.seat_accounts(v_source);
 IF cardinality(v_accounts)>1 THEN RETURN NULL; END IF;
 v_account:=v_accounts[1];
 IF v_account IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=v_account AND status='active') THEN RETURN NULL; END IF;
 ELSE RETURN NULL;
 END IF;
 IF v_account IS NOT NULL THEN
 v_player:=games.ensure_player('account',v_account);
 -- Attach verified source links immediately from either entry path. Keep the
 -- only pre-existing subject; when both existed, retain Account and audit aliases.
 FOR v_linked_seat IN SELECT id FROM public.classroom_student_seats WHERE games.seat_accounts(id)=ARRAY[v_account] ORDER BY id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('games-source:student_seat:'||v_linked_seat::text,0));
 SELECT games.canonical(player_id) INTO v_existing_player FROM games.player_sources WHERE source_kind='student_seat' AND source_id=v_linked_seat;
 IF v_existing_player IS NULL THEN
 INSERT INTO games.player_sources(source_kind,source_id,player_id) VALUES('student_seat',v_linked_seat,v_player);
 ELSIF v_existing_player<>v_player THEN
 PERFORM 1 FROM games.players WHERE id IN(v_player,v_existing_player) ORDER BY id FOR UPDATE;
 UPDATE games.players SET canonical_id=v_player WHERE id=v_existing_player;
 INSERT INTO games.player_alias_events(old_player_id,canonical_player_id,reason) VALUES(v_existing_player,v_player,'verified_account_link') ON CONFLICT DO NOTHING;
 END IF;
 END LOOP;
 IF p_kind='student_seat' THEN
 v_seat_player:=games.ensure_player('student_seat',v_source);
 IF v_seat_player<>v_player THEN
 PERFORM 1 FROM games.players WHERE id IN(v_player,v_seat_player) ORDER BY id FOR UPDATE;
 UPDATE games.players SET canonical_id=v_player WHERE id=v_seat_player;
 INSERT INTO games.player_alias_events(old_player_id,canonical_player_id,reason) VALUES(v_seat_player,v_player,'verified_account_link') ON CONFLICT DO NOTHING;
 END IF;
 END IF;
 ELSE v_player:=games.ensure_player(p_kind,v_source);
 END IF;
 PERFORM set_config('app.game_player_id',v_player::text,true);
 PERFORM set_config('app.games_source_kind',p_kind,true);
 PERFORM set_config('app.games_source_id',v_source::text,true);
 RETURN jsonb_build_object('playerId',v_player,'sourceKind',p_kind,'sourceId',v_source);
END $$;

-- Verified pupil bindings include both seat.account_id and canonical active learner links.
CREATE FUNCTION games.pupil_seats(p_player uuid) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT DISTINCT s.id FROM public.classroom_student_seats s
 JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id AND c.status='active'
 JOIN public.learner_identity_links sl ON sl.seat_id=s.id AND sl.link_kind='student_seat' AND sl.tenant_id=c.tenant_id AND sl.school_id=c.school_id
 JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.tenant_id=c.tenant_id AND learner.school_id=c.school_id
 WHERE s.status<>'removed' AND (
 EXISTS(SELECT 1 FROM games.player_sources source WHERE source.player_id IN(SELECT games.lineage(games.canonical(p_player))) AND source.source_kind='student_seat' AND source.source_id=s.id)
 OR EXISTS(SELECT 1 FROM games.player_sources source JOIN public.accounts a ON a.id=source.source_id AND a.status='active'
 WHERE source.player_id IN(SELECT games.lineage(games.canonical(p_player))) AND source.source_kind='account' AND (s.account_id=a.id OR EXISTS(
 SELECT 1 FROM public.learner_identity_links al WHERE al.learner_identity_id=sl.learner_identity_id AND al.tenant_id=sl.tenant_id AND al.school_id=sl.school_id AND al.link_kind='account' AND al.account_id=a.id AND al.status='active' AND al.disabled_at IS NULL)))
 );
$$;
CREATE FUNCTION games.access(p_player uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_rules jsonb:='[]'; v_affiliations jsonb:='[]'; v_bindings jsonb:='[]'; v_marks jsonb:='[]'; v_revision bigint; v_seat record; v_policy record; v_override text; v_score numeric; v_offline boolean; v_allowed boolean:=true; v_found boolean:=false;
BEGIN
 p_player:=games.canonical(p_player);
 IF p_player IS NULL THEN RETURN jsonb_build_object('allowed',false,'reason','access_unavailable'); END IF;
 IF EXISTS(SELECT 1 FROM games.player_sources src JOIN public.accounts a ON a.id=src.source_id AND a.status='active' WHERE src.source_kind='account' AND src.player_id IN(SELECT games.lineage(p_player))) THEN v_found:=true; END IF;
 -- Shared locks serialize teacher policy changes with admitted network operations.
 PERFORM 1 FROM public.classrooms c WHERE c.id IN(SELECT s.classroom_id FROM public.classroom_student_seats s WHERE s.id IN(SELECT games.pupil_seats(p_player))) ORDER BY c.id FOR SHARE;
 FOR v_seat IN SELECT s.*,c.school_id FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id WHERE s.id IN(SELECT games.pupil_seats(p_player)) ORDER BY s.id LOOP
 v_found:=true;
 SELECT COALESCE(p.mode,'allow') mode,p.threshold,COALESCE(p.state,'active') state,COALESCE(n.enabled,false) enabled,COALESCE(n.scope,'classroom') scope,COALESCE(n.version,0) network_version INTO v_policy
 FROM public.classrooms c LEFT JOIN public.classroom_games_policies p ON p.classroom_id=c.id LEFT JOIN games.classroom_network_policies n ON n.classroom_id=c.id WHERE c.id=v_seat.classroom_id;
 SELECT COALESCE((SELECT override FROM public.classroom_games_seat_overrides WHERE seat_id=v_seat.id),'inherit') INTO v_override;
 v_offline:=v_policy.state='active' AND (v_override='allow' OR (v_override='inherit' AND v_policy.mode='allow'));
 IF v_policy.state='active' AND v_override='inherit' AND v_policy.mode='rating_threshold' THEN
 SELECT (metric.item->>'score')::numeric INTO v_score FROM public.classroom_participant_metrics(v_seat.classroom_id) metric WHERE metric.item->>'seatId'=v_seat.id::text;
 v_offline:=v_score IS NOT NULL AND v_score>=v_policy.threshold;
 END IF;
 v_allowed:=v_allowed AND v_seat.status='active' AND COALESCE(v_offline,false) AND v_policy.enabled
 AND EXISTS(SELECT 1 FROM public.learner_identity_links sl JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.state='active' AND learner.tenant_id=v_seat.tenant_id AND learner.school_id=v_seat.school_id WHERE sl.seat_id=v_seat.id AND sl.link_kind='student_seat' AND sl.status='active' AND sl.disabled_at IS NULL AND sl.tenant_id=v_seat.tenant_id AND sl.school_id=v_seat.school_id);
 v_rules:=v_rules||jsonb_build_array(jsonb_build_object('seatId',v_seat.id,'classroomId',v_seat.classroom_id,'schoolId',v_seat.school_id,'scope',v_policy.scope));
 v_affiliations:=v_affiliations||jsonb_build_array(jsonb_build_object('tenantId',v_seat.tenant_id,'classroomId',v_seat.classroom_id,'schoolId',v_seat.school_id));
 v_bindings:=v_bindings||jsonb_build_array(v_seat.id);
 SELECT COALESCE(max(e.id),0) INTO v_revision FROM public.audit_events e WHERE
 (e.entity_id=v_seat.classroom_id AND (e.action IN('classroom.games.class','classroom.games.revoke') OR (e.action='classroom.games.seat' AND e.payload_json->>'seatId'=v_seat.id::text) OR (e.action='classroom.status_changed' AND e.payload_json->>'status'<>'active')))
 OR (e.entity_id=v_seat.id AND (e.action='classroom.student_seat_removed' OR (e.action='classroom.student_seat_updated' AND e.payload_json->>'status'<>'active')));
 v_marks:=v_marks||jsonb_build_array(jsonb_build_object('seatId',v_seat.id,'networkVersion',v_policy.network_version,'accessRevision',v_revision));
 END LOOP;
 -- Educators can play within their verified classes as well as platform-wide.
 FOR v_seat IN SELECT DISTINCT c.id classroom_id,c.school_id,c.tenant_id FROM games.player_sources src
 JOIN public.principals actor ON actor.account_id=src.source_id AND actor.kind='account'
 JOIN public.classrooms c ON c.status='active'
 WHERE src.source_kind='account' AND src.player_id IN(SELECT games.lineage(p_player)) AND public.classroom_games_teacher(actor.id,c.tenant_id,c.id) LOOP
 v_affiliations:=v_affiliations||jsonb_build_array(jsonb_build_object('tenantId',v_seat.tenant_id,'classroomId',v_seat.classroom_id,'schoolId',v_seat.school_id));
 END LOOP;
 IF p_player=games.canonical(NULLIF(current_setting('app.game_player_id',true),'')::uuid) AND current_setting('app.games_source_kind',true)='student_seat' AND NOT(v_bindings ? current_setting('app.games_source_id',true)) THEN v_allowed:=false; END IF;
 RETURN jsonb_build_object('allowed',v_found AND v_allowed,'reason',CASE WHEN NOT v_found THEN 'access_unavailable' WHEN NOT v_allowed THEN 'teacher_restricted' ELSE 'allowed' END,'rules',v_rules,'affiliations',v_affiliations,'bindings',v_bindings,'marks',v_marks);
END $$;
CREATE FUNCTION games.can_pair(p_first jsonb,p_second jsonb,p_scope text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE rule jsonb; other jsonb; side integer; own_access jsonb; other_access jsonb;
BEGIN
 IF NOT COALESCE((p_first->>'allowed')::boolean,false) OR NOT COALESCE((p_second->>'allowed')::boolean,false) THEN RETURN false; END IF;
 IF p_scope NOT IN('classroom','school','platform') THEN RETURN false; END IF;
 IF p_scope<>'platform' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_first->'affiliations') a CROSS JOIN jsonb_array_elements(p_second->'affiliations') b WHERE CASE WHEN p_scope='classroom' THEN a->>'classroomId'=b->>'classroomId' ELSE a->>'schoolId'=b->>'schoolId' END) THEN RETURN false; END IF;
 FOR side IN 1..2 LOOP
 own_access:=CASE WHEN side=1 THEN p_first ELSE p_second END; other_access:=CASE WHEN side=1 THEN p_second ELSE p_first END;
 FOR rule IN SELECT * FROM jsonb_array_elements(own_access->'rules') LOOP
 IF rule->>'scope'='classroom' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(other_access->'affiliations') a WHERE a->>'classroomId'=rule->>'classroomId') THEN RETURN false; END IF;
 IF rule->>'scope'='school' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(other_access->'affiliations') a WHERE a->>'schoolId'=rule->>'schoolId') THEN RETURN false; END IF;
 END LOOP;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION games.source_active(p_kind text,p_source uuid,p_player uuid,p_bindings jsonb,p_marks jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_access jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM games.player_sources s WHERE s.source_kind=p_kind AND s.source_id=p_source AND games.canonical(s.player_id)=games.canonical(p_player)) THEN RETURN false; END IF;
 IF p_kind='student_seat' AND NOT EXISTS(SELECT 1 FROM games.pupil_seats(p_player) seat WHERE seat=p_source) THEN RETURN false; END IF;
 IF p_kind='account' AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_source AND status='active') THEN RETURN false; END IF;
 current_access:=games.access(p_player);
 RETURN COALESCE((current_access->>'allowed')::boolean,false) AND COALESCE(current_access->'marks','[]'::jsonb) @> p_marks AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_bindings) old WHERE NOT (current_access->'bindings' ? old));
END $$;
CREATE FUNCTION games.network_policy(p_kind text,p_hash varchar,p_class uuid,p_input jsonb DEFAULT NULL,p_command varchar DEFAULT NULL,p_fingerprint text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor jsonb; v_account uuid; v_principal uuid; v_tenant uuid; previous integer; result jsonb; replay jsonb;
BEGIN
 actor:=games.authenticate(p_kind,p_hash);
 IF actor IS NULL OR p_kind<>'account' THEN RETURN NULL; END IF;
 v_account:=(actor->>'sourceId')::uuid;
 SELECT id INTO v_principal FROM public.principals WHERE kind='account' AND account_id=v_account;
 SELECT tenant_id INTO v_tenant FROM public.classrooms WHERE id=p_class AND status='active';
 IF v_tenant IS NULL OR NOT public.classroom_games_teacher(v_principal,v_tenant,p_class) THEN RETURN NULL; END IF;
 IF p_input IS NOT NULL THEN
 IF p_command IS NULL OR p_command !~ '^[A-Za-z0-9._:-]{1,128}$' OR p_fingerprint IS NULL THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 -- Permission above is current, even for replay. Lock order matches all Games commands.
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 PERFORM 1 FROM public.classrooms WHERE id=p_class FOR UPDATE;
 IF p_input-ARRAY['enabled','scope','expectedVersion']<>'{}' OR jsonb_typeof(p_input->'enabled') IS DISTINCT FROM 'boolean' OR COALESCE(p_input->>'scope','') NOT IN('classroom','school','platform') OR jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number' OR (p_input->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,8})$' THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 SELECT COALESCE((SELECT version FROM games.classroom_network_policies WHERE classroom_id=p_class),0) INTO previous;
 IF previous<>(p_input->>'expectedVersion')::integer THEN RETURN '{"error":"VERSION_CONFLICT"}'; END IF;
 INSERT INTO games.classroom_network_policies(classroom_id,enabled,scope,version,updated_by) VALUES(p_class,(p_input->>'enabled')::boolean,p_input->>'scope',previous+1,v_principal)
 ON CONFLICT(classroom_id) DO UPDATE SET enabled=EXCLUDED.enabled,scope=EXCLUDED.scope,version=EXCLUDED.version,updated_by=v_principal,updated_at=now();
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json) VALUES(v_tenant,'classroom',p_class,'classroom.games.network',jsonb_build_object('actorId',v_principal,'after',p_input));
 END IF;
 SELECT jsonb_build_object('enabled',COALESCE(n.enabled,false),'scope',COALESCE(n.scope,'classroom'),'version',COALESCE(n.version,0)) INTO result FROM public.classrooms c LEFT JOIN games.classroom_network_policies n ON n.classroom_id=c.id WHERE c.id=p_class;
 IF p_input IS NOT NULL THEN
   result:=result||'{"replayed":false}';
   PERFORM games.command_record(p_command,'network-policy',p_fingerprint,result);
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION games.actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT games.canonical(NULLIF(current_setting('app.game_player_id',true),'')::uuid);
$$;
CREATE FUNCTION games.match_record(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',m.id,'status',m.status,'version',m.version,'sequence',m.sequence,'scope',m.scope,'state',CASE WHEN m.state->>'drawOfferedBy' IS NULL THEN m.state ELSE jsonb_set(m.state,'{drawOfferedBy}',to_jsonb(games.canonical((m.state->>'drawOfferedBy')::uuid))) END,'updatedAt',m.updated_at,'termination',m.termination,
 'white',jsonb_build_object('playerId',games.canonical(w.player_id),'displayAlias',wp.alias),
 'black',jsonb_build_object('playerId',games.canonical(b.player_id),'displayAlias',bp.alias))
 FROM games.chess_matches m
 JOIN games.chess_participants w ON w.match_id=m.id AND w.color='white'
 JOIN games.chess_participants b ON b.match_id=m.id AND b.color='black'
 JOIN games.players wp ON wp.id=games.canonical(w.player_id)
 JOIN games.players bp ON bp.id=games.canonical(b.player_id)
 WHERE m.id=p_id;
$$;
CREATE FUNCTION games.invite_view(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',i.id,'code',i.code,'scope',i.scope,'status',CASE WHEN status='open' AND expires_at<floor(extract(epoch FROM clock_timestamp())*1000) THEN 'expired' ELSE status END,
 'initialMs',i.initial_ms,'incrementMs',i.increment_ms,'colorPreference',i.color_preference,'expiresAt',i.expires_at,'matchId',i.match_id,'version',i.version)
 FROM games.chess_invites i WHERE id=p_id;
$$;
CREATE FUNCTION games.check_match_policy(p_id uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE w games.chess_participants; b games.chess_participants; scope text;
BEGIN
 SELECT * INTO w FROM games.chess_participants WHERE match_id=p_id AND color='white';
 SELECT * INTO b FROM games.chess_participants WHERE match_id=p_id AND color='black';
 SELECT m.scope INTO scope FROM games.chess_matches m WHERE id=p_id;
 RETURN games.canonical(w.player_id)<>games.canonical(b.player_id) AND games.source_active(w.source_kind,w.source_id,w.player_id,w.bindings,w.grant_marks)
 AND games.source_active(b.source_kind,b.source_id,b.player_id,b.bindings,b.grant_marks)
 AND games.can_pair(games.access(w.player_id),games.access(b.player_id),scope);
END $$;
CREATE FUNCTION games.abort_if_revoked(p_id uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m games.chess_matches;
BEGIN
 SELECT * INTO m FROM games.chess_matches WHERE id=p_id FOR UPDATE;
 IF m.status='active' AND NOT games.check_match_policy(p_id) THEN
 UPDATE games.chess_matches SET status='aborted',termination='security_abort',version=version+1,sequence=sequence+1,lifecycle_version=lifecycle_version+1,updated_at=floor(extract(epoch FROM clock_timestamp())*1000) WHERE id=p_id;
 INSERT INTO games.chess_events(match_id,sequence,kind,actor_id,payload) VALUES(p_id,m.sequence+1,'match_aborted',NULL,'{"reason":"policy_or_membership_revoked"}');
 INSERT INTO games.outbox(event_id,match_id,event_kind,payload) VALUES(gen_random_uuid(),p_id,'match_aborted','{"result":"*","reason":"security_abort"}') ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE FUNCTION games.chess_read(p_action text,p_target text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); result jsonb; i games.chess_invites; target uuid;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 IF p_action='access' THEN
 RETURN jsonb_build_object('player',jsonb_build_object('playerId',actor,'displayAlias',(SELECT alias FROM games.players WHERE id=actor)),'access',games.access(actor));
 ELSIF p_action='match' THEN
 target:=p_target::uuid;
 IF NOT EXISTS(SELECT 1 FROM games.chess_participants p WHERE match_id=target AND p.player_id IN(SELECT games.lineage(actor))) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 PERFORM games.abort_if_revoked(target);
 RETURN jsonb_build_object('match',games.match_record(target));
 ELSIF p_action='invite' THEN
 SELECT * INTO i FROM games.chess_invites WHERE code=p_target FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF games.canonical(i.creator_id)<>actor AND NOT EXISTS(SELECT 1 FROM games.chess_participants p WHERE p.match_id=i.match_id AND p.player_id IN(SELECT games.lineage(actor))) THEN
 -- Possession permits redemption only; no read-side source/profile disclosure.
 RETURN '{"error":"NOT_FOUND"}';
 END IF;
 RETURN jsonb_build_object('invite',games.invite_view(i.id));
 ELSIF p_action='own-invite' THEN
 SELECT * INTO i FROM games.chess_invites WHERE id=p_target::uuid;
 IF NOT FOUND OR games.canonical(i.creator_id)<>actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 RETURN jsonb_build_object('invite',games.invite_view(i.id));
 ELSIF p_action='history' THEN
 IF p_limit<1 OR p_limit>100 THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 SELECT COALESCE(jsonb_agg(item ORDER BY updated_at DESC,id DESC),'[]') INTO result FROM (
 SELECT games.match_record(m.id) item,m.updated_at,m.id FROM games.chess_matches m
 WHERE EXISTS(SELECT 1 FROM games.chess_participants p WHERE p.match_id=m.id AND p.player_id IN(SELECT games.lineage(actor)))
 AND (p_cursor IS NULL OR (m.updated_at,m.id)<((p_cursor->>'updatedAt')::bigint,(p_cursor->>'id')::uuid))
 ORDER BY m.updated_at DESC,m.id DESC LIMIT p_limit
 ) page;
 RETURN jsonb_build_object('matches',result,'invites',(SELECT COALESCE(jsonb_agg(games.invite_view(id) ORDER BY created_at DESC),'[]'::jsonb) FROM (SELECT id,created_at FROM games.chess_invites WHERE games.canonical(creator_id)=actor AND status='open' AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000) ORDER BY created_at DESC LIMIT 8) own_invites));
 END IF;
 RETURN '{"error":"INVALID_COMMAND"}';
END $$;
CREATE FUNCTION games.command_replay(p_command varchar,p_fingerprint text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); receipt games.command_receipts;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('games-command:'||actor::text,0));
 IF (SELECT count(*) FROM games.command_receipts WHERE actor_id IN(SELECT games.lineage(actor)) AND command_id=p_command)>1 THEN RETURN '{"error":"IDEMPOTENCY_CONFLICT"}'; END IF;
 SELECT * INTO receipt FROM games.command_receipts WHERE actor_id IN(SELECT games.lineage(actor)) AND command_id=p_command;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF receipt.fingerprint<>p_fingerprint THEN RETURN '{"error":"IDEMPOTENCY_CONFLICT"}'; END IF;
 RETURN receipt.result||'{"replayed":true}';
END $$;
CREATE FUNCTION games.command_record(p_command varchar,p_kind text,p_fingerprint text,p_result jsonb) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id();
BEGIN
 INSERT INTO games.command_receipts(actor_id,command_id,kind,fingerprint,result) VALUES(actor,p_command,p_kind,p_fingerprint,p_result);
END $$;
CREATE FUNCTION games.check_admission_limit() RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT count(*)<30 FROM games.command_receipts WHERE actor_id IN(SELECT games.lineage(games.actor_id())) AND kind IN('create','accept','cancel') AND created_at>clock_timestamp()-interval '1 minute';
$$;
CREATE FUNCTION games.chess_create(p_command varchar,p_fingerprint text,p_id uuid,p_code varchar,p_scope text,p_initial integer,p_increment integer,p_color text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); access jsonb; replay jsonb; result jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 access:=games.access(actor);
 IF NOT COALESCE((access->>'allowed')::boolean,false) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 IF p_scope NOT IN('classroom','school','platform') OR p_color NOT IN('white','black','random') OR p_initial NOT BETWEEN 60000 AND 3600000 OR p_increment NOT BETWEEN 0 AND 60000 THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(access->'rules') rule WHERE (p_scope='platform' AND rule->>'scope'<>'platform') OR (p_scope='school' AND rule->>'scope'='classroom')) OR (p_scope<>'platform' AND jsonb_array_length(access->'affiliations')=0) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 IF NOT games.check_admission_limit() OR (SELECT count(*) FROM games.chess_invites WHERE games.canonical(creator_id)=actor AND status='open' AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000))>=8 THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 INSERT INTO games.chess_invites(id,creator_id,code,scope,status,initial_ms,increment_ms,color_preference,expires_at,bindings,grant_marks,source_kind,source_id)
 VALUES(p_id,actor,p_code,p_scope,'open',p_initial,p_increment,p_color,floor(extract(epoch FROM clock_timestamp())*1000)+1800000,access->'bindings',access->'marks',current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid);
 result:=jsonb_build_object('inviteId',p_id);
 PERFORM games.command_record(p_command,'create',p_fingerprint,result);
 RETURN result;
END $$;
CREATE FUNCTION games.chess_cancel(p_command varchar,p_fingerprint text,p_id uuid,p_version integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); invite games.chess_invites; replay jsonb; result jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT * INTO invite FROM games.chess_invites WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR games.canonical(invite.creator_id)<>actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF invite.version<>p_version THEN RETURN '{"error":"VERSION_CONFLICT"}'; END IF;
 IF invite.status<>'open' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 UPDATE games.chess_invites SET status='cancelled',version=version+1 WHERE id=p_id;
 result:=jsonb_build_object('inviteId',p_id);
 PERFORM games.command_record(p_command,'cancel',p_fingerprint,result);
 RETURN result;
END $$;
CREATE FUNCTION games.chess_redeem_context(p_code varchar) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); invite games.chess_invites;
BEGIN
 SELECT * INTO invite FROM games.chess_invites WHERE code=p_code FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF games.canonical(invite.creator_id)=actor THEN RETURN '{"error":"FORBIDDEN"}'; END IF;
 IF invite.status='accepted' AND EXISTS(SELECT 1 FROM games.chess_participants p WHERE p.match_id=invite.match_id AND p.player_id IN(SELECT games.lineage(actor))) THEN RETURN jsonb_build_object('matchId',invite.match_id); END IF;
 IF invite.status<>'open' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF invite.expires_at<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RETURN '{"error":"INVITE_EXPIRED"}'; END IF;
 IF NOT games.source_active(invite.source_kind,invite.source_id,invite.creator_id,invite.bindings,invite.grant_marks) OR NOT games.can_pair(games.access(invite.creator_id),games.access(actor),invite.scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 RETURN jsonb_build_object('invite',games.invite_view(invite.id),'creatorId',games.canonical(invite.creator_id));
END $$;
CREATE FUNCTION games.chess_accept(p_command varchar,p_fingerprint text,p_code varchar,p_id uuid,p_creator_white boolean,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); context jsonb; invite games.chess_invites; replay jsonb; result jsonb; creator uuid; own_access jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 context:=games.chess_redeem_context(p_code);
 IF context ? 'error' THEN RETURN context; END IF;
 IF context ? 'matchId' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF NOT games.check_admission_limit() THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 SELECT * INTO invite FROM games.chess_invites WHERE code=p_code;
 creator:=games.canonical(invite.creator_id); own_access:=games.access(actor);
 IF (invite.color_preference='white' AND NOT p_creator_white) OR (invite.color_preference='black' AND p_creator_white) OR p_state->'document'->>'result'<>'*' OR jsonb_array_length(p_state->'document'->'moves')<>0 OR (p_state->'document'->'clock'->>'whiteMs')::integer<>invite.initial_ms OR (p_state->'document'->'clock'->>'blackMs')::integer<>invite.initial_ms THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 INSERT INTO games.chess_matches(id,scope_kind,status,lifecycle_version,scope,scope_bindings,state,updated_at)
 VALUES(p_id,CASE invite.scope WHEN 'classroom' THEN 'classroom' WHEN 'school' THEN 'workspace' ELSE 'global' END,'active',3,invite.scope,CASE WHEN invite.scope='platform' THEN '[]'::jsonb ELSE (SELECT COALESCE(jsonb_agg(DISTINCT a),'[]'::jsonb) FROM jsonb_array_elements(games.access(creator)->'affiliations') a WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(own_access->'affiliations') b WHERE CASE WHEN invite.scope='classroom' THEN a->>'classroomId'=b->>'classroomId' ELSE a->>'schoolId'=b->>'schoolId' END)) END,p_state,floor(extract(epoch FROM clock_timestamp())*1000));
 INSERT INTO games.chess_participants(match_id,player_id,color,bindings,grant_marks,source_kind,source_id) VALUES
 (p_id,creator,CASE WHEN p_creator_white THEN 'white' ELSE 'black' END,invite.bindings,invite.grant_marks,invite.source_kind,invite.source_id),
 (p_id,actor,CASE WHEN p_creator_white THEN 'black' ELSE 'white' END,own_access->'bindings',own_access->'marks',current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid);
 UPDATE games.chess_invites SET status='accepted',match_id=p_id,version=version+1 WHERE id=invite.id;
 INSERT INTO games.chess_events(match_id,sequence,kind,actor_id,payload) VALUES(p_id,1,'match_started',actor,'{}');
 result:=jsonb_build_object('matchId',p_id);
 PERFORM games.command_record(p_command,'accept',p_fingerprint,result);
 RETURN result;
END $$;
CREATE FUNCTION games.chess_save(p_command varchar,p_fingerprint text,p_id uuid,p_version integer,p_kind text,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); m games.chess_matches; replay jsonb; result jsonb; finished boolean;
BEGIN
 IF p_command IS NOT NULL THEN replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM games.chess_participants WHERE match_id=p_id AND games.canonical(player_id)=actor) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 PERFORM games.abort_if_revoked(p_id);
 SELECT * INTO m FROM games.chess_matches WHERE id=p_id FOR UPDATE;
 IF m.status='aborted' THEN RETURN jsonb_build_object('matchId',p_id,'policyAborted',true); END IF;
 IF m.status<>'active' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF m.version<>p_version THEN RETURN '{"error":"VERSION_CONFLICT"}'; END IF;
 IF p_command IS NOT NULL AND (SELECT count(*) FROM games.command_receipts WHERE actor_id IN(SELECT games.lineage(actor)) AND kind='match:'||p_id::text AND created_at>clock_timestamp()-interval '1 minute')>=120 THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 finished:=p_state->'document'->>'result'<>'*';
 UPDATE games.chess_matches SET state=p_state,status=CASE WHEN finished THEN 'finished' ELSE 'active' END,
 version=version+1,sequence=sequence+1,lifecycle_version=lifecycle_version+CASE WHEN finished THEN 2 ELSE 0 END,
 termination=CASE WHEN finished THEN p_state->'document'->>'termination' ELSE '' END,
 updated_at=floor(extract(epoch FROM clock_timestamp())*1000) WHERE id=p_id;
 INSERT INTO games.chess_events(match_id,sequence,kind,actor_id,payload) VALUES(p_id,m.sequence+1,CASE WHEN finished THEN 'match_finished' ELSE p_kind END,actor,jsonb_build_object('version',m.version+1,'result',p_state->'document'->>'result'));
 IF finished THEN INSERT INTO games.outbox(event_id,match_id,event_kind,payload) VALUES(gen_random_uuid(),p_id,'match_finished',jsonb_build_object('result',p_state->'document'->>'result','termination',p_state->'document'->>'termination')); END IF;
 result:=jsonb_build_object('matchId',p_id);
 IF p_command IS NOT NULL THEN PERFORM games.command_record(p_command,'match:'||p_id::text,p_fingerprint,result); END IF;
 RETURN result;
END $$;
-- Helper functions are never callable by the runtime role. Only authenticated narrow entry points.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA games FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION games.authenticate(text,varchar),games.network_policy(text,varchar,uuid,jsonb,varchar,text),
 games.chess_read(text,text,jsonb,integer),games.command_replay(varchar,text),
 games.chess_create(varchar,text,uuid,varchar,text,integer,integer,text),
 games.chess_cancel(varchar,text,uuid,integer),games.chess_redeem_context(varchar),
 games.chess_accept(varchar,text,varchar,uuid,boolean,jsonb),games.chess_save(varchar,text,uuid,integer,text,jsonb)
 TO asalab_app;
