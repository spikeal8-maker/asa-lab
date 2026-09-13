# ASA Games Platform — Value-Driven Delivery Plan

**Статус:** Proposed execution contract  
**Назначение:** определить порядок разработки ASA Games Platform так, чтобы каждый этап давал проверяемый пользовательский результат и не превращался в бесконечное строительство инфраструктуры.  
**Связанное ТЗ:** `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION.md`  
**Правило:** этот документ задаёт порядок реализации. Архитектурные ADR и Master Technical Specification задают границы и требования, но не являются разрешением реализовывать всё сразу.

---

## 1. Основной принцип

ASA Games Platform развивается **вертикальными результатами**, а не горизонтальными слоями.

Запрещён подход:

```text
сначала сделать все таблицы
→ потом все SDK
→ потом все сервисы
→ потом весь realtime
→ потом все рейтинги
→ потом когда-нибудь подключить игру
```

Обязательный подход:

```text
минимальный общий фундамент
→ реальная работающая игровая возможность
→ доказательство
→ следующий минимальный общий фундамент
→ следующая работающая возможность
```

Платформенная абстракция добавляется только тогда, когда она нужна текущему или следующему пользовательскому результату.

---

## 2. Value Gate

Каждый этап обязан отвечать на вопрос:

> Что после этого этапа сможет сделать реальный пользователь, чего он не мог делать до этапа?

Этап без пользовательского результата допускается только как короткий обязательный prerequisite непосредственно перед следующим вертикальным slice.

Не допускается больше одного подряд инфраструктурного этапа без пользовательского результата.

Пример допустимого prerequisite:

```text
R0: зафиксировать identity/match security boundaries
↓
R1: два пользователя реально играют в шашки по сети
```

Пример недопустимой цепочки:

```text
Registry
↓
SDK
↓
Outbox
↓
Gateway
↓
Allocator
↓
Creator Builder
↓
Rating Engine
↓
через несколько месяцев первая игра
```

---

## 3. Правила экономичности разработки

### VD-RULE-001 — Existing-first

Не переписывать работающие Chess/Checkers rules, bots, UI и persistence без доказанной необходимости.

Новая платформа должна сначала подключаться через adapters/compatibility layers.

### VD-RULE-002 — No speculative infrastructure

Не добавлять Redis, Kafka, Kubernetes, Agones, WebTransport или отдельный microservice только потому, что он может понадобиться в будущем.

### VD-RULE-003 — One result, bounded scope

Каждый delivery slice имеет:

- один главный пользовательский результат;
- явный список обязательных изменений;
- явный список `NOT IN THIS SLICE`;
- отдельный acceptance gate;
- rollback/disable path.

### VD-RULE-004 — No unrelated refactor

Во время slice запрещены unrelated cleanup/refactor/migration работы.

Если найден unrelated дефект, он фиксируется отдельно и не расширяет текущий scope без явного решения.

### VD-RULE-005 — No invisible success

Нельзя закрыть пользовательский slice только unit tests.

Для multiplayer требуется реальный multi-client evidence.

### VD-RULE-006 — Platform abstraction must be reused

Общая абстракция считается оправданной только после использования минимум двумя game paths либо одной product game + одной certification game.

### VD-RULE-007 — Feature can be stopped independently

Любой новый online capability должен иметь admission/feature toggle или другой безопасный способ остановить новые сессии без удаления history.

### VD-RULE-008 — No automatic production deployment

Merge, schema migration и production enablement являются разными действиями.

Успешная разработка не означает автоматический rollout пользователям.

---

# 4. Целевая последовательность результатов

```text
R0  Architecture Freeze
 ↓
R1  Checkers Online — Private Match
 ↓
R2  Generic Command Proof + Quick Match
 ↓
R3  Competitive Checkers — Rating/Stats
 ↓
R4  Chess Convergence
 ↓
R5  Classroom Social Play
 ↓
R6  Realtime Platform + Arena Mini
 ↓
R7  Creator Web Games MVP
 ↓
R8  Creator Multiplayer Rules (conditional)
 ↓
R9  Events/Tournaments/Scale (demand-driven)
```

R8 и R9 не являются обязательными для признания базовой Games Platform полезной.

---

# 5. R0 — Architecture Freeze

## Цель

Закрыть только те решения, неправильный выбор которых заставит переделывать R1–R4.

## Пользовательский результат

Прямого нового UX нет. Это единственный допустимый initial prerequisite stage.

## Обязательные решения

### R0-001 Gaming identity

Зафиксировать:

- какой Principal получает `GamePlayerProfile`;
- поведение StudentSeat;
- сохранение profile/history при смене класса;
- safe public identity DTO;
- lifecycle suspend/delete/anonymize.

### R0-002 Games security/storage domain

Зафиксировать, где живут:

- global/private cross-workspace matches;
- ratings;
- matchmaking tickets;
- public game player profiles;
- classroom-scoped matches.

Нельзя начинать generic SQL schema, пока cross-tenant security model не утверждена.

### R0-003 Canonical Match dimensions

Убрать overloaded `mode`.

Минимальные независимые измерения:

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

### R0-004 Match state machine

Зафиксировать allowed transitions и termination reasons.

### R0-005 Minimal capability catalog

Только capabilities, необходимые R1–R4.

Creator/device/network capabilities откладываются до R7.

## NOT IN R0

- SQL migrations;
- WebSocket implementation;
- rating algorithm;
- creator builder;
- Arena runtime;
- tournaments;
- Redis/Kafka/Kubernetes.

## Exit Gate

R0 считается закрытым, когда:

1. ADR identity/security domain принят;
2. canonical Match model не смешивает admission/rating/scope;
3. Match state machine утверждена;
4. privacy-safe GamePlayerProfile contract утверждён;
5. следующие R1 schema/contracts можно реализовать без самостоятельных архитектурных решений разработчика.

---

# 6. R1 — Checkers Online: Private Match

## Главный результат

> Два реальных пользователя ASA могут пригласить друг друга в шашки, открыть одну и ту же сетевую партию, делать ходы с серверной авторитетностью, пережить краткий разрыв связи, завершить матч и увидеть его в истории.

Это первый обязательный продуктовый результат всей программы.

## Пользовательский сценарий

```text
Игрок A
→ Шашки
→ Играть с другом
→ получает ссылку/код или выбирает разрешённого пользователя
→ Игрок B принимает
→ партия создаётся
→ оба видят одну доску
→ A делает ход
→ B получает authoritative update без ручного reload
→ B отвечает
→ A теряет сеть/закрывает вкладку
→ возвращается
→ получает текущее authoritative состояние
→ партия завершается
→ оба видят одинаковый результат
→ партия есть в истории
→ можно начать rematch
```

## Что реализуется платформенно

Минимум:

- `GameRegistry` только с необходимым subset manifest;
- `GamePlayerProfile` resolver;
- canonical `GameMatch`;
- `GameMatchParticipant`;
- canonical match state/version;
- `GameEvent`/sequence для command match;
- `GameCommandReceipt`;
- generic private invite;
- generic command endpoint;
- generic reconnect snapshot;
- basic match history metadata;
- Checkers adapter к существующему rules engine.

## Что остаётся game-owned

- Russian draughts rules;
- legal moves;
- mandatory capture;
- multi-capture;
- promotion;
- board rendering;
- current Checkers bots/local play;
- game-specific move animation.

## Transport

Correctness не должна зависеть от WebSocket.

R1 допускает простой `MatchUpdatesPort` с первым implementation, обеспечивающим automatic opponent update без manual refresh.

Допустимые начальные реализации:

- bounded short polling/event polling;
- long-poll;
- minimal server push adapter.

Клиентский Checkers UI не должен знать concrete transport. Позднее WebSocket adapter заменяет transport без изменения Match semantics.

## NOT IN R1

- public quick matchmaking;
- rating;
- leaderboards;
- party;
- tournaments;
- creator games;
- realtime room runtime;
- bot migration;
- full Chess migration.

## Evidence

Обязательно:

- 2 независимых authenticated browser contexts;
- invite accept;
- legal move A→B;
- legal move B→A;
- duplicate command retry;
- expectedVersion conflict;
- disconnect/reconnect;
- finish;
- same result on both clients;
- history entry;
- privacy check: internal IDs not exposed.

## Exit Gate

R1 не DONE, пока два пользователя не могут **реально сыграть сетевую партию в шашки от приглашения до результата**.

---

# 7. R2 — Generic Command Proof + Quick Match

## Главный результат

> Пользователь может нажать «Быстрая игра» в шашках и получить случайного совместимого соперника; при этом простая вторая game implementation подключается к тому же Match Core без создания собственной сетевой инфраструктуры.

## Зачем нужна вторая игра

Вторая игра нужна не как продуктовый приоритет, а как архитектурный тест.

Используется минимальный `Tic-Tac-Toe`.

Он должен использовать:

- тот же GameRegistry;
- тот же GameMatch;
- тот же invite;
- тот же quick matchmaking;
- тот же command endpoint;
- тот же reconnect;
- тот же history.

## Checkers результат

Добавить:

```text
Быстрая игра
→ поиск
→ отмена поиска
→ match found
→ automatic open
→ сетевой матч
```

## Matchmaker v1

Только минимальная policy:

- same game;
- compatible version;
- same quick mode;
- valid scope policy;
- no duplicate active ticket;
- no self-match;
- blocked relation respected if available.

Skill/rating window не нужен, пока нет ratings.

## Architecture quality gate

Если для Tic-Tac-Toe необходимо создавать:

```text
новый invite service
новый matchmaking repository
новый match table
новый reconnect endpoint
```

R2 считается провалом abstraction и Games Core исправляется до дальнейшего развития.

## NOT IN R2

- rated matchmaking;
- rating algorithm;
- global leaderboard;
- party;
- Arena;
- Creator Platform.

## Exit Gate

1. Quick Match работает в Checkers.
2. Tic-Tac-Toe использует общую infrastructure.
3. Новая command game подключается преимущественно через manifest + adapter + renderer.
4. Нет game-specific matchmaking persistence.

---

# 8. R3 — Competitive Checkers

## Главный результат

> В шашках появляется полноценный соревновательный online-режим: рейтинговая игра, ASA Rating, изменение рейтинга после матча, личная статистика и таблица лидеров.

## Реализуется

- rating policy interface;
- первый duel rating policy;
- immutable rating events/ledger;
- rated matchmaking queue;
- calibration/provisional state;
- current + peak rating;
- W/D/L;
- win rate;
- current/best streak;
- recent form;
- light/dark split;
- Checkers leaderboard;
- player Checkers profile;
- rating delta after match.

## Жёсткое правило

Rating применяется только после authoritative finished match.

Не влияют на Checkers ASA Rating:

- bot;
- local;
- private friendly match;
- classroom friendly match;
- Quick unranked.

## Что не нужно решать сейчас

Не требуется универсальный лучший algorithm для всех будущих игр.

Нужен versioned `RatingPolicy` и один утверждённый duel policy для Checkers.

## Exit Gate

Пользователь должен иметь законченный цикл:

```text
Рейтинговая игра
→ соперник
→ партия
→ результат
→ rating before/delta/after
→ history
→ stats
→ leaderboard
```

---

# 9. R4 — Chess Convergence

## Главный результат

> Шахматы и шашки используют одни платформенные invite/matchmaking/profile/rating/history services, а chess-specific правила и state остаются внутри Chess.

## Стратегия

Не переписывать `chess-live` одномоментно.

### R4-A Shadow mapping

Существующие Chess live entities проецируются в generic model без переключения write path.

Сравниваются:

- players;
- result;
- version/events;
- rating events;
- history counts.

### R4-B Compatibility adapter

Current Chess API/UI может делегировать generic services, сохраняя compatibility contract.

### R4-C New-match cutover

Только новые Chess matches начинают использовать generic Games Core после parity evidence.

Legacy games остаются читаемыми.

## Пользовательский результат

Для Chess появляются/сохраняются через общую платформу:

- private invite;
- quick match;
- rated match;
- reconnect;
- rating;
- stats;
- history;
- leaderboard.

## Exit Gate

Games Platform доказана уже двумя зрелыми играми.

При этом Chess rules/FEN/clocks не попали в generic core.

---

# 10. R5 — Classroom Social Play

## Главный результат

> Ученик видит разрешённых одноклассников и может пригласить их в поддерживаемые игры; класс получает безопасный игровой leaderboard без раскрытия classroom membership глобально.

## Реализуется

- `ClassroomRelationshipProvider`;
- classmates game directory;
- invite from classmate list;
- incoming challenge notification;
- class-scoped leaderboard;
- «моё место в классе»;
- class H2H where allowed;
- teacher/admin safety policy hooks.

## Не реализуется

- глобальный free-form chat;
- публичное раскрытие школы/класса;
- полноценная social friend network;
- party для team games, если она ещё не нужна.

## Exit Gate

Checkers и Chess используют один Classroom relationship adapter без собственного `<game>_classmates` backend.

---

# 11. R6 — Realtime Platform + ASA Arena Mini

## Главный результат

> Четыре пользователя могут войти в простую realtime Arena, двигаться в одной server-authoritative комнате, переподключаться и получить официальный результат матча в общей history/stats системе.

## Почему только сейчас

До R6 Games Core уже доказан command games. Теперь добавляется **вторая runtime family**, а не переписывается существующая.

## Arena Mini scope

Очень простая игра:

```text
маленькая карта
простые аватары/фигуры
движение
сбор объектов или simple objective
короткий раунд
```

Обязательные modes certification:

1. FFA минимум 4 players;
2. 2v2 team mode.

## Реализуется платформенно

- Realtime Gateway production baseline;
- Room Runtime Protocol;
- one-runtime `GameRoomAllocator`;
- runtime registration/health;
- room lease;
- allocation generation/fencing token;
- short-lived room credential;
- authoritative inputs;
- tick/snapshot loop;
- reconnect snapshot;
- authoritative outcome handoff;
- common Match history/stat integration.

## Не реализуется

- Kubernetes;
- Agones;
- global multi-region routing;
- sophisticated shooter anti-cheat;
- WebTransport unless benchmark demands it.

## Exit Gate

4 clients complete realtime match, including reconnect and runtime authority tests.

2v2 proves teams are first-class, not inferred UI decoration.

---

# 12. R7 — Creator Web Games MVP

## Главный результат

> Ученик может подключить безопасную web-игру из GitHub/ZIP, получить private preview, а после одобрения педагога сделать её доступной своему классу — без доступа игры к ASA cookies, DOM и внутренней БД.

## Scope v1

Только `sandbox-web`.

Допустимы:

- HTML/CSS/JS/TS;
- Canvas;
- Phaser/Pixi/Three.js;
- обычные browser assets.

## Реализуется

- Game Definition;
- creator ownership;
- GitHub App read-only source connector;
- ZIP import;
- isolated build;
- artifact digest;
- minimal SBOM/dependency scan;
- immutable GameBuild;
- GameRelease;
- private/classroom channels;
- sandboxed game origin/iframe;
- minimal Client SDK:
  - public player profile;
  - private game storage;
  - lifecycle/ready/error;
  - platform UI exit;
- teacher classroom publication review;
- release update;
- rollback.

## Третья certification game

`Creator Sample Game` проходит полный путь:

```text
GitHub
→ build
→ private preview
→ teacher approval
→ classroom publication
→ SDK storage
→ release update
→ rollback
```

## Не реализуется

- arbitrary student Docker;
- user-authored server code;
- managed multiplayer rules;
- community/public marketplace;
- monetization;
- native executables.

## Exit Gate

Реальный creator workflow работает от source до classroom playtest.

---

# 13. R8 — Creator Multiplayer Rules

## Статус

**Conditional.** Не начинать автоматически после R7.

Начинается только если R7 creator usage показывает реальную потребность в пользовательских authoritative multiplayer games.

## Результат

> Creator может написать ограниченный authoritative rules module для command multiplayer без доступа к ASA internals.

## Перед реализацией обязателен отдельный feasibility prototype

Кандидат:

```text
WASM/WASI managed-command sandbox
```

Нужно доказать:

- CPU/time/memory limits;
- deterministic host services where required;
- no arbitrary filesystem/network;
- bounded state/command payload;
- crash isolation;
- versioning;
- safe host API;
- reproducible certification.

Если prototype неудовлетворителен, R8 не реализуется и creator multiplayer остаётся platform-native/verified path.

---

# 14. R9 — Events, Tournaments and Scale

## Статус

Demand-driven.

Добавляется только когда текущие games реально требуют capability.

Возможности:

- event campaigns;
- tournaments;
- seasons;
- party expansion;
- static multi-runtime pool;
- Redis coordination при нескольких gateway/runtime instances;
- advanced room allocator;
- verified external realtime runtime;
- replay artifacts;
- regional placement.

Каждая возможность оформляется отдельным vertical slice с собственным product result.

---

# 15. Что считать минимальной полезной Games Platform

После R3 система уже даёт значимый продукт:

```text
Checkers
├── игра с другом
├── Quick Match
├── Rated Match
├── reconnect
├── history
├── ASA Rating
├── stats
└── leaderboard

Tic-Tac-Toe
└── доказательство reusable command platform
```

То есть **не нужно ждать R6/R7**, чтобы получить пользу от проекта.

После R4:

```text
Checkers + Chess
→ общая multiplayer infrastructure
```

Это первая зрелая версия Games Core.

После R6:

```text
command games + realtime games
```

После R7:

```text
встроенные игры + creator web games
```

---

# 16. Stop/Go Gates

После каждого R-stage проводится решение:

```text
GO
FIX
STOP/DEFER
```

## GO

Этап дал заявленный пользовательский результат и evidence.

## FIX

Результат существует, но abstraction/security/reliability gate не пройден.

Следующий этап запрещён до исправления.

## STOP/DEFER

Следующий capability не имеет достаточной продуктовой ценности относительно стоимости.

Проект не обязан автоматически выполнить R0→R9.

---

# 17. Cost Control Gate

Перед каждым новым R-stage фиксируется короткий Delivery Brief:

```text
Result
Why now
User journey
Required platform changes
Required game changes
Schema changes
New dependencies
Files/bounded contexts expected
Test/evidence plan
Rollback/disable plan
Explicit NOT IN SCOPE
```

Если в процессе выясняется, что требуется существенная новая архитектурная область, которой нет в Brief:

```text
STOP
→ оформить finding
→ пересмотреть scope
```

Разработчик/бот не расширяет задачу самостоятельно.

---

# 18. Evidence Contract каждого результата

Для каждого R-stage evidence package содержит:

- base SHA;
- final SHA;
- changed files;
- schema migrations, если были;
- exact tests;
- browser scenarios;
- failure/reconnect scenarios;
- security/privacy negative tests;
- screenshots только как дополнение, не вместо behavior evidence;
- known limitations;
- rollback/disable proof;
- явно: что НЕ проверено.

Запрещено:

- писать `PASS`, если тест не запускался;
- считать endpoint implementation доказательством пользовательского flow;
- считать unit test доказательством сетевого multi-client поведения;
- скрывать baseline/upstream failures под статусом текущего stage.

---

# 19. Branch/PR discipline

Каждый stage делится на bounded PRs, но пользовательский stage остаётся единицей результата.

Пример R1:

```text
PR R1-A — minimal generic Match Core schema/domain
PR R1-B — Checkers adapter + command path
PR R1-C — invite/reconnect/history UI
PR R1-D — two-browser acceptance/evidence fixes
```

Нельзя закрыть R1 после R1-A, потому что пользователь ещё не может играть.

Промежуточные PR должны маркироваться как infrastructure/prerequisite, а не как завершённая feature.

---

# 20. Existing Games Protection

Checkers и Chess должны продолжать работать во время миграции.

Обязательные правила:

1. additive schema first;
2. no destructive migration in same release as new write path;
3. compatibility adapters;
4. shadow comparison before cutover;
5. feature/admission toggle for new online modes;
6. rollback new admission without deleting new data;
7. local/bot/learning paths не переписываются ради online platform без отдельной причины.

---

# 21. Рекомендуемый ближайший порядок

Непосредственно после принятия этого delivery plan:

### Шаг 1

Закрыть R0 только четырьмя/пятью небольшими ADR/amendments.

### Шаг 2

Начать R1 и не отвлекаться ни на rating, ни на Creator Platform, ни на Arena.

### Шаг 3

Довести R1 до реальной двухпользовательской партии шашек.

### Шаг 4

Только после этого R2 — Quick Match + Tic-Tac-Toe proof.

### Шаг 5

R3 — соревновательные шашки.

Это обеспечивает ранний и регулярно видимый результат вместо длинного периода невидимой инфраструктурной разработки.

---

# 22. Acceptance всей программы

ASA Games Platform развивается успешно, если после каждого крупного этапа можно показать работающий продукт:

```text
R1 → «два человека играют в шашки по сети»
R2 → «Quick Match работает; вторая игра подключилась к тому же ядру»
R3 → «в шашках есть настоящий рейтинг и статистика»
R4 → «шахматы и шашки живут на общем multiplayer core»
R5 → «одноклассники играют через общую social integration»
R6 → «четыре человека играют в server-authoritative realtime Arena»
R7 → «ученик загрузил web-игру и класс играет в неё безопасно»
```

Если очередной этап нельзя продемонстрировать таким образом, его scope должен быть пересмотрен.