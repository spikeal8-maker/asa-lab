# ASA Lab — игровые модули
## Нормативное ТЗ по технической гигиене, большим файлам и итерационной оптимизации

**Статус:** обязательное нормативное приложение для Checkers, Chess и будущих game-модулей ASA Lab.  
**Общая политика:** [`docs/delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md`](../delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md).  
**Форма evidence:** [`docs/review/HYGIENE_AUDIT_TEMPLATE.md`](../review/HYGIENE_AUDIT_TEMPLATE.md).

Этот документ не заменяет execution plan конкретной игры. Он задаёт обязательные технические границы и ритм очистки.

---

# 1. Главный принцип

Игровой код очищается **по итерациям разработки, а не по времени**.

```text
каждый bounded game change → L0
каждый законченный feature slice → L1
каждые 2 принятые игровые итерации → L2
крупный milestone раньше порога → L2
release / owner acceptance → L3
```

Игровой lane относится к high-risk/runtime-heavy, поэтому его L2 threshold = **2 принятых bounded slices** после предыдущего L2.

Если milestone заканчивается после первой итерации, L2 выполняется сразу на milestone boundary — ждать второй итерации не надо.

---

# 2. Что считается игровой итерацией

Отдельной итерацией считается законченный проверяемый результат, например:

- rules/engine slice;
- board/input slice;
- local playable flow;
- bot slice;
- multiplayer/session slice;
- persistence/replay slice;
- rating/stats slice;
- puzzles/learning slice;
- audio/animation slice;
- substantial bug-fix, если он меняет отдельный контракт и имеет собственный acceptance.

Несколько таких результатов внутри одного большого PR считаются несколькими итерациями hygiene counter.

Черновые коммиты, временные попытки и незавершённые ветки counter не увеличивают.

---

# 3. Обязательная архитектурная граница

Целевая зависимость:

```text
Game UI
  ↓
Game Application / Controller
  ↓
Game Engine
  ↓
Rules Engine

AI / Bot
  ↓
Game Engine

Multiplayer / Session
  ↓
Game Application / Controller

Persistence
  ↓
Versioned Game State / Events
```

Запрещено:

- правила хода внутри React-компонента;
- отдельная копия правил у bot;
- отдельная копия правил в multiplayer server;
- legality только на клиенте;
- persistence, зависящий от DOM/UI state;
- giant component, который одновременно рисует доску, хранит rules/network/AI/timer/history/persistence.

Временный prototype с нарушением границы должен иметь явный delete condition и не переживать milestone acceptance без `WARNING/BLOCK`.

---

# 4. L0 — каждое изменение

Перед merge/acceptance каждого bounded game change проверить:

- неожиданные large files;
- generated artifacts;
- новые binaries;
- новые dependencies;
- `V2/New/Fixed/Final/Copy/Old` дубли;
- debug leftovers;
- случайные test videos/traces/screenshots;
- сохранение lazy route isolation.

---

# 5. L1 — каждый законченный feature slice

Перед acceptance итерации удалить или оформить:

- временные debug controls;
- обходы, ставшие ненужными;
- obsolete branches;
- duplicate UI/service/engine code;
- temporary assets;
- unused imports/dependencies;
- transitional implementation без owner/delete condition;
- feature flags без следующего gate.

После cleanup повторить focused/regression tests среза.

---

# 6. L2 — каждые 2 принятые игровые итерации

L2 выполняется, когда `accepted_since_last_l2 == 2`, либо раньше на milestone boundary/trigger.

Обязательные проверки:

- top large source files;
- responsibilities файлов >500 LOC;
- duplicate/dead code;
- generated artifacts;
- game assets;
- dependency graph;
- route/chunk delta;
- lazy loading;
- canonical rules-engine boundary;
- bot/multiplayer reuse rules;
- persistence/replay size;
- technical-debt findings;
- cleanup и повторные tests.

Verdict: `PASS / WARNING / BLOCK`.

При `BLOCK` следующая игровая итерация не начинается.

После `PASS`/accepted `WARNING` game hygiene counter обнуляется.

---

# 7. L2 раньше двух итераций

Немедленный L2 нужен, если:

- handwritten runtime file >1000 LOC;
- один файл одновременно держит UI + rules + network + persistence;
- появился второй rules engine;
- тяжёлая dependency добавилась в game route;
- game route перестал быть lazy;
- bundle/chunk вырос существенно;
- добавлен большой audio/video/3D asset;
- debug/test artifacts массово попали в Git;
- bot или multiplayer начали копировать legality;
- один баг пришлось исправлять в нескольких копиях правил;
- replay/state storage начал быстро расти.

---

# 8. L3 — release / owner acceptance

Полный аудит включает:

- актуальный L2;
- repository/Git-object delta;
- production bundle/chunk;
- lazy isolation от Home/3D/Electronics/Scratch;
- dependency audit;
- dead/duplicate assets;
- generated artifacts;
- performance evidence;
- unresolved hygiene debt с owner decision.

Release запрещён при `BLOCK`.

---

# 9. Размеры игровых source-файлов

Применяются общие thresholds:

- >500 LOC — structural review;
- >800 LOC — обязательное решение `decompose / documented exception`;
- >1000 LOC handwritten runtime — `BLOCK` без обоснованного исключения.

Особенно проверять:

- `*Board.tsx`;
- `*Game.tsx`;
- `*Engine.ts`;
- `*Controller.ts`;
- `*Session.ts`;
- `*Bot.ts`;
- `*Service.ts`.

Если в файле смешаны 4+ независимых ответственности из rendering, rules, input, persistence, network, AI, timers, analytics, audio, animation, result handling — decomposition review обязателен независимо от LOC.

---

# 10. Единственное игровое ядро

Для одной ruleset/version должен существовать один canonical rules engine.

Запрещено:

```text
rules.ts
bot-rules.ts
online-rules.ts
ui-rules.ts
```

с различающейся логикой одного и того же хода.

Правильная модель:

```text
          UI
           ↑
Bot ← Game Engine → Server
           ↓
        Rules
```

Если client и server используют разные реализации, совместимость доказывается общими fixtures/property tests и versioned rules contract.

---

# 11. Bot / AI hygiene

Bot не владеет правилами.

Проверить:

- legal moves приходят из canonical engine;
- evaluation/strategy отделены от legality;
- search state не мутирует production game state;
- debug search trees/dumps не коммитятся;
- benchmark positions остаются только при реальном consumer;
- model/weights не попадают в обычный Git без storage decision;
- deterministic config/seed фиксируется там, где нужен воспроизводимый тест.

---

# 12. Multiplayer hygiene

Разделять:

- transport;
- session lifecycle;
- authz;
- authoritative validation;
- reconnect;
- clocks;
- persistence;
- presence/reactions.

WebSocket/controller не содержит полный rules engine.

Network/load-test logs — runtime artifacts, не исходный код.

---

# 13. Persistence / replay

Game state должен иметь versioned schema.

Проверить:

- отсутствие бесконтрольного giant JSON;
- snapshot отделён от replay/event history;
- одна история не дублируется в нескольких полях;
- fixtures ограничены;
- deterministic replay;
- backward compatibility поддерживаемых версий;
- storage growth имеет измеримый budget.

---

# 14. Assets

## Images

- no duplicates;
- размер соответствует display use;
- heavy backgrounds не грузятся в initial route;
- retina variants осмысленны.

## Audio

- lazy/deferred load;
- короткие эффекты оптимизированы;
- длинный audio не импортируется как JS payload;
- unused sounds удаляются.

## Animation / video / 3D

- размер измерен;
- poster/thumbnail существует при необходимости;
- decorative asset не ухудшает time-to-play;
- 3D textures/materials проверены на дубли и compression.

---

# 15. Bundle isolation

Game route должен быть lazy-loaded, если нет отдельного архитектурного решения.

Acceptance-инвариант:

> Открытие Home, Electronics, 3D или Scratch не должно тянуть тяжёлый runtime конкретной игры только потому, что игра присутствует в репозитории.

L2/L3 фиксирует:

- route chunk baseline;
- target chunk;
- delta %;
- shared chunk impact;
- unrelated route impact;
- new dependency impact.

Ориентиры: +10% = `WARNING`, +20% = `BLOCK` без профилирования/решения.

---

# 16. Test artifacts

По умолчанию CI/runtime artifacts:

- screenshots;
- videos;
- Playwright traces;
- network logs;
- replay dumps;
- AI search dumps;
- benchmark output.

В Git допускаются только canonical visual snapshots, small deterministic fixtures, compatibility replays и reviewed puzzle/position catalogs с реальным consumer.

---

# 17. Transitional files от агентов

После acceptance не должны оставаться:

```text
BoardOld.tsx
BoardNew.tsx
BoardNew2.tsx
GameFixed.tsx
GameFinal.tsx
GameFinal2.tsx
engine-old.ts
engine-copy.ts
bot-debug.json
positions-temp.json
```

Если coexistence нужна для migration:

- определить source of truth;
- причину;
- delete condition;
- bounded slice, который удалит transitional path.

---

# 18. Что нельзя удалять автоматически

Не удалять без доказанного ownership/consumer анализа:

- user/owner assets;
- compatibility fixtures;
- migration data;
- vendor/upstream artifacts;
- production replay data;
- visual golden snapshots;
- protected backups по общим правилам репозитория.

Audit сначала фиксирует evidence, потом выполняется разрешённый cleanup.

---

# 19. Game hygiene evidence

Каждый игровой slice указывает:

```text
hygiene_iteration:
  lane: chess | checkers | <game>
  accepted_since_last_l2: <N>
  l2_threshold: 2
  l2_required_now: yes | no
  last_l2_target_sha: <sha | none>
```

L2/L3 оформляется по `docs/review/HYGIENE_AUDIT_TEMPLATE.md`.

---

# 20. Definition of Done игрового slice

Игровая итерация не завершена, пока:

- [ ] focused behavior tests PASS;
- [ ] L0 PASS;
- [ ] L1 cleanup выполнен;
- [ ] hygiene counter обновлён;
- [ ] если counter достиг 2 — L2 выполнен;
- [ ] BLOCK отсутствуют;
- [ ] canonical rules engine не продублирован;
- [ ] route isolation не ухудшена;
- [ ] временные test/debug artifacts не оставлены;
- [ ] exact final SHA зафиксирован в evidence.

Так очистка происходит в естественном ритме разработки и не зависит от календаря.