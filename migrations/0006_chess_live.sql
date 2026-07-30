-- ASA Chess Online candidate persistence (Issue #67).
--
-- Durable server-authoritative challenges, games, command receipts, event
-- sequences, matchmaking tickets and transparent ASA Elo ledgers. All runtime
-- access is tenant-scoped by forced RLS and the verified transaction-local
-- app.tenant_id set by @asa-lab/database. The browser never supplies this GUC.

CREATE TABLE IF NOT EXISTS chess_live_challenges (
    id                    uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    public_code           varchar(16) NOT NULL,
    creator_id            uuid NOT NULL,
    color_preference      varchar(16) NOT NULL CHECK (color_preference IN ('white','black','random')),
    initial_ms            bigint NOT NULL CHECK (initial_ms BETWEEN 60000 AND 604800000),
    increment_ms          bigint NOT NULL CHECK (increment_ms BETWEEN 0 AND 3600000),
    rated                 boolean NOT NULL,
    status                varchar(16) NOT NULL CHECK (status IN ('open','accepted','cancelled','expired')),
    created_at_ms         bigint NOT NULL CHECK (created_at_ms >= 0),
    expires_at_ms         bigint NOT NULL CHECK (expires_at_ms > created_at_ms),
    accepted_by_id        uuid,
    accepted_at_ms        bigint,
    game_id               uuid,
    version               integer NOT NULL CHECK (version >= 1),
    create_command_id     varchar(128) NOT NULL,
    challenge_json        jsonb NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, public_code),
    UNIQUE (tenant_id, creator_id, create_command_id),
    FOREIGN KEY (tenant_id, creator_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, accepted_by_id) REFERENCES users (tenant_id, id),
    CHECK ((status = 'accepted') = (accepted_by_id IS NOT NULL AND accepted_at_ms IS NOT NULL AND game_id IS NOT NULL)),
    CHECK (accepted_at_ms IS NULL OR accepted_at_ms >= created_at_ms)
);
CREATE INDEX IF NOT EXISTS chess_live_challenges_creator_idx
    ON chess_live_challenges (tenant_id, creator_id, status, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS chess_live_challenges_expiry_idx
    ON chess_live_challenges (tenant_id, status, expires_at_ms)
    WHERE status = 'open';

CREATE TABLE IF NOT EXISTS chess_live_games (
    id                    uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    challenge_id          uuid,
    white_player_id       uuid NOT NULL,
    black_player_id       uuid NOT NULL,
    initial_ms            bigint NOT NULL CHECK (initial_ms BETWEEN 60000 AND 604800000),
    increment_ms          bigint NOT NULL CHECK (increment_ms BETWEEN 0 AND 3600000),
    rated                 boolean NOT NULL,
    status                varchar(16) NOT NULL CHECK (status IN ('active','finished')),
    result                varchar(16) NOT NULL CHECK (result IN ('1-0','0-1','1/2-1/2','*')),
    termination           varchar(32) NOT NULL,
    winner_id             uuid,
    version               integer NOT NULL CHECK (version >= 1),
    event_sequence        bigint NOT NULL CHECK (event_sequence >= 1),
    created_at_ms         bigint NOT NULL CHECK (created_at_ms >= 0),
    updated_at_ms         bigint NOT NULL CHECK (updated_at_ms >= created_at_ms),
    finished_at_ms        bigint,
    game_json             jsonb NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, challenge_id) REFERENCES chess_live_challenges (tenant_id, id),
    FOREIGN KEY (tenant_id, white_player_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, black_player_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, winner_id) REFERENCES users (tenant_id, id),
    CHECK (white_player_id <> black_player_id),
    CHECK ((status = 'active' AND result = '*' AND finished_at_ms IS NULL AND winner_id IS NULL)
        OR (status = 'finished' AND result <> '*' AND finished_at_ms IS NOT NULL)),
    CHECK (winner_id IS NULL OR winner_id IN (white_player_id, black_player_id))
);
CREATE INDEX IF NOT EXISTS chess_live_games_white_idx
    ON chess_live_games (tenant_id, white_player_id, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS chess_live_games_black_idx
    ON chess_live_games (tenant_id, black_player_id, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS chess_live_games_active_idx
    ON chess_live_games (tenant_id, status, updated_at_ms)
    WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS chess_live_games_challenge_idx
    ON chess_live_games (tenant_id, challenge_id)
    WHERE challenge_id IS NOT NULL;

ALTER TABLE chess_live_challenges
    DROP CONSTRAINT IF EXISTS chess_live_challenges_game_fk;
ALTER TABLE chess_live_challenges
    ADD CONSTRAINT chess_live_challenges_game_fk
    FOREIGN KEY (tenant_id, game_id) REFERENCES chess_live_games (tenant_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS chess_live_events (
    id                    uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    game_id               uuid,
    challenge_id          uuid,
    sequence              bigint NOT NULL CHECK (sequence >= 1),
    event_type            varchar(48) NOT NULL,
    actor_id              uuid,
    created_at_ms         bigint NOT NULL CHECK (created_at_ms >= 0),
    payload_json          jsonb NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, game_id) REFERENCES chess_live_games (tenant_id, id),
    FOREIGN KEY (tenant_id, challenge_id) REFERENCES chess_live_challenges (tenant_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES users (tenant_id, id),
    CHECK (game_id IS NOT NULL OR challenge_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS chess_live_events_game_sequence_idx
    ON chess_live_events (tenant_id, game_id, sequence)
    WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chess_live_events_visible_idx
    ON chess_live_events (tenant_id, game_id, created_at_ms, sequence)
    WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chess_live_events_challenge_idx
    ON chess_live_events (tenant_id, challenge_id, sequence)
    WHERE challenge_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS chess_live_command_receipts (
    id                    bigserial PRIMARY KEY,
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    actor_id              uuid NOT NULL,
    command_id            varchar(128) NOT NULL,
    command_kind          varchar(64) NOT NULL,
    fingerprint           text NOT NULL,
    resource_type         varchar(16) NOT NULL CHECK (resource_type IN ('challenge','game','ticket')),
    resource_id           uuid NOT NULL,
    created_at_ms         bigint NOT NULL CHECK (created_at_ms >= 0),
    UNIQUE (tenant_id, command_id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS chess_live_command_actor_idx
    ON chess_live_command_receipts (tenant_id, actor_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS chess_matchmaking_tickets (
    id                    uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    player_id             uuid NOT NULL,
    rating_pool           varchar(16) NOT NULL CHECK (rating_pool IN ('bullet','blitz','rapid','classical','daily')),
    initial_ms            bigint NOT NULL CHECK (initial_ms BETWEEN 60000 AND 604800000),
    increment_ms          bigint NOT NULL CHECK (increment_ms BETWEEN 0 AND 3600000),
    rated                 boolean NOT NULL,
    color_preference      varchar(16) NOT NULL CHECK (color_preference IN ('white','black','random')),
    queued_rating         integer NOT NULL CHECK (queued_rating BETWEEN 100 AND 4000),
    status                varchar(16) NOT NULL CHECK (status IN ('queued','paired','cancelled','expired')),
    created_at_ms         bigint NOT NULL CHECK (created_at_ms >= 0),
    expires_at_ms         bigint NOT NULL CHECK (expires_at_ms > created_at_ms),
    paired_game_id        uuid,
    version               integer NOT NULL CHECK (version >= 1),
    command_id            varchar(128) NOT NULL,
    ticket_json           jsonb NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, player_id, command_id),
    FOREIGN KEY (tenant_id, player_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, paired_game_id) REFERENCES chess_live_games (tenant_id, id),
    CHECK ((status = 'paired') = (paired_game_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS chess_matchmaking_one_queued_player_idx
    ON chess_matchmaking_tickets (tenant_id, player_id)
    WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS chess_matchmaking_queue_idx
    ON chess_matchmaking_tickets
       (tenant_id, rating_pool, initial_ms, increment_ms, rated, status, created_at_ms)
    WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS chess_ratings (
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    player_id             uuid NOT NULL,
    rating_pool           varchar(16) NOT NULL CHECK (rating_pool IN ('bullet','blitz','rapid','classical','daily')),
    rating                integer NOT NULL CHECK (rating BETWEEN 100 AND 4000),
    games                 integer NOT NULL CHECK (games >= 0),
    provisional           boolean NOT NULL,
    updated_at_ms         bigint NOT NULL CHECK (updated_at_ms >= 0),
    algorithm             varchar(32) NOT NULL CHECK (algorithm = 'asa-elo-v1'),
    rating_json           jsonb NOT NULL,
    PRIMARY KEY (tenant_id, player_id, rating_pool),
    FOREIGN KEY (tenant_id, player_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS chess_rating_ledger (
    id                    uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    game_id               uuid NOT NULL,
    rating_pool           varchar(16) NOT NULL CHECK (rating_pool IN ('bullet','blitz','rapid','classical','daily')),
    player_id             uuid NOT NULL,
    opponent_id           uuid NOT NULL,
    result                varchar(16) NOT NULL CHECK (result IN ('1-0','0-1','1/2-1/2')),
    score                 numeric(2,1) NOT NULL CHECK (score IN (0,0.5,1)),
    rating_before         integer NOT NULL CHECK (rating_before BETWEEN 100 AND 4000),
    rating_after          integer NOT NULL CHECK (rating_after BETWEEN 100 AND 4000),
    opponent_rating_before integer NOT NULL CHECK (opponent_rating_before BETWEEN 100 AND 4000),
    expected_score        double precision NOT NULL CHECK (expected_score BETWEEN 0 AND 1),
    k_factor              integer NOT NULL CHECK (k_factor IN (16,24,32,48)),
    delta                 integer NOT NULL,
    games_after           integer NOT NULL CHECK (games_after >= 1),
    provisional_after     boolean NOT NULL,
    created_at_ms         bigint NOT NULL CHECK (created_at_ms >= 0),
    algorithm             varchar(32) NOT NULL CHECK (algorithm = 'asa-elo-v1'),
    ledger_json           jsonb NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, game_id, player_id),
    FOREIGN KEY (tenant_id, game_id) REFERENCES chess_live_games (tenant_id, id),
    FOREIGN KEY (tenant_id, player_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, opponent_id) REFERENCES users (tenant_id, id),
    CHECK (player_id <> opponent_id)
);
CREATE INDEX IF NOT EXISTS chess_rating_ledger_player_idx
    ON chess_rating_ledger (tenant_id, player_id, rating_pool, created_at_ms DESC);

CREATE OR REPLACE FUNCTION chess_live_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'chess live events and rating ledger are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS chess_live_events_no_mutation ON chess_live_events;
CREATE TRIGGER chess_live_events_no_mutation
    BEFORE UPDATE OR DELETE ON chess_live_events
    FOR EACH ROW EXECUTE FUNCTION chess_live_append_only();
DROP TRIGGER IF EXISTS chess_rating_ledger_no_mutation ON chess_rating_ledger;
CREATE TRIGGER chess_rating_ledger_no_mutation
    BEFORE UPDATE OR DELETE ON chess_rating_ledger
    FOR EACH ROW EXECUTE FUNCTION chess_live_append_only();

ALTER TABLE chess_live_challenges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_live_challenges       FORCE ROW LEVEL SECURITY;
ALTER TABLE chess_live_games            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_live_games            FORCE ROW LEVEL SECURITY;
ALTER TABLE chess_live_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_live_events           FORCE ROW LEVEL SECURITY;
ALTER TABLE chess_live_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_live_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE chess_matchmaking_tickets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_matchmaking_tickets   FORCE ROW LEVEL SECURITY;
ALTER TABLE chess_ratings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_ratings               FORCE ROW LEVEL SECURITY;
ALTER TABLE chess_rating_ledger         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_rating_ledger         FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chess_live_challenges_tenant ON chess_live_challenges;
CREATE POLICY chess_live_challenges_tenant ON chess_live_challenges
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS chess_live_games_tenant ON chess_live_games;
CREATE POLICY chess_live_games_tenant ON chess_live_games
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS chess_live_events_tenant ON chess_live_events;
CREATE POLICY chess_live_events_tenant ON chess_live_events
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS chess_live_command_receipts_tenant ON chess_live_command_receipts;
CREATE POLICY chess_live_command_receipts_tenant ON chess_live_command_receipts
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS chess_matchmaking_tickets_tenant ON chess_matchmaking_tickets;
CREATE POLICY chess_matchmaking_tickets_tenant ON chess_matchmaking_tickets
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS chess_ratings_tenant ON chess_ratings;
CREATE POLICY chess_ratings_tenant ON chess_ratings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS chess_rating_ledger_tenant ON chess_rating_ledger;
CREATE POLICY chess_rating_ledger_tenant ON chess_rating_ledger
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON
    chess_live_challenges,
    chess_live_games,
    chess_live_command_receipts,
    chess_matchmaking_tickets,
    chess_ratings
TO asalab_app;
GRANT SELECT, INSERT ON chess_live_events, chess_rating_ledger TO asalab_app;
GRANT USAGE ON SEQUENCE public.chess_live_command_receipts_id_seq TO asalab_app;
