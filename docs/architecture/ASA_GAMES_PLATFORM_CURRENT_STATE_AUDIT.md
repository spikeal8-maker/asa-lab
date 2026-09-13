# ASA Games Platform — Current State Audit

**Status:** Draft research baseline  
**Scope:** фактическое состояние `main` перед проектированием общей игровой платформы  
**Base SHA:** `3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`

## 1. Executive summary

ASA Lab уже содержит значительную часть строительных блоков будущей игровой платформы, но они находятся в разных bounded contexts и пока не образуют общий Games Core.

Самый зрелый online-game код находится в `contexts/chess-live`: там уже реализованы durable challenges, idempotency receipts, optimistic versioning, append-only events, matchmaking tickets, rating state/ledger, reconnect envelope, PostgreSQL repository и HTTP API. Это не следует выбрасывать. Это главный донор для будущего Games Control Plane.

Одновременно `chess-live` жёстко связан с шахматными понятиями (`white/black`, FEN, UCI/SAN, chess result, chess time pools), поэтому его нельзя просто переименовать в `games-live` и считать задачу решённой.

Шашки имеют сильный собственный rules engine и продуктовую Match Session эволюцию, но classroom/online path развивался отдельно. Продолжение отдельного checkers networking увеличит архитектурный долг.

`apps/realtime-gateway` существует, но фактически является placeholder: `health()` возвращает `{ live: true, ready: false }`. Следовательно, realtime data-plane ещё не закреплён несовместимыми решениями и может быть спроектирован как общий игровой gateway.

Production Compose сегодня запускает `postgres`, `migration`, `api`, `web`; отдельные realtime/game-runtime сервисы в production topology отсутствуют. Поэтому Games Platform должна иметь staged deployment plan и не предполагать Kubernetes/Redis/room servers с первого release.

## 2. Existing architectural precedent: Module SDK

`packages/module-sdk` уже использует правильный для Games Platform принцип: Core зависит от framework-independent contracts, а предметный модуль владеет payload, validation, preview и optional analysis.

Полезные свойства текущего `ModuleRegistry`:

- стабильный `moduleKey`;
- versioned manifest;
- explicit availability;
- provider обязательный для active module;
- Core не импортирует предметные реализации;
- registry валидирует manifest при регистрации;
- общий preview contract вынесен из предметной логики.

Это хороший организационный образец, но `module-sdk` не следует расширять сетевой игровой семантикой. Project Module и Online Game — разные capabilities и lifecycle. Целевой `@asa-lab/game-sdk` должен использовать тот же принцип регистрации, но отдельные contracts.

## 3. Chess Live: что уже существует

### 3.1. Domain / application boundary

`contexts/chess-live` уже разделён на:

```text
contexts/chess-live
├── domain
├── application
├── infrastructure
└── testing
```

Публичный barrel экспортирует:

- challenge lifecycle;
- game commands;
- matchmaking;
- rating;
- live protocol;
- application service;
- repository ports;
- memory repository;
- PostgreSQL repository;
- runtime clock/id generators.

Это достаточно зрелая структура и хороший источник будущих generic contracts.

### 3.2. Универсальные идеи внутри Chess Live

Следующие механизмы являются не шахматными и должны рассматриваться как кандидаты на extraction в Games Core:

1. `commandId` и command receipt;
2. stable command fingerprint;
3. idempotent replay;
4. optimistic `expectedVersion`;
5. aggregate `version`;
6. monotonic event `sequence`;
7. durable append-only event log;
8. challenge/invite lifecycle;
9. matchmaking ticket lifecycle;
10. matchmaking pairing transaction;
11. immutable rating ledger;
12. reconnect как snapshot + events after sequence;
13. repository port + memory/Pg implementations;
14. tenant-scoped repository execution;
15. atomic repository operations, где game/ticket/event/receipt должны согласованно измениться.

### 3.3. Шахматные части, которые нельзя поднимать в Core

Текущий `LiveChessGame` содержит:

- `whitePlayerId`, `blackPlayerId`;
- `currentFen`;
- `positionKeys`;
- SAN/UCI move records;
- `Color`;
- chess clock white/black semantics;
- chess result strings (`1-0`, `0-1`, `1/2-1/2`, `*`);
- chess termination types;
- chess time-control rating pools (`bullet`, `blitz`, `rapid`, `classical`, `daily`).

Generic Games Core не должен знать ни одно из этих понятий. Они остаются в Chess adapter/plugin.

### 3.4. Слишком широкая ответственность текущего ChessLiveRepositoryPort

Сегодня один repository port одновременно отвечает за:

- command receipts;
- challenges;
- games;
- events;
- matchmaking tickets;
- ratings;
- rating ledger.

Для одной игры это допустимо, но для платформы создаёт сильную связанность. Целевая архитектура должна разложить ответственность хотя бы логически:

```text
GameCommandReceiptRepository
GameInviteRepository
GameMatchRepository
GameEventRepository
GameMatchmakingRepository
GameRatingRepository
```

Это не означает шесть PostgreSQL connections или шесть микросервисов. В v1 один `PgGamesRepository` может реализовывать несколько портов. Разделение нужно на уровне contracts и тестируемой ответственности.

## 4. Existing Chess persistence

Миграция `migrations/0006_chess_live.sql` уже создаёт production-grade заготовку:

```text
chess_live_challenges
chess_live_games
chess_live_events
chess_live_command_receipts
chess_matchmaking_tickets
chess_ratings
chess_rating_ledger
```

### 4.1. Сильные стороны существующей схемы

- tenant-scoped composite relations;
- `ENABLE` + `FORCE ROW LEVEL SECURITY`;
- runtime access через `app.tenant_id`;
- optimistic versions;
- append-only events;
- append-only rating ledger;
- unique `(tenant_id, command_id)` receipt;
- unique game/player ledger application;
- JSON snapshot рядом с queryable columns;
- отдельные индексы hot paths;
- explicit runtime DB grants.

Эти паттерны нужно сохранить в generic Games schema.

### 4.2. Что в схеме нельзя просто переименовать

`chess_live_games` структурно предполагает ровно двух игроков и шахматные seat names. `chess_matchmaking_tickets` содержит chess rating pools, time controls и color preference. `chess_rating_ledger` предполагает ровно одного opponent и scalar duel outcome.

Для FFA, teams и co-op это не подходит.

Generic schema должна перейти от fixed columns к:

```text
game_matches
game_match_participants
game_events
game_command_receipts
game_invites
game_matchmaking_tickets
game_ratings
game_rating_events
```

с game-specific state/metrics отдельно.

### 4.3. Migration rule

Нельзя destructive-rename текущих chess tables в первом Games Platform release.

Безопасная стратегия:

1. создать additive generic schema;
2. подключить certification games;
3. доказать semantic parity;
4. добавить compatibility adapter для chess-live;
5. backfill historical chess matches/rating ledger;
6. dual-read verification;
7. переключить new chess matches на Games Core;
8. оставить старые tables read-compatible до отдельного cleanup release.

## 5. Checkers baseline

Шашки уже имеют:

- Russian-64 rules engine;
- bot engine;
- local mode;
- classroom game path;
- unified Checkers Match Session foundation для presentation;
- game-first lobby;
- Board V2 и game-feel enhancements;
- планы quick/rated/friend/stats.

Но server-side online lifecycle ещё не является общим Games Core.

Правильный следующий шаг для шашек — не отдельный `checkers-live.controller`, matchmaking и rating. Шашки должны позже реализовать `CommandGameAdapter` и стать consumer Games Platform.

CK-105 foundation полезен как migration adapter, но не определяет общую архитектуру.

## 6. Identity baseline

ASA Lab уже движется от tenant-scoped legacy `users` к global identity:

```text
accounts
profiles
principals
sessions_v2
workspaces
workspace_memberships
legacy_user_account_links
```

`migrations/0010_account_identity_sessions_v2.sql` вводит global account/profile/principal и compatibility links к legacy tenant users.

Нормативный identity transition plan отдельно фиксирует принцип:

> Workspace — продуктовая/access-модель; Tenant — security/storage boundary.

Для Games Platform это означает:

1. игровой player ID нельзя строить на `classroom_membership`;
2. смена класса не должна сбрасывать rating/history;
3. public gaming identity не должна быть legacy `users.id`;
4. класс — relationship/scope, а не identity;
5. public alias/avatar должен быть derived/approved profile view, а не прямой доступ к account row;
6. game services обязаны работать с Principal/Account evolution, не создавая третью независимую identity system.

### 6.1. Предлагаемая identity позиция

Не создавать новый логин или пароль для Games.

Целевая сущность `GamePlayerProfile` является gaming projection существующего Principal/Account:

```text
id                stable public game-player id
principal_id      internal link, never exposed publicly
public_alias
avatar_ref
visibility
created_at
updated_at
```

Для StudentSeat в будущем профиль должен также разрешаться через стабильный principal, когда identity model полностью сойдётся.

## 7. Classroom baseline

Classroom уже является важным источником разрешённых отношений между пользователями. Games Platform должна использовать его как provider:

```text
Classroom Relationship Provider
  → list playable classmates
  → verify shared-class scope
  → classroom leaderboard scope
  → classroom invite policy
```

Games Core не должен копировать membership tables или становиться владельцем classroom access rules.

## 8. API composition baseline

`AppModule.forPool()` сегодня напрямую создаёт:

```text
PgChessLiveRepository / MemoryChessLiveRepository
ChessLiveService
ChessLiveController
```

Это означает, что chess online фактически выполняется внутри основного API process. Для command games это может оставаться допустимым deployment v1.

Важное наблюдение: будущий Games Control Plane не обязан сразу становиться отдельным process. Сначала он может быть bounded context внутри `apps/api`, с чистыми ports/contracts. Физическое выделение в service выполняется только при доказанной operational необходимости.

## 9. Realtime gateway baseline

`apps/realtime-gateway` сейчас содержит только foundation health surface:

```ts
health() => { live: true, ready: false }
```

Следовательно, сейчас нет production WebSocket routing/presence implementation, которую пришлось бы сохранять ради compatibility.

Это позволяет задать gateway responsibility до реализации:

- auth handshake;
- public gaming identity resolution;
- subscriptions;
- presence;
- party/invite/lobby notifications;
- durable match event delivery;
- connection/reconnect signalling;
- bounded queues/backpressure;
- health/metrics.

Gateway НЕ должен владеть game rules, rating updates или realtime physics simulation.

## 10. Deployment baseline

`compose.yaml` содержит:

```text
postgres
migration
api
web
```

`compose.production.yaml` только усиливает production configuration этих же сервисов. `realtime-gateway`, `worker-runtime` и dedicated game runtime в production Compose не подключены.

Отсюда deployment evolution:

### D0 — current

```text
web -> api -> postgres
```

### D1 — command Games Platform

```text
web -> api(Games Control Plane + Command Runtime) -> postgres
```

Без нового обязательного process.

### D2 — realtime notifications

```text
web -> api -> postgres
  \-> realtime-gateway
```

### D3 — realtime room games

```text
web -> api/control-plane -> postgres
  \-> realtime-gateway
  \-> game-runtime
```

### D4 — scale-out, только по измерениям

```text
api xN
realtime-gateway xN
game-runtime xN
optional Redis / placement coordination
```

Kubernetes/Agones не является prerequisite архитектуры.

## 11. Existing capacity/security constraints that Games must inherit

`CAPACITY_AND_SLO.md` уже задаёт L1 цель 500 CCU и 300 API RPS burst и отдельно отслеживает realtime connections, outbound buffer и reconnect storm rate. Games Platform не должна создавать альтернативный capacity model; она расширяет существующий документ game-specific indicators.

`DATA_SECURITY_AND_TENANCY.md` уже требует:

- tenant context only from authenticated server context;
- RLS as second boundary;
- composite tenant FKs;
- runtime role without BYPASSRLS;
- cross-tenant negative tests;
- transactional outbox for async side effects;
- data minimization для детей;
- no direct internal IDs/PII in public surfaces;
- strict input schemas/rate limits.

Games Platform обязана наследовать эти правила.

## 12. Gap analysis

| Capability | Сейчас | Цель |
|---|---|---|
| Game registry | предметный ModuleRegistry | отдельный GameRegistry |
| Command runtime | chess-specific; checkers-specific | generic adapter contract |
| Durable match model | chess-only | multi-game / multi-player |
| Participants | white/black или game-specific | generic seats/teams |
| Invite | chess challenge / checkers class challenge | generic invite service |
| Matchmaking | chess-specific | generic tickets + game policy |
| Rating | chess ASA Elo | pluggable per-game/per-pool policies |
| Stats | fragmented/planned | rebuildable generic projections |
| Public gaming identity | отсутствует как отдельный view | privacy-safe game profile |
| Party | отсутствует | platform capability |
| Realtime gateway | placeholder | authenticated event/presence plane |
| Realtime room server | отсутствует | allocator + room runtime |
| Event games | отсутствует | lifecycle/campaign support |
| Tournament | game-specific/planned | platform entity |
| Isolated third-party game | отсутствует | sandboxed client/runtime contract |

## 13. Reuse decision matrix

### Reuse directly as patterns/contracts

- Module registry design principle;
- tenant/RLS conventions;
- command idempotency pattern;
- optimistic aggregate version;
- event sequence;
- append-only ledger;
- repository transaction pattern;
- existing Account/Principal/Workspace direction;
- existing capacity/security documents.

### Extract/adapt

- chess challenge → generic invite/challenge;
- chess matchmaking ticket → generic matchmaker ticket;
- chess event store → game durable events;
- chess rating ledger → generic rating events;
- chess reconnect envelope → command-runtime reconnect;
- checkers session projection → game shell adapter concept.

### Keep game-specific

- Chess FEN/UCI/SAN;
- chess clocks/pools policy;
- Checkers Russian-64 rules;
- checkers bots;
- board renderers;
- shooter simulation;
- game-specific metrics.

### Do not carry forward

- fixed `white_player_id / black_player_id` in platform tables;
- one-opponent-only rating ledger assumptions;
- platform APIs named by game for generic features;
- direct public exposure of internal participant IDs;
- polling as the intended final realtime delivery model;
- storing high-frequency room state in PostgreSQL every tick.

## 14. Architectural risks before implementation

### R1 — overfitting to board games

Mitigation: certify both Tic-Tac-Toe and ASA Arena Mini before migrating mature chess/checkers.

### R2 — premature microservices

Mitigation: logical bounded contexts first; physical split only where latency/lifecycle requires it.

### R3 — dual identity

Mitigation: GamePlayerProfile must project Principal/Account, not invent auth.

### R4 — public child data leakage

Mitigation: dedicated PublicGameIdentity DTO + privacy/scope policy; no classroom/school metadata by default.

### R5 — rating/stat divergence

Mitigation: immutable match outcomes + rating events; projections rebuildable.

### R6 — realtime simulation overloads API/PostgreSQL

Mitigation: in-memory room runtime; durable lifecycle events only.

### R7 — event delivery dual-write

Mitigation: transactional outbox.

### R8 — generic abstraction becomes too weak or too clever

Mitigation: capabilities are explicit; plugin API has two runtime families instead of one fake universal `applyMove()`.

## 15. GP-000 conclusion

Repository baseline supports building ASA Games Platform incrementally without a destructive rewrite.

The recommended direction is:

1. accept Games Platform boundary ADR;
2. create contracts and GameRegistry without moving chess/checkers runtime;
3. build additive generic data model;
4. prove command platform with a trivial certification game;
5. build realtime gateway/runtime contracts;
6. prove realtime path with ASA Arena Mini;
7. migrate chess via compatibility adapter;
8. migrate checkers;
9. only then retire game-specific duplicate infrastructure.

No production migration should begin until GP-001..GP-003 contracts have been reviewed and accepted.
