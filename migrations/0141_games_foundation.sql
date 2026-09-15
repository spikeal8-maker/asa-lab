-- ASA Games R1A2 foundation (Issue #258).
-- Platform-scoped gaming identity + canonical Match storage under FORCE RLS.
-- Invite admission, game-owned state, finalization/outbox and rating remain later R1/R3 slices.

CREATE SCHEMA IF NOT EXISTS games;
REVOKE CREATE ON SCHEMA games FROM PUBLIC;
GRANT USAGE ON SCHEMA games TO asalab_app;

CREATE TABLE games.game_players (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_alias varchar(96) NOT NULL CHECK (length(btrim(display_alias)) BETWEEN 1 AND 96),
    avatar_ref    text,
    profile_state varchar(16) NOT NULL DEFAULT 'active'
                  CHECK (profile_state IN ('active', 'suspended', 'anonymized')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games.game_player_account_sources (
    account_id     uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE RESTRICT,
    game_player_id uuid NOT NULL REFERENCES games.game_players(id) ON DELETE RESTRICT,
    link_audit_ref text NOT NULL,
    linked_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_player_account_sources_player_idx
    ON games.game_player_account_sources (game_player_id);

CREATE TABLE games.game_player_seat_sources (
    seat_id        uuid PRIMARY KEY REFERENCES public.classroom_student_seats(id) ON DELETE RESTRICT,
    game_player_id uuid NOT NULL REFERENCES games.game_players(id) ON DELETE RESTRICT,
    link_audit_ref text NOT NULL,
    linked_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_player_seat_sources_player_idx
    ON games.game_player_seat_sources (game_player_id);

CREATE TABLE games.game_player_aliases (
    alias_game_player_id     uuid PRIMARY KEY REFERENCES games.game_players(id) ON DELETE RESTRICT,
    canonical_game_player_id uuid NOT NULL REFERENCES games.game_players(id) ON DELETE RESTRICT,
    merge_audit_ref          text NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    CHECK (alias_game_player_id <> canonical_game_player_id)
);
CREATE INDEX game_player_aliases_canonical_idx
    ON games.game_player_aliases (canonical_game_player_id);

CREATE TABLE games.matches (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_key                  varchar(96) NOT NULL CHECK (length(btrim(game_key)) > 0),
    game_version              varchar(64) NOT NULL CHECK (length(btrim(game_version)) > 0),
    rules_version             varchar(64) NOT NULL CHECK (length(btrim(rules_version)) > 0),
    state_schema_version      integer NOT NULL CHECK (state_schema_version > 0),
    protocol_version          varchar(64) NOT NULL CHECK (length(btrim(protocol_version)) > 0),
    rating_policy_version     varchar(64),
    admission_kind            varchar(24) NOT NULL
                              CHECK (admission_kind IN ('direct', 'invite', 'matchmaking', 'tournament', 'event', 'bot', 'local')),
    competition_kind          varchar(16) NOT NULL
                              CHECK (competition_kind IN ('casual', 'rated')),
    scope_kind                varchar(16) NOT NULL
                              CHECK (scope_kind IN ('private', 'classroom', 'workspace', 'global', 'event', 'tournament')),
    runtime_kind              varchar(24) NOT NULL
                              CHECK (runtime_kind IN ('command', 'realtime_room')),
    topology                  varchar(24) NOT NULL
                              CHECK (topology IN ('duel', 'free_for_all', 'teams', 'coop')),
    status                    varchar(16) NOT NULL
                              CHECK (status IN ('waiting', 'ready', 'active', 'finishing', 'finished', 'cancelled', 'aborted')),
    lifecycle_version         integer NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0),
    game_config_ref           text,
    admission_ref             text,
    created_by_game_player_id uuid NOT NULL REFERENCES games.game_players(id) ON DELETE RESTRICT,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (competition_kind = 'rated' AND rating_policy_version IS NOT NULL)
        OR (competition_kind = 'casual' AND rating_policy_version IS NULL)
    )
);
CREATE INDEX matches_creator_idx
    ON games.matches (created_by_game_player_id, created_at DESC);
CREATE INDEX matches_game_status_idx
    ON games.matches (game_key, status, created_at DESC);

CREATE TABLE games.match_teams (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id   uuid NOT NULL REFERENCES games.matches(id) ON DELETE CASCADE,
    team_key   varchar(64) NOT NULL CHECK (length(btrim(team_key)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (match_id, team_key),
    UNIQUE (match_id, id)
);

CREATE TABLE games.match_participants (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id         uuid NOT NULL REFERENCES games.matches(id) ON DELETE CASCADE,
    participant_kind varchar(16) NOT NULL
                     CHECK (participant_kind IN ('player', 'bot', 'local_guest')),
    game_player_id   uuid REFERENCES games.game_players(id) ON DELETE RESTRICT,
    bot_key          varchar(96),
    seat_key         varchar(64) NOT NULL CHECK (length(btrim(seat_key)) > 0),
    team_id          uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (match_id, seat_key),
    FOREIGN KEY (match_id, team_id)
        REFERENCES games.match_teams (match_id, id) ON DELETE RESTRICT,
    CHECK (
        (participant_kind = 'player' AND game_player_id IS NOT NULL AND bot_key IS NULL)
        OR (participant_kind = 'bot' AND game_player_id IS NULL AND bot_key IS NOT NULL)
        OR (participant_kind = 'local_guest' AND game_player_id IS NULL AND bot_key IS NULL)
    )
);
CREATE UNIQUE INDEX match_participants_player_once_idx
    ON games.match_participants (match_id, game_player_id)
    WHERE game_player_id IS NOT NULL;
CREATE INDEX match_participants_player_history_idx
    ON games.match_participants (game_player_id, match_id)
    WHERE game_player_id IS NOT NULL;

-- Authorization index. Runtime cannot grant itself access. R1B will add the
-- validated invite-redemption path that inserts the opponent row.
CREATE TABLE games.match_access (
    match_id       uuid NOT NULL REFERENCES games.matches(id) ON DELETE CASCADE,
    game_player_id uuid NOT NULL REFERENCES games.game_players(id) ON DELETE RESTRICT,
    granted_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, game_player_id)
);
CREATE INDEX match_access_player_idx
    ON games.match_access (game_player_id, match_id);

CREATE TABLE games.command_receipts (
    actor_game_player_id uuid NOT NULL REFERENCES games.game_players(id) ON DELETE RESTRICT,
    command_id           varchar(128) NOT NULL
                         CHECK (command_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
    command_kind         varchar(96) NOT NULL CHECK (length(btrim(command_kind)) > 0),
    fingerprint          varchar(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    resource_type        varchar(64) NOT NULL CHECK (length(btrim(resource_type)) > 0),
    resource_id          text,
    outcome_kind         varchar(16) NOT NULL CHECK (outcome_kind IN ('applied', 'rejected')),
    result_ref           text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_game_player_id, command_id)
);
CREATE INDEX command_receipts_resource_idx
    ON games.command_receipts (resource_type, resource_id)
    WHERE resource_id IS NOT NULL;

-- Runtime privileges stay narrow. Identity bindings/aliases and match_access
-- are intentionally owner-only in R1A2; later validated workflows get narrow doors.
REVOKE ALL ON ALL TABLES IN SCHEMA games FROM asalab_app;
GRANT SELECT ON games.game_players TO asalab_app;
GRANT SELECT, INSERT ON games.matches TO asalab_app;
GRANT UPDATE (status, lifecycle_version, updated_at) ON games.matches TO asalab_app;
GRANT SELECT, INSERT ON games.match_teams, games.match_participants TO asalab_app;
GRANT SELECT ON games.match_access TO asalab_app;
GRANT SELECT, INSERT ON games.command_receipts TO asalab_app;

ALTER TABLE games.game_players                ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.game_players                FORCE ROW LEVEL SECURITY;
ALTER TABLE games.game_player_account_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.game_player_account_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE games.game_player_seat_sources    ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.game_player_seat_sources    FORCE ROW LEVEL SECURITY;
ALTER TABLE games.game_player_aliases         ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.game_player_aliases         FORCE ROW LEVEL SECURITY;
ALTER TABLE games.matches                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.matches                     FORCE ROW LEVEL SECURITY;
ALTER TABLE games.match_teams                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.match_teams                 FORCE ROW LEVEL SECURITY;
ALTER TABLE games.match_participants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.match_participants          FORCE ROW LEVEL SECURITY;
ALTER TABLE games.match_access                ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.match_access                FORCE ROW LEVEL SECURITY;
ALTER TABLE games.command_receipts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE games.command_receipts            FORCE ROW LEVEL SECURITY;

-- A missing transaction-local app.game_player_id resolves to NULL and fails closed.
CREATE POLICY game_players_visible ON games.game_players
    FOR SELECT
    USING (
        id = nullif(current_setting('app.game_player_id', true), '')::uuid
        OR EXISTS (
            SELECT 1
              FROM games.match_participants participant
             WHERE participant.game_player_id = game_players.id
        )
    );

CREATE POLICY matches_visible ON games.matches
    FOR SELECT
    USING (
        created_by_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
        OR EXISTS (
            SELECT 1
              FROM games.match_access access_row
             WHERE access_row.match_id = matches.id
               AND access_row.game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
        )
    );

CREATE POLICY matches_create ON games.matches
    FOR INSERT
    WITH CHECK (
        created_by_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
    );

CREATE POLICY matches_update ON games.matches
    FOR UPDATE
    USING (
        created_by_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
        OR EXISTS (
            SELECT 1
              FROM games.match_access access_row
             WHERE access_row.match_id = matches.id
               AND access_row.game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
        )
    )
    WITH CHECK (
        created_by_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
        OR EXISTS (
            SELECT 1
              FROM games.match_access access_row
             WHERE access_row.match_id = matches.id
               AND access_row.game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
        )
    );

CREATE POLICY match_access_own ON games.match_access
    FOR SELECT
    USING (game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid);

CREATE POLICY match_teams_visible ON games.match_teams
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM games.matches match_row WHERE match_row.id = match_teams.match_id));
CREATE POLICY match_teams_create ON games.match_teams
    FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1
          FROM games.matches match_row
         WHERE match_row.id = match_teams.match_id
           AND match_row.created_by_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
    ));

CREATE POLICY match_participants_visible ON games.match_participants
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM games.matches match_row WHERE match_row.id = match_participants.match_id));
CREATE POLICY match_participants_create ON games.match_participants
    FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1
          FROM games.matches match_row
         WHERE match_row.id = match_participants.match_id
           AND match_row.created_by_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid
    ));

CREATE POLICY command_receipts_own ON games.command_receipts
    FOR SELECT
    USING (actor_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid);
CREATE POLICY command_receipts_create ON games.command_receipts
    FOR INSERT
    WITH CHECK (actor_game_player_id = nullif(current_setting('app.game_player_id', true), '')::uuid);
