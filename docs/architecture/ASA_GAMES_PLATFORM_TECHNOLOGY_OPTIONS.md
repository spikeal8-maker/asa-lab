# ASA Games Platform — Technology Options and Build-vs-Buy Matrix

**Status:** Draft research decision aid  
**Purpose:** определить, какие технологии являются архитектурными зависимостями, какие — возможными adapters, а какие сейчас избыточны.

## 1. Guiding rule

ASA Games Platform should own its domain contracts and data semantics even if infrastructure implementation is later delegated to an external product.

Do not encode provider-specific concepts into game modules.

For example:

```text
Game code -> GameRoomAllocator
```

not:

```text
Game code -> Agones CRD
```

This keeps the ability to begin with Docker and later adopt Agones/GameLift/another host without rewriting every game.

## 2. Existing ASA constraints

Current production topology is intentionally small:

```text
PostgreSQL
API
Web
Migration job
```

The platform already has:

- NestJS/TypeScript API;
- PostgreSQL/RLS;
- Docker/Compose;
- Nx/pnpm monorepo;
- subject ModuleRegistry;
- `chess-live` domain/application/Pg implementation;
- placeholder `realtime-gateway`;
- observability package and SLO documentation.

Therefore a technology is preferred when it can be introduced incrementally without forcing a full hosting-platform migration.

## 3. Backend/control-plane framework

### Option A — keep NestJS/TypeScript inside current API initially

**Recommendation:** YES for first Games Control Plane.

Advantages:

- existing auth/identity/DB wiring;
- existing testing/build/deployment;
- minimal operational change;
- command games are not latency-sensitive enough to justify another language/process;
- allows clean bounded-context extraction before physical service split.

Risks:

- API process can become too broad if boundaries are not enforced;
- realtime hot loops must not run in main API event loop.

Decision:

**Games Control Plane and Command Runtime v1 live logically inside API, with independent ports/contracts/packages.**

## 4. PostgreSQL

### Recommendation: keep as durable primary store

Use for:

- matches metadata;
- command-game canonical state;
- participants;
- durable lifecycle events;
- command receipts;
- invites/parties/tickets;
- rating state/ledger;
- outbox;
- statistics projections;
- tournament/event metadata.

Do not use for:

- every realtime physics tick;
- heartbeat hot path at large scale;
- high-frequency position telemetry.

Existing chess-live schema proves PostgreSQL already handles the key command-game consistency patterns in this repository.

## 5. Transactional event publication

### PostgreSQL outbox

**Recommendation:** YES.

Reasons:

- already aligned with ASA architecture docs;
- solves match/update + event dual-write;
- no new broker required;
- appropriate current scale;
- consumers can be idempotent;
- easy to inspect/recover operationally.

### Kafka

**Recommendation:** NO as baseline.

Consider only when:

- event throughput/retention/replay requirements clearly exceed Postgres outbox;
- multiple independent high-volume consumers justify broker operations;
- team has operational maturity for Kafka.

Do not add Kafka merely because "games use events".

### NATS / RabbitMQ

**Recommendation:** optional future adapter, not v1 dependency.

They may later improve pub/sub/worker routing but do not replace durable match truth.

## 6. Realtime gateway implementation

### Node.js WebSocket gateway

**Recommendation:** YES initially.

Possible implementation choices:

- `ws`;
- `uWebSockets.js` after compatibility/license/operational evaluation;
- framework adapter only if it preserves explicit protocol/backpressure controls.

Why initial Node is reasonable:

- gateway mostly handles auth/subscriptions/fanout, not simulation;
- shared TypeScript contracts;
- existing application stack;
- L1 target is hundreds, not hundreds of thousands, of connections.

Before selecting library, benchmark:

- 500 / 2k / 10k idle+active connections;
- fanout throughput;
- slow consumers;
- reconnect storm;
- memory per connection;
- graceful shutdown/draining.

## 7. WebSocket vs WebTransport vs WebRTC

### WebSocket

**Recommendation:** baseline.

Use for:

- Control Plane realtime;
- invites/presence/match events;
- first room runtime certification.

Pros:

- broad browser/proxy support;
- operationally familiar;
- TLS via existing HTTP infrastructure.

Cons:

- ordered reliable stream can create head-of-line latency for replaceable room updates;
- classic browser API has no native backpressure.

Mitigation: coalescing, bounded queues, message classes, resync.

### WebTransport

**Recommendation:** design-ready, not v1 requirement.

Potential advantages:

- HTTP/3/QUIC;
- unreliable datagrams for replaceable updates;
- multiple streams.

Adopt only after:

- browser/device matrix tested;
- reverse proxy/load balancer supports it;
- ASA Arena measurements show WebSocket limitation;
- fallback strategy exists.

### WebRTC data channels / peer-to-peer

**Recommendation:** NOT default competitive architecture.

Reasons:

- host authority/cheat risk if peer-hosted;
- NAT/STUN/TURN operational complexity;
- peer IP/privacy concerns;
- reconnect/migration complexity;
- children/privacy context makes direct peer networking unattractive.

WebRTC may later be evaluated for voice/media or specialized trusted LAN/event scenarios, but competitive state remains server-authoritative.

## 8. Redis

### Recommendation: optional scale-out coordination, not v1 source of truth

Potential future uses:

- distributed presence;
- gateway pub/sub;
- rate-limit counters;
- short-lived room/runtime registry;
- matchmaking coordination locks/leases;
- cached leaderboard slices.

Do not put durable ratings/match outcomes only in Redis.

Adoption trigger:

- >1 gateway/runtime process requires shared ephemeral coordination;
- measured Postgres polling/outbox wake-up latency/connection pressure becomes problematic.

Single-instance v1 can use in-memory presence plus PostgreSQL durable state.

## 9. Dedicated game runtime language/framework

No single language should be required by Games Platform protocol.

### TypeScript/Node

Good for:

- ASA Arena Mini certification;
- moderate tick rate/simple simulation;
- rapid iteration/shared schemas.

Risk: CPU-heavy physics and garbage collection at higher room densities.

### Rust

Possible future choice for:

- high room density;
- deterministic/CPU-heavy simulations;
- strict resource control.

Repository already contains `crates/`, so Rust is not foreign to ASA, but no need to force it before workload exists.

### Game-engine headless servers (Godot/Unity/etc.)

Can be integrated as isolated runtime images if an event game needs engine parity. Games Platform should speak runtime protocol rather than import engine internals.

**Decision:** Runtime protocol is language-agnostic. ASA Arena Mini may start TypeScript for certification simplicity.

## 10. Colyseus

Official docs: https://docs.colyseus.io/

Strengths:

- authoritative rooms;
- room lifecycle;
- state synchronization/delta patches;
- Node/TypeScript fit;
- matchmaking/room concepts useful for prototypes.

Potential use:

- candidate implementation library for realtime room server if it fits protocol and operations.

Why not make it architecture:

- ASA needs its own cross-game Control Plane, identity, rating, classrooms, events;
- game plugins should not depend on Colyseus-specific APIs;
- future non-Node runtime should remain possible.

**Position:** evaluate as one Room Runtime adapter/prototype, not platform contract.

## 11. Nakama

Official docs: https://heroiclabs.com/docs/nakama/

Strengths:

- mature auth/social/matchmaker/authoritative multiplayer;
- active/passive turn-based and realtime authoritative matches;
- storage and realtime features.

Why not adopt wholesale now:

- ASA already owns identity/classroom/project data;
- duplicating auth/social storage would create competing sources of truth;
- significant chess-live work already exists;
- migration/operations cost.

Potential future use:

- architectural reference;
- isolated deployment experiment if building/operating gateway/matchmaker becomes disproportionate.

**Position:** reference/alternative platform, not dependency.

## 12. PlayFab / GameLift

Official docs:

- https://learn.microsoft.com/en-us/gaming/playfab/multiplayer/
- https://docs.aws.amazon.com/gameliftservers/latest/flexmatchguide/

Strengths:

- managed matchmaking/server allocation/fleet operations;
- autoscaling/regions;
- production-proven patterns.

Constraints for ASA:

- cloud/provider dependency;
- cost/predictability;
- data locality/privacy requirements;
- school/offline/local deployment goals;
- existing self-hosted infrastructure direction.

**Position:** useful design references and possible future hosting adapters, not core requirements.

## 13. Open Match

Official docs: https://openmatch.dev/

Strengths:

- clean Tickets/Pools/MatchFunction architecture;
- customizable match logic;
- good separation between matchmaking and hosting.

Constraints:

- Kubernetes-centric operational model;
- far heavier than current ASA L1 deployment.

**Position:** conceptual reference. Consider only at much larger scale if custom matchmaker becomes operational bottleneck.

## 14. Agones

Official docs: https://agones.dev/

Strengths:

- dedicated server Fleet lifecycle;
- health/readiness/allocation;
- autoscaling ecosystem;
- allocation API cleanly matches proposed `GameRoomAllocator` port.

Constraints:

- requires Kubernetes expertise/cluster operations;
- overkill for one/few Docker runtimes.

**Position:** future allocator implementation for regional/national dedicated-room scale; not v1 requirement.

## 15. Container orchestration v1

### Docker Compose / current deployment

**Recommendation:** preserve for initial Games Platform.

Add services only when their slice is implemented:

```text
realtime-gateway
game-runtime
```

Use:

- read-only image/filesystem where possible;
- non-root;
- resource limits;
- no direct DB access for isolated external runtime;
- internal network segmentation;
- health checks;
- exact image revision.

### Kubernetes

Adoption trigger:

- many runtime instances;
- dynamic room fleet demand;
- multi-node scheduling/health/replacement requirements;
- operations team prepared.

Not a prerequisite for architecture acceptance.

## 16. Serialization

### JSON

**Recommendation:** Control Plane API/protocol v1 and certification phase.

Advantages:

- inspectable;
- existing TypeScript validation;
- easy debugging/security tests.

### MessagePack / protobuf

Evaluate for realtime-room hot path after measurement.

Adoption criteria:

- snapshot bandwidth is material;
- CPU serialization profile justifies complexity;
- schemas/protocol compatibility tooling in place.

Game runtime protocol must be schema-versioned regardless of binary/text encoding.

## 17. Object storage

Not required for command match state.

Useful future use:

- large replay artifacts;
- event-game maps/assets;
- large post-match telemetry traces retained for debugging;
- signed downloadable replay/export.

Follow ASA existing storage abstraction/data classification; do not expose permanent object keys.

## 18. Observability

Reuse existing `@asa-lab/observability` direction and platform SLOs.

Technology can remain current metrics/logging stack initially. The important architectural requirement is stable metrics names/labels and no PII labels.

Future OpenTelemetry exporter can cover:

```text
HTTP control-plane spans
matchmaking
allocation
room lifecycle
outbox consumers
```

Do not trace every realtime input/tick in production by default.

## 19. Technology recommendation by phase

| Phase | Required technology | Explicitly not required |
|---|---|---|
| Contracts/registry | TypeScript packages, existing monorepo | new services |
| Command certification | NestJS/API + PostgreSQL + outbox | Redis/Kafka |
| Gateway | Node WebSocket + existing auth | Kubernetes |
| Arena certification | one isolated game-runtime Docker service | Agones |
| Small production | API + Postgres + gateway + static runtime(s) | Open Match |
| Scale-out | optional Redis/shared ephemeral coordination | Kafka unless evidence |
| Regional dedicated fleet | allocator adapter, possibly Kubernetes/Agones | provider lock-in in SDK |

## 20. Technologies explicitly prohibited as accidental dependencies

A game plugin MUST NOT require platform consumers to know:

- NestJS controller internals;
- PostgreSQL table names;
- Redis keys;
- Kafka topics;
- Kubernetes resource names;
- Agones CRDs;
- Colyseus Room class;
- AWS/PlayFab identifiers.

Those may exist behind adapters. `@asa-lab/game-sdk` remains framework/provider independent.

## 21. Recommended initial stack

For the first complete Games Platform certification:

```text
Web: existing React application + GameShell
API: existing NestJS process, Games bounded context
DB: PostgreSQL 17 + RLS + outbox
Gateway: Node/TypeScript WebSocket service
Command runtime: inside Games Core via adapters
Realtime room: one isolated Node/TypeScript Docker runtime
Transport: HTTPS + WSS
Serialization: JSON initially
Coordination: in-memory + PostgreSQL durable state
Deployment: Docker Compose/current production model
```

This is deliberately conservative. The abstraction boundaries, not infrastructure fashion, provide the path to future scale.
