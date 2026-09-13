# ASA Games Platform — Testing and Certification Strategy V2

**Статус:** Proposed quality contract  
**Нормативное ТЗ:** `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION_V2.md`  
**Порядок:** `ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md`

---

# 1. Принцип

Unit tests игры отвечают на вопрос «правильно ли работают её правила?». Platform certification отвечает на вопрос:

> может ли эта игра/интеграция безопасно и корректно жить в общей ASA Games Platform без bespoke shared infrastructure?

Ни один пользовательский R-stage не закрывается только unit tests.

---

# 2. Три обязательных proof paths

## A. Command proof — Tic-Tac-Toe

Доказывает generic Match Core/Command Runtime/Quick Match/reconnect/history.

## B. Realtime proof — ASA Arena Mini

Доказывает Gateway/Matchmaker/Allocator/Room Runtime/server authority/teams/failure handling.

Обязательные режимы:

```text
FFA: 4 players
Teams: 2v2
```

## C. Creator proof — Creator Sample Game

Доказывает GitHub/ZIP source → isolated build → immutable release → sandbox Client SDK → private preview → teacher approval → classroom publication → upgrade/rollback.

Chess/Checkers migration не заменяет эти proofs: mature games проверяют compatibility, а certification games проверяют универсальность платформы.

---

# 3. Test pyramid

```text
game/domain unit tests
↓
SDK/manifest/adapter contract tests
↓
Match Core integration
↓
persistence/security/RLS
↓
multi-client browser E2E
↓
fault/reconnect/concurrency
↓
load/soak where applicable
↓
creator sandbox/build security where applicable
```

---

# 4. Evidence policy

Каждый accepted stage фиксирует:

- exact commit SHA;
- exact schema/protocol/game/release versions;
- команды/workflows, которые реально запускались;
- isolated test DB/runtime identity;
- PASS/FAIL/BLOCKED без подмены;
- benchmark environment для performance evidence;
- known limitations;
- rollback/disable procedure.

Skipped/discovered-only test никогда не называется PASS.

---

# 5. R0 architecture verification

R0 требует не runtime tests, а проверяемых решений:

- identity lifecycle matrix;
- cross-workspace security placement model;
- canonical match dimensions;
- match state transition table;
- first-class team model;
- minimal capability vocabulary;
- idempotency/error contract.

R0 не считается закрытым, если ключевой вопрос оставлен как implementation default.

---

# 6. Universal Registry/Manifest tests

Для каждой registered game:

- unique gameKey;
- required versions;
- known runtime kind/topology;
- min/max player consistency;
- capabilities supported by current trust/product stage;
- invalid combination rejected;
- disabled/suspended game cannot admit new match;
- public catalog contains no implementation secrets.

---

# 7. Command adapter certification

Обязательные fixtures:

- deterministic transition where game semantics permit;
- invalid command leaves state/version unchanged;
- seat/turn authorization;
- finished match rejects gameplay command;
- authoritative outcome conversion;
- viewer-specific public projection;
- hidden state never serialized to unauthorized viewer.

Adapter не должен:

- authenticate user;
- write DB directly;
- change rating/stats;
- send WebSocket directly.

---

# 8. Idempotency/concurrency

Для retry-safe mutation:

1. command/action X commits;
2. response is synthetically lost;
3. identical retry returns original effect/receipt;
4. domain effect count remains 1;
5. same idempotency key with different fingerprint returns conflict.

ExpectedVersion race:

- two clients start from V10;
- one commits V11;
- second gets conflict/resync;
- no duplicate event/sequence.

Applies progressively to commands, invites, matchmaking, parties and projectors as stages add them.

---

# 9. Persistence/security tests

Under real restricted runtime DB role:

- authorized row works;
- unauthorized tenant/workspace/class relation denied;
- append-only critical event/rating ledger rejects mutation;
- parent/child security placement mismatch impossible;
- match finish + event + outbox atomic;
- command receipt uniqueness enforced;
- rollback leaves no partial finished match.

If Games Global security domain uses authorization separate from normal tenant RLS, it gets its own negative matrix; disabling RLS is not an acceptable shortcut.

---

# 10. Public identity privacy suite

Fixtures deliberately include:

```text
account id
principal id
learner identity id
email
school id
classroom id
real name
```

Public profile, match, leaderboard, spectator and social DTOs must expose only policy-approved PublicGameIdentity data.

Alias lookup failure never falls back to internal ID.

---

# 11. R1 Checkers Private Online certification

Two independent real browser contexts/accounts:

```text
login A/B
A invite B
B accepts
same match opens
A moves
B receives authoritative state
B moves
simulate duplicate command
simulate version conflict
simulate A disconnect
A reconnects from authoritative snapshot
finish match
both see same outcome/history
```

Additionally:

- Russian-64 forced/backward/multi-capture rules unchanged;
- bot/local behavior not accidentally converted to network/rated;
- unauthorized participant cannot command seat.

R1 PASS only when this journey works end-to-end.

---

# 12. R2 Matchmaker + Tic-Tac-Toe certification

Matchmaker tests:

- compatible pair;
- incompatible game/version/scope not paired;
- one player/ticket not double-paired;
- cancel/pair race deterministic;
- expiry;
- no game rule imports.

Tic-Tac-Toe proof:

- no bespoke online persistence/controller;
- generic Match Core;
- generic command path;
- Quick Match;
- reconnect;
- history;
- public DTO/privacy.

If XO needs duplicate shared networking infrastructure, architecture fails review before R3.

---

# 13. R3 Rating/stats certification

For active Checkers policy:

- deterministic fixture vectors;
- win/loss/draw semantics;
- provisional behavior if enabled;
- server-authoritative source only;
- unique `(match, player, pool)` application;
- projector retry harmless;
- aborted/unrated/bot/local/private-casual excluded according to policy;
- current/peak/history reproducible.

Stats:

1. create authoritative match history;
2. build projection;
3. delete projection;
4. rebuild;
5. compare exact totals;
6. replay duplicate outbox;
7. totals unchanged.

---

# 14. R4 Chess migration certification

Before new-match cutover:

- shadow-map representative legacy games;
- participants/result/termination parity;
- event/version ordering parity;
- rating delta parity;
- old API contract suite passes through compatibility layer;
- active legacy matches not orphaned;
- rollback new admission proven;
- destructive old-table cleanup absent from cutover release.

---

# 15. R5 classroom/social certification

Test matrix:

- same classroom;
- different classroom same workspace;
- different workspace;
- teacher/student;
- recent opponent;
- global public view.

Verify:

- only permitted relation appears;
- invite authorization correct;
- class leaderboard restricted;
- class/school metadata absent globally;
- block/report policy hook works where introduced.

---

# 16. Gateway certification

Authentication/authorization:

- unauthenticated rejected;
- expired credential rejected;
- unauthorized subscription rejected;
- player personal topic bound to player;
- wildcard resource subscription unavailable.

Message safety:

- malformed schema;
- unknown message;
- oversized payload;
- rate flood;
- replay/invalid resource id.

Backpressure:

- bounded memory;
- replaceable state coalesces;
- durable stream forces resync/disconnect rather than silent corruption;
- reconnect storm does not collapse process.

Restart:

- durable Match truth unchanged;
- client resubscribe restores current state/sequence.

---

# 17. R6 Arena authority certification

Malicious client attempts:

```text
set position
set health
set score
claim hit/result
skip cooldown
replay input sequence
flood inputs
```

None directly changes authoritative state outside game rules.

Tick/load measurement:

```text
avg/p95/p99 tick
% overrun
CPU/memory per room
rooms per process
snapshot bytes
input rate
```

Certified room size is based on measurement with safety margin.

---

# 18. R6 allocator/fencing tests

Required:

```text
allocate → ready → connect → active → finish → close
```

Failures:

- allocation timeout;
- runtime unhealthy;
- room never ready;
- runtime dies;
- lease expires;
- stale old runtime callback after reallocation;
- duplicate final callback;
- deployment drain.

A stale `allocationGeneration`/fencing token cannot finish or mutate current match allocation.

---

# 19. R6 network impairment/reconnect

Simulate:

- 50/100/200ms latency;
- jitter;
- backlog/slow consumer;
- browser background/resume;
- short disconnect;
- reconnect;
- runtime resync.

Arena certification includes both FFA and 2v2 to prove canonical team outcomes.

---

# 20. R7 Build/Sandbox threat certification

Build threat cases minimum:

- malicious package install script;
- CPU miner / infinite loop;
- fork/PID exhaustion;
- oversized archive/artifact;
- zip/path traversal/symlink escape;
- SSRF/external network attempt;
- attempt to read production secrets/DB/socket/host filesystem;
- webhook/re-import retry;
- dependency/build failure isolation.

Expected: bounded failure/quarantine, no platform escape.

---

# 21. R7 client sandbox certification

Creator Sample must fail attempts to:

- read ASA cookies;
- reach parent DOM;
- navigate top window without grant;
- access disallowed popup/forms/download/device APIs;
- contact arbitrary external domain by default;
- spoof Client SDK message from wrong origin/source;
- send oversized/flooded bridge messages;
- invoke ungranted capability.

Exact CSP/Permissions Policy/origin model must be tested against real browser, not only static review.

---

# 22. R7 publishing certification — Creator Sample

Full journey:

```text
connect GitHub/ZIP exact source
build in isolation
record digest/SBOM/status
launch private preview
Client SDK public-profile/storage works
teacher approves classroom publication
class opens game
publish compatible next release
switch classroom channel
rollback to previous release without rebuild
suspend new admission
history/release metadata remain readable
```

This is the Creator Platform equivalent of Tic-Tac-Toe/Arena certification.

---

# 23. Fault injection matrix

| Failure | Expected |
|---|---|
| API dies after command commit before response | retry replays one receipt/effect |
| Gateway down | durable command correctness preserved |
| Outbox consumer down | backlog catches up idempotently |
| Rating/stats projector down | finished match truth remains |
| PostgreSQL unavailable | durable success not acknowledged |
| Realtime room dies | recover/abort according to policy, never fabricated result |
| Allocator reassigns room | stale generation fenced |
| Creator build fails maliciously | isolated failure/quarantine |
| Creator release disabled | no new admission; historical metadata retained |

---

# 24. Load/soak policy

R1/R2 command path: representative concurrent matches and retry/reconnect bursts.

Gateway: at least 2x initial expected concurrency before production enablement.

Room Runtime: per-room and aggregate CPU/memory/tick safety margin.

Creator Build: concurrent builds, queue starvation prevention, quota enforcement, repeated create/destroy and storage/log limits.

Realtime/build services entering production require multi-hour soak appropriate to expected operation.

---

# 25. Release gate per stage

A stage requiring runtime behavior is production-ready only when applicable evidence is PASS:

```text
contract/unit
security/privacy negative
schema/migration
multi-client browser E2E
retry/concurrency/reconnect
fault injection
load/soak
observability/alerts
rollback/admission kill switch
documentation matches implementation
```

Green unit tests alone are insufficient.

---

# 26. Completion proof mapping

```text
R1 → real Checkers private network match
R2 → Checkers Quick + Tic-Tac-Toe generic command proof
R3 → rated/stats Checkers
R4 → Chess convergence parity
R5 → classroom social privacy
R6 → Arena FFA + 2v2 realtime proof
R7 → Creator Sample secure publishing proof
```

R8/R9 get dedicated certification only if those conditional stages are explicitly started.