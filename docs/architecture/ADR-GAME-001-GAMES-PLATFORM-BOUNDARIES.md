# ADR-GAME-001: ASA Games Platform boundaries and runtime families

**Status:** Proposed  
**Date:** 2026-09-13  
**Scope:** Games Platform, online multiplayer, game plugins, realtime runtime  
**Owners:** ASA Lab platform architecture + game module owners

## Context

ASA Lab already contains online-game functionality in more than one form:

- `contexts/chess-live` owns a mature chess-specific live stack;
- Checkers owns its rules/bots/classroom/session evolution;
- `apps/realtime-gateway` exists as a foundation shell but has no production realtime implementation;
- the platform already has global Account/Principal evolution, Classroom relationships, ModuleRegistry, PostgreSQL/RLS, observability and Docker deployment patterns.

Future requirements include not only checkers/chess/tic-tac-toe but also temporary event games, team games, racing and potentially shooter/arena experiences.

A single abstraction designed around `makeMove()` cannot correctly model both turn-based games and a 20–60 Hz realtime simulation. Conversely, implementing networking independently inside every game will duplicate invitations, matchmaking, rating, history, public profiles, reconnect, notifications, moderation and observability.

The architecture therefore needs a stable platform boundary before more online functionality is added to individual games.

## Decision

### 1. Introduce ASA Games Platform as a first-class platform area

Games Platform is logically divided into:

```text
Games Control Plane
Command Game Runtime
Realtime Gateway
Realtime Room Runtime
```

These are logical boundaries first. They are not required to be separate deployable services on day one.

### 2. Games Control Plane owns cross-game product/platform capabilities

It owns:

- Game Registry and capabilities;
- gaming identity/public gaming profile projection;
- Match lifecycle metadata;
- participants/teams/seats metadata;
- invites;
- parties;
- social relationship integration (classmates, recent opponents, future friends);
- matchmaking admission and tickets;
- room placement/allocation requests;
- rating policies and immutable rating events;
- common statistics projections;
- leaderboards;
- history;
- tournaments/seasons/event campaigns;
- moderation/blocking/reporting hooks;
- notifications;
- durable lifecycle events and transactional outbox.

Control Plane MUST NOT understand game-specific legal moves, FEN, Russian-64 capture rules, shooter collision physics or renderer implementation.

### 3. Support two runtime families

#### Command runtime

Used when authoritative progression is driven primarily by discrete commands and canonical state can be durably updated per command.

Examples:

- chess;
- checkers;
- tic-tac-toe;
- cards;
- battleship;
- most turn-based educational games.

Contract properties:

- `commandId` for idempotency;
- `expectedVersion` for optimistic concurrency;
- server validates actor/seat and command;
- game adapter applies command;
- new canonical state is committed durably;
- durable events/outbox are committed with it;
- connected clients receive realtime delivery, but WebSocket availability is not required for correctness.

#### Realtime room runtime

Used when authoritative simulation must advance independently at a configured tick rate and database round trips cannot be in the hot loop.

Examples:

- shooter/arena;
- racing;
- realtime platformer;
- physics-heavy event games.

Contract properties:

- server-authoritative in-memory state;
- clients send bounded inputs, not authoritative position/result/damage;
- tick loop owns simulation;
- snapshots/deltas are transmitted to clients;
- PostgreSQL stores lifecycle/outcome/coarse snapshots where required, not every tick;
- room runtime reports final authoritative outcome to Control Plane;
- recovery policy is explicit per game.

### 4. `apps/realtime-gateway` is transport/presence infrastructure, not a game simulation host

Gateway responsibility:

- authenticated connection establishment;
- protocol/version negotiation;
- subscription authorization;
- presence/online state;
- lobby/party/invite notifications;
- match-found and lifecycle notifications;
- durable command-game event fanout;
- bounded buffering/backpressure;
- heartbeat/idle detection;
- reconnect signalling;
- metrics.

Gateway MUST NOT:

- calculate legal game moves;
- apply ratings;
- write gameplay outcomes on client assertion;
- simulate shooter physics;
- become the source of truth for durable match state.

### 5. Introduce a separate `@asa-lab/game-sdk`

It is separate from `@asa-lab/module-sdk`.

The SDK defines framework-independent contracts for:

- `GameManifest` and capabilities;
- runtime family;
- topology (`duel`, `ffa`, `teams`, `coop`);
- participant seats/teams;
- generic outcome shape;
- Command Game Adapter;
- Realtime Game Adapter;
- optional bot provider;
- optional custom metrics descriptor;
- renderer/client integration metadata;
- schema/protocol versioning.

Game code MUST NOT register its own replacement matchmaking/rating/invite services when platform capabilities exist.

### 6. Introduce one generic Match Core

Platform-level entities use generic semantics:

```text
GameMatch
GameParticipant
GameEvent
GameCommandReceipt
GameInvite
GameParty
GameMatchmakingTicket
GameRatingState
GameRatingEvent
```

Platform tables MUST NOT encode `white_player_id`, `black_player_id`, FEN, checkers piece positions or shooter HP as first-class generic columns.

Game-specific canonical state lives behind the game adapter and versioned schema.

### 7. Keep PostgreSQL as durable source of truth for Control Plane

The initial platform continues to use PostgreSQL and ASA tenant/RLS conventions.

Durable aggregate change and downstream event publication MUST avoid dual-write. Use a transactional outbox: business rows and outbox event are committed in one transaction; notification/stats/rating/analytics consumers are idempotent.

`LISTEN/NOTIFY` MAY be used as a wake-up optimization but MUST NOT be the only durable event transport.

### 8. Preserve existing tenant and identity security boundaries

Games Platform reuses existing Account/Principal/Workspace/Tenant direction.

A stable public `GamePlayerProfile`/public gaming identity projection may be introduced, but it MUST link to existing identity rather than create a new authentication system.

Public gameplay surfaces MUST NOT expose internal `account_id`, `principal_id`, `learner_identity_id`, email, class/school or other child-sensitive metadata by default.

Classroom membership is a relationship/scope provider, not game identity.

### 9. Separate matchmaking from realtime server allocation

Matchmaker forms a compatible group. For command games it may immediately create a durable Match. For realtime-room games it then requests placement from a `GameRoomAllocator`.

The allocator selects a healthy compatible runtime and returns a room/session endpoint. This boundary must exist even if v1 has only one runtime instance.

### 10. Do not mandate Redis, Kafka, Kubernetes or Agones in v1

The contracts must permit future scale-out, but the first implementation should minimize operational dependencies.

Expected staged topology:

```text
D1: web + api(Games Core) + postgres
D2: + realtime-gateway
D3: + game-runtime
D4: scale-out + optional shared coordination/placement infrastructure
```

A technology such as Redis, NATS, Kafka, Kubernetes or Agones is adopted only after a concrete requirement and load evidence.

### 11. WebSocket is baseline browser transport; WebTransport is an optional future realtime transport

WebSocket is the baseline for compatibility and initial implementation.

Protocols MUST be transport-aware rather than WebSocket-shaped internally so that realtime-room traffic can later use WebTransport datagrams/streams when deployment/browser support justifies it.

WebTransport MUST NOT be a launch dependency for command games or initial Games Control Plane.

### 12. Require server authority

Client assertions such as the following are never trusted as authoritative:

- winner/result;
- score/placement;
- rating delta;
- hit/damage/health;
- item pickup;
- final position.

Command games send commands. Realtime games send inputs. Authoritative server runtime derives outcomes.

### 13. Require version pinning per match

Each match pins at minimum:

- `gameKey`;
- `gameVersion`;
- `rulesVersion`;
- `stateSchemaVersion`;
- runtime protocol version;
- rating policy/version when rated.

Historical matches and rating events remain interpretable after future game updates.

### 14. Require certification games before migrating mature games

Two certification games are architectural gates:

1. **Tic-Tac-Toe** — proves a new command game receives lobby/invite/matchmaking/history/stats without writing its own network backend.
2. **ASA Arena Mini** — simple 4–8-player realtime game proving room allocation, realtime transport, tick loop, reconnect, outcome reporting and generic stats.

Chess/checkers mass migration starts only after relevant certification gates pass.

## Consequences

### Positive

- one cross-game invite/matchmaking/profile/stat/rating infrastructure;
- future games are substantially cheaper to add;
- architecture supports both board games and realtime event games;
- current chess-live work is reused rather than discarded;
- public identity and child privacy are enforced centrally;
- realtime simulation failures can be isolated from API and other games;
- game-specific code stays focused on rules/runtime/rendering;
- rating and statistics become consistent and rebuildable across games;
- staged deployment avoids premature infrastructure complexity.

### Costs / risks

- extraction from chess-live requires careful compatibility migration;
- generic contracts need stricter design review before implementation;
- two runtime families increase conceptual surface compared with a board-game-only platform;
- realtime room games require capacity/tick/transport testing absent from current production;
- Game Registry and SDK become critical shared contracts and need semantic versioning;
- privacy policy for public gaming profiles needs explicit product/legal review for child accounts;
- temporary support for old and new persistence paths increases migration complexity.

## Alternatives considered

### A. Build online infrastructure separately for every game

Rejected. Fast initially, but duplicates identity, invite, matchmaking, rating, history, moderation and reconnect. Existing chess/checkers divergence already demonstrates the risk.

### B. Rename `chess-live` to `games-live`

Rejected. Current model has fixed white/black players, FEN/UCI/SAN, chess clocks and chess rating pools. Renaming does not remove these assumptions.

### C. One universal `applyMove()` engine for every game

Rejected. A realtime shooter needs an independent tick loop, state synchronization and input stream; SQL-per-command semantics in the hot loop are inappropriate.

### D. Put everything into `realtime-gateway`

Rejected. Connection fanout and game simulation have different lifecycle, failure, scaling and security characteristics.

### E. Adopt Nakama/PlayFab/GameLift/Agones wholesale immediately

Rejected as a mandatory first step. External systems validate architectural patterns, but ASA already has significant domain/persistence work and deployment constraints. Managed/orchestration products may be evaluated later for specific hosting/scaling problems.

### F. Make WebTransport mandatory immediately

Rejected. It is promising for datagrams and multiple streams, but is newly broadly available and still has compatibility/operational considerations. WebSocket remains the safer baseline while protocol boundaries preserve future optional transport upgrade.

## Acceptance criteria

ADR can move from `Proposed` to `Accepted` only when:

1. Current-state audit is reviewed against actual repository code/migrations.
2. `GameManifest` capability set supports at least command duel, FFA/team realtime and event lifecycle without game-name special cases.
3. Generic `GameMatch`/participant/outcome model represents:
   - checkers duel;
   - chess duel with clock metadata;
   - Tic-Tac-Toe;
   - 8-player FFA race;
   - 4v4 arena match.
4. Public identity design cannot expose internal Principal/Learner/Account IDs by default.
5. Command flow defines idempotency, optimistic version, durable state and reconnect.
6. Realtime flow defines room allocation, tick ownership, client input, snapshot/delta, disconnect/reconnect and authoritative finish.
7. Data design includes RLS/tenant strategy, append-only critical events and transactional outbox.
8. Rating model is per game/pool and policy-versioned; no single universal user rating is required.
9. Statistics have explicit source-of-truth vs projection separation.
10. Migration plan preserves existing chess/checkers data and allows rollback/dual-read verification.
11. Initial physical deployment does not require Kubernetes/Redis/Kafka.
12. Certification plan for Tic-Tac-Toe and ASA Arena Mini is defined before mature game migration.
