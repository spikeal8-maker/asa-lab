-- Russian-64 casual matches reuse canonical Games identities and teacher network policy.
CREATE TABLE games.checkers_invites (
 id uuid PRIMARY KEY, creator_id uuid NOT NULL REFERENCES games.players(id), code varchar(32) NOT NULL UNIQUE,
 scope text NOT NULL CHECK(scope IN ('classroom','school','platform')), status text NOT NULL CHECK(status IN ('open','accepted','cancelled','expired')),
 initial_ms integer NOT NULL CHECK(initial_ms BETWEEN 60000 AND 3600000), increment_ms integer NOT NULL CHECK(increment_ms BETWEEN 0 AND 60000),
 color_preference text NOT NULL CHECK(color_preference IN ('white','black','random')),
 expires_at bigint NOT NULL, match_id uuid, version integer NOT NULL DEFAULT 1,
 bindings jsonb NOT NULL DEFAULT '[]', grant_marks jsonb NOT NULL DEFAULT '[]', source_kind text NOT NULL, source_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE games.checkers_matches (
 id uuid PRIMARY KEY, game_key text NOT NULL DEFAULT 'checkers' CHECK(game_key='checkers'),
 game_version text NOT NULL DEFAULT 'asa-checkers-v1', rules_version text NOT NULL DEFAULT 'russian-64-v1',
 state_schema_version integer NOT NULL DEFAULT 1, protocol_version text NOT NULL DEFAULT 'checkers-network-v1',
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
CREATE TABLE games.checkers_participants (
 match_id uuid NOT NULL REFERENCES games.checkers_matches(id), player_id uuid NOT NULL REFERENCES games.players(id),
 color text NOT NULL CHECK(color IN ('white','black')), bindings jsonb NOT NULL DEFAULT '[]', grant_marks jsonb NOT NULL DEFAULT '[]',
 source_kind text NOT NULL, source_id uuid NOT NULL,
 PRIMARY KEY(match_id,player_id), UNIQUE(match_id,color)
);
CREATE TABLE games.checkers_teams (
 id uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES games.checkers_matches(id), team_key text NOT NULL,
 UNIQUE(match_id,team_key)
);
CREATE TABLE games.checkers_events (
 match_id uuid NOT NULL REFERENCES games.checkers_matches(id), sequence integer NOT NULL,
 kind text NOT NULL, actor_id uuid REFERENCES games.players(id), payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(match_id,sequence)
);
CREATE TABLE games.checkers_outbox (
 event_id uuid PRIMARY KEY, match_id uuid NOT NULL REFERENCES games.checkers_matches(id),
 event_kind text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(match_id,event_kind)
);
ALTER TABLE games.checkers_invites ADD CONSTRAINT checkers_invite_match_fk FOREIGN KEY(match_id) REFERENCES games.checkers_matches(id);
CREATE INDEX checkers_participant_history ON games.checkers_participants(player_id,match_id);
CREATE INDEX checkers_invite_creator ON games.checkers_invites(creator_id,created_at);
DO $$ DECLARE item text; BEGIN
 FOREACH item IN ARRAY ARRAY['checkers_invites','checkers_matches','checkers_participants','checkers_teams','checkers_events','checkers_outbox'] LOOP
 EXECUTE format('ALTER TABLE games.%I ENABLE ROW LEVEL SECURITY',item);
 EXECUTE format('ALTER TABLE games.%I FORCE ROW LEVEL SECURITY',item);
 EXECUTE format('REVOKE ALL ON games.%I FROM PUBLIC,asalab_app',item);
 END LOOP;
END $$;
CREATE FUNCTION games.checkers_match_record(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',m.id,'status',m.status,'version',m.version,'sequence',m.sequence,'scope',m.scope,'state',CASE WHEN m.state->>'drawOfferedBy' IS NULL THEN m.state ELSE jsonb_set(m.state,'{drawOfferedBy}',to_jsonb(games.canonical((m.state->>'drawOfferedBy')::uuid))) END,'updatedAt',m.updated_at,'termination',m.termination,
 'white',jsonb_build_object('playerId',games.canonical(w.player_id),'displayAlias',wp.alias),
 'black',jsonb_build_object('playerId',games.canonical(b.player_id),'displayAlias',bp.alias))
 FROM games.checkers_matches m
 JOIN games.checkers_participants w ON w.match_id=m.id AND w.color='white'
 JOIN games.checkers_participants b ON b.match_id=m.id AND b.color='black'
 JOIN games.players wp ON wp.id=games.canonical(w.player_id)
 JOIN games.players bp ON bp.id=games.canonical(b.player_id)
 WHERE m.id=p_id;
$$;
CREATE FUNCTION games.checkers_invite_view(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',i.id,'code',i.code,'scope',i.scope,'status',CASE WHEN status='open' AND expires_at<floor(extract(epoch FROM clock_timestamp())*1000) THEN 'expired' ELSE status END,
 'initialMs',i.initial_ms,'incrementMs',i.increment_ms,'colorPreference',i.color_preference,'expiresAt',i.expires_at,'matchId',i.match_id,'version',i.version)
 FROM games.checkers_invites i WHERE id=p_id;
$$;
CREATE FUNCTION games.checkers_check_match_policy(p_id uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE w games.checkers_participants; b games.checkers_participants; scope text;
BEGIN
 SELECT * INTO w FROM games.checkers_participants WHERE match_id=p_id AND color='white';
 SELECT * INTO b FROM games.checkers_participants WHERE match_id=p_id AND color='black';
 SELECT m.scope INTO scope FROM games.checkers_matches m WHERE id=p_id;
 RETURN games.canonical(w.player_id)<>games.canonical(b.player_id) AND games.source_active(w.source_kind,w.source_id,w.player_id,w.bindings,w.grant_marks)
 AND games.source_active(b.source_kind,b.source_id,b.player_id,b.bindings,b.grant_marks)
 AND games.can_pair(games.access(w.player_id),games.access(b.player_id),scope);
END $$;
CREATE FUNCTION games.checkers_abort_if_revoked(p_id uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m games.checkers_matches;
BEGIN
 SELECT * INTO m FROM games.checkers_matches WHERE id=p_id FOR UPDATE;
 IF m.status='active' AND NOT games.checkers_check_match_policy(p_id) THEN
 UPDATE games.checkers_matches SET status='aborted',termination='security_abort',version=version+1,sequence=sequence+1,lifecycle_version=lifecycle_version+1,updated_at=floor(extract(epoch FROM clock_timestamp())*1000) WHERE id=p_id;
 INSERT INTO games.checkers_events(match_id,sequence,kind,actor_id,payload) VALUES(p_id,m.sequence+1,'match_aborted',NULL,'{"reason":"policy_or_membership_revoked"}');
 INSERT INTO games.checkers_outbox(event_id,match_id,event_kind,payload) VALUES(gen_random_uuid(),p_id,'match_aborted','{"result":"*","reason":"security_abort"}') ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE FUNCTION games.checkers_read(p_action text,p_target text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); result jsonb; i games.checkers_invites; target uuid;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 IF p_action='access' THEN
 RETURN jsonb_build_object('player',jsonb_build_object('playerId',actor,'displayAlias',(SELECT alias FROM games.players WHERE id=actor)),'access',games.access(actor));
 ELSIF p_action='match' THEN
 target:=p_target::uuid;
 IF NOT EXISTS(SELECT 1 FROM games.checkers_participants p WHERE match_id=target AND p.player_id IN(SELECT games.lineage(actor))) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 PERFORM games.checkers_abort_if_revoked(target);
 RETURN jsonb_build_object('match',games.checkers_match_record(target));
 ELSIF p_action='invite' THEN
 SELECT * INTO i FROM games.checkers_invites WHERE code=p_target FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF games.canonical(i.creator_id)<>actor AND NOT EXISTS(SELECT 1 FROM games.checkers_participants p WHERE p.match_id=i.match_id AND p.player_id IN(SELECT games.lineage(actor))) THEN
 -- Possession permits redemption only; no read-side source/profile disclosure.
 RETURN '{"error":"NOT_FOUND"}';
 END IF;
 RETURN jsonb_build_object('invite',games.checkers_invite_view(i.id));
 ELSIF p_action='own-invite' THEN
 SELECT * INTO i FROM games.checkers_invites WHERE id=p_target::uuid;
 IF NOT FOUND OR games.canonical(i.creator_id)<>actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 RETURN jsonb_build_object('invite',games.checkers_invite_view(i.id));
 ELSIF p_action='history' THEN
 IF p_limit<1 OR p_limit>100 THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 SELECT COALESCE(jsonb_agg(item ORDER BY updated_at DESC,id DESC),'[]') INTO result FROM (
 SELECT games.checkers_match_record(m.id) item,m.updated_at,m.id FROM games.checkers_matches m
 WHERE EXISTS(SELECT 1 FROM games.checkers_participants p WHERE p.match_id=m.id AND p.player_id IN(SELECT games.lineage(actor)))
 AND (p_cursor IS NULL OR (m.updated_at,m.id)<((p_cursor->>'updatedAt')::bigint,(p_cursor->>'id')::uuid))
 ORDER BY m.updated_at DESC,m.id DESC LIMIT p_limit
 ) page;
 RETURN jsonb_build_object('matches',result,'invites',(SELECT COALESCE(jsonb_agg(games.checkers_invite_view(id) ORDER BY created_at DESC),'[]'::jsonb) FROM (SELECT id,created_at FROM games.checkers_invites WHERE games.canonical(creator_id)=actor AND status='open' AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000) ORDER BY created_at DESC LIMIT 8) own_invites));
 END IF;
 RETURN '{"error":"INVALID_COMMAND"}';
END $$;
CREATE FUNCTION games.checkers_create(p_command varchar,p_fingerprint text,p_id uuid,p_code varchar,p_scope text,p_initial integer,p_increment integer,p_color text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); access jsonb; replay jsonb; result jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 access:=games.access(actor);
 IF NOT COALESCE((access->>'allowed')::boolean,false) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 IF p_scope NOT IN('classroom','school','platform') OR p_color NOT IN('white','black','random') OR p_initial NOT BETWEEN 60000 AND 3600000 OR p_increment NOT BETWEEN 0 AND 60000 THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(access->'rules') rule WHERE (p_scope='platform' AND rule->>'scope'<>'platform') OR (p_scope='school' AND rule->>'scope'='classroom')) OR (p_scope<>'platform' AND jsonb_array_length(access->'affiliations')=0) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 IF NOT games.check_admission_limit() OR (SELECT count(*) FROM games.checkers_invites WHERE games.canonical(creator_id)=actor AND status='open' AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000))>=8 THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 INSERT INTO games.checkers_invites(id,creator_id,code,scope,status,initial_ms,increment_ms,color_preference,expires_at,bindings,grant_marks,source_kind,source_id)
 VALUES(p_id,actor,p_code,p_scope,'open',p_initial,p_increment,p_color,floor(extract(epoch FROM clock_timestamp())*1000)+1800000,access->'bindings',access->'marks',current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid);
 result:=jsonb_build_object('inviteId',p_id);
 PERFORM games.command_record(p_command,'create',p_fingerprint,result);
 RETURN result;
END $$;
CREATE FUNCTION games.checkers_cancel(p_command varchar,p_fingerprint text,p_id uuid,p_version integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); invite games.checkers_invites; replay jsonb; result jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT * INTO invite FROM games.checkers_invites WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR games.canonical(invite.creator_id)<>actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF invite.version<>p_version THEN RETURN '{"error":"VERSION_CONFLICT"}'; END IF;
 IF invite.status<>'open' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 UPDATE games.checkers_invites SET status='cancelled',version=version+1 WHERE id=p_id;
 result:=jsonb_build_object('inviteId',p_id);
 PERFORM games.command_record(p_command,'cancel',p_fingerprint,result);
 RETURN result;
END $$;
CREATE FUNCTION games.checkers_redeem_context(p_code varchar) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); invite games.checkers_invites;
BEGIN
 SELECT * INTO invite FROM games.checkers_invites WHERE code=p_code FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF games.canonical(invite.creator_id)=actor THEN RETURN '{"error":"FORBIDDEN"}'; END IF;
 IF invite.status='accepted' AND EXISTS(SELECT 1 FROM games.checkers_participants p WHERE p.match_id=invite.match_id AND p.player_id IN(SELECT games.lineage(actor))) THEN RETURN jsonb_build_object('matchId',invite.match_id); END IF;
 IF invite.status<>'open' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF invite.expires_at<=floor(extract(epoch FROM clock_timestamp())*1000) THEN RETURN '{"error":"INVITE_EXPIRED"}'; END IF;
 IF NOT games.source_active(invite.source_kind,invite.source_id,invite.creator_id,invite.bindings,invite.grant_marks) OR NOT games.can_pair(games.access(invite.creator_id),games.access(actor),invite.scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 RETURN jsonb_build_object('invite',games.checkers_invite_view(invite.id),'creatorId',games.canonical(invite.creator_id));
END $$;
CREATE FUNCTION games.checkers_accept(p_command varchar,p_fingerprint text,p_code varchar,p_id uuid,p_creator_white boolean,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); context jsonb; invite games.checkers_invites; replay jsonb; result jsonb; creator uuid; own_access jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 context:=games.checkers_redeem_context(p_code);
 IF context ? 'error' THEN RETURN context; END IF;
 IF context ? 'matchId' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF NOT games.check_admission_limit() THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 SELECT * INTO invite FROM games.checkers_invites WHERE code=p_code;
 creator:=games.canonical(invite.creator_id); own_access:=games.access(actor);
 IF (invite.color_preference='white' AND NOT p_creator_white) OR (invite.color_preference='black' AND p_creator_white) OR p_state->'document'->>'result'<>'*' OR jsonb_array_length(p_state->'document'->'moveHistory')<>0 OR (p_state->'clock'->>'whiteMs')::integer<>invite.initial_ms OR (p_state->'clock'->>'blackMs')::integer<>invite.initial_ms THEN RETURN '{"error":"INVALID_COMMAND"}'; END IF;
 INSERT INTO games.checkers_matches(id,scope_kind,status,lifecycle_version,scope,scope_bindings,state,updated_at)
 VALUES(p_id,CASE invite.scope WHEN 'classroom' THEN 'classroom' WHEN 'school' THEN 'workspace' ELSE 'global' END,'active',3,invite.scope,CASE WHEN invite.scope='platform' THEN '[]'::jsonb ELSE (SELECT COALESCE(jsonb_agg(DISTINCT a),'[]'::jsonb) FROM jsonb_array_elements(games.access(creator)->'affiliations') a WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(own_access->'affiliations') b WHERE CASE WHEN invite.scope='classroom' THEN a->>'classroomId'=b->>'classroomId' ELSE a->>'schoolId'=b->>'schoolId' END)) END,p_state,floor(extract(epoch FROM clock_timestamp())*1000));
 INSERT INTO games.checkers_participants(match_id,player_id,color,bindings,grant_marks,source_kind,source_id) VALUES
 (p_id,creator,CASE WHEN p_creator_white THEN 'white' ELSE 'black' END,invite.bindings,invite.grant_marks,invite.source_kind,invite.source_id),
 (p_id,actor,CASE WHEN p_creator_white THEN 'black' ELSE 'white' END,own_access->'bindings',own_access->'marks',current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid);
 UPDATE games.checkers_invites SET status='accepted',match_id=p_id,version=version+1 WHERE id=invite.id;
 INSERT INTO games.checkers_events(match_id,sequence,kind,actor_id,payload) VALUES(p_id,1,'match_started',actor,'{}');
 result:=jsonb_build_object('matchId',p_id);
 PERFORM games.command_record(p_command,'accept',p_fingerprint,result);
 RETURN result;
END $$;
CREATE FUNCTION games.checkers_save(p_command varchar,p_fingerprint text,p_id uuid,p_version integer,p_kind text,p_state jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); m games.checkers_matches; replay jsonb; result jsonb; finished boolean;
BEGIN
 IF p_command IS NOT NULL THEN replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM games.checkers_participants WHERE match_id=p_id AND games.canonical(player_id)=actor) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 PERFORM games.checkers_abort_if_revoked(p_id);
 SELECT * INTO m FROM games.checkers_matches WHERE id=p_id FOR UPDATE;
 IF m.status='aborted' THEN RETURN jsonb_build_object('matchId',p_id,'policyAborted',true); END IF;
 IF m.status<>'active' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF m.version<>p_version THEN RETURN '{"error":"VERSION_CONFLICT"}'; END IF;
 IF p_command IS NOT NULL AND (SELECT count(*) FROM games.command_receipts WHERE actor_id IN(SELECT games.lineage(actor)) AND kind='match:'||p_id::text AND created_at>clock_timestamp()-interval '1 minute')>=120 THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 finished:=p_state->'document'->>'result'<>'*';
 UPDATE games.checkers_matches SET state=p_state,status=CASE WHEN finished THEN 'finished' ELSE 'active' END,
 version=version+1,sequence=sequence+1,lifecycle_version=lifecycle_version+CASE WHEN finished THEN 2 ELSE 0 END,
 termination=CASE WHEN finished THEN p_state->>'termination' ELSE '' END,
 updated_at=floor(extract(epoch FROM clock_timestamp())*1000) WHERE id=p_id;
 INSERT INTO games.checkers_events(match_id,sequence,kind,actor_id,payload) VALUES(p_id,m.sequence+1,CASE WHEN finished THEN 'match_finished' ELSE p_kind END,actor,jsonb_build_object('version',m.version+1,'result',p_state->'document'->>'result'));
 IF finished THEN INSERT INTO games.checkers_outbox(event_id,match_id,event_kind,payload) VALUES(gen_random_uuid(),p_id,'match_finished',jsonb_build_object('result',p_state->'document'->>'result','termination',p_state->>'termination')); END IF;
 result:=jsonb_build_object('matchId',p_id);
 IF p_command IS NOT NULL THEN PERFORM games.command_record(p_command,'match:'||p_id::text,p_fingerprint,result); END IF;
 RETURN result;
END $$;
-- Opt-in Checkers lobby: ephemeral presence and recipient-bound invitations.
-- Existing education RLS, tenant ownership and match storage are unchanged.
CREATE TABLE games.checkers_presence (
 player_id uuid PRIMARY KEY REFERENCES games.players(id), source_kind text NOT NULL,
 source_id uuid NOT NULL, bindings jsonb NOT NULL, grant_marks jsonb NOT NULL,
 affiliations jsonb NOT NULL, seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX checkers_presence_recent ON games.checkers_presence(seen_at DESC);
CREATE TABLE games.checkers_challenges (
 invite_id uuid PRIMARY KEY REFERENCES games.checkers_invites(id), recipient_id uuid NOT NULL REFERENCES games.players(id),
 source_kind text NOT NULL, source_id uuid NOT NULL, bindings jsonb NOT NULL, grant_marks jsonb NOT NULL
);
CREATE INDEX checkers_challenge_recipient ON games.checkers_challenges(recipient_id);
ALTER TABLE games.checkers_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.checkers_presence FORCE ROW LEVEL SECURITY;
ALTER TABLE games.checkers_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.checkers_challenges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON games.checkers_presence,games.checkers_challenges FROM PUBLIC,asalab_app;

CREATE FUNCTION games.checkers_scope_allowed(a jsonb,s text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE((a->>'allowed')::boolean,false) AND s IN('classroom','school','platform')
 AND (s='platform' OR jsonb_array_length(a->'affiliations')>0)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'rules') r
 WHERE (s='platform' AND r->>'scope'<>'platform') OR (s='school' AND r->>'scope'='classroom'));
$$;
CREATE FUNCTION games.checkers_player_free(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM games.checkers_participants c JOIN games.checkers_matches m ON m.id=c.match_id
 WHERE c.player_id IN(SELECT games.lineage(p)) AND m.status='active');
$$;
CREATE FUNCTION games.checkers_avatar_revision(p_player uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT md5(p.source_kind||COALESCE(a.updated_at::text,s.updated_at::text,'default'))
 FROM games.checkers_presence p LEFT JOIN public.profiles a ON p.source_kind='account' AND a.account_id=p.source_id
 LEFT JOIN public.classroom_student_seats s ON p.source_kind='student_seat' AND s.id=p.source_id
 WHERE p.player_id IN(SELECT games.lineage(p_player)) ORDER BY p.seen_at DESC LIMIT 1;
$$;
CREATE FUNCTION games.checkers_avatar(p_target uuid,p_scope text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); a jsonb; target games.checkers_presence; image text; avatar text;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 a:=games.access(actor); p_target:=games.canonical(p_target);
 IF NOT games.checkers_scope_allowed(a,p_scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 SELECT * INTO target FROM games.checkers_presence p WHERE p.player_id IN(SELECT games.lineage(p_target)) AND p.seen_at>clock_timestamp()-interval '45 seconds' ORDER BY p.seen_at DESC LIMIT 1;
 IF NOT FOUND OR NOT games.source_active(target.source_kind,target.source_id,p_target,target.bindings,target.grant_marks)
 OR NOT games.checkers_scope_allowed(games.access(p_target),p_scope) OR NOT games.can_pair(a,games.access(p_target),p_scope) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF target.source_kind='account' THEN SELECT avatar_data_url INTO image FROM public.profiles WHERE account_id=target.source_id;
 ELSE SELECT avatar_key INTO avatar FROM public.classroom_student_seats WHERE id=target.source_id; END IF;
 RETURN jsonb_build_object('dataUrl',image,'avatarKey',avatar,'seed',target.source_id::text);
END $$;
CREATE FUNCTION games.checkers_lobby(p_scope text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); own_access jsonb; peers jsonb; incoming jsonb; outgoing jsonb;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 own_access:=games.access(actor);
 IF NOT games.checkers_scope_allowed(own_access,p_scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 -- Re-enabling a class creates a new grant. Obsolete directed invitations must
 -- neither reappear nor consume the recipient/creator's bounded inbox slots.
 UPDATE games.checkers_invites i SET status='cancelled',version=i.version+1
 FROM games.checkers_challenges c WHERE c.invite_id=i.id AND i.status='open'
 AND (i.creator_id IN(SELECT games.lineage(actor)) OR c.recipient_id IN(SELECT games.lineage(actor)))
 AND (games.canonical(i.creator_id)=games.canonical(c.recipient_id)
 OR NOT games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 OR NOT games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 OR NOT games.checkers_scope_allowed(games.access(i.creator_id),i.scope)
 OR NOT games.checkers_scope_allowed(games.access(c.recipient_id),i.scope)
 OR NOT games.can_pair(games.access(i.creator_id),games.access(c.recipient_id),i.scope));
 UPDATE games.checkers_invites i SET status='cancelled',version=i.version+1 WHERE i.creator_id IN(SELECT games.lineage(actor)) AND i.status='open' AND NOT games.checkers_scope_allowed(own_access,i.scope);
 INSERT INTO games.checkers_presence(player_id,source_kind,source_id,bindings,grant_marks,affiliations)
 VALUES(actor,current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid,
 own_access->'bindings',own_access->'marks',own_access->'affiliations')
 ON CONFLICT(player_id) DO UPDATE SET source_kind=excluded.source_kind,source_id=excluded.source_id,
 bindings=excluded.bindings,grant_marks=excluded.grant_marks,affiliations=excluded.affiliations,seen_at=clock_timestamp();
 -- Bounded discovery. No education identifiers, names, emails or roster are projected.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('playerId',p.id,'displayAlias',p.alias,'avatarRevision',games.checkers_avatar_revision(p.id)) ORDER BY p.alias,p.id),'[]') INTO peers
 FROM games.players p WHERE p.id IN (
 SELECT DISTINCT games.canonical(pres.player_id) FROM (
 SELECT * FROM games.checkers_presence recent
 WHERE recent.seen_at>clock_timestamp()-interval '45 seconds' AND games.canonical(recent.player_id)<>actor
 AND (p_scope='platform' OR EXISTS(SELECT 1 FROM jsonb_array_elements(recent.affiliations) a CROSS JOIN jsonb_array_elements(own_access->'affiliations') b
 WHERE CASE p_scope WHEN 'classroom' THEN a->>'classroomId'=b->>'classroomId' ELSE a->>'schoolId'=b->>'schoolId' END))
 ORDER BY recent.seen_at DESC,recent.player_id LIMIT 200
 ) pres CROSS JOIN LATERAL (SELECT games.access(pres.player_id) a OFFSET 0) current_access
 WHERE true
 AND games.source_active(pres.source_kind,pres.source_id,pres.player_id,pres.bindings,pres.grant_marks)
 AND games.checkers_player_free(games.canonical(pres.player_id))
 AND games.checkers_scope_allowed(current_access.a,p_scope)
 AND games.can_pair(own_access,current_access.a,p_scope)
 ORDER BY games.canonical(pres.player_id) LIMIT 100
 );
 SELECT COALESCE(jsonb_agg(jsonb_build_object('invite',games.checkers_invite_view(i.id),'from',jsonb_build_object('playerId',p.id,'displayAlias',p.alias,'avatarRevision',games.checkers_avatar_revision(p.id))) ORDER BY i.created_at DESC),'[]') INTO incoming
 FROM games.checkers_challenges c JOIN games.checkers_invites i ON i.id=c.invite_id JOIN games.players p ON p.id=games.canonical(i.creator_id)
 WHERE c.recipient_id IN(SELECT games.lineage(actor)) AND p.id<>actor AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)
 AND games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 AND games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 AND games.checkers_player_free(p.id)
 AND games.checkers_scope_allowed(own_access,i.scope)
 AND EXISTS(SELECT 1 FROM games.checkers_presence pres WHERE games.canonical(pres.player_id)=p.id AND pres.seen_at>clock_timestamp()-interval '45 seconds')
 AND games.can_pair(own_access,games.access(i.creator_id),i.scope);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('invite',games.checkers_invite_view(i.id),'to',jsonb_build_object('playerId',p.id,'displayAlias',p.alias,'avatarRevision',games.checkers_avatar_revision(p.id))) ORDER BY i.created_at DESC),'[]') INTO outgoing
 FROM games.checkers_challenges c JOIN games.checkers_invites i ON i.id=c.invite_id JOIN games.players p ON p.id=games.canonical(c.recipient_id)
 WHERE i.creator_id IN(SELECT games.lineage(actor)) AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)
 AND games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 AND games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 AND games.can_pair(own_access,games.access(c.recipient_id),i.scope);
 RETURN jsonb_build_object('available',games.checkers_player_free(actor),'players',peers,'incoming',incoming,'outgoing',outgoing,'limit',100);
END $$;

CREATE FUNCTION games.checkers_challenge_create(p_command varchar,p_fingerprint text,p_id uuid,p_code varchar,p_target uuid,p_scope text,p_initial integer,p_increment integer,p_color text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); replay jsonb; result jsonb; recipient games.checkers_presence; locked uuid; own_access jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 p_target:=games.canonical(p_target);
 IF p_target IS NULL OR p_target=actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 FOR locked IN SELECT id FROM unnest(ARRAY[actor,p_target]) id ORDER BY id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('games-lobby-player:'||locked::text,0)); END LOOP;
 own_access:=games.access(actor);
 IF NOT games.checkers_scope_allowed(own_access,p_scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM games.checkers_presence p WHERE p.player_id IN(SELECT games.lineage(actor)) AND p.seen_at>clock_timestamp()-interval '45 seconds' AND games.source_active(p.source_kind,p.source_id,actor,p.bindings,p.grant_marks)) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 SELECT * INTO recipient FROM games.checkers_presence p WHERE p.player_id IN(SELECT games.lineage(p_target))
 AND seen_at>clock_timestamp()-interval '45 seconds' ORDER BY seen_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR NOT games.source_active(recipient.source_kind,recipient.source_id,p_target,recipient.bindings,recipient.grant_marks)
 OR NOT games.checkers_scope_allowed(games.access(p_target),p_scope) OR NOT games.can_pair(own_access,games.access(p_target),p_scope) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF NOT games.checkers_player_free(actor) OR NOT games.checkers_player_free(p_target) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF EXISTS(SELECT 1 FROM games.checkers_challenges c JOIN games.checkers_invites i ON i.id=c.invite_id
 WHERE i.creator_id IN(SELECT games.lineage(actor)) AND c.recipient_id IN(SELECT games.lineage(p_target)) AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF (SELECT count(*) FROM games.checkers_challenges c JOIN games.checkers_invites i ON i.id=c.invite_id WHERE c.recipient_id IN(SELECT games.lineage(p_target)) AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000))>=8 THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 result:=games.checkers_create(p_command,p_fingerprint,p_id,p_code,p_scope,p_initial,p_increment,p_color);
 IF result ? 'error' THEN RETURN result; END IF;
 INSERT INTO games.checkers_challenges VALUES(p_id,p_target,recipient.source_kind,recipient.source_id,recipient.bindings,recipient.grant_marks);
 RETURN result;
END $$;

-- Recipient binding also applies to the existing code-redemption endpoints.
ALTER FUNCTION games.checkers_redeem_context(varchar) RENAME TO checkers_redeem_context_v1;
CREATE FUNCTION games.checkers_redeem_context(p_code varchar) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); target games.checkers_challenges; status text;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 SELECT c.*,i.status INTO target.invite_id,target.recipient_id,target.source_kind,target.source_id,target.bindings,target.grant_marks,status
 FROM games.checkers_challenges c JOIN games.checkers_invites i ON i.id=c.invite_id WHERE i.code=p_code;
 IF FOUND THEN
 IF games.canonical(target.recipient_id)<>actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF status='open' AND NOT EXISTS(SELECT 1 FROM games.checkers_invites i JOIN games.checkers_presence p ON games.canonical(p.player_id)=games.canonical(i.creator_id) WHERE i.id=target.invite_id AND p.seen_at>clock_timestamp()-interval '45 seconds') THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF status='open' AND NOT games.source_active(target.source_kind,target.source_id,target.recipient_id,target.bindings,target.grant_marks) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 END IF;
 RETURN games.checkers_redeem_context_v1(p_code);
END $$;
ALTER FUNCTION games.checkers_accept(varchar,text,varchar,uuid,boolean,jsonb) RENAME TO checkers_accept_v1;
CREATE FUNCTION games.checkers_accept(p_command varchar,p_fingerprint text,p_code varchar,p_id uuid,p_creator_white boolean,p_state jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); replay jsonb; context jsonb; creator uuid; locked uuid;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT games.canonical(i.creator_id) INTO creator FROM games.checkers_invites i WHERE i.code=p_code;
 IF creator IS NULL THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 FOR locked IN SELECT id FROM unnest(ARRAY[actor,creator]) id ORDER BY id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('games-lobby-player:'||locked::text,0)); END LOOP;
 context:=games.checkers_redeem_context(p_code); IF context ? 'error' THEN RETURN context; END IF;
 IF EXISTS(SELECT 1 FROM games.checkers_challenges c JOIN games.checkers_invites i ON i.id=c.invite_id WHERE i.code=p_code) AND (NOT games.checkers_player_free(actor) OR NOT games.checkers_player_free(creator)) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 RETURN games.checkers_accept_v1(p_command,p_fingerprint,p_code,p_id,p_creator_white,p_state);
END $$;
CREATE FUNCTION games.checkers_challenge_decline(p_command varchar,p_fingerprint text,p_id uuid,p_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); replay jsonb; i games.checkers_invites;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM games.checkers_challenges c WHERE c.invite_id=p_id AND c.recipient_id IN(SELECT games.lineage(actor))) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT * INTO i FROM games.checkers_invites WHERE id=p_id FOR UPDATE;
 IF i.version<>p_version THEN RETURN '{"error":"VERSION_CONFLICT"}'; END IF;
 IF i.status<>'open' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 UPDATE games.checkers_invites SET status='cancelled',version=version+1 WHERE id=p_id;
 PERFORM games.command_record(p_command,'decline',p_fingerprint,'{"declined":true}');
 RETURN '{"declined":true}';
END $$;
REVOKE ALL ON FUNCTION games.checkers_avatar(uuid,text),games.checkers_avatar_revision(uuid),games.checkers_scope_allowed(jsonb,text),games.checkers_player_free(uuid),games.checkers_lobby(text),
 games.checkers_challenge_create(varchar,text,uuid,varchar,uuid,text,integer,integer,text),games.checkers_challenge_decline(varchar,text,uuid,integer),
 games.checkers_redeem_context(varchar),games.checkers_redeem_context_v1(varchar),games.checkers_accept(varchar,text,varchar,uuid,boolean,jsonb),games.checkers_accept_v1(varchar,text,varchar,uuid,boolean,jsonb)
 FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION games.checkers_avatar(uuid,text),games.checkers_lobby(text),games.checkers_challenge_create(varchar,text,uuid,varchar,uuid,text,integer,integer,text),
 games.checkers_challenge_decline(varchar,text,uuid,integer),games.checkers_redeem_context(varchar),games.checkers_accept(varchar,text,varchar,uuid,boolean,jsonb) TO asalab_app;

-- Authenticated portal presence and a private invitation counter, without roster discovery.
CREATE FUNCTION games.checkers_notifications() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); a jsonb; incoming jsonb;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 a:=games.access(actor);
 IF NOT COALESCE((a->>'allowed')::boolean,false) THEN
   RETURN jsonb_build_object('playerId',actor,'incoming','[]'::jsonb);
 END IF;
 INSERT INTO games.checkers_presence(player_id,source_kind,source_id,bindings,grant_marks,affiliations)
 VALUES(actor,current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid,
 a->'bindings',a->'marks',a->'affiliations')
 ON CONFLICT(player_id) DO UPDATE SET source_kind=excluded.source_kind,source_id=excluded.source_id,
 bindings=excluded.bindings,grant_marks=excluded.grant_marks,affiliations=excluded.affiliations,seen_at=clock_timestamp();
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'expiresAt',i.expires_at) ORDER BY i.created_at),'[]') INTO incoming
 FROM games.checkers_challenges c JOIN games.checkers_invites i ON i.id=c.invite_id
 WHERE c.recipient_id IN(SELECT games.lineage(actor)) AND games.canonical(i.creator_id)<>actor
 AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)
 AND games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 AND games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 AND games.checkers_scope_allowed(a,i.scope) AND games.checkers_scope_allowed(games.access(i.creator_id),i.scope)
 AND games.can_pair(a,games.access(i.creator_id),i.scope)
 AND games.checkers_player_free(actor) AND games.checkers_player_free(i.creator_id)
 AND EXISTS(SELECT 1 FROM games.checkers_presence p WHERE p.player_id IN(SELECT games.lineage(i.creator_id)) AND p.seen_at>clock_timestamp()-interval '45 seconds');
 RETURN jsonb_build_object('playerId',actor,'incoming',incoming);
END $$;
REVOKE ALL ON FUNCTION games.checkers_notifications() FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION games.checkers_notifications() TO asalab_app;

DO $$ DECLARE item regprocedure; BEGIN
 FOR item IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='games' AND p.proname LIKE 'checkers_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,asalab_app',item);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION games.checkers_read(text,text,jsonb,integer),
 games.checkers_create(varchar,text,uuid,varchar,text,integer,integer,text), games.checkers_cancel(varchar,text,uuid,integer),
 games.checkers_redeem_context(varchar), games.checkers_accept(varchar,text,varchar,uuid,boolean,jsonb),
 games.checkers_save(varchar,text,uuid,integer,text,jsonb), games.checkers_lobby(text), games.checkers_avatar(uuid,text),
 games.checkers_challenge_create(varchar,text,uuid,varchar,uuid,text,integer,integer,text), games.checkers_challenge_decline(varchar,text,uuid,integer),
 games.checkers_notifications() TO asalab_app;
