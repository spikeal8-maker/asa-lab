# ASA Chess Online — server-authoritative candidate

**Issue:** #67  
**Stack:** `assistant/chess-online-core` on Draft PR #66  
**Status:** implementation candidate, local gates `NOT_RUN`  
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
- strict request-body shape.

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

One player can have only one queued ticket in the candidate repository.

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

Rating is updated once per rated finished game.

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
- explicit candidate and authority notices.

## Current persistence limitation

The composition root intentionally uses `MemoryChessLiveRepository` for the implementation candidate. This proves aggregate, API and two-session browser behavior but is not durable or horizontally scalable.

Before production acceptance it must be replaced by a PostgreSQL repository with:

- tenant RLS;
- atomic expected-version writes;
- unique command receipts;
- append-only event sequence;
- unique challenge codes per tenant;
- one queued matchmaking ticket per player;
- exactly-once rating ledger per game/player;
- migration, rollback and isolated `_test` database evidence.

## Not implemented or claimed

- durable PostgreSQL live repository;
- production WebSocket gateway;
- distributed clock scheduler;
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
pnpm build
pnpm test:chess
pnpm test:chess-live
pnpm test
pnpm e2e:chess-live
```

Required browser evidence:

```text
chess-online-white-desktop.png
chess-online-black-mobile.png
```

Canonical ports remain 4610 / 4611 / 4612. Ports 3000 / 3100 / 5173 are forbidden.
