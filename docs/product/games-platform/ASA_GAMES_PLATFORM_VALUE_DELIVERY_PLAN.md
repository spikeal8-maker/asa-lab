# ASA Games Platform — Value-Driven Delivery Plan V2

**Статус:** Proposed normative delivery order  
**Главное ТЗ:** `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION_V2.md`  
**Техническая декомпозиция:** `ASA_GAMES_PLATFORM_EXECUTION_PLAN.md`

Этот документ отвечает только на вопрос: **в каком порядке мы создаём пользовательскую ценность**.

---

# 1. Базовое правило

После R0 каждый stage обязан закончиться новой пользовательской возможностью, которую можно реально продемонстрировать и проверить.

Запрещён путь:

```text
все таблицы
→ все SDK
→ все сервисы
→ весь realtime
→ весь creator stack
→ когда-нибудь первая игра
```

Правильный путь:

```text
минимальный prerequisite
→ пользовательский результат
→ evidence
→ следующий минимальный prerequisite
→ следующий результат
```

---

# 2. Cost Control Gate

Перед каждым stage создаётся короткий Delivery Brief:

```text
Result
Why now
User journey
Required platform changes
Required game changes
Schema changes
New dependencies
Evidence plan
Rollback/disable
NOT IN SCOPE
```

Если в процессе обнаруживается крупная новая зависимость/архитектурное решение, stage не расширяется автоматически.

---

# 3. Порядок

```text
R0  Architecture Freeze
↓
R1  Checkers Online — Private Match
↓
R2  Quick Match + Generic Command Proof
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
R8  Creator Multiplayer Rules — conditional
↓
R9  Events/Tournaments/Scale — demand-driven
```

R8/R9 не должны задерживать полезные продукты R1–R7.

---

# 4. R0 — Architecture Freeze

## Зачем

Закрыть только решения, которые могут заставить переделывать R1–R4:

- Gaming Identity;
- Games security/cross-workspace storage domain;
- canonical Match dimensions;
- Match state machine/termination;
- first-class teams;
- minimal capabilities + idempotency/error contract.

## Результат

Прямого пользовательского UX нет. Это единственный допустимый initial architecture-only stage.

## Hard Gate

Никакой shared Games SQL/API реализации до принятия R0 решений.

---

# 5. R1 — Checkers Online: Private Match

## Пользователь получает

> Игрок A приглашает B, они играют одну сетевую партию шашек, видят ходы без reload, reconnect восстанавливает партию, результат остаётся в history.

## Не делаем

```text
Quick Match
Rating
Leaderboards
Chess migration
Party
Arena
Creator Platform
```

## Hard Gate

Два реальных browser sessions завершают authoritative match с duplicate/version/reconnect evidence.

---

# 6. R2 — Quick Match + Generic Command Proof

## Пользователь получает

> В шашках появляется «Быстрая игра».

Одновременно Tic-Tac-Toe подключается к тому же Match Core.

## Зачем XO

Проверить, что платформа не является скрыто «Checkers backend».

## Hard Gate

XO не имеет собственного generic online repository/controller/matchmaking stack.

---

# 7. R3 — Competitive Checkers

## Пользователь получает

- Rated Match;
- current/peak rating;
- rating delta;
- W/D/L;
- win rate;
- streak/recent form;
- history;
- leaderboard.

## Hard Gate

Rating server-authoritative/idempotent; projections rebuildable; bot/local/casual не загрязняют public rating.

## Продуктовый checkpoint

**Games Core Alpha.** Уже полезный законченный сетевой продукт шашек.

---

# 8. R4 — Chess Convergence

## Пользователь получает

Шахматы сохраняют зрелую функциональность, но новые shared capabilities идут через Games Core, а не через параллельную новую инфраструктуру.

## Hard Gate

Shadow/parity evidence до cutover; rollback без потери legacy data.

## Продуктовый checkpoint

**Games Core V1:** минимум две зрелые игры используют общую multiplayer foundation.

---

# 9. R5 — Classroom Social Play

## Пользователь получает

- разрешённых одноклассников/recent opponents;
- приглашения;
- incoming challenge notifications;
- classroom leaderboard;
- H2H в разрешённом scope.

## Hard Gate

Ни school/class membership, ни child-sensitive identity не протекают в global/public views.

## Продуктовый checkpoint

**School Games V1.**

---

# 10. R6 — Realtime Platform + Arena Mini

## Пользователь получает

Короткую multiplayer Arena:

```text
FFA 4 players
2v2 teams
```

с authoritative movement/score, reconnect и match history.

## Зачем

Доказать, что platform не ограничена board/command games.

## Hard Gate

Matchmaker → Allocator → Room Runtime; allocation fencing; malicious client authority tests; tick/load/reconnect/crash certification.

## Продуктовый checkpoint

**Realtime Games V1.**

---

# 11. R7 — Creator Web Games MVP

## Пользователь получает

> Ученик подключает GitHub/ZIP web-game → ASA безопасно собирает → private preview → педагог одобряет → класс запускает → release можно обновить/откатить.

## В первой версии только

```text
sandbox-web
private/classroom publishing
minimal Client SDK
private player storage
teacher/admin review
```

## Не делаем

```text
student Docker/runtime
community marketplace
native exe
unrestricted external network
user-authored server multiplayer rules
```

## Hard Gate

Creator Sample проходит source→build→sandbox→classroom→storage→upgrade→rollback security journey.

## Продуктовый checkpoint

**Creator Web Games V1.**

---

# 12. R8 — Creator Multiplayer Rules — conditional

Начинается только при доказанном спросе.

До реализации требуется отдельный managed-command sandbox ADR/prototype. WASM/WASI — кандидат, не заранее выбранная технология.

R8 не блокирует признание R1–R7 готовыми.

---

# 13. R9 — Events/Tournaments/Scale — demand-driven

Добавляется только под конкретный use case/нагрузку.

Нельзя заранее превращать в обязательный backlog:

- Redis/Kafka;
- Kubernetes/Agones;
- WebTransport;
- regional fleets;
- advanced tournaments;
- creator marketplace;
- verified external runtime hosting.

---

# 14. Экономические/агентские правила

1. Existing-first: использовать рабочие Chess/Checkers rules/bots/UI, не переписывать ради чистоты.
2. One result, bounded scope.
3. No unrelated refactor.
4. No invisible success: multiplayer требует real multi-client evidence.
5. No speculative infrastructure.
6. Общая абстракция должна быть переиспользована/сертифицирована.
7. Каждый capability можно безопасно выключить для новых sessions.
8. Merge/migration/enable/deploy — разные действия.
9. Бот не принимает новое фундаментальное архитектурное решение внутри implementation task.
10. Токены/время на более поздние stages не расходуются до acceptance текущего product result.

---

# 15. Как измеряется прогресс

Не количеством файлов/таблиц/сервисов, а достигнутыми состояниями:

| Stage | Проверяемый результат |
|---|---|
| R1 | private сетевые шашки |
| R2 | Quick Match + XO proof |
| R3 | rated/stats шашки |
| R4 | Chess + Checkers common core |
| R5 | classroom social play |
| R6 | realtime Arena FFA+2v2 |
| R7 | ученическая web-game в classroom |

Если stage не улучшил эту таблицу, он либо prerequisite R0, либо scope ушёл в инфраструктурную разработку без подтверждённой ценности.