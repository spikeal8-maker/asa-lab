# ASA Games Platform — Requirements Traceability Matrix

**Статус:** Draft  
**Источник требований:** `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION.md`  
**Назначение:** связать нормативные требования с компонентами, milestone и способом доказательства выполнения.

---

## 1. Правила использования

Каждая implementation task должна ссылаться минимум на один requirement ID из Master Technical Specification.

Каждый requirement перед переводом в `DONE` должен иметь evidence:

- automated test;
- schema/contract test;
- browser/integration test;
- security negative test;
- load/fault test;
- documentation/review evidence — только там, где требование архитектурное, а не runtime.

`Implemented` без evidence не считается выполнением.

---

## 2. Traceability

| Requirement | Область | Основной компонент | Milestone | Обязательное evidence |
|---|---|---|---|---|
| GP-SEC-001..005 | Trust model | Game Registry / Policy | GP-M1 | contract tests + policy matrix |
| GP-FR-001..005 | Game Package / manifest | `@asa-lab/game-sdk`, Registry | GP-M1 | manifest schema + conformance tests |
| GP-FR-010 | Source connection | Creator Platform | GP-M6 | GitHub/ZIP integration tests |
| GP-FR-011 | Immutable Build | Build Service | GP-M6 | build fixture + digest repeatability test |
| GP-SEC-010 | Build isolation | Build Service | GP-M6 | sandbox negative tests |
| GP-NFR-010 | Build resource limits | Build Service | GP-M6 | CPU/RAM/PID/time limit tests |
| GP-FR-012..015 | Release/channels/publication | Release Service | GP-M6 | lifecycle + rollback integration tests |
| GP-FR-020..023 | Game Registry | Game Registry | GP-M1 | registry contract tests + disable/archive tests |
| GP-FR-030..031 | Client SDK | Game Client SDK | GP-M6 | SDK conformance + sandbox demo game |
| GP-SEC-020..023 | Client isolation | GameShell / SDK bridge | GP-M6 | cross-origin/message validation negative tests |
| GP-FR-040..042 | Gaming identity | Games Identity Adapter | GP-M2 | migration/identity mapping tests |
| GP-SEC-030 | Public DTO privacy | Identity/Profile API | GP-M2 | PII/internal-ID negative tests |
| GP-FR-050..054 | Match Core | Match Core | GP-M2 | domain/schema tests + outcome authority tests |
| GP-FR-060..063 | Command Runtime | Command Runtime | GP-M3 | idempotency/version/reconnect tests |
| GP-SEC-040 | Adapter isolation | Command Runtime | GP-M3 | forbidden dependency/boundary tests |
| GP-FR-070..074 | Realtime Room Runtime | Game Runtime | GP-M8 | Arena Mini certification |
| GP-NFR-020..021 | Tick/input limits | Game Runtime | GP-M8 | load + tick-budget tests |
| GP-FR-080..081 | Realtime Gateway | Gateway | GP-M7 | protocol/integration tests |
| GP-NFR-030..031 | Backpressure/transport | Gateway | GP-M7 | slow-consumer + reconnect storm tests |
| GP-FR-090..092 | Room allocation | Room Allocator | GP-M8 | allocation/capacity/health tests |
| GP-SEC-050 | Room credentials | Auth/Gateway/Runtime | GP-M8 | expiry/scope/replay negative tests |
| GP-FR-100..103 | Matchmaking | Matchmaker | GP-M4 | pairing/window/scope/block tests |
| GP-FR-110..113 | Invites/Party/Social | Social Multiplayer | GP-M4 | invite/party/classmate integration tests |
| GP-SEC-060 | Classmate privacy | Social Directory | GP-M4 | classroom-scope negative tests |
| GP-FR-120..124 | Ratings | Rating Service | GP-M5 | deterministic policy + idempotency tests |
| GP-SEC-070 | Rating authority | Rating/Match Core | GP-M5 | forged result/score negative tests |
| GP-FR-130..133 | Stats/Leaderboards | Stats Projector | GP-M5 | rebuild/projection/visibility tests |
| GP-FR-140..143 | History/Replay/Audit | History Service | GP-M5/M8 | command replay + realtime artifact tests |
| GP-FR-150 | Achievements | Achievement Adapter | GP-M5/M6 | catalog/version tests |
| GP-SEC-080 | Achievement authority | Achievement Adapter | GP-M5/M6 | forged unlock negative tests |
| GP-FR-160..162 | Events/Tournaments | Event/Tournament Service | GP-M10 | lifecycle/bracket/event-scope tests |
| GP-FR-170..171 | Developer Portal | Creator UI | GP-M6 | browser flows |
| GP-FR-180 | Admin/Moderation | Games Admin | GP-M6/M10 | browser + permission tests |
| GP-SEC-090 | Emergency disable | Registry/Admin | GP-M6 | disable-with-history-retained test |
| GP-DATA-001..003 | Data model/RLS | PostgreSQL repositories | GP-M2 | migration + runtime-role RLS matrix |
| GP-NFR-040..042 | Transactional outbox | Match Core/Outbox | GP-M2/M5 | atomicity + duplicate delivery tests |
| GP-SEC-100..107 | Untrusted code/runtime security | Build/Sandbox/Runtime | GP-M6/M8 | security certification suite |
| GP-PRIV-001..005 | Child privacy | Registry/Publishing/Analytics | GP-M6 | privacy policy tests + moderation review |
| GP-FR-190..192 | Version compatibility | Registry/Match/Runtime | GP-M1/M2/M8 | compatibility/draining tests |
| GP-API-001 | Generic API boundary | API | all | architecture test/review + endpoint inventory |
| GP-RT-001..002 | Realtime schemas/reconnect | Gateway | GP-M7 | protocol schema + reconnect integration |
| GP-NFR-050 | Observability labels | Observability | GP-M7/M8 | metrics snapshot test |
| GP-NFR-060..063 | Deployment/scaling boundaries | Infra | GP-M7/M8/M10 | compose/deploy tests + provider-independent allocator contract |
| GP-MIG-001 | Chess migration | Chess adapter | GP-M9 | parity + migration + compatibility E2E |
| GP-MIG-002 | Checkers migration | Checkers adapter | GP-M9 | parity + migration + compatibility E2E |
| GP-MIG-003..004 | Compatibility/additive migration | API/Data | GP-M9 | dual-read/cutover/rollback evidence |

---

## 3. Milestone acceptance matrix

### GP-M0 — Architecture acceptance

Must have:

- current-state audit accepted;
- ADR-GAME-001 reviewed;
- ADR-GAME-002 reviewed;
- Master Technical Specification reviewed;
- open questions recorded explicitly;
- no runtime code required.

### GP-M1 — SDK + Registry

Must prove:

```text
manifest validation
capability request/grant distinction
integration mode
trust level
version compatibility metadata
game enable/disable/archive
```

Exit condition:

A fake game can register without importing API/DB infrastructure.

### GP-M2 — Identity + Match Core

Must prove:

```text
stable game player projection
no duplicate auth system
canonical GameMatch
participants/outcomes
events/receipts
RLS
outbox atomicity
public DTO privacy
```

Exit condition:

Generic match can be created/finished and projected without Chess/Checkers-specific columns.

### GP-M3 — Command Runtime

Certification game: **Tic-Tac-Toe**.

Must prove:

```text
generic command endpoint
server rule authority
idempotency
optimistic concurrency
reconnect
history
no game-specific networking service
```

Exit condition:

Tic-Tac-Toe multiplayer works entirely through shared Games infrastructure.

### GP-M4 — Social Multiplayer

Must prove:

```text
private invite
classmate invite
party
quick queue
scope restrictions
blocked-player policy
```

Exit condition:

At least two registered games use the same invite/matchmaker stack.

### GP-M5 — Competitive Services

Must prove:

```text
rating ledger
projection rebuild
profile stats
head-to-head
leaderboard scopes
bot separation
```

Exit condition:

Deleting/rebuilding derived stats reproduces the same results from authoritative data.

### GP-M6 — Creator/Publishing MVP

Must prove:

```text
GitHub or ZIP source
isolated build
immutable GameBuild
GameRelease
channels
rollback
sandbox-web
SDK capabilities
private publication
classroom publication
admin review
```

Exit condition:

A student web game can be imported, built, previewed and published to a class without gaining ASA cookies/internal API access.

### GP-M7 — Realtime Gateway

Must prove:

```text
authenticated websocket
subscriptions
presence
match events
bounded queues
slow consumer handling
reconnect storms
graceful shutdown
```

Exit condition:

Gateway failure/restart does not corrupt durable match truth.

### GP-M8 — Room Runtime

Certification game: **ASA Arena Mini**.

Must prove:

```text
allocator
room token
server authority
input sequencing
30Hz-class tick loop or justified equivalent
snapshot/delta
resync
room crash policy
graceful drain
no per-tick DB dependency
```

Exit condition:

Arena Mini runs 4–8 players through generic room runtime and produces authoritative final result consumed by Games Core.

### GP-M9 — Existing Game Migration

Must prove independently for Chess and Checkers:

```text
feature parity
history compatibility
no data loss
no rating double-application
existing classroom flows preserved or deliberately converged
rollback path
```

Exit condition:

Legacy game-specific online infrastructure is no longer required for new matches.

### GP-M10 — Events / Scale Hardening

Must prove:

```text
event lifecycle
season/tournament
runtime scale-out
cross-instance presence if needed
capacity evidence
operational runbooks
```

Infrastructure such as Redis/Agones/Kafka is introduced only when evidence justifies it.

---

## 4. Security certification matrix

| Threat | Required control | Evidence |
|---|---|---|
| forged match result | server-authoritative outcome | negative API/runtime test |
| duplicate command | command receipt/idempotency | retry test |
| internal ID leakage | public DTO mapping | snapshot/negative test |
| hidden-state leakage | viewer-specific projection | adversarial viewer test |
| malicious iframe | isolated origin + message validation | browser security test |
| malicious build | isolated build + resource limits | sandbox test |
| malicious runtime | non-root/no-secrets/no-DB | container policy test |
| cross-tenant access | RLS + application authz | runtime-role matrix |
| room token theft/replay | short TTL + scope + replay policy | security test |
| websocket flood | rate/size/backpressure limits | load/abuse test |
| leaderboard forgery | authoritative source only | forged score test |
| double rating | unique/idempotent rating event | retry/concurrency test |

---

## 5. Privacy certification matrix

Before any public/community rollout verify:

- student game starts private;
- classroom publication visible only permitted audience;
- public alias does not expose school/class/internal learner mapping;
- analytics fields are allowlisted;
- logs contain no secrets/child-sensitive payload;
- classmate relationship is not globally enumerable;
- moderation can suspend game/release/player interaction without deleting evidence/history.

---

## 6. Documentation consistency gate

Before milestone close:

1. implementation matches Master Technical Specification;
2. traceability row has evidence;
3. ADR status reflects accepted/rejected decisions;
4. Developer Integration Guide matches actual SDK;
5. Package/Publishing spec matches actual build/release model;
6. Testing/Certification document matches CI suites;
7. no documentation claims a capability that is not implemented.

---

## 7. Definition of traceability complete

Traceability is complete when every normative requirement in the Master Technical Specification is either:

```text
IMPLEMENTED + evidence
DEFERRED + approved reason/milestone
REJECTED + ADR/review rationale
NOT_APPLICABLE + justified scope
```

Requirements must not silently disappear during implementation.
