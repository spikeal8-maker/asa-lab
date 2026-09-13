# ASA Games Platform — Execution Plan

**Status:** Draft planning contract  
**Rule:** no production migration or new game-specific online backend before architecture gates are accepted  
**Base:** documentation branch only

## 1. Delivery strategy

Games Platform is delivered in small, reversible slices. Logical boundaries are introduced before physical services. Existing Chess/Checkers remain operational until certification and compatibility gates prove the generic path.

Key rules:

1. No destructive chess/checkers migration in the same release that introduces generic tables/contracts.
2. No force migration of current users/identity into a new Games auth model.
3. No Kubernetes/Redis/Kafka dependency unless a later task contains measured justification.
4. Every new shared contract has a fake/in-memory test implementation before production wiring.
5. Every runtime path has explicit privacy/cross-tenant negative tests.
6. Command and realtime-room paths are certified separately.
7. Mature chess/checkers migrate only after third-game certification proves abstraction quality.
8. All public DTOs are reviewed for internal identity leakage.
9. Ratings/stats are never trusted from client-supplied result.
10. Existing API paths remain compatibility surfaces until their replacement is evidence-backed.

## 2. Milestones

```text
GP-M0  Architecture and current-state acceptance
GP-M1  Game SDK and Registry
GP-M2  Identity + Match Core persistence
GP-M3  Command runtime certification
GP-M4  Social/invite/party + Matchmaker
GP-M5  Rating + Statistics + History
GP-M6  Realtime Gateway
GP-M7  Realtime Room Runtime certification
GP-M8  Chess migration
GP-M9  Checkers migration
GP-M10 Events/Tournaments/scale-out hardening
```

## 3. GP-M0 — Architecture and current-state acceptance

### GP-000 Current-state audit

**Goal:** verify reuse/migration boundaries against repository reality.

Deliverables:

- Chess Live decomposition;
- Checkers online/classroom/session decomposition;
- identity/classroom mapping;
- PostgreSQL/RLS baseline;
- deployment baseline;
- realtime gateway baseline;
- security/capacity inheritance;
- risk register.

Acceptance:

- no claim contradicts current code/migrations;
- generic vs game-specific chess concepts explicitly separated;
- deployment document reflects actual Compose topology;
- unresolved cross-tenant global matchmaking is called out, not hidden.

### GP-001 Boundary ADR

**Goal:** accept Control Plane / Command Runtime / Gateway / Room Runtime boundaries.

Acceptance:

- architecture represents Checkers, Chess, Tic-Tac-Toe, 8-player FFA and 4v4 Arena;
- command and realtime runtime contracts differ intentionally;
- server authority mandatory;
- no mandatory new infrastructure product;
- migration/certification order accepted.

**Blocker:** no GP-M1 implementation until ADR accepted.

## 4. GP-M1 — Game SDK and Registry

### GP-002 `@asa-lab/game-sdk` foundation

Implement framework-independent types only:

- `GameManifestV1`;
- capabilities;
- topology;
- runtime kind;
- lifecycle;
- recovery policy;
- common outcome/participant contracts;
- Command adapter interfaces;
- Realtime adapter interfaces;
- optional bot/custom metrics descriptors;
- version fields.

Acceptance tests:

- manifests for checkers/chess/XO/Arena validate without game-name branches;
- impossible combinations rejected (e.g. `rated=true` with no rating policy);
- version fields required;
- SDK imports no React/NestJS/PostgreSQL/Redis/Agones.

### GP-003 Game Registry

Add `GameRegistry` analogous in discipline to ModuleRegistry.

Responsibilities:

- unique gameKey;
- manifest validation;
- provider/adapter availability;
- feature capability lookup;
- game/version compatibility lookup;
- public catalog projection.

Acceptance:

- no game-specific switch in registry core;
- inactive/event-expired games cannot admit new matches;
- registry can expose public capability summary without implementation secrets.

### GP-004 Developer conformance harness

Create reusable tests/helpers for game authors:

- manifest contract;
- deterministic command adapter tests;
- public-state privacy tests;
- outcome schema tests;
- bot provider contract;
- custom metrics validation.

## 5. GP-M2 — Gaming identity and Match Core

### GP-005 Game player identity projection

Create public-safe gaming identity linked to existing Principal/Account direction.

Before schema implementation, resolve open policy:

- Account vs StudentSeat principal path;
- default alias/visibility for minors;
- whether cross-tenant public identity is enabled at all in first release.

Acceptance:

- changing classroom membership does not change game player identity;
- public DTO never contains account/principal/learner/email IDs;
- suspended/deleted identity behavior defined;
- current ASA session remains authentication source.

### GP-006 Generic Match schema

Additive migration only:

- `game_matches`;
- `game_match_participants`;
- command-game state storage;
- `game_events`;
- `game_command_receipts`;
- `outbox_events` if shared platform outbox not yet materialized;
- game-specific metrics table.

Acceptance:

- RLS/authorization design approved;
- duel/FFA/team/co-op fixtures persist;
- optimistic version conflict tested;
- durable events append-only;
- no `white_player_id`, `black_player_id` platform columns;
- migration works from clean DB and existing DB.

### GP-007 Generic Match application service

Implement lifecycle:

```text
create/reserve
ready
start
apply command (command runtime)
finish
abort/cancel
get/reconnect/history
```

Acceptance:

- authoritative outcome only from adapter/runtime;
- finish and outbox atomic;
- duplicate command idempotent;
- unauthorized seat rejected;
- game/version pinned.

## 6. GP-M3 — Command runtime certification

### GP-008 Command Runtime V1

Connect registered `CommandGameAdapter` to Match Core.

Acceptance:

- command envelope uses `commandId + expectedVersion`;
- canonical state stored durably;
- viewer-aware public state supported;
- hidden-information test fixture supported;
- HTTP correctness independent of WebSocket.

### GP-009 Tic-Tac-Toe certification game

Implement deliberately small game:

- X/O rules;
- renderer;
- optional perfect/simple bot;
- no custom online backend.

It MUST receive from platform:

- match lifecycle;
- command idempotency;
- reconnect;
- history;
- common stats source;
- later invites/matchmaking automatically.

Acceptance gate:

> If Tic-Tac-Toe requires a bespoke controller/repository for match lifecycle, GP-M2/M3 architecture is rejected and redesigned before Chess/Checkers migration.

## 7. GP-M4 — Invites, Party, social directory and Matchmaker

### GP-010 Invite service

Generic directed and code/link invites.

Acceptance:

- idempotent create/accept/cancel;
- expiry;
- game capability validation;
- block/privacy policy hook;
- accept creates exactly one Match;
- public identity only.

### GP-011 Game social directory

Adapters/providers:

- Classroom relationships;
- recent opponents;
- future friends;
- event participants.

Acceptance:

- Games Core does not own classroom membership;
- classroom-only view cannot leak to global public view;
- aggregated classmates work from Games Hub.

### GP-012 Party V1

Required for team/co-op future games.

Acceptance:

- leader/member lifecycle;
- invite/join/leave;
- party admission policy;
- party cannot queue conflicting matches simultaneously;
- duel games may bypass party.

### GP-013 Matchmaker V1

Generic tickets/pools/policy.

Initial supported grouping:

- duel quick;
- duel rated;
- party/team-size compatible test fixture.

Acceptance:

- tickets scoped by game/version/mode;
- widening skill window policy testable;
- blocked/incompatible players not paired;
- same player cannot hold conflicting active tickets;
- pairing transaction creates one match;
- matchmaker has no game rule imports.

## 8. GP-M5 — Rating, stats, profile, history

### GP-014 Rating policy framework

Define generic policy interface and immutable rating events.

Acceptance:

- policy selected by pinned game/pool version;
- duel policy fixture passes;
- team/placement interface representable even if not production enabled;
- retry cannot double-rate match;
- bot/local/unrated modes excluded by policy.

### GP-015 Existing Chess rating compatibility study

Before replacing ASA Elo:

- compare existing chess calculations;
- decide keep-as-policy `chess-asa-elo-v1` vs migration to another algorithm;
- no silent historical recomputation under a new algorithm.

### GP-016 Common stats projectors

Implement rebuildable projections:

- games/WDL/win rate;
- streak;
- recent form;
- seat split;
- placement;
- head-to-head;
- bots;
- rating history/peak.

Acceptance:

- rebuild from source produces same result;
- duplicate outbox delivery harmless;
- custom metrics schema isolation;
- no stats source exists only as mutable counter.

### GP-017 Games Profile / History / Leaderboards API

Privacy-aware endpoints and DTOs.

Acceptance:

- self/private/public/classroom scopes tested;
- no internal IDs;
- leaderboards per game/pool, not universal rating;
- classroom leaderboard requires relationship/access policy.

## 9. GP-M6 — Realtime Gateway

### GP-018 Control realtime protocol V1

Specify and implement:

- HELLO/auth;
- subscriptions;
- player personal topic;
- party/match topics;
- invite/match-found/match-event/rating messages;
- sequence/resync semantics.

### GP-019 Gateway security/backpressure

Acceptance:

- origin/auth validation;
- per-subscription authorization;
- strict schemas;
- max payload/rate/connection limits;
- heartbeat/idle timeout;
- bounded outbound queues;
- slow consumer handling;
- no PII logs.

### GP-020 Gateway deployment

Add service to dev/test before production.

Load gates at minimum:

- 500 connections L1 with safety margin;
- reconnect storm;
- event fanout;
- slow consumer memory behavior;
- graceful drain/restart.

Only then add to production Compose.

## 10. GP-M7 — Realtime Room Runtime

### GP-021 Room Runtime Protocol V1

Implement language-neutral envelopes/contracts:

- room token;
- input sequence;
- server tick;
- snapshots/deltas;
- input acknowledgement;
- resync;
- final outcome;
- room health/lifecycle.

### GP-022 GameRoomAllocator V1

First adapter may target one configured runtime.

Acceptance:

- compatibility/version/capacity checked;
- room allocation idempotent;
- lost/expired room detected;
- match status transitions correctly;
- allocator contract has no Docker/Kubernetes-specific API.

### GP-023 `game-runtime` initial service

One isolated Docker runtime process.

Rules:

- no direct account DB access;
- short-lived room tokens;
- resource limits;
- health/readiness;
- room lifecycle;
- metrics.

### GP-024 ASA Arena Mini certification

Minimal gameplay, not product polish:

- 4–8 players;
- move around small 2D map;
- collect/hold objectives or points;
- 60 second round;
- authoritative score/position;
- 30 Hz target (subject to measurement).

Certification proves:

- matchmaking→allocation→room;
- token isolation;
- server-authoritative input;
- snapshots;
- interpolation/prediction basics;
- reconnect;
- disconnect grace;
- outcome→Match Core;
- stats/history;
- room crash policy;
- tick SLO/metrics.

Hard gate:

> Chess/Checkers are not migrated merely because command path works. GP-024 proves platform is not board-game-shaped.

## 11. GP-M8 — Chess migration

### GP-025 Chess generic adapter

Wrap existing chess rules/state behind CommandGameAdapter without changing user-visible online API yet.

### GP-026 Shadow projection

Map current `chess_live_*` games/events/ratings into generic model in tests/reporting.

Acceptance:

- counts/results/rating deltas match historical fixtures;
- no privacy regressions;
- current chess E2E unchanged.

### GP-027 Compatibility API delegation

`/api/chess/live` may delegate new matches to Games Core while preserving old response contract.

### GP-028 Backfill and read parity

Add historical generic records or stable compatibility read layer.

### GP-029 Stop legacy writes

Only after evidence, make legacy persistence non-primary/read-only. Destructive cleanup deferred.

## 12. GP-M9 — Checkers migration

### GP-030 Checkers CommandGameAdapter

Reuse Russian-64 rules; no rewrite.

### GP-031 Replace checkers-specific online/classroom lifecycle with Games Core

Keep educational/classroom policy adapters but use generic Match/Invite infrastructure.

### GP-032 Online product modes

Enable through shared platform:

- invite friend/classmate;
- quick;
- rated;
- realtime push;
- reconnect;
- history/stats/rating.

### GP-033 Checkers bot/stat integration

Bots remain game-owned; platform consumes descriptors/outcomes.

## 13. GP-M10 — Events, tournaments, isolated games and scale

### GP-034 Event Campaign model

- active windows;
- audience scope;
- pinned game version;
- event leaderboard;
- admission cap;
- archive behavior.

### GP-035 Tournament Core

Start only with formats required by real product use case.

### GP-036 Isolated game package protocol

Define supply-chain and runtime/client sandbox contracts for event games.

Acceptance:

- runtime has no direct internal DB/auth access;
- signed/pinned artifacts;
- resource/capability limits;
- protocol compatibility gate;
- kill switch/admission pause.

### GP-037 Scale-out experiments

Only based on measured bottlenecks:

- Redis/shared presence/pub-sub;
- static runtime pool;
- Kubernetes/Agones allocator;
- binary room protocol;
- WebTransport;
- regional placement.

Each adoption requires benchmark + rollback plan.

## 14. Cross-cutting security gates

Every relevant milestone checks:

- no cross-tenant unauthorized access;
- no internal identity exposure;
- child privacy defaults;
- block/report policy;
- strict schemas;
- rate limits;
- idempotency/replay;
- runtime sandbox boundary;
- no client-authoritative result;
- secret/token redaction;
- dependency/image supply chain.

## 15. Cross-cutting observability gates

Before enabling a capability in production, dashboards/alerts must exist for its critical path.

Examples:

- match creation/finish failures;
- queue wait;
- command conflicts/latency;
- outbox backlog;
- gateway connection/backpressure;
- room allocation failures;
- tick overruns/crashes;
- rating projector backlog.

## 16. Documentation required before each code milestone

Every GP task should have:

```text
Problem / scope
Owner boundary
Contract changes
Data/security impact
Compatibility impact
Failure modes
Tests
Metrics
Rollback
Explicit non-goals
```

Bots/agents must read this Games Platform package before touching shared game networking.

## 17. Definition of platform-ready

ASA Games Platform v1 is considered real only when all are true:

1. Tic-Tac-Toe has no bespoke online stack.
2. ASA Arena Mini has no bespoke lobby/matchmaking/profile stack.
3. Both use common player identity, Match Core, history and stats.
4. Command path survives retry/reconnect safely.
5. Room path is server-authoritative and meets certified tick/load target.
6. Gateway failure does not corrupt durable match truth.
7. Rating is immutable/replay-safe and per game/pool.
8. Public identity layer passes child/privacy review.
9. Chess can be compatibility-mapped without semantic data loss.
10. Checkers can consume the platform without rewriting Russian-64 rules.
11. A new trusted game can be scaffolded primarily by manifest + adapter + renderer.
12. An isolated event game can be admitted/disabled without gaining internal DB/auth access.

Until these gates are met, product language should say games are being converged onto Games Platform, not claim arbitrary plug-and-play game hosting.
