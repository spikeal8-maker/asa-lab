# ASA Chess Online — server-authoritative candidate

**Issue:** #67  
**Draft PR:** #68  
**Stack:** `assistant/chess-online-core` on Chess Foundation Draft PR #66  
**Status:** implementation candidate, all local gates `NOT_RUN`  
**Merge rule:** do not merge before R0, Module Registry and Chess Foundation acceptance.

## Product outcome

```text
Player A opens ASA Chess Online
→ creates a direct challenge or joins matchmaking
→ Player B accepts from a separate authenticated session
→ server assigns colors and starts clocks
→ browsers submit only command ID, expected version and UCI move
→ server validates the move and computes FEN, SAN, clocks and result
→ both clients receive the authoritative state
→ reconnect returns snapshot plus missed events
→ rated finished game writes an immutable ASA Elo v1 ledger
→ PostgreSQL preserves the game across API restarts
```

The candidate is an original ASA Lab implementation. It does not copy Chess.com source code, protocol, visual assets, rating formula, private fair-play rules or user text.

## Security and authority rules

The browser must never authoritatively submit:

```text
tenantId
userId
player color
currentFen
fenAfter
SAN
elapsed move time
remaining clocks
winner
result
termination
rating delta
```

The session supplies tenant and principal. The server accepts only bounded intent:

```text
commandId
expectedVersion
UCI move
challenge preferences
matchmaking preferences
draw/resign/timeout command
```

Every write uses:

- mandatory safe idempotency key;
- command fingerprint;
- optimistic aggregate version;
- tenant-scoped repository lookup;
- participant authorization;
- server timestamp;
- strict request-body shape;
- transaction-local tenant context;
- forced PostgreSQL RLS in the durable adapter.

## Domain model

### Direct challenge

```text
LiveChessChallenge
id / publicCode
tenantId / creatorId
colorPreference
timeControl
rated
status
expiresAtMs
acceptedById / gameId
version / createCommandId
```

Challenge invariants:

- opaque uppercase public code;
- bounded lifetime;
- creator cannot accept own challenge;
- only creator can cancel;
- expired challenge cannot be accepted;
- accept is atomic and exactly once;
- code is isolated by tenant.

### Live game aggregate

```text
LiveChessGame
players and assigned colors
currentFen
positionKeys
immutable moves
server clock
draw offer
result / termination / winner
version / event sequence
processed command receipts
```

Move processing:

```text
load tenant game
→ verify participant
→ verify expected version
→ settle active clock using server now
→ close on timeout when necessary
→ validate legal UCI through @asa-lab/chess
→ calculate SAN/FEN/repetition keys
→ add increment to mover
→ evaluate mate/pat/automatic draws
→ append event(s)
→ atomically save game and command receipt
```

### Reconnect and events

Participant reconnect receives:

```text
current snapshot
all events after last acknowledged sequence
next authoritative sequence
server timestamp
projected clocks
```

Event types:

```text
challenge_created
challenge_cancelled
challenge_expired
challenge_accepted
game_started
move_played
draw_offered
draw_declined
game_finished
```

A future WebSocket adapter uses protocol `asa-chess-live-v1`. The aggregate remains independent of transport.

### Spectators

Active participants receive events immediately. Non-participants receive only events whose server timestamp is at least 15 seconds old while the game is active. A finished game can be shown without that live delay.

The first UI does not expose a public spectator directory.

## Matchmaking

Tickets are compatible only when they share:

- tenant;
- exact time control;
- rating pool;
- rated/unrated mode;
- compatible color preferences;
- different player identities;
- current queued status;
- rating difference inside the time-expanded window.

Initial search window is 100 points. It expands by 50 points every 30 seconds up to 600. The oldest ticket is considered first and paired with the closest compatible rating deterministically.

PostgreSQL enforces one queued ticket per tenant/player through a partial unique index.

## ASA Elo v1

This is a transparent ASA-owned rating model, not Chess.com rating parity.

Pools:

```text
bullet
blitz
rapid
classical
daily
```

Foundation parameters:

```text
initial rating: 1200
provisional games: 10
K provisional: 48
K below 2100: 32
K 2100–2399: 24
K 2400+: 16
rating bounds: 100–4000
```

Every update stores two immutable ledger records with:

```text
rating before / after
opponent rating
actual score
expected score
K factor
delta
game ID
algorithm version
```

The database has a unique `(tenant_id, game_id, player_id)` constraint and an append-only trigger. A repeated command therefore cannot produce a second ledger row for the same player/game.

## Durable PostgreSQL adapter

Implemented files:

```text
migrations/0006_chess_live.sql
migrations/0007_chess_live_privilege_tightening.sql
contexts/chess-live/infrastructure/pg-repository.ts
```

Tables:

```text
chess_live_challenges
chess_live_games
chess_live_events
chess_live_command_receipts
chess_matchmaking_tickets
chess_ratings
chess_rating_ledger
```

Database guarantees:

- UUID resource identities;
- tenant-composite foreign keys;
- forced RLS on every live table;
- transaction-local `app.tenant_id` from `@asa-lab/database`;
- optimistic `WHERE version = expectedVersion` writes;
- unique command receipt per tenant/command;
- unique challenge code per tenant;
- unique event sequence per tenant/game;
- one queued matchmaking ticket per tenant/player;
- at-most-once rating ledger per tenant/game/player;
- append-only events and rating ledger;
- least-privilege runtime grants.

Normal API composition with `APP_DATABASE_URL` uses `PgChessLiveRepository`. `MemoryChessLiveRepository` remains only for health-only composition without a database and for fast deterministic unit tests.

The implementation and migration are not considered proven until the isolated `_test` database gate actually passes.

## Candidate API

```text
POST /api/chess/live/challenges
GET  /api/chess/live/challenges/:publicCode
POST /api/chess/live/challenges/:publicCode/accept
POST /api/chess/live/challenges/:challengeId/cancel

GET  /api/chess/live/games/:gameId
GET  /api/chess/live/games/:gameId/reconnect?after=N
GET  /api/chess/live/games/:gameId/events?after=N
POST /api/chess/live/games/:gameId/moves
POST /api/chess/live/games/:gameId/draw-offer
POST /api/chess/live/games/:gameId/draw-accept
POST /api/chess/live/games/:gameId/draw-decline
POST /api/chess/live/games/:gameId/resign
POST /api/chess/live/games/:gameId/claim-timeout

POST /api/chess/live/matchmaking
POST /api/chess/live/matchmaking/:ticketId/cancel
GET  /api/chess/live/ratings/:pool
```

## Visible candidate UI

The Chess module exposes an `Онлайн` surface with:

- direct challenge creation;
- code copy and acceptance;
- time-control and color choice;
- rated toggle;
- matchmaking queue;
- queue cancellation;
- current rapid rating;
- two-session live board;
- server clocks;
- authoritative move list;
- draw offer/accept/decline;
- resign and timeout check;
- version/sequence indicator;
- desktop and mobile layouts;
- explicit server-authority notices.

The first transport is same-origin REST plus polling. This is deliberate: it proves authority, persistence and reconnect semantics before adding WebSocket operations.

## Known residual risks

- rating finalization is invoked after the game-state transaction; database uniqueness prevents duplicate ledgers, but production needs an outbox/reconciliation path for a crash between game finish and rating write;
- active clock expiry currently closes on a command or timeout claim; production needs a durable scheduler for unattended expiration;
- polling is not a production replacement for WebSocket push;
- no reconnect token/device binding yet;
- no lag-compensation policy;
- no distributed locking/load evidence;
- migration order and exact privileges still require a real clean `_test` database run;
- no production observability/SLO dashboard yet.

## Not implemented or claimed

- production WebSocket gateway;
- distributed clock scheduler;
- rating outbox/reconciliation worker;
- reconnect token/device management;
- premoves;
- public game directory;
- tournaments, clubs or chat;
- production moderation and appeals;
- production anti-cheat;
- lag compensation policy;
- horizontal scaling or load proof;
- Chess.com protocol/rating/fair-play parity.

## Candidate verification

```text
pnpm install --lockfile-only
pnpm format
pnpm format:check
pnpm chess:contract
pnpm chess-live:contract
pnpm lint
pnpm typecheck:chess
pnpm typecheck:chess-live
pnpm typecheck
pnpm boundaries:check
pnpm graph:report
pnpm build
pnpm test:chess
pnpm test:chess-live
pnpm db:test:provision --reset
pnpm db:migrate:test
pnpm test:chess-live:pg
pnpm test:rls
pnpm test
pnpm e2e:chess-live
```

Required browser evidence:

```text
chess-online-white-desktop.png
chess-online-black-mobile.png
```

Canonical ports remain 4610 / 4611 / 4612. Ports 3000 / 3100 / 5173 are forbidden.
