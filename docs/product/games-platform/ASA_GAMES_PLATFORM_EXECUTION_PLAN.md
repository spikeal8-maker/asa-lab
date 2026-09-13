# ASA Games Platform — Execution Plan V2

**Статус:** Proposed execution decomposition  
**Нормативный порядок:** `ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md`  
**Главное ТЗ:** `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION_V2.md`

Этот документ НЕ задаёт отдельный roadmap. Он только разбивает `R0–R9` на bounded implementation tasks.

---

# 1. Правила выполнения

1. Выполняется только текущий R-stage.
2. Каждый task ссылается на конкретные требования V2.
3. Один task не расширяет scope соседних stages.
4. Existing Checkers/Chess rules/bots/UI не переписываются без необходимости.
5. Merge != migration != feature enablement != production deploy.
6. Не больше одного инфраструктурного prerequisite подряд без пользовательского результата.
7. Любая новая shared abstraction должна получить повторное использование/сертификацию до дальнейшего расширения.
8. Redis/Kafka/Kubernetes/Agones/WebTransport запрещены как baseline dependency без отдельного measured justification.
9. Реальный multiplayer stage не считается завершённым без multi-client evidence.
10. Если найдено противоречие с R0 boundary, работа останавливается и возвращается на architecture review.

---

# 2. R0 — Architecture Freeze

## R0-001 Gaming Identity ADR

Закрыть `GP-R0-001`:

- principal → GamePlayerProfile mapping;
- Account/StudentSeat behavior;
- migration/merge;
- suspend/delete/anonymize;
- public-safe DTO;
- no second login system.

**Exit:** identity contract accepted; schema implementation ещё не требуется.

## R0-002 Games Security Domain ADR

Закрыть `GP-R0-002`:

- global/cross-workspace match placement;
- rating/ticket/profile storage boundary;
- classroom/tenant authorization bridge;
- RLS/global authorization model;
- negative-test strategy.

**Exit:** запрещено оставлять решение «возьмём tenant одного игрока».

## R0-003 Canonical Match ADR

Закрыть `GP-R0-003..005`:

- independent dimensions admission/competition/scope/runtime/topology;
- state machine;
- termination reasons;
- first-class teams;
- participant model;
- no game-specific columns.

## R0-004 Minimal Capability Vocabulary

Закрыть `GP-R0-006` только для R1–R4.

Не проектировать весь creator/device/network permission catalog заранее.

## R0-005 Error and idempotency contract

До R1 определить:

- request idempotency key convention;
- commandId semantics;
- machine-readable error taxonomy;
- version conflict behavior;
- rate/payload baseline.

## R0 Acceptance

- 4 решения выше review-accepted;
- Master V2 + Value Plan + Traceability согласованы;
- ни одной общей Games SQL migration ещё не создано на предположениях;
- следующий Delivery Brief — R1.

---

# 3. R1 — Checkers Online: Private Match

**Пользовательский результат:** A приглашает B и оба завершают сетевую партию шашек.

## R1-001 Minimal Game Registry

Только необходимые функции:

- register `checkers`;
- pinned versions;
- command runtime capability;
- enable/disable admission.

Не строить creator registry/release channels.

## R1-002 GamePlayerProfile persistence/resolver

Реализовать только принятый R0 identity contract.

Tests:

- same principal resolves stable profile;
- class change does not change profile;
- public DTO redaction;
- suspend path.

## R1-003 Minimal Match persistence

Additive schema:

- game_matches;
- game_match_participants;
- game_match_teams if topology teams support is required by canonical schema;
- command state;
- game events;
- command receipts;
- outbox.

Tests:

- clean/existing DB migration;
- restricted-role authorization/RLS;
- append-only events;
- expectedVersion race;
- atomic finish+outbox.

## R1-004 Match application service

Minimal lifecycle needed by private duel:

```text
create/wait
start
apply command
finish
cancel/abort
reconnect
history
```

## R1-005 Checkers CommandGameAdapter

Reuse current Russian-64 rules and CK-105 session foundation where useful.

Forbidden:

- rules rewrite;
- second rules engine;
- rating logic;
- quick queue.

## R1-006 Generic private invite

Directed invite only.

Need:

- create;
- accept;
- decline/cancel/expiry;
- accept creates one match;
- retry safe.

Link/public-code invite can wait unless required by agreed R1 UX.

## R1-007 Checkers online UI

First screen should make `Играть с другом` discoverable.

User journey:

```text
A invite
B receives/opens
same match
moves synchronize
finish
history
```

## R1-008 Delivery/reconnect

Use smallest safe delivery mechanism.

Correctness remains HTTP/snapshot authoritative. If minimal WebSocket push is introduced, do not build full Gateway features not required by R1.

## R1-009 Browser acceptance

Two isolated accounts/browser contexts:

- invite;
- accept;
- move A/B;
- forced capture/multi-capture preserved;
- duplicate request;
- version conflict;
- disconnect/reconnect;
- finish;
- history same result both sides.

## R1 Exit

User result demonstrated. No claim of Quick/Rating/Creator/Realtimes.

---

# 4. R2 — Quick Match + Generic Command Proof

**Пользовательский результат:** Checkers Quick Match + Tic-Tac-Toe on same core.

## R2-001 Generic Matchmaking Duel V1

Only duel/casual first:

- join;
- cancel;
- expiry;
- pair;
- version/scope compatibility;
- one active compatible ticket;
- pair race protection.

No team/region complexity unless test fixture requires representability only.

## R2-002 Checkers Quick Match

Wire existing Checkers adapter into generic matcher.

## R2-003 Tic-Tac-Toe certification

Implement minimal:

- rules;
- adapter;
- renderer;
- no bespoke network repository/controller.

Must reuse:

- Registry;
- Match Core;
- commands;
- reconnect;
- history;
- Quick Match.

## R2-004 Abstraction review

If XO requires game-name branches or duplicate services, stop and simplify architecture before R3.

## R2 Exit

Quick Match demonstrated in Checkers and generic command core proven by second game.

---

# 5. R3 — Competitive Checkers

**Пользовательский результат:** Rated Checkers + profile/stats/leaderboard.

## R3-001 Rating policy interface

Implement generic pinned policy contract.

Only production policy needed now: Checkers standard rated duel.

Do not implement multiple speculative algorithms.

## R3-002 Immutable rating events/current state

- server-authoritative finished match only;
- unique match/player/pool application;
- current/peak/provisional as needed;
- retry safe.

## R3-003 Stats projections

Minimum Checkers product:

- games;
- W/D/L;
- win rate;
- current/best streak;
- recent form;
- light/dark split;
- current/peak rating;
- H2H where allowed.

## R3-004 Checkers Rated Match

Generic matcher uses competition_kind=rated and rating pool.

## R3-005 Profile/History/Leaderboard UI

Deliver usable Checkers profile.

## R3-006 Competitive E2E

- rated pairing;
- authoritative result;
- delta shown;
- projector retry;
- no double rate;
- bot/local/private casual excluded;
- leaderboard converges.

## R3 Exit — Games Core Alpha

Checkers online is independently useful even if later stages are never built.

---

# 6. R4 — Chess Convergence

**Пользовательский результат:** Chess and Checkers share platform services.

## R4-001 Chess mapping/parity study

Map existing `chess-live` concepts:

Generic donor:

- receipts;
- versions;
- event sequence;
- matchmaking patterns;
- rating ledger;
- reconnect.

Chess-owned:

- white/black semantics;
- FEN/SAN/UCI;
- chess clock/rating pool semantics.

## R4-002 Chess Command adapter

Wrap mature chess logic without rewriting behavior.

## R4-003 Shadow projection

Representative existing games/events/ratings → generic model.

Must compare:

- participants;
- result/termination;
- command/event ordering;
- rating deltas;
- history counts.

## R4-004 Compatibility delegation

New chess matches may use Games Core behind existing API contract.

## R4-005 Cutover/rollback evidence

No destructive legacy cleanup.

## R4 Exit — Games Core V1

Two mature games use the platform without duplicate new generic services.

---

# 7. R5 — Classroom Social Play

**Пользовательский результат:** classmates/recent opponents discovery + invites + classroom leaderboard/H2H.

## R5-001 Social Directory providers

- Classroom provider;
- Recent Opponents provider.

No hidden friend graph.

## R5-002 Privacy policy matrix

Test:

- same class;
- different class;
- different tenant/workspace;
- teacher/student;
- global public projection.

## R5-003 Incoming challenge notifications

Use platform delivery path; no game-specific polling loops.

## R5-004 Classroom leaderboard/H2H

Restricted scope only.

## R5 Exit — School Games V1

Checkers and Chess both gain the same classroom social layer.

---

# 8. R6 — Realtime Platform + Arena Mini

**Пользовательский результат:** 4-player FFA and 2v2 Arena sessions work online.

## R6-001 Realtime Gateway V1

Implement only required control-plane realtime:

- auth;
- typed subscriptions;
- match/invite notifications;
- presence where product uses it;
- bounded queues;
- reconnect/resubscribe;
- health/metrics.

## R6-002 Room Runtime Protocol V1

Language-neutral logical protocol:

- HELLO/WELCOME;
- INPUT/ACK;
- SNAPSHOT/DELTA;
- RESYNC;
- GAME_EVENT;
- MATCH_END;
- PING/PONG.

## R6-003 Room credentials

Short-lived signed scoped token.

## R6-004 Allocator V1 + fencing

First implementation may use one runtime, but contract includes:

- allocationGeneration;
- lease/fencing token;
- version/capacity/health checks;
- authoritative callback validation;
- release/lost/timeout behavior.

## R6-005 `game-runtime` initial service

No account DB/session secrets; resource limits; health; metrics.

## R6-006 Arena Mini FFA

4 players, simple movement/objective/60-second round.

## R6-007 Arena Mini 2v2

Prove first-class team semantics and party/team outcome path.

## R6-008 Failure/load certification

- malicious position/score claim rejected;
- reconnect;
- slow consumer;
- room crash;
- stale allocator callback fenced;
- tick budget/load;
- outcome to Match Core.

## R6 Exit — Realtime Games V1

Platform is proven beyond board games.

---

# 9. R7 — Creator Web Games MVP

**Пользовательский результат:** student web game safely published to classroom.

## R7-001 Creator ownership model

Owner:

```text
principal | workspace | platform
```

Define contributor/reviewer authority and account/class change behavior.

## R7-002 Capability catalog V1

Minimum only:

- public profile read;
- private storage read/write;
- UI exit/lifecycle;
- error telemetry.

Network/device access deny by default.

## R7-003 GitHub/ZIP source connectors

Least privilege; exact revision/digest.

## R7-004 Isolated Build Service

Threat model + controls:

- no prod secrets;
- no DB;
- no Docker socket;
- non-privileged;
- CPU/RAM/PID/time/disk/output limits;
- network deny/restricted mirror;
- manifest/tests/SBOM/digest.

## R7-005 Build/Release/Channel/Publication

Immutable artifacts; private/classroom channels; rollback without rebuild.

## R7-006 Sandbox web origin

Decide exact origin model and sandbox/CSP/Permissions Policy/storage/service-worker rules.

## R7-007 Client SDK/bridge V1

Strict origin/source/schema/rate/capability checks.

## R7-008 Game Storage Contract V1

Define:

- private-player namespace;
- quotas;
- creator read policy;
- schema/version behavior;
- deletion/retention.

## R7-009 Teacher/Admin review flow

Private → classroom only for MVP.

Community/public store remains out of scope.

## R7-010 Creator Sample certification

GitHub import → build → preview → approval → classroom launch → save → new release → rollback.

## R7 Exit — Creator Web Games V1

A student game works without trusted ASA source import/cookies/DB access.

---

# 10. R8 — Creator Multiplayer Rules — conditional

No implementation until owner confirms product demand.

If started:

1. threat model;
2. managed-command sandbox ADR;
3. feasibility prototype (WASM/WASI candidate);
4. deterministic resource-limited host contract;
5. hidden-state certification fixture;
6. only then user-authored network rules.

---

# 11. R9 — Events/Tournaments/Scale — demand-driven

Implement only real product needs.

Potential tasks are not backlog commitments:

- campaigns;
- tournament formats;
- Redis scale coordination;
- runtime pool/Agones adapter;
- WebTransport;
- regional placement;
- verified external room runtime;
- community creator publication.

Each requires new Delivery Brief and measured justification.

---

# 12. Cross-cutting gates

Every relevant task checks:

```text
identity/privacy
scope authorization
idempotency/concurrency
server authority
compatibility/versioning
resource bounds
observability
rollback/disable
```

No task may claim a capability whose end-to-end acceptance stage is incomplete.

---

# 13. Evidence policy

For each R-stage record:

- exact branch/commit SHA;
- exact migration/schema/protocol/game versions;
- tests actually executed;
- isolated DB/runtime identities;
- screenshots/artifacts only when they prove user behavior;
- load environment for benchmarks;
- blocked/skipped honestly;
- known limitations;
- rollback/feature-off procedure.

---

# 14. Product completion checkpoints

```text
R1  Working private network Checkers
R3  Games Core Alpha
R4  Games Core V1
R5  School Games V1
R6  Realtime Games V1
R7  Creator Web Games V1
```

R8/R9 are optional extensions and must not delay recognition/use of earlier completed products.