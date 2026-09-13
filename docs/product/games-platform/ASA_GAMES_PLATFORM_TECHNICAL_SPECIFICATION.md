# Техническое задание — ASA Games Platform

**Документ:** Master Technical Specification  
**Статус:** Draft / Proposed  
**Ветка:** `docs/asa-games-platform-architecture`  
**Назначение:** нормативно определить разработку общей игровой платформы ASA Lab до начала реализации новых online-функций конкретных игр.  
**Область:** Games Platform, Creator Platform, Game SDK, Game Packages, multiplayer, realtime, publishing, moderation, ratings, statistics, event games.  
**Связанные документы:**

- `ADR-GAME-001-GAMES-PLATFORM-BOUNDARIES.md`;
- `ADR-GAME-002-GAME-PACKAGES-PUBLISHING-AND-TRUST.md`;
- `ASA_GAMES_PLATFORM_CURRENT_STATE_AUDIT.md`;
- `ASA_GAMES_PLATFORM_NETWORKING_RESEARCH.md`;
- `ASA_GAMES_PLATFORM_DATA_AND_IDENTITY.md`;
- `ASA_GAMES_PLATFORM_PROTOCOLS_AND_RUNTIME.md`;
- `ASA_GAMES_PLATFORM_TECHNOLOGY_OPTIONS.md`;
- `ASA_GAMES_PLATFORM_CRITICAL_ARCHITECTURE_REVIEW.md`;
- `ASA_GAME_PACKAGE_AND_PUBLISHING_SPEC.md`;
- `ASA_GAMES_PLATFORM_DEVELOPER_INTEGRATION_GUIDE.md`;
- `ASA_GAMES_PLATFORM_TESTING_AND_CERTIFICATION.md`;
- `ASA_GAMES_PLATFORM_EXECUTION_PLAN.md`.

---

## 1. Цель разработки

Создать в ASA Lab единую игровую платформу, в которую встроенные, ученические, экспериментальные и будущие сторонние игры подключаются через стабильные контракты и получают общие платформенные возможности без повторной реализации сетевой инфраструктуры.

После реализации разработчик новой игры должен в основном создавать:

- правила или realtime simulation;
- game-specific state;
- client/renderer;
- optional bots;
- optional custom metrics;
- manifest/package metadata.

Платформа должна автоматически предоставлять, если это разрешено capabilities игры:

- идентичность игрока;
- Games Hub;
- lobby/party;
- приглашения;
- одноклассников и разрешённые social relations;
- matchmaking;
- private rooms;
- reconnect;
- match history;
- ratings;
- common statistics;
- leaderboards;
- notifications;
- moderation/reporting;
- tournaments/events;
- observability;
- version/build lifecycle.

---

## 2. Критерий успеха

Платформа считается успешно спроектированной, если новая третья игра не создаёт собственные аналоги:

```text
invites
matchmaking
ratings
history
presence
notifications
reconnect
leaderboards
player identity
```

и проходит платформенную сертификацию только через `GameManifest + Game SDK + game-owned adapter/runtime`.

Обязательные certification games:

1. **Tic-Tac-Toe** — доказывает универсальность command-runtime;
2. **ASA Arena Mini** — доказывает универсальность realtime-room runtime.

Шахматы и шашки мигрируют на общий Games Core только после прохождения обеих certification paths.

---

## 3. Что не входит в цель

Не является целью первой версии:

- создать полный аналог Steam Store с коммерческой дистрибуцией;
- принимать произвольные native `.exe` от учеников;
- разрешать ученическим runtime прямой доступ к ASA database;
- вводить Kafka/Kubernetes/Agones/Redis как обязательную базовую зависимость;
- строить глобальную social network/личные сообщения между детьми;
- гарантировать anti-cheat уровня крупных коммерческих FPS;
- запускать unreviewed third-party server container в production;
- переносить все существующие шахматные/шашечные данные одним destructive release.

---

## 4. Термины

### 4.1. Game Definition

Стабильная идентичность игры в платформе.

Пример:

```text
game_key = checkers
```

### 4.2. Game Build

Неизменяемый результат сборки конкретного source revision.

### 4.3. Game Release

Одобренный набор build/artifact/version metadata, допустимый к публикации.

### 4.4. Release Channel

Канал распространения release:

```text
private
classroom
beta
stable
event
```

### 4.5. Game Publication

Факт доступности release определённой аудитории.

### 4.6. Game Match

Платформенная сущность игровой сессии между участниками.

### 4.7. Command Game

Игра, где authoritative progression происходит дискретными командами.

Примеры: шашки, шахматы, XO, карточные игры.

### 4.8. Realtime Room Game

Игра с серверным simulation loop/tick и частым state synchronization.

Примеры: Arena, shooter, racing, platformer.

### 4.9. Trusted Game

Игра, код которой является частью доверенного ASA release process.

### 4.10. Isolated Game

Игра, запускаемая через sandbox/client isolation и/или отдельный runtime process.

---

## 5. Пользовательские роли

Платформа должна различать минимум следующие роли:

- `player` — обычный игрок;
- `student_creator` — автор ученической игры;
- `teacher_reviewer` — педагог, разрешающий classroom publication;
- `verified_creator` — проверенный внешний/внутренний разработчик;
- `game_moderator` — review/moderation публикаций;
- `platform_admin` — управление платформой;
- `service_runtime` — технический principal runtime/worker.

Роль в Games Platform не должна подменять существующие Account/Principal/Workspace/Classroom модели ASA.

---

# 6. Целевая архитектура

## 6.1. Логические области

```text
ASA Games
├── Creator Platform
│   ├── Source Connectors
│   ├── Build Service
│   ├── Game Package Validator
│   ├── Release/Channel Management
│   └── Developer/Admin Portal
├── Games Control Plane
│   ├── Game Registry
│   ├── Game Player Profile
│   ├── Match Core
│   ├── Invites
│   ├── Parties
│   ├── Social Directory Adapter
│   ├── Matchmaker
│   ├── Rating
│   ├── Statistics
│   ├── History
│   ├── Leaderboards
│   ├── Tournaments/Event Campaigns
│   ├── Moderation
│   └── Notifications
├── Command Runtime
├── Realtime Gateway
├── Realtime Room Runtime
└── Game SDK
    ├── Client SDK
    ├── Server/Adapter SDK
    ├── Runtime Protocol
    └── Testing/Certification SDK
```

## 6.2. Разделение Control Plane и Data Plane

`Games Control Plane` отвечает за жизненный цикл и платформенные возможности.

Gameplay execution не должен быть встроен в matchmaking/rating/profile services.

`Realtime Gateway` не является physics/simulation server.

`Realtime Room Runtime` не является Account/Classroom service.

---

# 7. Классы интеграции игры

Платформа должна поддерживать четыре интеграционных режима.

## 7.1. `platform-native`

Для доверенных встроенных игр ASA.

Примеры:

- Chess;
- Checkers;
- Tic-Tac-Toe certification.

Код может находиться в monorepo и использовать internal typed contracts, но не должен обходить Games Core.

## 7.2. `sandbox-web`

Основной формат для ученических web-игр.

Допустимые технологии:

- HTML/CSS/JS/TS;
- React;
- Canvas;
- Phaser;
- PixiJS;
- Three.js;
- другие браузерные библиотеки после package validation.

Игра запускается в sandboxed iframe/isolated origin и общается с ASA через Client SDK bridge.

## 7.3. `managed-command`

Игра предоставляет rule/command adapter в контролируемом execution environment.

Используется для пользовательских пошаговых multiplayer games.

Runtime не получает прямой доступ к ASA database/secrets.

## 7.4. `isolated-room-runtime`

Для сложных realtime games.

Runtime запускается отдельно и взаимодействует через `ASA Game Room Runtime Protocol`.

В первой версии разрешён только `platform` и `verified` trust level.

---

# 8. Уровни доверия

## GP-SEC-001

Trust level и integration mode являются независимыми характеристиками.

Минимальные trust levels:

```text
platform
verified
classroom
private-draft
```

## GP-SEC-002

`private-draft` не может стать публичным автоматически после push/build.

## GP-SEC-003

`classroom` publication требует policy/approval, связывающий release с разрешённой classroom audience.

## GP-SEC-004

`verified` разрешается только после platform review.

## GP-SEC-005

`platform` используется только для официального ASA code/release process.

---

# 9. Game Package

## GP-FR-001

Каждая новая игра должна иметь стабильный `gameKey`.

## GP-FR-002

Игра должна предоставлять versioned manifest.

Минимальные поля:

```yaml
gameKey:
name:
version:
rulesVersion:
stateSchemaVersion:
integrationMode:
runtimeKind:
topology:
players:
capabilities:
lifecycle:
recovery:
client:
server:
```

## GP-FR-003

Manifest не должен содержать ASA database credentials, internal table names, account secrets, raw session cookies или provider-specific infrastructure objects.

## GP-FR-004

Capabilities в manifest являются **запросом**, а не разрешением.

## GP-FR-005

Фактически доступные capabilities вычисляются как пересечение:

```text
requested capabilities
∩ trust policy
∩ audience policy
∩ platform policy
∩ runtime capability
```

---

# 10. Source, Build, Release, Publication

## GP-FR-010 — Source Connection

Платформа должна поддерживать минимум:

- GitHub repository/branch;
- ZIP upload;
- future ASA Creator workspace.

GitHub connection должна использовать минимально необходимые App permissions.

## GP-FR-011 — Immutable Build

Source revision не запускается напрямую в production.

Pipeline:

```text
Source Revision
→ Isolated Build
→ Validation
→ Tests
→ Security/Dependency Scan
→ SBOM
→ Artifact Digest
→ GameBuild
```

`GameBuild` является immutable.

## GP-SEC-010

Build environment не получает:

- production secrets;
- production DB access;
- Docker socket;
- host filesystem mounts;
- privileged mode;
- ASA session cookies.

## GP-NFR-010

Build имеет ограничения CPU/RAM/PIDs/disk/network/time/output.

## GP-FR-012 — Release

Release ссылается на конкретный immutable build.

## GP-FR-013 — Channels

Минимальные каналы:

```text
private
classroom
beta
stable
event
```

## GP-FR-014 — Rollback

Платформа должна позволять вернуть channel на предыдущий compatible release без пересборки старого artifact.

## GP-FR-015 — Publication

Publication определяет:

- release;
- audience/scope;
- visibility;
- start/end time;
- moderation state.

---

# 11. Game Registry

## GP-FR-020

Game Registry является единственной платформенной точкой регистрации игр.

## GP-FR-021

Game Registry хранит capabilities, integration mode, trust level, active releases/channels и lifecycle state.

## GP-FR-022

Запрещено добавлять отдельную game-specific инфраструктуру matchmaking/rating/invite без отдельного архитектурного решения.

## GP-FR-023

Игра может быть:

```text
draft
enabled
disabled
archived
suspended
```

Отключение новой admission не должно уничтожать историю старых матчей.

---

# 12. Game Client SDK

## GP-FR-030

Sandboxed game взаимодействует с ASA только через versioned Client SDK/bridge.

## GP-SEC-020

Client SDK не предоставляет внутренние Account/Learner/Tenant identifiers.

## GP-FR-031

Базовые namespaces SDK:

```text
player
match
party
invites
storage
leaderboards
achievements
ui
lifecycle
telemetry
```

## GP-SEC-021

Каждый вызов проверяется по granted capabilities.

## GP-SEC-022

Cross-window messaging обязан валидировать:

- origin;
- source window;
- protocol version;
- message schema;
- message size;
- rate limits.

## GP-SEC-023

Sandboxed game не получает ASA auth cookies и не считается trusted same-origin application.

---

# 13. Gaming Identity

## GP-FR-040

Games Platform использует стабильный platform gaming identity, связанный с существующим Account/Principal.

Не создавать вторую независимую систему логина.

## GP-FR-041

Public gaming profile отделён от внутренней identity.

Допустимые public fields:

- public alias;
- avatar;
- game-specific ratings;
- safe public statistics;
- badges/achievements согласно policy.

## GP-SEC-030

Публичный Games DTO не содержит email, classroom internal IDs, school membership, learner identity mapping или другие child-sensitive данные без явной policy.

## GP-FR-042

Переход ученика между классами не должен сбрасывать игровую историю/рейтинг глобального профиля.

---

# 14. Game Match Core

## GP-FR-050

Вся networked игра создаёт canonical `GameMatch`.

Минимальная модель:

```text
id
game_key
game_version
rules_version
runtime_kind
mode
topology
status
rated
rating_pool
scope
created_at
started_at
finished_at
runtime_room_id nullable
```

## GP-FR-051

Участники хранятся отдельно от match.

```text
match_id
participant_kind
player_id/bot_id
seat
team_id
joined_at
left_at
result
placement
score
```

## GP-FR-052

Общая модель не должна иметь game-specific поля вроде `white_player_id`, `black_player_id`, FEN, шашечной клетки или HP.

## GP-FR-053

Outcome поддерживает минимум:

```text
win
loss
draw
completed
dnf
placement
score
team result
```

## GP-FR-054

Клиент не может самостоятельно назначить authoritative match outcome.

---

# 15. Command Runtime

## GP-FR-060

Command games используют versioned command envelope:

```text
commandId
expectedVersion
actor/seat
payload
```

## GP-FR-061

Сервер выполняет:

```text
authz
version check
idempotency check
game adapter validation
apply transition
persist canonical state/events/outbox
acknowledge
```

## GP-FR-062

Повтор одного и того же `commandId` не создаёт повторный ход/результат.

## GP-FR-063

Command game reconnect восстанавливает authoritative state/version и недостающие durable events.

## GP-SEC-040

Game adapter не пишет напрямую rating/statistics/notifications.

---

# 16. Realtime Room Runtime

## GP-FR-070

Realtime game использует server-authoritative room.

## GP-FR-071

Клиент отправляет inputs/intents, а не authoritative position/health/hit/score/result.

## GP-FR-072

Room runtime имеет versioned protocol минимум для:

```text
ROOM_HELLO
ROOM_READY
INPUT
INPUT_ACK
SNAPSHOT
DELTA
GAME_EVENT
RESYNC
MATCH_END
PING
PONG
```

## GP-NFR-020

Runtime manifest задаёт лимиты:

```text
tickRateHz
snapshotRateHz
maxInputRateHz
maxInputBytes
maxSnapshotBytes
maxPlayers
```

## GP-NFR-021

Realtime hot loop не выполняет блокирующий database I/O на каждый tick.

## GP-FR-073

Room state по умолчанию живёт в памяти; persistence зависит от recovery policy:

```text
durable
snapshot
non-recoverable
```

## GP-FR-074

Runtime завершает матч через authenticated server-to-control-plane outcome handoff.

---

# 17. Realtime Gateway

## GP-FR-080

Gateway отвечает за:

- authenticated connections;
- subscriptions;
- presence;
- invites;
- match found/start/finish notifications;
- durable match events;
- reconnect signalling.

## GP-FR-081

Gateway не должен содержать physics/game-specific simulation.

## GP-NFR-030

Gateway имеет bounded outbound queues, slow-consumer policy и reconnect storm protection.

## GP-NFR-031

WebSocket является baseline transport.

WebTransport допускается как future adapter после измеренной необходимости.

---

# 18. Room Allocation

## GP-FR-090

Matchmaking и room placement являются разными операциями.

## GP-FR-091

Для realtime match Control Plane вызывает `GameRoomAllocator`.

Allocator выбирает runtime instance по capability/capacity/health/version constraints.

## GP-FR-092

Runtime выдаёт room endpoint + short-lived room credential.

## GP-SEC-050

Room credential:

- scoped к match/room/player;
- short-lived;
- не является ASA browser session;
- не даёт доступ к Control Plane DB.

---

# 19. Matchmaking

## GP-FR-100

Matchmaker является общим для игр.

Ticket содержит минимум:

```text
game_key
game_version
mode
topology
party_id nullable
scope
rating_pool nullable
skill_estimate nullable
created_at
expires_at
```

## GP-FR-101

Matchmaker учитывает policy:

- game/version compatibility;
- party size;
- scope;
- rating/skill window;
- block/moderation restrictions;
- optional region/latency.

## GP-FR-102

Skill window может расширяться по времени ожидания.

## GP-FR-103

Matchmaking не должен сам запускать game-specific runtime напрямую; он формирует proposal/match group, затем начинается match/placement flow.

---

# 20. Invites, Party и Social Directory

## GP-FR-110

Invite Service общий для игр.

## GP-FR-111

Invite содержит game/mode/settings/sender/recipient/expiry, но не реализует отдельную friend system.

## GP-FR-112

Party является platform entity для совместного matchmaking/командных игр.

## GP-FR-113

Social Directory получает relationships через providers:

```text
Classroom
Recent Opponents
Future Friends
Event Participants
```

## GP-SEC-060

Classmate visibility разрешается policy и не превращается автоматически в глобально публичную информацию.

---

# 21. Ratings

## GP-FR-120

Нет одного общего рейтинга пользователя на все игры.

Rating identity:

```text
game_key + rating_pool + player_id
```

## GP-FR-121

Rating algorithm определяется policy, а не game UI.

Примеры future policies:

```text
duel-glicko-v1
team-rating-v1
placement-v1
none
```

## GP-FR-122

Rating changes фиксируются immutable ledger/event.

## GP-FR-123

Один `(match, player, rating_pool)` не может применить rating update дважды.

## GP-FR-124

Bot matches не меняют human public rating по умолчанию.

## GP-SEC-070

Unverified/client-declared score не влияет на official rating.

---

# 22. Statistics и Leaderboards

## GP-FR-130

Общая статистика строится из authoritative matches/participants/rating events.

Минимум:

- games played;
- wins/draws/losses;
- win rate;
- current/best streak;
- side/team performance;
- head-to-head;
- recent form;
- current/peak rating;
- classroom/recent-opponent comparisons согласно policy.

## GP-FR-131

Game-specific metrics передаются как versioned bounded schema.

## GP-FR-132

Derived statistics являются projection/cache и могут быть rebuild из source of truth.

## GP-FR-133

Leaderboards поддерживают scope минимум:

```text
global/restricted
near-me
classroom
event/tournament
```

с учётом privacy policy.

---

# 23. History, Replay и Audit

## GP-FR-140

Каждый завершённый authoritative match имеет readable history metadata.

## GP-FR-141

Command games должны иметь достаточное durable состояние/commands/events для review/replay согласно game policy.

## GP-FR-142

Realtime replay не обязан хранить каждый tick в PostgreSQL.

При необходимости используется compressed replay artifact/object storage.

## GP-FR-143

Moderation/audit events хранят только необходимый минимум и не должны логировать child-sensitive gameplay payload без необходимости.

---

# 24. Achievements

## GP-FR-150

Game может регистрировать versioned achievement catalog.

## GP-SEC-080

Competitive achievements, зависящие от authoritative результата, подтверждаются сервером.

Client-only achievements должны иметь отдельную trust semantics.

---

# 25. Event Games, Seasons, Tournaments

## GP-FR-160

Game lifecycle поддерживает:

```text
permanent
seasonal
event
```

## GP-FR-161

Event game может иметь `enabled_from/enabled_until`, после завершения исчезает из admission/catalog, но history/results сохраняются.

## GP-FR-162

Tournament является platform entity, а не `<game>_tournament`.

Минимальные formats:

- single elimination;
- round robin;
- future Swiss;
- event-score.

---

# 26. Developer Portal

## GP-FR-170

Creator должен иметь UI для:

- создания Game Definition;
- подключения GitHub/ZIP;
- просмотра builds;
- build logs;
- validation/security results;
- release creation;
- channels;
- preview launch;
- requested/granted capabilities;
- usage/runtime errors;
- deprecation/archive.

## GP-FR-171

Student Creator UI должен быть проще platform developer UI и не показывать недоступные dangerous capabilities.

---

# 27. Admin / Moderation

## GP-FR-180

Games Admin должен иметь:

- pending publication review;
- creator/game/build/release detail;
- capability grant/revoke;
- visibility/channel controls;
- suspend admission;
- emergency disable;
- moderation reports;
- runtime health;
- audit trail.

## GP-SEC-090

Emergency disable не удаляет historical data.

---

# 28. Storage и Data Model

Минимальные логические агрегаты:

```text
game_definitions
game_source_connections
game_builds
game_releases
game_release_channels
game_publications
game_capability_grants

game_player_profiles

game_matches
game_match_participants
game_match_events
game_command_receipts

game_invites
game_parties
game_party_members
game_matchmaking_tickets

game_ratings
game_rating_events

game_metric_records

game_outbox_events
```

Фактическая SQL schema утверждается отдельным migration design review.

## GP-DATA-001

Durable Games data подчиняется существующей ASA tenant/security model и RLS requirements.

## GP-DATA-002

Global/public gaming identity не должна обходить Account/Principal migration strategy.

## GP-DATA-003

Game-specific state допускается JSON/binary/object storage, но Game Core metadata остаётся queryable отдельно.

---

# 29. Transactional Outbox

## GP-NFR-040

Match finish + participant outcome + durable event + outbox фиксируются атомарно в одной транзакции там, где используется PostgreSQL durable path.

## GP-NFR-041

Consumers обязаны быть idempotent.

Consumers:

```text
realtime fanout
rating projector
stats projector
notifications
achievements
analytics
```

## GP-NFR-042

Kafka/NATS/RabbitMQ не являются source of truth.

---

# 30. Security и Sandboxing

## GP-SEC-100

Весь user/third-party game code считается untrusted по умолчанию.

## GP-SEC-101

Sandbox-web работает на isolated origin/iframe sandbox и не получает ASA cookies.

## GP-SEC-102

Arbitrary student Docker runtime запрещён.

## GP-SEC-103

Isolated server runtime допускается только platform/verified trust.

## GP-SEC-104

Runtime container:

- non-root;
- no privileged;
- no Docker socket;
- no host mounts;
- resource limits;
- ephemeral scoped credentials;
- network allowlist/deny-by-default policy;
- no DB password.

## GP-SEC-105

Game server не доверяет client result/score/hit/position.

## GP-SEC-106

Hidden-information games не отправляют hidden authoritative state клиенту с расчётом «frontend просто спрячет».

## GP-SEC-107

Rate limits применяются к SDK, HTTP commands и realtime messages.

---

# 31. Privacy и дети

## GP-PRIV-001

Private by default для student-created game.

## GP-PRIV-002

Публичная publication требует отдельной policy/moderation state.

## GP-PRIV-003

Classroom publication не раскрывает school/class metadata за пределами разрешённого scope.

## GP-PRIV-004

Analytics использует allowlist полей и не принимает arbitrary game payload.

## GP-PRIV-005

Логи не содержат email, auth tokens, hidden student identity mapping и full game content без отдельного justified logging policy.

---

# 32. Versioning и Compatibility

Каждый match фиксирует минимум:

```text
game_key
game_version
rules_version
state_schema_version
protocol_version
runtime_build/release id
```

## GP-FR-190

Активный матч не мигрируется автоматически на incompatible rules/runtime version.

## GP-FR-191

Release compatibility policy обязана определить, какие client/runtime versions могут играть вместе.

## GP-FR-192

Old build может оставаться доступным для draining active matches даже после переключения stable channel.

---

# 33. API

Целевые generic resources:

```text
GET  /api/games
GET  /api/games/:gameKey

POST /api/games/invites
POST /api/games/parties
POST /api/games/matchmaking

GET  /api/games/matches/:matchId
POST /api/games/matches/:matchId/commands
GET  /api/games/matches/:matchId/events
POST /api/games/matches/:matchId/reconnect

GET  /api/games/profile
GET  /api/games/history
GET  /api/games/stats
GET  /api/games/ratings
GET  /api/games/leaderboards
```

Developer/admin APIs проектируются отдельно, но используют те же domain entities.

## GP-API-001

Game-specific endpoint допускается только для genuinely game-specific capability, а не как копия общего Platform API.

---

# 34. Realtime Topics

Control-plane events минимум:

```text
PRESENCE_CHANGED
INVITE_CREATED
INVITE_ACCEPTED
PARTY_CHANGED
MATCHMAKING_STATUS
MATCH_FOUND
MATCH_STARTED
MATCH_EVENT
MATCH_FINISHED
RATING_CHANGED
NOTIFICATION
```

## GP-RT-001

Сообщения versioned и schema-validated.

## GP-RT-002

Reconnect не должен требовать полного logout/login при кратковременном сетевом обрыве.

---

# 35. Observability

Обязательные common metrics:

```text
game_match_create_total
game_match_finish_total
game_match_abort_total
game_active_matches
game_active_players
matchmaking_wait_ms
command_latency_ms
disconnect_total
reconnect_total
```

Realtime дополнительно:

```text
room_active
room_players
runtime_tick_ms
runtime_tick_overrun_total
snapshot_bytes
input_rate
ws_rtt_ms
room_crashes
desync_total
```

## GP-NFR-050

Основные labels:

```text
game_key
game_version
mode
runtime_kind
```

User ID/child identity не используется как high-cardinality telemetry label.

---

# 36. SLO и Capacity

Games Platform наследует общий ASA Capacity/SLO документ и вводит дополнительные game-specific targets.

Для первого L1 pilot:

- 500 concurrent platform users;
- hundreds of websocket connections;
- command P95 target определяется после baseline load tests;
- matchmaking queue time измеряется и публикуется;
- room tick P95 должен оставаться в пределах tick budget выбранной игры;
- reconnect rate/error rate измеряются.

Численные SLO для room runtime утверждаются только после Arena Mini benchmark.

---

# 37. Deployment

## GP-NFR-060

Начальная физическая схема допускает:

```text
postgres
api
web
realtime-gateway
game-runtime
```

Но logical boundaries должны существовать до physical split.

## GP-NFR-061

Redis не нужен для single-instance correctness.

Добавляется при scale-out необходимости distributed presence/pubsub/leases.

## GP-NFR-062

Kafka/Kubernetes/Agones не являются baseline requirement.

## GP-NFR-063

Room allocator contract не зависит от конкретного hosting provider.

---

# 38. Migration существующих игр

## GP-MIG-001 — Chess

`chess-live` рассматривается как donor implementation.

Переиспользуемые идеи:

- idempotency receipts;
- optimistic versioning;
- durable events/sequence;
- matchmaking flow;
- rating ledger;
- reconnect concepts;
- PostgreSQL/RLS discipline.

Не переносить в generic core как есть:

- white/black player columns;
- FEN/SAN/UCI;
- шахматные rating pool names;
- chess-specific clock/result semantics.

## GP-MIG-002 — Checkers

Не создавать отдельный checkers matchmaking/rating/invite backend до появления generic platform layer.

Current rules/bot/UI остаются game-owned.

## GP-MIG-003

Legacy API paths сохраняются compatibility adapters до evidence-backed cutover.

## GP-MIG-004

Migration additive-first, destructive cleanup отдельным поздним этапом.

---

# 39. Certification

Каждая игра проходит подходящий certification profile.

## 39.1 Command certification

Проверяется:

- deterministic/valid transitions;
- server authority;
- idempotency;
- optimistic conflict;
- reconnect;
- outcome;
- hidden state privacy;
- history;
- generic invites/matchmaking/stats integration.

## 39.2 Realtime certification

Дополнительно:

- tick budget;
- input rate/size abuse;
- slow clients;
- packet delay/loss/reorder simulation;
- reconnect/resync;
- room crash;
- graceful drain;
- no trusted client position/health/score;
- no hot-path DB dependency;
- room isolation.

## 39.3 Package/publishing certification

Проверяется:

- manifest;
- build sandbox;
- artifact digest;
- dependency/license inventory;
- capabilities;
- release channels;
- rollback;
- moderation path;
- student privacy.

---

# 40. Developer Workflow

Целевой путь новой game:

```text
create/reserve game
→ implement game
→ validate manifest
→ local ASA simulator
→ connect GitHub/upload
→ build
→ automated certification
→ preview
→ request capabilities/publication
→ review
→ release
→ channel assignment
→ monitor
```

Цель ergonomics:

Разработчик новой игры не должен изучать внутренние таблицы Accounts/Classroom/Ratings для обычной интеграции.

---

# 41. Admin Workflow

```text
Pending Game/Release
→ inspect manifest/source/build
→ inspect scan/tests/SBOM
→ inspect requested capabilities
→ launch preview
→ approve/deny capabilities
→ choose publication scope/channel
→ publish
→ monitor reports/health
→ rollback/suspend if necessary
```

---

# 42. Запрещённые архитектурные паттерны

Запрещено без отдельного ADR:

```text
/api/checkers/matchmaking
/api/chess/invites
/api/new-game/ratings
```

если generic service уже решает эту задачу.

Также запрещено:

- клиент объявляет официальный результат;
- game renderer читает Games DB напрямую;
- game plugin знает password/connection string БД;
- student package запускается privileged;
- game build автоматически становится public stable;
- internal principal/learner IDs показываются как fallback display name;
- realtime physics выполняется внутри main API request handler;
- каждый realtime tick записывается в SQL по умолчанию;
- derived win rate является единственным source of truth;
- rating update можно применить дважды;
- hidden state отправляется неавторизованному viewer;
- новая infrastructure dependency внедряется непосредственно в Game SDK contract.

---

# 43. Этапы реализации

## GP-M0 — Architecture acceptance

- current-state audit;
- ADR-GAME-001;
- ADR-GAME-002;
- master technical specification;
- data model review;
- security/privacy review.

## GP-M1 — Game SDK + Registry

- manifest;
- capability schema;
- integration/trust enums;
- registry;
- conformance tests.

## GP-M2 — Identity + Match Core

- gaming profile projection;
- match/participants/events/receipts;
- outbox;
- PostgreSQL/RLS.

## GP-M3 — Command Runtime

- command adapter;
- generic command endpoint;
- reconnect;
- Tic-Tac-Toe certification.

## GP-M4 — Social multiplayer

- invites;
- parties;
- classmates/recent-opponent directory;
- generic matchmaking.

## GP-M5 — Competitive services

- rating policies;
- rating ledger;
- statistics projections;
- history;
- leaderboards.

## GP-M6 — Creator/Publishing MVP

- Game Definition;
- GitHub/ZIP source;
- build sandbox;
- GameBuild/Release/Channel;
- Developer/Admin UI;
- sandbox-web Client SDK.

## GP-M7 — Realtime Gateway

- WebSocket protocol;
- presence;
- subscriptions;
- fanout;
- reconnect;
- backpressure.

## GP-M8 — Room Runtime

- runtime protocol;
- allocator;
- short-lived room tokens;
- Arena Mini certification.

## GP-M9 — Existing game migration

- Chess adapter/cutover;
- Checkers adapter/cutover;
- compatibility/read migration.

## GP-M10 — Events/Scale Hardening

- campaigns;
- tournaments;
- scale-out coordination;
- optional Redis/advanced allocator;
- verified external runtime path.

---

# 44. Definition of Done всей платформы v1

Games Platform v1 считается готовой, когда одновременно выполнено:

1. Game Registry работает через versioned manifest.
2. Tic-Tac-Toe проходит command certification без собственной сетевой инфраструктуры.
3. Generic invites/matchmaking/history/stats используются минимум двумя game plugins.
4. Sandbox-web game может быть собрана, проверена, опубликована private/classroom и запущена через Client SDK без доступа к ASA cookies/internal APIs.
5. Build/Release/Channel разделены и поддерживают rollback.
6. Capabilities реально enforced, а не только отображаются в manifest.
7. Rating ledger idempotent и server-authoritative.
8. ASA Arena Mini проходит realtime certification через Room Runtime/Allocator.
9. Realtime Gateway имеет backpressure/reconnect/health metrics.
10. Chess и Checkers имеют утверждённые migration adapters или уже используют generic core без потери текущих возможностей.
11. Cross-tenant/privacy negative tests проходят.
12. Student game private-by-default policy работает.
13. Админ может suspend game/release без destructive deletion history.
14. Все production interfaces имеют versioning.
15. Документация и traceability matrix отражают фактическую реализацию.

---

# 45. Открытые решения, которые нельзя скрывать

До реализации должны быть отдельно подтверждены:

1. Точный public gaming identity key относительно Account/Principal/StudentSeat.
2. Правила cross-tenant/global matchmaking для несовершеннолетних.
3. Политика публичных aliases/avatar/profile visibility.
4. Технология managed-command sandbox для user-authored server rules (WASM/WASI или другой ограниченный runtime).
5. Правила external network access для sandbox games.
6. Retention game builds/replays/telemetry.
7. Rating algorithms для duel/team/placement.
8. Moderation workflow для community/public publication.
9. Ownership/licensing rules student-created games/assets.
10. Recovery policy и snapshot interval для rated realtime games.

Открытый вопрос не должен silently превращаться в implementation default.

---

# 46. Change Control

Этот документ становится нормативным только после архитектурного review.

Изменение следующих границ требует ADR или явного amendment:

- trust model;
- game integration modes;
- server authority;
- identity ownership;
- match source of truth;
- runtime families;
- build sandbox boundary;
- rating source of truth;
- public child profile policy;
- direct third-party DB/network access;
- mandatory infrastructure products.

До принятия ТЗ запрещено трактовать Draft как разрешение на массовую реализацию.
