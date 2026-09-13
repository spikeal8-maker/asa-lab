# ASA Games Platform — Data, Identity and Persistence Model

**Status:** Draft  
**Scope:** canonical data model, gaming identity, tenancy, durable events, rating, statistics and migration compatibility  
**Related:** `ADR-GAME-001-GAMES-PLATFORM-BOUNDARIES.md`, `DATA_SECURITY_AND_TENANCY.md`, `ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md`

## 1. Goals

Data model must simultaneously support:

- a private checkers game between two classmates;
- global quick/rated chess/checkers;
- bot games;
- local games that may optionally be recorded;
- 8-player free-for-all;
- 4v4 team arena;
- co-op games;
- temporary event games;
- spectators;
- reconnect and history;
- per-game/per-pool ratings;
- rebuildable statistics;
- child-safe public identities;
- current ASA tenant/RLS model;
- additive migration from existing `chess_live_*` data.

The model MUST NOT encode assumptions that every game is 1v1, every outcome is W/L/D, every participant is a human, or every match lives entirely inside PostgreSQL while active.

## 2. Identity layers

### 2.1 Existing ASA identity remains authoritative

Authentication remains owned by existing ASA identity:

```text
Account / StudentSeat evolution
        ↓
Principal
        ↓
Workspace / Tenant / Classroom relationships
```

Games Platform MUST NOT introduce another username/password/session system.

### 2.2 GamePlayerProfile

Games need a stable platform identity that survives class changes and does not expose internal identity keys.

Proposed logical model:

```text
GamePlayerProfile
-----------------
id                    uuid/ulid public-safe game identity
principal_id          internal FK/reference, never public API field
public_alias          nullable/approved alias
avatar_ref            nullable
visibility            private | restricted | public
status                active | suspended | deleted
created_at
updated_at
```

Rules:

1. `principal_id` is unique for active profile.
2. The browser may receive `GamePlayerProfile.id`, not `principals.id`.
3. Email, tenant membership, classroom membership and real name are not implicit public fields.
4. For a minor/StudentSeat, default visibility is the strictest allowed by policy.
5. Public alias changes do not alter match/rating identity.
6. Profile deletion/anonymization must preserve integrity of historical match/rating ledgers while respecting retention policy.

### 2.3 PublicGameIdentity DTO

All social/game surfaces consume a dedicated view:

```ts
interface PublicGameIdentity {
  playerId: string;
  displayName: string;
  avatarRef: string | null;
  presence?: 'online' | 'in-game' | 'offline';
}
```

Optional rating/stats are attached by game-specific view endpoints, not embedded as internal account data.

A missing approved alias falls back to a non-sensitive generic display label; never to `principal_id`, `account_id`, learner identity, email or database UUID.

## 3. Scope model

Every network-visible match/invite/queue item has an explicit scope:

```ts
type GameScope =
  | { kind: 'private' }
  | { kind: 'global' }
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'classroom'; classroomId: string }
  | { kind: 'event'; eventId: string }
  | { kind: 'tournament'; tournamentId: string };
```

Important distinction:

- `scope` controls who may discover/join/observe;
- `tenant_id` remains a storage/security boundary where ASA tenancy requires it.

A global player identity does not imply unrestricted cross-tenant discovery. Public/global matchmaking for minors is a policy decision layered on top of this model.

## 4. Canonical Match aggregate

### 4.1 `game_matches`

Proposed logical columns:

```text
id                       uuid/ulid PK
tenant_id                nullable/derived security placement key
game_key                 varchar NOT NULL
game_version             varchar NOT NULL
rules_version            varchar NOT NULL
state_schema_version     integer NOT NULL
runtime_protocol_version integer NOT NULL
runtime_kind             command | realtime_room
mode                     bot | local | friend | quick | rated | classroom | event | tournament
topology                 duel | free_for_all | teams | coop
status                   waiting | allocating | ready | active | finishing | finished | cancelled | aborted
scope_kind               private | global | tenant | classroom | event | tournament
scope_ref                 nullable
rated                    boolean
rating_pool              nullable
rating_policy_version    nullable
version                  bigint NOT NULL
event_sequence           bigint NOT NULL
created_at
started_at               nullable
updated_at
finished_at              nullable
runtime_room_id          nullable
outcome_schema_version   integer nullable
metadata_json            jsonb
```

`metadata_json` is bounded platform metadata, not arbitrary authoritative game state.

### 4.2 Match state

Command games need durable canonical state. Realtime rooms may only need checkpoints/outcome.

Logical storage:

```text
game_match_states
-----------------
match_id
state_version
state_schema_version
state_json / storage_ref
state_hash
created_at
```

Command runtime may update a current-state row plus append checkpoints according to game policy.

Realtime room modes:

```text
result_only
checkpointed
replay_artifact
```

The platform MUST NOT write one SQL row per physics tick by default.

## 5. Participants and teams

### 5.1 `game_match_participants`

```text
id
match_id
player_kind             human | bot | service
player_id               nullable GamePlayerProfile.id
bot_key                 nullable
seat_key                varchar
team_key                nullable
join_state              reserved | joined | disconnected | left
joined_at
left_at
result                   win | loss | draw | completed | dnf | null
placement                integer nullable
score                    numeric nullable
rating_pool              nullable
rating_before            nullable
rating_after             nullable
rating_delta             nullable
public_snapshot_json     bounded alias/avatar snapshot if policy requires historical rendering
UNIQUE(match_id, seat_key)
```

Platform does not assign semantics to `seat_key`:

```text
checkers: light / dark
chess: white / black
tic-tac-toe: x / o
arena: red-1 / blue-2
racing: p1..p8
```

### 5.2 Teams

For team games, either `team_key` on participant is enough or a separate `game_match_teams` table is introduced when team-level metadata/results need first-class queries.

Generic Core MUST support team outcome independently of individual custom metrics.

## 6. Durable event stream

### 6.1 `game_events`

```text
id
match_id nullable
aggregate_type           match | invite | party | ticket | campaign | tournament
aggregate_id
sequence
schema_name
schema_version
event_type
actor_player_id nullable
occurred_at
payload_json
```

Properties:

- append-only for critical lifecycle events;
- sequence monotonic within aggregate where ordering matters;
- payload schema versioned;
- no secrets/child-sensitive free-form payload;
- events are domain history/reconnect support, not analytics dumping ground.

### 6.2 Durable event examples

```text
MATCH_CREATED
MATCH_ALLOCATING
MATCH_READY
MATCH_STARTED
PARTICIPANT_JOINED
PARTICIPANT_DISCONNECTED
PARTICIPANT_RECONNECTED
ROUND_STARTED
ROUND_FINISHED
MATCH_FINISHED
MATCH_ABORTED
INVITE_CREATED
INVITE_ACCEPTED
MATCHMAKING_PAIRED
RATING_APPLIED
```

### 6.3 Ephemeral events are not stored by default

Examples:

```text
PLAYER_POSITION_CHANGED
AIM_CHANGED
PROJECTILE_POSITION
ANIMATION_STATE
```

These belong to realtime transport/runtime state. If a game requires replay, it opts into replay artifact storage.

## 7. Idempotent commands

### 7.1 `game_command_receipts`

Generalize the successful `chess_live_command_receipts` pattern:

```text
id
actor_player_id
command_id
command_kind
fingerprint
resource_type
resource_id
applied_version
applied_sequence
created_at
UNIQUE(actor_player_id, command_id) or stronger scope uniqueness
```

Rules:

- same `commandId` + same fingerprint => replay original receipt;
- same `commandId` + different command => idempotency conflict;
- retry after client timeout must not duplicate move/invite/rating;
- server-generated side effects use their own deterministic idempotency keys.

## 8. Transactional outbox

### 8.1 `outbox_events`

ASA architecture already specifies outbox. Games uses the same platform pattern:

```text
event_id
schema_name
schema_version
aggregate_type
aggregate_id
aggregate_version
tenant_id nullable
payload_json
occurred_at
available_at
attempt_count
published_at nullable
```

Example match-finish transaction:

```text
BEGIN
  update game_matches -> finished
  update participant outcomes
  insert MATCH_FINISHED durable event
  insert outbox(MATCH_FINISHED)
COMMIT
```

Consumers:

```text
Realtime Delivery Projector
Rating Projector
Statistics Projector
Notification Projector
Achievement Projector
Analytics Exporter
```

Every consumer must be idempotent.

`LISTEN/NOTIFY` can wake processors but a restart always catches up from durable `outbox_events`.

## 9. Invites

### 9.1 `game_invites`

```text
id
from_player_id
to_player_id nullable
public_code nullable
game_key
game_version_constraint
mode
scope_kind
scope_ref
configuration_json bounded
status pending | accepted | declined | cancelled | expired
created_at
expires_at
accepted_at nullable
match_id nullable
version
```

Two invitation styles:

1. directed invite (`to_player_id`);
2. link/code invite with policy-controlled redemption.

Accepting invite is an atomic transition that creates/reserves a Match exactly once.

## 10. Party

### 10.1 `game_parties`

```text
id
leader_player_id
status open | queued | in_match | closed
scope
created_at
version
```

### 10.2 `game_party_members`

```text
party_id
player_id
role leader | member
state invited | joined | left
joined_at
```

Party is platform-level because team matchmaking/event games need a persistent pre-match group.

A duel game may bypass party entirely.

## 11. Matchmaking tickets

### 11.1 Generic schema

```text
id
player_id/party_id
game_key
game_version_constraint
runtime_kind
topology
mode
scope
rating_pool nullable
skill_estimate nullable
latency_profile_json nullable
constraints_json bounded
status queued | paired | cancelled | expired
created_at
expires_at
paired_match_id nullable
version
command_id
```

Game-specific match preferences belong in a validated extension object controlled by registered game/mode policy, not generic SQL columns.

Examples:

- chess color preference = extension;
- arena team preference = extension;
- map playlist = extension;
- required party size/topology = generic.

## 12. Rating model

### 12.1 No universal cross-game rating

Rating identity is:

```text
(player_id, game_key, rating_pool, policy_version)
```

Examples:

```text
checkers / standard
chess / blitz
chess / rapid
arena / ranked-4v4
```

### 12.2 `game_ratings`

Current materialized state:

```text
player_id
game_key
rating_pool
rating_value
uncertainty nullable
games
provisional
policy_version
updated_at
state_json
PRIMARY KEY(player_id, game_key, rating_pool)
```

### 12.3 `game_rating_events`

Immutable ledger:

```text
id
match_id
player_id
game_key
rating_pool
before_json
opponents_or_field_json
delta_json
after_json
policy_version
created_at
UNIQUE(match_id, player_id, rating_pool)
```

The generic ledger does not assume exactly one opponent or scalar Elo K-factor. Duel policies can store those details in policy-specific JSON/metric columns if needed.

### 12.4 Rating application

Rating is applied only after authoritative match outcome is durable.

```text
MATCH_FINISHED outbox
   ↓
RatingProjector
   ↓
load pinned policy version
   ↓
transactionally append rating events + update current states
```

Retries cannot double-apply because `(match, player, pool)` is unique.

## 13. Statistics

### 13.1 Source of truth

Statistics must be reconstructible from:

- finished `game_matches`;
- participant outcomes;
- rating events;
- versioned game-specific match metrics.

Do NOT make `wins=42` the only truth.

### 13.2 Projection examples

```text
game_player_stats
classroom_game_stats
head_to_head_stats
game_leaderboard_snapshots
bot_opponent_stats
```

These are caches/projections and may be rebuilt.

### 13.3 Common metrics automatically available

Where applicable:

- matches played;
- W/D/L;
- win rate;
- current/best streak;
- recent form;
- side/seat split;
- average placement;
- DNF rate;
- head-to-head;
- rating current/peak/history;
- classroom/recent-opponent views;
- bot W/D/L.

### 13.4 Custom game metrics

```text
game_match_metrics
------------------
match_id
player_id nullable
metrics_schema_version
metrics_json
```

Examples:

Checkers:

```json
{"captures": 12, "promotions": 2, "maxCaptureChain": 4}
```

Arena:

```json
{"kills": 10, "deaths": 6, "assists": 4, "accuracy": 0.38, "objectiveScore": 740}
```

The platform stores and validates the registered schema but does not infer meaning unless a projector explicitly knows a metric.

## 14. Presence data

Presence is ephemeral and MUST NOT become a high-write PostgreSQL table in the hot path.

Logical state:

```text
playerId
status online | away | in_game | offline
connectionIds
currentMatchId nullable
lastHeartbeat
```

V1 single gateway may store presence in memory.

Scale-out can add a shared ephemeral store/pub-sub adapter later. Durable history only records meaningful lifecycle events, not every heartbeat.

## 15. Realtime room runtime registration

Room/server heartbeats are also ephemeral:

```text
runtimeId
buildVersion
supportedGameVersions
region
capacity
activeRooms
activePlayers
lastHeartbeat
health
```

Room lease:

```text
roomId
matchId
runtimeId
leaseUntil
status allocating | ready | active | draining | lost | closed
```

For initial single-runtime deployment these may be in-memory control objects. Persistence is introduced only where recovery/operations require it.

## 16. Recovery policy metadata

Each GameManifest declares one of:

```text
durable          // command state can be reconstructed from DB
checkpointed     // realtime room emits periodic recoverable checkpoints
non_recoverable  // crash aborts match; no rated outcome
```

Rules:

- rated realtime modes cannot silently use `non_recoverable` unless product policy explicitly defines void/abort semantics;
- recovery must never synthesize winner from incomplete client reports;
- aborted rated games do not apply rating unless a game policy can prove an authoritative result.

## 17. Multi-tenancy strategy

Games must inherit ASA storage boundaries, not invent a parallel tenancy model.

### Command/classroom/private organization matches

Use tenant-aware repositories/RLS where match belongs to a tenant/workspace scope.

### Future cross-tenant/global matchmaking

This requires an explicit platform-level placement decision because a single match may contain principals from different workspaces.

Do NOT fake this by selecting one player's tenant and leaking another user's data into it.

Before global cross-tenant matchmaking is enabled, a separate ADR must decide one of:

- dedicated platform Games tenant/storage domain;
- global platform tables with explicit row authorization separate from tenant RLS;
- controlled match placement with privacy-safe participant references.

Until then, global matchmaking is a product capability flag, not an assumed database implementation.

This is an important unresolved boundary.

## 18. Privacy and minors

Mandatory platform rules:

1. Public gaming alias/avatar are explicit views, not account rows.
2. School/class membership is not public leaderboard metadata by default.
3. Cross-tenant discovery of minors is disabled until policy review.
4. Direct free-form chat is out of core Games scope; reactions/preset communication may be separately enabled.
5. Block/report relation is checked before invite/match pairing.
6. Spectator payload must not expose hidden/private game state.
7. Logs/telemetry use player-independent correlation IDs; no email/real names/game payload dumps.
8. Retention is defined per data class and event/replay type.

## 19. Migration from `chess_live_*`

### Stage A — preserve

Current chess tables remain authoritative for existing live games.

### Stage B — generic schema

Create new `game_*` tables additively. No rename/drop.

### Stage C — certification data

Tic-Tac-Toe writes only generic schema. Validate idempotency/events/reconnect/rating projection if enabled.

### Stage D — chess compatibility projection

Implement converter:

```text
LiveChessGame -> GameMatch + Participants + game-specific ChessState
ChessRatingLedgerEntry -> GameRatingEvent
LiveChessEvent -> mapped GameEvent
```

Run shadow comparisons without changing chess write path.

### Stage E — new chess matches on Games Core

Compatibility API `/api/chess/live` may delegate to Games Core while response contract remains stable.

### Stage F — history backfill

Backfill old chess games/rating events with stable source markers and integrity counts.

### Stage G — retire writes

Old tables become read-only compatibility source, then eventually archived/retired in a separate migration after evidence.

Same principle later applies to checkers classroom-specific game storage.

## 20. Data acceptance tests

Before Games Core persistence is accepted:

- duplicate command never creates duplicate move/outcome;
- concurrent expectedVersion race has one winner;
- match finish and outbox are atomic;
- rating retry does not double-apply;
- stats projection rebuild produces same totals;
- participant model represents 1v1, FFA, teams and bots;
- no internal identity IDs appear in public DTO fixtures;
- tenant/class scope negative tests pass;
- append-only critical events reject mutation;
- old chess data can be shadow-projected without semantic loss;
- a crashed non-recoverable realtime room yields `aborted`, not fabricated result;
- spectator public state excludes hidden information.
