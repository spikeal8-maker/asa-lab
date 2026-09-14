# ASA Lab — игровые модули
## Нормативное ТЗ по технической гигиене, большим файлам и периодической оптимизации

**Статус:** обязательное нормативное приложение для разработки игровых модулей ASA Lab.  
**Применяется к:** Checkers, Chess и будущим game-модулям.  
**Общая политика:** [`docs/delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md`](../delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md).  
**Форма evidence:** [`docs/review/HYGIENE_AUDIT_TEMPLATE.md`](../review/HYGIENE_AUDIT_TEMPLATE.md).

Этот документ не заменяет конкретный execution plan игры. Он добавляет обязательные технические условия, которые должны выполняться на каждом крупном игровом milestone.

---

# 1. Цель

Игровой модуль должен развиваться так, чтобы:

- игровое ядро оставалось изолированным от UI;
- правила не дублировались в клиенте, боте и multiplayer;
- крупные файлы не становились «центром всего»;
- временные test/debug/media artifacts не накапливались в Git;
- game route оставался lazy и не раздувал unrelated routes;
- тяжёлые assets загружались осознанно;
- после каждого крупного этапа оставался обслуживаемый код, а не только работающий feature.

---

# 2. Обязательная архитектурная граница игры

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

## Запрещено

- правила хода внутри React-компонента;
- отдельная копия правил у bot;
- отдельная копия правил в multiplayer server;
- вычисление легальности хода только на клиенте;
- persistence, зависящий от DOM/UI state;
- giant component, который одновременно рисует доску, хранит правила, сеть, AI, таймер, историю и persistence.

Если временный prototype нарушает границу, до acceptance milestone он либо исправляется, либо получает явный WARNING/BLOCK с delete condition.

---

# 3. Периодичность аудита

Аудит привязан не только ко времени, а к завершённым продуктовым срезам.

## L0 — каждый срез

Выполняется перед merge/acceptance каждой игровой задачи.

Проверяются:

- неожиданные large files;
- generated artifacts;
- новые binaries;
- новые dependencies;
- duplicate `V2/New/Fixed/Final` реализации;
- случайные debug leftovers.

## L1 — после законченного feature

Например:

- правила игры;
- доска и input;
- bot;
- multiplayer;
- рейтинг;
- puzzles/обучение;
- история партии;
- статистика.

После feature убираются временные обходы, debug controls и obsolete code этого feature.

## L2 — после milestone

Выполняется после каждого крупного вертикального milestone, **но не реже одного раза на 10 рабочих дней активной разработки конкретной игры**.

Рекомендуемые естественные точки:

1. engine/rules готовы;
2. playable local game готова;
3. bot готов;
4. persistence/history готовы;
5. multiplayer готов;
6. player stats/rating готовы;
7. learning/puzzles готовы;
8. release candidate готов.

Это не означает, что каждая игра обязана иметь именно такой roadmap. Audit ставится на фактическую границу крупного законченного результата.

## L3 — перед release

Полный аудит обязателен перед production/owner acceptance крупной версии game-модуля.

---

# 4. Почему не надо делать глубокую оптимизацию после каждого коммита

Постоянная декомпозиция незаконченного кода создаёт churn и повышает риск регрессий.

Правильная последовательность:

```text
bounded implementation
→ feature complete
→ focused tests
→ L1 cleanup
→ milestone complete
→ L2 audit
→ targeted optimization
→ regression tests
→ acceptance
```

Глубокая оптимизация в середине незавершённого feature выполняется только при явном blocker:

- файл стал неконтролируемым;
- performance уже мешает разработке;
- архитектурное дублирование начало распространяться;
- bundle/runtime regression критичен;
- новый код невозможно безопасно тестировать без декомпозиции.

---

# 5. Размеры игровых source-файлов

Применяются общие thresholds:

- >500 строк — structural review;
- >800 строк — обязательное решение о декомпозиции;
- >1000 строк handwritten runtime-кода — BLOCK без обоснованного исключения.

## Для игр особенно подозрительны

- `*Board.tsx`;
- `*Game.tsx`;
- `*Engine.ts`;
- `*Controller.ts`;
- `*Session.ts`;
- `*Bot.ts`;
- `*Service.ts`.

Большой файл должен быть проверен на смешение:

- rendering;
- game rules;
- input mapping;
- persistence;
- network;
- AI;
- timers;
- analytics;
- audio;
- animation;
- result handling.

Если в одном файле присутствуют 4+ независимых ответственности, это сильный сигнал для декомпозиции независимо от LOC.

---

# 6. Каноническая декомпозиция game UI

Это не обязательные конкретные имена файлов, а границы ответственности.

Пример:

```text
GamePage
├── GameBoardView
├── GameToolbar
├── GameStatus
├── MoveHistory
├── ResultDialog
└── useGameController

GameApplication
├── game-controller
├── game-session
└── commands/events

GameDomain
├── rules
├── move-generator
├── state-transition
├── notation/replay
└── result-evaluator
```

Bot, multiplayer и persistence используют domain/application contracts, а не импортируют UI.

---

# 7. Правило единственного игрового ядра

Для одной ruleset/version должен существовать один canonical rules engine.

Запрещено:

```text
rules.ts
bot-rules.ts
online-rules.ts
ui-rules.ts
```

с разной логикой одного и того же хода.

Допустимо:

```text
rules-engine
  ↑        ↑        ↑
UI       Bot      Server
```

Если server обязан повторно валидировать ход, он использует тот же versioned domain contract либо серверную реализацию, доказанно совместимую общими fixtures/property tests.

---

# 8. Bot/AI hygiene

Bot не должен становиться вторым владельцем правил.

Проверять:

- legal moves берутся из canonical engine;
- evaluation/strategy отделены от legality;
- search state не мутирует production game state;
- debug tree/search dumps не коммитятся;
- benchmark positions являются canonical fixtures только если реально используются;
- model/weights, если появятся, не кладутся в обычный Git без отдельного storage decision.

Для deterministic bot фиксируется seed/config, необходимый для воспроизводимых тестов.

---

# 9. Multiplayer hygiene

Multiplayer особенно легко порождает большие controller/service файлы.

Проверять раздельность:

- transport;
- session lifecycle;
- authorization;
- authoritative game validation;
- reconnection;
- clocks;
- persistence;
- presence/reactions.

WebSocket/controller не должен содержать полную реализацию rules engine.

Generated network logs, packet dumps и load-test output не хранятся в Git как обычные source files.

---

# 10. Persistence и replay

Состояние игры должно иметь versioned schema.

Аудит проверяет:

- отсутствие огромного неограниченного JSON без необходимости;
- отделение snapshot от event/replay history;
- отсутствие дублирования одного и того же history в нескольких полях;
- fixture size;
- deterministic replay;
- backward compatibility для поддерживаемых версий.

Если replay/analysis data начинают быстро расти, storage policy рассматривается до того, как большие blobs становятся production default.

---

# 11. Game assets

## Изображения

Фигуры, доски, backgrounds, avatars:

- нет дублей;
- размер соответствует display usage;
- тяжёлые backgrounds не входят в initial route без причины;
- variants/retina осмысленны.

## Audio

- lazy/deferred load;
- короткие эффекты оптимизированы;
- длинные аудиофайлы не импортируются как JS payload;
- unused sounds удаляются.

## Animation

- sprite/video/Lottie/3D asset проверяется по размеру;
- decorative asset не должен ухудшать time-to-play.

---

# 12. Bundle isolation

Каждая игра — отдельный lazy-loaded product module, если архитектура ASA Lab не требует иного.

Acceptance-инвариант:

> Открытие главной страницы ASA Lab, электроники, 3D или Scratch не должно тянуть тяжёлый runtime конкретной игры только потому, что игра существует в репозитории.

L2/L3 фиксирует:

- route chunk baseline;
- delta;
- shared chunk impact;
- new dependency impact.

+10% — WARNING.  
+20% — BLOCK без обоснования/профилирования/решения.

---

# 13. Test artifacts

Для игровых E2E особенно часто генерируются:

- screenshots;
- video;
- Playwright traces;
- network logs;
- game replay dumps;
- AI search dumps;
- benchmark results.

По умолчанию это CI/runtime artifacts, а не source.

В Git допускаются только:

- утверждённые visual snapshots;
- small deterministic fixtures;
- compatibility replay fixtures;
- manually reviewed puzzle/position catalogs.

Каждый такой файл должен иметь реального потребителя в tests/runtime.

---

# 14. Паттерн временных файлов от агентов

В игровых модулях запрещено оставлять после acceptance:

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

Если новая реализация нужна для безопасной миграции, требуется:

- canonical source of truth;
- transitional file marker;
- причина существования;
- delete condition;
- milestone, после которого файл исчезает.

---

# 15. Что считается мусорным контентом

Мусор — не только временный файл.

К нему относятся:

- неиспользуемый component;
- неиспользуемый asset;
- дубль texture/image;
- старый engine после перехода на новый;
- debug button;
- fake fixture, больше не используемый тестом;
- скриншоты ручной проверки;
- отчёты локального профилирования;
- export игры для разовой диагностики;
- закомментированные большие блоки старого кода;
- dependency без import/consumer;
- feature flag без owner/delete condition.

---

# 16. Что нельзя удалять автоматически

Аудит не является командой `rm -rf`.

Запрещено автоматически удалять:

- owner-supplied assets;
- backups;
- credentials;
- production DB dumps, если они защищены политикой;
- canonical visual snapshots;
- compatibility fixtures;
- migration evidence;
- чужие незавершённые артефакты параллельной работы.

Сначала классификация, потом действие.

---

# 17. Метрики L2 для игрового milestone

Каждый L2 report должен по возможности содержать:

1. top-20 largest files в game scope;
2. все source >500 LOC;
3. все новые binary >2 MB;
4. repository delta от baseline milestone;
5. route/shared bundle delta;
6. список added/removed dependencies;
7. generated artifacts count;
8. duplicate/transitional files;
9. dead code findings;
10. boundary violations;
11. cleanup actions;
12. unresolved debt.

---

# 18. Когда нужен отдельный optimization milestone

Отдельный milestone создаётся, если обычный L1/L2 cleanup уже недостаточен.

Триггеры:

- несколько critical files >1000 LOC;
- bundle значительно превысил baseline;
- startup/time-to-play деградировал;
- engine/rules дублируются;
- game module начал влиять на unrelated ASA Lab routes;
- Git/assets выросли на десятки MB без продуктовой необходимости;
- test suite стала нестабильной из-за архитектурной связанности;
- feature development систематически требует править один giant file;
- один и тот же domain bug исправляется в нескольких слоях.

Optimization milestone должен иметь измеримый baseline и target, а не цель «сделать код красивее».

---

# 19. Что не является оптимизацией

Не считать улучшением само по себе:

- перенос 900 строк в три файла без разделения ответственности;
- минификация source в Git;
- удаление полезных tests ради скорости;
- снижение качества изображений до заметных артефактов;
- объединение domain и UI ради меньшего числа файлов;
- добавление abstraction layers без реального потребителя;
- массовый unrelated refactor во время feature-задачи;
- перенос мусора из одного каталога в другой.

---

# 20. Gate между игровыми milestone

Перед переходом к следующему крупному игровому этапу:

```text
functional milestone complete
→ focused tests PASS
→ browser journey PASS, если применимо
→ L1 cleanup complete
→ L2 hygiene audit
→ BLOCK findings = 0
→ regression tests after cleanup
→ milestone acceptance
→ only then next major milestone
```

Если прошло 10 рабочих дней активной разработки, а milestone ещё не завершён, L2 выполняется как промежуточный safety audit.

---

# 21. Связь с конкретными игровыми ТЗ

Эта политика применяется к:

- `docs/product/ASA_CHECKERS_EXECUTION_PLAN.md`;
- `docs/delivery/CHECKERS_EXECUTION_PLAN.md`;
- `docs/product/ASA_CHESS_EXECUTION_PLAN.md`;
- `docs/product/ASA_CHESS_PLATFORM_SPEC.md`;
- будущим game execution plans.

Если конкретное игровое ТЗ задаёт более строгий threshold — действует более строгий threshold.

Если конкретное ТЗ конфликтует с этим документом, конфликт должен быть явно разрешён архитектурным решением; агент не выбирает удобную версию молча.

---

# 22. Требование к будущим task cards

Каждая крупная game task card должна иметь раздел:

```text
Hygiene / Optimization impact
- expected large files/assets:
- expected bundle impact:
- temporary artifacts:
- cleanup required at feature end:
- L2 required: YES/NO
- baseline SHA:
```

Для мелкого bounded fix достаточно L0/L1. Для нового вертикального feature или milestone — L2 обязателен.

---

# 23. Definition of Done игрового milestone

Milestone не является DONE, если хотя бы одно условие не выполнено:

- пользовательский сценарий работает;
- правила доказаны tests/fixtures;
- persistence/replay соответствует контракту;
- temporary/debug artifacts очищены;
- нет неразрешённого duplicate production engine;
- новый critical large file не оставлен без решения;
- game route isolation сохранена;
- bundle regression классифицирована;
- L2 report создан;
- `BLOCK findings = 0`;
- cleanup не сломал functional regression suite.

---

# 24. Итоговое правило

> После каждого крупного законченного игрового результата кодовая база должна быть не только функционально богаче, но и не менее понятной, изолированной и управляемой, чем до начала этапа.

Если feature увеличил возможности, но оставил giant files, дубли rules engine, десятки временных screenshots и необъяснимый bundle growth, такой milestone технически не завершён.