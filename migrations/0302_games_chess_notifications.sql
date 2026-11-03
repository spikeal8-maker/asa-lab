-- Authenticated portal presence and a private invitation counter, without roster discovery.
CREATE FUNCTION games.chess_notifications() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=games.actor_id(); a jsonb; incoming jsonb;
BEGIN
 IF actor IS NULL THEN RETURN '{"error":"UNAUTHORIZED"}'; END IF;
 a:=games.access(actor);
 IF NOT COALESCE((a->>'allowed')::boolean,false) THEN
   RETURN jsonb_build_object('playerId',actor,'incoming','[]'::jsonb);
 END IF;
 INSERT INTO games.chess_presence(player_id,source_kind,source_id,bindings,grant_marks,affiliations)
 VALUES(actor,current_setting('app.games_source_kind'),current_setting('app.games_source_id')::uuid,
 a->'bindings',a->'marks',a->'affiliations')
 ON CONFLICT(player_id) DO UPDATE SET source_kind=excluded.source_kind,source_id=excluded.source_id,
 bindings=excluded.bindings,grant_marks=excluded.grant_marks,affiliations=excluded.affiliations,seen_at=clock_timestamp();
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'expiresAt',i.expires_at) ORDER BY i.created_at),'[]') INTO incoming
 FROM games.chess_challenges c JOIN games.chess_invites i ON i.id=c.invite_id
 WHERE c.recipient_id IN(SELECT games.lineage(actor)) AND games.canonical(i.creator_id)<>actor
 AND i.status='open' AND i.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)
 AND games.source_active(c.source_kind,c.source_id,c.recipient_id,c.bindings,c.grant_marks)
 AND games.source_active(i.source_kind,i.source_id,i.creator_id,i.bindings,i.grant_marks)
 AND games.chess_scope_allowed(a,i.scope) AND games.chess_scope_allowed(games.access(i.creator_id),i.scope)
 AND games.can_pair(a,games.access(i.creator_id),i.scope)
 AND games.chess_player_free(actor) AND games.chess_player_free(i.creator_id)
 AND EXISTS(SELECT 1 FROM games.chess_presence p WHERE p.player_id IN(SELECT games.lineage(i.creator_id)) AND p.seen_at>clock_timestamp()-interval '45 seconds');
 RETURN jsonb_build_object('playerId',actor,'incoming',incoming);
END $$;
REVOKE ALL ON FUNCTION games.chess_notifications() FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION games.chess_notifications() TO asalab_app;
