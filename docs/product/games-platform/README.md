# ASA Games Platform — Documentation Index

**Статус пакета:** Proposed / documentation only  
**Ветка:** `docs/asa-games-platform-architecture`

---

# 1. Читать в таком порядке

## 1. Master Technical Specification — нормативное ТЗ

`ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION_V2.md`

Определяет:

- что строим;
- архитектурные invariants;
- R0 blockers;
- требования с ID;
- product completion states;
- security/privacy/governance rules.

Старый `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION.md` имеет статус **SUPERSEDED** и не используется для новой реализации.

## 2. Value Delivery Plan — единственный порядок реализации

`ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md`

Определяет пользовательскую последовательность:

```text
R0 Architecture Freeze
R1 Checkers Online — Private Match
R2 Quick Match + XO proof
R3 Competitive Checkers
R4 Chess Convergence
R5 Classroom Social Play
R6 Realtime + Arena Mini
R7 Creator Web Games MVP
R8 Creator Multiplayer Rules — conditional
R9 Events/Tournaments/Scale — demand-driven
```

## 3. Execution Plan — bounded task decomposition

`ASA_GAMES_PLATFORM_EXECUTION_PLAN.md`

Разбивает текущий R-stage на задачи. Не имеет права менять порядок Value Delivery Plan.

## 4. Requirements Traceability

`ASA_GAMES_PLATFORM_REQUIREMENTS_TRACEABILITY.md`

Связывает:

```text
requirement
→ R-stage
→ component
→ mandatory evidence
```

`Implemented` без evidence не считается выполнением.

## 5. Testing & Certification

`ASA_GAMES_PLATFORM_TESTING_AND_CERTIFICATION.md`

Три обязательных proof paths:

```text
Tic-Tac-Toe        → generic command platform
ASA Arena Mini     → realtime platform, FFA + 2v2
Creator Sample     → secure creator publishing/sandbox
```

---

# 2. Supporting architecture/research

Эти документы дают подробности и обоснования, но являются draft/supporting material. При конфликте с Master V2 действует Master V2.

- `docs/architecture/ASA_GAMES_PLATFORM_CURRENT_STATE_AUDIT.md`
- `docs/architecture/ADR-GAME-001-GAMES-PLATFORM-BOUNDARIES.md`
- `docs/architecture/ADR-GAME-002-GAME-PACKAGES-PUBLISHING-AND-TRUST.md`
- `docs/architecture/ASA_GAMES_PLATFORM_NETWORKING_RESEARCH.md`
- `docs/architecture/ASA_GAMES_PLATFORM_DATA_AND_IDENTITY.md`
- `docs/architecture/ASA_GAMES_PLATFORM_PROTOCOLS_AND_RUNTIME.md`
- `docs/architecture/ASA_GAMES_PLATFORM_TECHNOLOGY_OPTIONS.md`
- `docs/architecture/ASA_GAMES_PLATFORM_CRITICAL_ARCHITECTURE_REVIEW.md`
- `ASA_GAMES_PLATFORM_PRODUCT_SPEC.md`
- `ASA_GAMES_PLATFORM_DEVELOPER_INTEGRATION_GUIDE.md`
- `ASA_GAME_PACKAGE_AND_PUBLISHING_SPEC.md`

Supporting draft может содержать более раннее proposal, например overloaded `mode` или старый milestone порядок. Такие места не являются normative, если V2 уже задаёт более новое правило.

---

# 3. Главная архитектурная идея

ASA Games Platform делает общими:

```text
player identity
match lifecycle
invites
matchmaking
reconnect
history
rating/stats/leaderboards
notifications/realtime delivery
```

Игра сохраняет собственными:

```text
rules/simulation
game state
renderer
bots
custom metrics
special UX
```

Command games и realtime-room games имеют разные execution models.

---

# 4. Главная delivery-идея

Не строить платформу месяцами до первой работающей игры.

Правило:

```text
минимальный фундамент
→ реальный пользовательский результат
→ evidence
→ следующий фундамент
→ следующий результат
```

Первый настоящий результат после R0 — **сетевая private-партия шашек между двумя пользователями**.

---

# 5. R0 сейчас является единственным разрешённым следующим этапом

До shared Games schema/API необходимо принять:

1. Gaming Identity;
2. Games cross-workspace security/storage domain;
3. canonical Match dimensions без overloaded `mode`;
4. Match state machine + termination reasons;
5. first-class teams;
6. minimal capability/idempotency/error vocabulary.

После этого создаётся Delivery Brief R1 и начинается private online Checkers.

---

# 6. Что нельзя делать преждевременно

До соответствующего stage не внедрять:

- Redis/Kafka/Kubernetes/Agones;
- WebTransport;
- arbitrary student Docker/runtime;
- creator marketplace;
- native game distribution;
- user-authored multiplayer server rules;
- advanced tournament engines;
- destructive Chess/Checkers migrations;
- parallel game-specific invite/matchmaking/rating services.

---

# 7. Product checkpoints

| Checkpoint | После | Что реально готово |
|---|---:|---|
| First Multiplayer Result | R1 | private online Checkers |
| Games Core Alpha | R3 | Quick + Rated + Stats Checkers |
| Games Core V1 | R4 | Chess + Checkers common core |
| School Games V1 | R5 | classroom social play |
| Realtime Games V1 | R6 | Arena FFA + 2v2 |
| Creator Web Games V1 | R7 | student web game → classroom publication |

R8/R9 не блокируют признание более ранних продуктов готовыми.

---

# 8. Документационный change control

Если реализация обнаруживает необходимость изменить одно из решений R0, implementation task останавливается. Решение оформляется/пересматривается до продолжения.

Нельзя позволять боту или отдельному PR самостоятельно менять:

- identity ownership;
- security/tenancy boundary;
- canonical Match semantics;
- server authority;
- runtime family boundary;
- rating source of truth;
- creator sandbox trust boundary.

---

# 9. Текущее состояние

Пакет является документацией. Он не означает, что Games Platform runtime уже реализована.

`main` не должен получать schema/runtime changes до принятия R0 и явного начала R1.