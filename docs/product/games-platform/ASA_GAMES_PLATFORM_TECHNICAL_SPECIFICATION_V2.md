# Техническое задание — ASA Games Platform — Revision 2

**Документ:** Master Technical Specification V2  
**Статус:** Proposed / candidate for architecture acceptance  
**Назначение:** нормативно определить разработку ASA Games Platform так, чтобы каждый этап давал проверяемый пользовательский результат, а платформенные абстракции появлялись только по необходимости.  
**Порядок реализации:** `ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md`.  
**Контроль требований:** `ASA_GAMES_PLATFORM_REQUIREMENTS_TRACEABILITY.md`.

---

# 1. Нормативный статус и приоритет документов

Этот документ заменяет Revision 1 как главное ТЗ Games Platform.

При конфликте документов применяется следующий приоритет:

1. `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION_V2.md` — что система обязана обеспечивать;
2. `ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md` — в каком порядке это разрешено реализовывать;
3. принятые ADR — архитектурные решения конкретных границ;
4. `ASA_GAMES_PLATFORM_REQUIREMENTS_TRACEABILITY.md` — требование → этап → evidence;
5. testing/certification specs — как доказать выполнение;
6. supporting research/audits/older drafts — обоснование, но не разрешение менять scope.

Если старый draft противоречит V2, действует V2.

---

# 2. Главная продуктовая цель

Создать в ASA Lab единую игровую основу, которая сначала улучшает существующие реальные игры — прежде всего шашки и шахматы — и только затем расширяется до realtime и creator-platform возможностей.

Платформа должна устранять дублирование следующих возможностей:

```text
player identity
match lifecycle
invites
matchmaking
reconnect
history
ratings
statistics
leaderboards
notifications
realtime delivery
```

Game-specific код должен сохранять ответственность за:

```text
rules / simulation
game-specific authoritative state
renderer/client
bots
custom metrics
special game UX
```

---

# 3. Принцип поставки результата

## GP-VALUE-001

Разработка идёт вертикальными slices. Каждый этап после R0 обязан давать новое проверяемое действие реальному пользователю.

## GP-VALUE-002

Не допускается больше одного подряд инфраструктурного prerequisite slice без следующего пользовательского результата.

## GP-VALUE-003

Общая абстракция считается подтверждённой только после повторного использования минимум двумя game paths либо одной product game + одной certification game.

## GP-VALUE-004

Успешный merge, unit tests или созданные таблицы не являются пользовательским результатом сами по себе.

## GP-VALUE-005

Перед каждым slice создаётся Delivery Brief:

```text
Result
Why now
User journey
Required platform changes
Required game changes
Schema changes
New dependencies
Evidence plan
Rollback/disable path
Explicit NOT IN SCOPE
```

Если во время реализации возникает необходимость существенно расширить scope, slice останавливается и пересматривается.

---

# 4. Обязательный порядок результатов

```text
R0  Architecture Freeze
R1  Checkers Online — Private Match
R2  Quick Match + Generic Command Proof
R3  Competitive Checkers — Rating/Stats
R4  Chess Convergence
R5  Classroom Social Play
R6  Realtime Platform + Arena Mini
R7  Creator Web Games MVP
R8  Creator Multiplayer Rules — conditional
R9  Events/Tournaments/Scale — demand-driven
```

R8 и R9 не являются обязательными для получения полезного Games Core.

---

# 5. Контрольные продуктовые состояния

## После R1 — первый реальный результат

Два пользователя ASA могут пригласить друг друга и полностью сыграть сетевую партию в шашки с reconnect и history.

## После R3 — Games Core Alpha

Шашки имеют private, quick и rated online play, историю, рейтинг, базовую статистику и leaderboard.

## После R4 — Games Core V1

Шашки и шахматы используют общую платформенную инфраструктуру multiplayer без потери существующей зрелой функциональности.

## После R5 — School Games V1

Разрешённые одноклассники могут находить и приглашать друг друга; classroom leaderboard и H2H используют общую платформу без утечки school/class metadata наружу.

## После R6 — Realtime Games V1

Платформа доказана не только на board/command games: Arena Mini работает через общий Matchmaker → Allocator → Room Runtime.

## После R7 — Creator Web Games V1

Ученическая web-игра проходит source → isolated build → private preview → teacher approval → classroom publication и работает через sandbox + Client SDK.

---

# 6. R0 — архитектурные решения, обязательные до shared SQL/API

R0 не реализует новую игровую функцию. Это единственный допустимый начальный чисто архитектурный этап.

## GP-R0-001 — Gaming Identity

Необходимо зафиксировать:

- какой существующий ASA Principal получает `GamePlayerProfile`;
- поведение Account и StudentSeat;
- сохранение game identity при смене класса/workspace;
- merge/migration behavior;
- suspend/delete/anonymize semantics;
- public-safe identity DTO.

Запрещено создавать вторую независимую систему login/session.

## GP-R0-002 — Games Security Domain / cross-tenant placement

Необходимо решить, где живут global/cross-workspace:

```text
GamePlayerProfile
GameMatch
MatchmakingTicket
Rating
RatingEvent
```

Нельзя помещать cross-workspace match в tenant одного из игроков по умолчанию.

Решение должно сохранить существующую ASA RLS/tenant discipline и иметь отдельные authorization negative tests.

## GP-R0-003 — Canonical Match dimensions

Запрещён перегруженный единый enum `mode` со значениями `friend|rated|classroom|event|...`.

Match обязан иметь независимые измерения минимум:

```text
admission_kind:
  direct | invite | matchmaking | tournament | event | bot | local

competition_kind:
  casual | rated

scope_kind:
  private | classroom | workspace | global | event | tournament

runtime_kind:
  command | realtime_room

topology:
  duel | free_for_all | teams | coop
```

## GP-R0-004 — Match state machine

Должна быть нормативная state machine минимум:

```text
waiting
allocating
ready
active
finishing
finished
cancelled
aborted
```

Для каждого перехода определяются allowed source/target и actor/system authority.

Termination reason — отдельное поле/enum минимум:

```text
normal
rules_outcome
resignation
draw_agreement
timeout
forfeit
disconnect_forfeit
no_show
admin_abort
runtime_lost
```

## GP-R0-005 — Teams first-class

Так как платформа обещает team games, canonical model обязан представлять team independently от individual participants.

Минимальная логическая сущность:

```text
GameMatchTeam
match_id
team_key
result
placement
score
```

Participant ссылается на team при team topology.

## GP-R0-006 — Minimal capability vocabulary

До R1 разрешается утвердить только capabilities, необходимые R1–R4. Creator/device/network capabilities детализируются перед R7.

## R0 Exit Gate

R1 не начинается, пока GP-R0-001..006 не имеют принятых ADR/spec решений и тестируемых acceptance rules.

---

# 7. Общие архитектурные границы

## GP-ARCH-001 — Games Control Plane

Платформа владеет:

```text
Game Registry
Gaming Identity projection
Match Core
Invites
Matchmaking
Ratings
Statistics
History
Leaderboards
Social Directory adapters
Notifications
```

## GP-ARCH-002 — Command Runtime

Для пошаговых/command игр canonical progression идёт через versioned authoritative commands.

## GP-ARCH-003 — Realtime Gateway

Gateway отвечает за auth/subscriptions/fanout/presence/reconnect signalling и не содержит game physics.

## GP-ARCH-004 — Realtime Room Runtime

Fast realtime simulation выполняется в отдельной authoritative room execution model, а не внутри main API request handler.

## GP-ARCH-005 — Modular monolith first

До доказанной необходимости Control Plane остаётся логически модульным внутри существующего API. Не создавать отдельные `rating-service`, `invite-service`, `stats-service` контейнеры без измеренной причины.

## GP-ARCH-006 — No speculative infrastructure

Redis, Kafka, Kubernetes, Agones, WebTransport не являются baseline dependencies.

---

# 8. Canonical Game Registry

## GP-FR-001

Каждая game имеет стабильный `gameKey` и versioned manifest.

Минимум:

```text
gameKey
gameVersion
rulesVersion
stateSchemaVersion
runtimeKind
topology
minPlayers
maxPlayers
capabilities
lifecycle
recovery
```

## GP-FR-002

Registry — единственная platform registration point. Game-specific matchmaking/invite/rating duplication запрещено без отдельного ADR.

## GP-FR-003

Игра может быть `draft | enabled | disabled | archived | suspended`; disable прекращает new admission и не уничтожает history.

## GP-FR-004

Registry contract не содержит PostgreSQL, NestJS, Redis, Docker/Kubernetes provider objects или secrets.

---

# 9. Gaming Identity

## GP-FR-040

`GamePlayerProfile` связан с существующим ASA principal resolver и не создаёт новый login.

## GP-FR-041

Public DTO содержит только безопасные поля:

```text
playerId
displayName
avatarRef optional
approved game-specific rating/stats according to visibility policy
```

## GP-SEC-030

Public/game DTO не содержит email, principal/account/learner IDs, school membership или classroom internal identifiers.

## GP-FR-042

Изменение classroom membership не должно автоматически менять historical gaming identity/rating.

---

# 10. Canonical Match Core

## GP-FR-050

Каждая networked game создаёт canonical `GameMatch`.

Минимум:

```text
id
game_key
game_version
rules_version
state_schema_version
runtime_protocol_version
admission_kind
competition_kind
scope_kind
scope_ref nullable
runtime_kind
topology
status
termination_reason nullable
rating_pool nullable
version
event_sequence
created_at
started_at nullable
finished_at nullable
runtime_room_id nullable
```

## GP-FR-051

Participants хранятся отдельно:

```text
match_id
participant_kind
player_id/bot_id
seat_key
team_id nullable
join_state
result nullable
placement nullable
score nullable
```

## GP-FR-052

Teams являются first-class для team topology.

## GP-FR-053

Generic Core не имеет game-specific колонок FEN, white/black player, шашечных клеток, HP и т.п.

## GP-FR-054

Клиент не может назначить authoritative outcome.

---

# 11. Command Runtime

## GP-FR-060

Command envelope содержит минимум:

```text
commandId
expectedVersion
payload
```

Actor/seat определяется сервером из authenticated participant context, а не доверяется произвольному клиентскому полю.

## GP-FR-061

Server flow:

```text
authenticate/resolve player
authorize match+seat
schema/size validation
idempotency check
expectedVersion check
registered game adapter
persist state/events/receipt/outbox atomically
return authoritative receipt
```

## GP-FR-062

Retry одинакового `commandId` не создаёт второй domain effect.

## GP-FR-063

Reconnect восстанавливает authoritative snapshot/version и доступные durable events.

## GP-SEC-040

Game adapter не пишет ratings/stats/notifications напрямую и не получает DB credentials/session secrets.

---

# 12. R1 — Checkers Online: Private Match

## Пользовательский результат

Пользователь A приглашает B, оба открывают одну партию шашек, видят ходы без reload, переживают кратковременный disconnect и после завершения видят матч в history.

## Обязательный scope

Только минимально необходимое:

- Game Registry entry для Checkers;
- GamePlayerProfile resolver;
- canonical Match/Participant/Team-compatible schema;
- command state/version/receipt/events/outbox;
- private directed invite;
- Checkers `CommandGameAdapter` поверх существующего Russian-64 engine;
- generic command HTTP endpoint;
- минимальная push delivery или bounded temporary polling only if push is explicitly scheduled inside R1;
- reconnect;
- match history;
- multi-client browser acceptance.

## R1 NOT IN SCOPE

```text
rating
quick matchmaking
party
leaderboards
creator platform
Arena
Redis/Kafka
Chess migration
```

## R1 Acceptance

Два независимых real browser sessions/accounts завершают одну authoritative сетевую партию шашек. Duplicate command, version conflict и reconnect проверены. Existing bot/local/rules behavior не регрессирует.

---

# 13. R2 — Quick Match + Generic Command Proof

## Пользовательский результат

В шашках появляется `Быстрая игра`, а Tic-Tac-Toe подключается к тому же Match Core без собственного online stack.

## GP-FR-100 — Matchmaking V1

Generic ticket учитывает game/version, admission, competition, topology, scope и compatible player count.

## GP-FR-101

Один ticket/player не может быть paired в два active matches.

## GP-FR-102

Cancellation/pair race имеет один terminal outcome.

## GP-FR-103

Matchmaker не импортирует game rules.

## R2 Acceptance

- Checkers Quick Match работает между двумя реальными пользователями;
- Tic-Tac-Toe использует generic Match Core/command/reconnect/history;
- у XO нет bespoke invite/match lifecycle repository/controller;
- abstraction reused by ≥2 games.

---

# 14. R3 — Competitive Checkers

## Пользовательский результат

Пользователь может выбрать Rated Match и после партии увидеть изменение рейтинга, профиль, историю, W/D/L и leaderboard.

## GP-FR-120

Rating identity: `player + game + pool + pinned policy version`.

## GP-FR-121

Нет одного cross-game ASA skill rating.

## GP-FR-122

Rating events immutable/idempotent и применяются только после authoritative finished match.

## GP-FR-123

Bot/local/private casual matches не меняют public Checkers rating по умолчанию.

## GP-FR-130

Stats rebuildable из matches/participants/rating events; mutable counter не является единственным source of truth.

## GP-FR-133

Leaderboards privacy-aware и per game/pool/scope.

## R3 Acceptance

Rated Checkers end-to-end проходит в реальных браузерах; retry rating projector не double-apply; leaderboard/profile/history сходятся из authoritative source.

---

# 15. R4 — Chess Convergence

## Пользовательский результат

Chess и Checkers используют общие invites/matchmaking/history/rating infrastructure, при этом существующая зрелая chess функциональность сохранена.

## GP-MIG-001

`chess-live` — donor implementation; не переписывать working rules/live semantics без необходимости.

## GP-MIG-002

Сначала shadow mapping + parity evidence, затем new-game cutover через compatibility adapter.

## GP-MIG-003

Legacy API остаётся compatibility surface до evidence-backed cutover.

## GP-MIG-004

Migration additive-first; destructive cleanup — отдельный поздний release.

## R4 Acceptance

Representative existing chess games/events/ratings shadow-map без semantic loss; new chess match может использовать Games Core; rollback new admission возможен без потери старой истории.

---

# 16. R5 — Classroom Social Play

## Пользовательский результат

Разрешённый пользователь видит доступных одноклассников/недавних соперников, может пригласить их; classroom leaderboard и H2H не раскрывают образовательный контекст глобально.

## GP-FR-110

Invite Service остаётся generic.

## GP-FR-112

Party вводится только в минимальном объёме, необходимом будущему team/realtime flow; duel games не обязаны использовать party.

## GP-FR-113

Social Directory использует providers `Classroom`, `Recent Opponents`, future `Friends/Event` и не владеет classroom membership.

## GP-SEC-060

Classroom relationship не является global-public metadata.

## R5 Acceptance

Cross-class/cross-tenant negative tests проходят; teacher/student visibility policy доказана real browser flows; глобальный public DTO не содержит school/class membership.

---

# 17. Realtime Gateway

Gateway вводится только когда push UX и/или R6 требуют его; HTTP remains authoritative for command correctness.

## GP-FR-080

Gateway: authenticated connections, typed authorized subscriptions, invites/match events/presence/reconnect signalling.

## GP-FR-081

Game physics/simulation запрещены внутри Gateway.

## GP-NFR-030

Bounded queues, slow-consumer policy, heartbeat, reconnect storm protection обязательны.

## GP-NFR-031

WebSocket baseline; WebTransport — future adapter после измеренной необходимости.

---

# 18. R6 — Realtime Platform + Arena Mini

## Пользовательский результат

4 пользователя запускают Arena Mini через общий queue → match → allocator → room, двигаются/набирают authoritative score, reconnect и получают итог/history.

Certification modes минимум:

```text
FFA: 4 players
Teams: 2v2
```

## GP-FR-070

Room server authoritative: client sends input/intents, не position/health/hit/score/result.

## GP-FR-072

Versioned room protocol поддерживает hello/input/ack/snapshot-or-delta/resync/game-event/match-end/ping-pong.

## GP-FR-090

Matchmaking и room placement — разные операции.

## GP-FR-091

Allocator provider-neutral.

## GP-FR-092

Room credential short-lived и scoped к match/room/player/seat/role.

## GP-RT-LEASE-001

Allocation имеет `allocationGeneration`/lease/fencing semantics. Control Plane принимает authoritative runtime callbacks только от актуальной allocation generation.

## GP-NFR-020

Tick/snapshot/input/player limits декларируются и benchmarked.

## GP-NFR-021

Hot tick path не делает blocking SQL I/O каждый tick.

## R6 Acceptance

Arena FFA + 2v2 проходят room authority, reconnect, runtime crash/abort policy, slow client и load/tick-budget certification.

---

# 19. R7 — Creator Web Games MVP

## Пользовательский результат

Ученик подключает GitHub/ZIP web-игру, получает isolated build/private preview, педагог одобряет classroom publication, класс запускает игру в sandbox через Client SDK. Предыдущий release можно вернуть без rebuild.

## GP-CREATOR-001

`Source ≠ Build ≠ Release ≠ Publication`.

## GP-CREATOR-002

GitHub source pinned exact commit; production никогда не запускает repository checkout напрямую.

## GP-SEC-010

Builder не получает production secrets/DB/session/Docker socket/privileged host access.

## GP-SEC-101

Student/community client запускается на isolated game-content origin в sandboxed iframe, без ASA auth cookies/parent DOM access.

## GP-CAP-001

Manifest capability request не является grant. Grant привязан минимум к game/release/audience/policy version и может быть revoked.

## GP-CAP-002

R7 обязан иметь versioned minimal capability catalog для:

```text
player.public_profile.read
storage.private.read
storage.private.write
ui.exit
telemetry.error
```

Дополнительные network/device capabilities denied by default до отдельного review.

## GP-NET-001

External network access для untrusted creator game запрещён по умолчанию и требует отдельного reviewed capability/allowlist.

## GP-OWN-001

До classroom/community publication должна существовать creator ownership model (`principal|workspace|platform`) и contributor/reviewer authority.

## GP-QUOTA-001

Creator build/storage/log/runtime resources имеют явные quotas/limits; unlimited creator resources запрещены.

## R7 Acceptance

Creator Sample Game проходит GitHub import → build → preview → teacher approval → classroom release → SDK storage → new release → rollback. Cross-origin/cookie/DOM/network negative tests проходят.

---

# 20. R8 — Creator Multiplayer Rules — conditional

R8 начинается только при доказанном product demand после R7.

Необходимо отдельное ADR managed-command sandbox.

До его принятия нельзя обещать user-authored server logic как production capability.

Sandbox обязан определить:

```text
execution technology
host functions
CPU/memory/time limits
state/command limits
network/filesystem policy
random/time semantics
determinism expectations
crash behavior
versioning
```

WASM/WASI — candidate, но не нормативная технология до prototype + ADR.

---

# 21. R9 — Events/Tournaments/Scale — demand-driven

Добавляются только capabilities, необходимые конкретному product use case.

Не вводить заранее:

```text
Kafka
Kubernetes
Agones
regional fleet
Swiss tournaments
native game distribution
marketplace/payments
voice chat
Steam-like DRM
```

Каждая новая infrastructure dependency требует measured bottleneck, benchmark и rollback plan.

---

# 22. Transactional consistency

## GP-NFR-040

Там, где match durability в PostgreSQL, finish + outcomes + durable event + outbox фиксируются атомарно.

## GP-NFR-041

Outbox consumers idempotent.

## GP-NFR-042

Message broker никогда не является единственным source of truth матча/рейтинга.

---

# 23. History, events and replay

## GP-FR-140

Каждый authoritative finished match имеет readable history metadata.

## GP-FR-141

Command game хранит достаточно authoritative state/events для review/reconnect/replay policy.

## GP-FR-142

Realtime tick history не пишется в PostgreSQL по умолчанию; replay при необходимости — отдельный bounded artifact.

---

# 24. Security/privacy invariants

## GP-SEC-100

User/third-party game code untrusted by default.

## GP-SEC-102

Arbitrary student Docker/native executable не входит в v1.

## GP-SEC-105

Competitive result/score/rating never trusted from client-only claim.

## GP-SEC-106

Hidden authoritative state не отправляется viewer, которому оно не разрешено.

## GP-PRIV-001

Student-created content private by default.

## GP-PRIV-002

Classroom/community publication требует явной policy/review state.

## GP-PRIV-004

Analytics/logging — allowlist; arbitrary gameplay payload не попадает в платформенные логи автоматически.

---

# 25. API implementation rules

API contracts детализируются непосредственно перед slice, который их использует.

Каждый production endpoint должен иметь:

```text
request schema
response schema
authz policy
idempotency semantics if mutation
error taxonomy
payload limit
rate limit
OpenAPI/contract tests
```

Минимальная generic namespace: `/api/games`.

Game-specific endpoint допускается только для genuinely game-specific capability.

---

# 26. Error/idempotency minimum

До R1 необходимо определить machine-readable errors минимум:

```text
UNAUTHORIZED
FORBIDDEN
CAPABILITY_DENIED
NOT_FOUND
VALIDATION_FAILED
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
MATCH_FINISHED
INVITE_EXPIRED
RATE_LIMITED
```

Retry-safe mutations используют единый idempotency contract.

---

# 27. Resource limits

Каждый новый execution surface обязан иметь bounded resource policy.

До R1:

```text
command payload
command rate
history/events page size
```

До R6:

```text
connections/player
inputs/sec
snapshot bytes
players/room
rooms/runtime
CPU/memory
```

До R7:

```text
builds/day
build CPU/RAM/time/PIDs
artifact size
storage quota
log volume
network egress policy
```

---

# 28. Testing and evidence

## GP-QA-001

Multiplayer user slice не закрывается unit tests alone.

## GP-QA-002

Required evidence выбирается по slice:

```text
contract/unit
restricted-role RLS/security negative
multi-client browser E2E
retry/concurrency/reconnect
fault injection
load/soak for realtime/build surfaces
```

## GP-QA-003

Нельзя заявлять PASS теста, который не запускался или был skipped.

## GP-QA-004

Каждый результат фиксирует exact commit, schema/protocol/game versions, test environment и known limitations.

---

# 29. Change control and bot/agent rules

## GP-GOV-001

Bot/agent получает один bounded Delivery Brief и не расширяет scope самостоятельно.

## GP-GOV-002

Unrelated defect/refactor фиксируется отдельно. Исправляется внутри slice только если блокирует acceptance либо отдельно разрешён owner.

## GP-GOV-003

Merge, schema migration, feature enablement и production deploy — разные действия.

## GP-GOV-004

Existing Chess/Checkers rules, bots, saves и mature behavior не переписываются без evidence необходимости.

## GP-GOV-005

Если реализация требует изменить R0 boundary, работа останавливается и возвращается на architecture review.

---

# 30. Definition of Done по продуктовым уровням

## Games Core Alpha — после R3

Готово, когда:

1. private Checkers online работает;
2. Quick Match работает;
3. XO подтверждает generic command path;
4. Rated Checkers/rating/stats/leaderboard работают;
5. retry/reconnect/history доказаны real multi-client evidence.

## Games Core V1 — после R4

Дополнительно:

1. Chess использует generic platform path для новых матчей или evidence-backed compatibility delegation;
2. existing chess semantics/history не потеряны;
3. Checkers/Chess не имеют параллельных новых generic service implementations.

## School Games V1 — после R5

Дополнительно classmates/social scope работает без privacy leakage.

## Realtime Games V1 — после R6

Arena Mini FFA+2v2 проходит allocator/room authority/load/failure certification.

## Creator Web Games V1 — после R7

Creator Sample проходит secure publishing pipeline и classroom launch.

Полезность Games Platform не зависит от выполнения R8/R9.

---

# 31. Что сознательно отложено

До возникновения конкретного спроса/нагрузки не реализуются:

- arbitrary student server containers;
- public creator marketplace;
- monetization;
- native desktop game distribution;
- global friends/private chat;
- WebTransport;
- Agones/Kubernetes;
- Kafka;
- advanced cross-region placement;
- full realtime replay;
- sophisticated FPS anti-cheat;
- many rating algorithms;
- Swiss tournament engine.

---

# 32. Acceptance of this specification

V2 может получить статус `Accepted for implementation`, когда:

1. R0-001..006 закрыты принятыми решениями;
2. Value Delivery Plan согласован как единственный порядок работ;
3. Traceability использует R0–R9, а не старые горизонтальные GP-M milestones;
4. старый Execution Plan не противоречит V2;
5. Testing/Certification содержит три proof paths: Command, Realtime, Creator Sandbox;
6. документационный индекс однозначно указывает нормативные документы;
7. никаких runtime/schema изменений не сделано под неутверждённые R0 решения.

До этого статуса допустима только документационная/исследовательская работа R0.