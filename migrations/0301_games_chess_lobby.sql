-- Opt-in Chess lobby: ephemeral presence and recipient-bound invitations.
-- Existing education RLS, tenant ownership and match storage are unchanged.
CREATE TABLE games.chess_presence (
 player_id uuid PRIMARY KEY REFERENCES games.players(id), source_kind text NOT NULL,
 source_id uuid NOT NULL, bindings jsonb NOT NULL, grant_marks jsonb NOT NULL,
 affiliations jsonb NOT NULL, seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX chess_presence_recent ON games.chess_presence(seen_at DESC);
CREATE TABLE games.chess_challenges (
 invite_id uuid PRIMARY KEY REFERENCES games.chess_invites(id), recipient_id uuid NOT NULL REFERENCES games.players(id),
 source_kind text NOT NULL, source_id uuid NOT NULL, bindings jsonb NOT NULL, grant_marks jsonb NOT NULL
);
CREATE INDEX chess_challenge_recipient ON games.chess_challenges(recipient_id);
ALTER TABLE games.chess_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.chess_presence FORCE ROW LEVEL SECURITY;
ALTER TABLE games.chess_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.chess_challenges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON games.chess_presence,games.chess_challenges FROM PUBLIC,asalab_app;

CREATE FUNCTION games.chess_scope_allowed(a jsonb,s text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE((a->>'allowed')::boolean,false) AND s IN('classroom','school','platform')
 AND (s='platform' OR jsonb_array_length(a->'affiliations')>0)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'rules') r
 WHERE (s='platform' AND r->>'scope'<>'platform') OR (s='school' AND r->>'scope'='classroom'));
$$;
CREATE FUNCTION games.chess_player_free(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM games.chess_participants c JOIN games.chess_matches m ON m.id=c.match_id
 WHERE c.player_id IN(SELECT games.lineage(p)) AND m.status='active');
$$;
CREATE FUNCTION games.chess_avatar_revision(p_player uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT md5(p.source_kind||COALESCE(a.updated_at::text,s.updated_at::text,'default'))
 FROM games.chess_presence p LEFT JOIN public.profiles a ON p.source_kind='account' AND a.account_id=p.source_id
 LEFT JOIN public.classroom_student_seats s ON p.source_kind='student_seat' AND s.id=p.source_id
 WHERE p.player_id IN(SELECT games.lineage(p_player)) ORDER BY p.seen_at DESC LIMIT 1;
$$;
CREATE FUNCTION games.chess_avatar(p_target uuid,p_scope text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); a jsonb; target games.chess_presence; image text; avatar text;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 a:=games.access(actor); p_target:=games.canonical(p_target);
 IF NOT games.chess_scope_allowed(a,p_scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 SELECT * INTO target FROM games.chess_presence p WHERE p.player_id IN(SELECT games.lineage(p_target)) AND p.seen_at>clock_timestamp()-interval '45 seconds' ORDER BY p.seen_at DESC LIMIT 1;
 IF NOT FOUND OR NOT games.source_active(target.source_kind,target.source_id,p_target,target.bindings,target.grant_marks)
 OR NOT games.chess_scope_allowed(games.access(p_target),p_scope) OR NOT games.can_pair(a,games.access(p_target),p_scope) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF target.source_kind='account' THEN SELECT avatar_data_url INTO image FROM public.profiles WHERE account_id=target.source_id;
 ELSE SELECT avatar_key INTO avatar FROM public.classroom_student_seats WHERE id=target.source_id; END IF;
 RETURN jsonb_build_object('dataUrl',image,'avatarKey',avatar,'seed',target.source_id::text);
END $$;
CREATE FUNCTION games.chess_lobby(p_scope text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); own_access jsonb; peers jsonb; incoming jsonb; outgoing jsonb;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 own_access:=games.access(actor);
 IF NOT games.chess_scope_allowed(own_access,p_scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 -- Re-enabling a class creates a new grant. Obsolete directed invitations must
 -- neither reappear nor consume the recipient/creator's bounded inbox slots.
 UPDATE games.chess_invites i SET status='cancelled',version=i.version+1
 FROM games.chess_challenges c WHERE c.invite_id=i.id AND i.status='open'
 AND (i.creator_id IN(SELECT games.lineage(actor)) OR c.recipient_id IN(SELECT games.lineage(actor)))
 AND (games.canonical(i.creator_id)=games.canonical(c.recipient_id)
 OR NOT games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 OR NOT games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 OR NOT games.chess_scope_allowed(games.access(i.creator_id),i.scope)
 OR NOT games.chess_scope_allowed(games.access(c.recipient_id),i.scope)
 OR NOT games.can_pair(games.access(i.creator_id),games.access(c.recipient_id),i.scope));
 UPDATE games.chess_invites i SET status='cancelled',version=i.version+1 WHERE i.creator_id IN(SELECT games.lineage(actor)) AND i.status='open' AND NOT games.chess_scope_allowed(own_access,i.scope);
 INSERT INTO games.chess_presence(player_id,source_kind,source_id,bindings,grant_marks,affiliations)
 VALUES(actor,current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid,
 own_access->'bindings',own_access->'marks',own_access->'affiliations')
 ON CONFLICT(player_id) DO UPDATE SET source_kind=excluded.source_kind,source_id=excluded.source_id,
 bindings=excluded.bindings,grant_marks=excluded.grant_marks,affiliations=excluded.affiliations,seen_at=clock_timestamp();
 -- Bounded discovery. No education identifiers, names, emails or roster are projected.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('playerId',p.id,'displayAlias',p.alias,'avatarRevision',games.chess_avatar_revision(p.id)) ORDER BY p.alias,p.id),'[]') INTO peers
 FROM games.players p WHERE p.id IN (
 SELECT DISTINCT games.canonical(pres.player_id) FROM (
 SELECT * FROM games.chess_presence recent
 WHERE recent.seen_at>clock_timestamp()-interval '45 seconds' AND games.canonical(recent.player_id)<>actor
 AND (p_scope='platform' OR EXISTS(SELECT 1 FROM jsonb_array_elements(recent.affiliations) a CROSS JOIN jsonb_array_elements(own_access->'affiliations') b
 WHERE CASE p_scope WHEN 'classroom' THEN a->>'classroomId'=b->>'classroomId' ELSE a->>'schoolId'=b->>'schoolId' END))
 ORDER BY recent.seen_at DESC,recent.player_id LIMIT 200
 ) pres CROSS JOIN LATERAL (SELECT games.access(pres.player_id) a OFFSET 0) current_access
 WHERE true
 AND games.source_active(pres.source_kind,pres.source_id,pres.player_id,pres.bindings,pres.grant_marks)
 AND games.chess_player_free(games.canonical(pres.player_id))
 AND games.chess_scope_allowed(current_access.a,p_scope)
 AND games.can_pair(own_access,current_access.a,p_scope)
 ORDER BY games.canonical(pres.player_id) LIMIT 100
 );
 SELECT COALESCE(jsonb_agg(jsonb_build_object('invite',games.invite_view(i.id),'from',jsonb_build_object('playerId',p.id,'displayAlias',p.alias,'avatarRevision',games.chess_avatar_revision(p.id))) ORDER BY i.created_at DESC),'[]') INTO incoming
 FROM games.chess_challenges c JOIN games.chess_invites i ON i.id=c.invite_id JOIN games.players p ON p.id=games.canonical(i.creator_id)
 WHERE c.recipient_id IN(SELECT games.lineage(actor)) AND p.id<>actor AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)
 AND games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 AND games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 AND games.chess_player_free(p.id)
 AND games.chess_scope_allowed(own_access,i.scope)
 AND EXISTS(SELECT 1 FROM games.chess_presence pres WHERE games.canonical(pres.player_id)=p.id AND pres.seen_at>clock_timestamp()-interval '45 seconds')
 AND games.can_pair(own_access,games.access(i.creator_id),i.scope);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('invite',games.invite_view(i.id),'to',jsonb_build_object('playerId',p.id,'displayAlias',p.alias,'avatarRevision',games.chess_avatar_revision(p.id))) ORDER BY i.created_at DESC),'[]') INTO outgoing
 FROM games.chess_challenges c JOIN games.chess_invites i ON i.id=c.invite_id JOIN games.players p ON p.id=games.canonical(c.recipient_id)
 WHERE i.creator_id IN(SELECT games.lineage(actor)) AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)
 AND games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 AND games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 AND games.can_pair(own_access,games.access(c.recipient_id),i.scope);
 RETURN jsonb_build_object('available',games.chess_player_free(actor),'players',peers,'incoming',incoming,'outgoing',outgoing,'limit',100);
END $$;

CREATE FUNCTION games.chess_challenge_create(p_command varchar,p_fingerprint text,p_id uuid,p_code varchar,p_target uuid,p_scope text,p_initial integer,p_increment integer,p_color text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); replay jsonb; result jsonb; recipient games.chess_presence; locked uuid; own_access jsonb;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 p_target:=games.canonical(p_target);
 IF p_target IS NULL OR p_target=actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 FOR locked IN SELECT id FROM unnest(ARRAY[actor,p_target]) id ORDER BY id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('games-lobby-player:'||locked::text,0)); END LOOP;
 own_access:=games.access(actor);
 IF NOT games.chess_scope_allowed(own_access,p_scope) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM games.chess_presence p WHERE p.player_id IN(SELECT games.lineage(actor)) AND p.seen_at>clock_timestamp()-interval '45 seconds' AND games.source_active(p.source_kind,p.source_id,actor,p.bindings,p.grant_marks)) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 SELECT * INTO recipient FROM games.chess_presence p WHERE p.player_id IN(SELECT games.lineage(p_target))
 AND seen_at>clock_timestamp()-interval '45 seconds' ORDER BY seen_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR NOT games.source_active(recipient.source_kind,recipient.source_id,p_target,recipient.bindings,recipient.grant_marks)
 OR NOT games.chess_scope_allowed(games.access(p_target),p_scope) OR NOT games.can_pair(own_access,games.access(p_target),p_scope) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF NOT games.chess_player_free(actor) OR NOT games.chess_player_free(p_target) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF EXISTS(SELECT 1 FROM games.chess_challenges c JOIN games.chess_invites i ON i.id=c.invite_id
 WHERE i.creator_id IN(SELECT games.lineage(actor)) AND c.recipient_id IN(SELECT games.lineage(p_target)) AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 IF (SELECT count(*) FROM games.chess_challenges c JOIN games.chess_invites i ON i.id=c.invite_id WHERE c.recipient_id IN(SELECT games.lineage(p_target)) AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000))>=8 THEN RETURN '{"error":"RATE_LIMITED"}'; END IF;
 result:=games.chess_create(p_command,p_fingerprint,p_id,p_code,p_scope,p_initial,p_increment,p_color);
 IF result ? 'error' THEN RETURN result; END IF;
 INSERT INTO games.chess_challenges VALUES(p_id,p_target,recipient.source_kind,recipient.source_id,recipient.bindings,recipient.grant_marks);
 RETURN result;
END $$;

-- Recipient binding also applies to the existing code-redemption endpoints.
ALTER FUNCTION games.chess_redeem_context(varchar) RENAME TO chess_redeem_context_v1;
CREATE FUNCTION games.chess_redeem_context(p_code varchar) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); target games.chess_challenges; status text;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 SELECT c.*,i.status INTO target.invite_id,target.recipient_id,target.source_kind,target.source_id,target.bindings,target.grant_marks,status
 FROM games.chess_challenges c JOIN games.chess_invites i ON i.id=c.invite_id WHERE i.code=p_code;
 IF FOUND THEN
 IF games.canonical(target.recipient_id)<>actor THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF status='open' AND NOT EXISTS(SELECT 1 FROM games.chess_invites i JOIN games.chess_presence p ON games.canonical(p.player_id)=games.canonical(i.creator_id) WHERE i.id=target.invite_id AND p.seen_at>clock_timestamp()-interval '45 seconds') THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 IF status='open' AND NOT games.source_active(target.source_kind,target.source_id,target.recipient_id,target.bindings,target.grant_marks) THEN RETURN '{"error":"POLICY_DENIED"}'; END IF;
 END IF;
 RETURN games.chess_redeem_context_v1(p_code);
END $$;
ALTER FUNCTION games.chess_accept(varchar,text,varchar,uuid,boolean,jsonb) RENAME TO chess_accept_v1;
CREATE FUNCTION games.chess_accept(p_command varchar,p_fingerprint text,p_code varchar,p_id uuid,p_creator_white boolean,p_state jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); replay jsonb; context jsonb; creator uuid; locked uuid;
BEGIN
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT games.canonical(i.creator_id) INTO creator FROM games.chess_invites i WHERE i.code=p_code;
 IF creator IS NULL THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 FOR locked IN SELECT id FROM unnest(ARRAY[actor,creator]) id ORDER BY id LOOP
 PERFORM pg_advisory_xact_lock(hashtextextended('games-lobby-player:'||locked::text,0)); END LOOP;
 context:=games.chess_redeem_context(p_code); IF context ? 'error' THEN RETURN context; END IF;
 IF EXISTS(SELECT 1 FROM games.chess_challenges c JOIN games.chess_invites i ON i.id=c.invite_id WHERE i.code=p_code) AND (NOT games.chess_player_free(actor) OR NOT games.chess_player_free(creator)) THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 RETURN games.chess_accept_v1(p_command,p_fingerprint,p_code,p_id,p_creator_white,p_state);
END $$;
CREATE FUNCTION games.chess_challenge_decline(p_command varchar,p_fingerprint text,p_id uuid,p_version integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); replay jsonb; i games.chess_invites;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM games.chess_challenges c WHERE c.invite_id=p_id AND c.recipient_id IN(SELECT games.lineage(actor))) THEN RETURN '{"error":"NOT_FOUND"}'; END IF;
 replay:=games.command_replay(p_command,p_fingerprint); IF replay IS NOT NULL THEN RETURN replay; END IF;
 SELECT * INTO i FROM games.chess_invites WHERE id=p_id FOR UPDATE;
 IF i.version<>p_version THEN RETURN '{"error":"VERSION_CONFLICT"}'; END IF;
 IF i.status<>'open' THEN RETURN '{"error":"INVALID_STATE"}'; END IF;
 UPDATE games.chess_invites SET status='cancelled',version=version+1 WHERE id=p_id;
 PERFORM games.command_record(p_command,'decline',p_fingerprint,'{"declined":true}');
 RETURN '{"declined":true}';
END $$;
REVOKE ALL ON FUNCTION games.chess_avatar(uuid,text),games.chess_avatar_revision(uuid),games.chess_scope_allowed(jsonb,text),games.chess_player_free(uuid),games.chess_lobby(text),
 games.chess_challenge_create(varchar,text,uuid,varchar,uuid,text,integer,integer,text),games.chess_challenge_decline(varchar,text,uuid,integer),
 games.chess_redeem_context(varchar),games.chess_redeem_context_v1(varchar),games.chess_accept(varchar,text,varchar,uuid,boolean,jsonb),games.chess_accept_v1(varchar,text,varchar,uuid,boolean,jsonb)
 FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION games.chess_avatar(uuid,text),games.chess_lobby(text),games.chess_challenge_create(varchar,text,uuid,varchar,uuid,text,integer,integer,text),
 games.chess_challenge_decline(varchar,text,uuid,integer),games.chess_redeem_context(varchar),games.chess_accept(varchar,text,varchar,uuid,boolean,jsonb) TO asalab_app;
