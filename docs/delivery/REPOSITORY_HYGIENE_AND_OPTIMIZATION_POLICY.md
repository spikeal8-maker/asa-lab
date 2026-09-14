# ASA Lab — Repository Hygiene & Optimization Policy

## 0. Статус и назначение

**Статус:** обязательная инженерная политика для активной разработки.  
**Область:** весь репозиторий ASA Lab; особенно обязательна для игр, 3D, Electronics, Scratch/Blocks, Public Projects и media-heavy модулей.  
**Цель:** не допускать накопления больших неоптимальных файлов, generated-мусора, дублированных реализаций, мёртвого кода, необоснованного роста bundle/dependency graph и Git history.

Эта политика не разрешает самовольный глобальный refactor. Найденный дефект исправляется только в разрешённом scope либо регистрируется отдельным technical-debt item.

Главный принцип:

> Гигиена репозитория привязана к завершённым итерациям разработки, а не к календарю. Мы чистим систему после определённого количества законченных срезов и на границах milestones, а не «раз в N дней».

---

# 1. Базовые термины

## 1.1. Bounded slice / итерация

Законченная ограниченная разработческая единица с собственным scope, acceptance criteria, тестами и evidence. Это может быть feature slice, migration slice, viewer slice, API slice, UI slice или исправление, если оно завершает отдельный проверяемый результат.

Один большой PR с несколькими независимыми результатами считается несколькими итерациями для целей hygiene counter.

## 1.2. Hygiene counter

Для каждого активного lane ведётся количество **принятых bounded slices после последнего L2-аудита**.

Counter увеличивается только после acceptance завершённой итерации. Черновые коммиты и незавершённые попытки counter не увеличивают.

После L2 с verdict `PASS` или принятого `WARNING` counter обнуляется.

## 1.3. Production asset

Файл, реально необходимый продукту в runtime: изображение, модель, аудио, локализованный контент, compatibility fixture, обязательный vendor artifact и т. п.

## 1.4. Generated development artifact

Файл, созданный инструментами разработки и не являющийся исходником продукта: screenshots, videos, traces, coverage, reports, build outputs, dumps, profiling captures, caches, temporary exports.

## 1.5. Canonical test evidence

Generated-файл, который намеренно хранится как часть regression contract, например утверждённый visual snapshot или compatibility fixture. Он должен находиться в явно определённом каталоге и иметь реального потребителя.

## 1.6. Hygiene debt

Найденная проблема, которую нельзя безопасно исправить в текущем scope. Она обязана быть зарегистрирована с путём, причиной, риском, severity и требуемым gate.

---

# 2. Четыре уровня контроля

## L0 — Change Hygiene

**Когда:** на каждом bounded change / PR / merge-кандидате.  
**Цель:** не пустить очевидный мусор в историю.

Проверить:

- неожиданные большие файлы в diff;
- generated artifacts;
- новые binaries;
- `*.tmp`, `*.bak`, `*.old`, logs, dumps;
- новые зависимости;
- появление `V2/New/Fixed/Final/Copy/Old` реализаций;
- случайные build/cache outputs;
- заметный route/bundle growth, если метрика доступна.

L0 должен быть автоматизирован CI/gate настолько, насколько это технически возможно.

## L1 — Slice Cleanup

**Когда:** перед acceptance каждой законченной пользовательской или технической итерации.  
**Цель:** убрать мусор и обходы, созданные именно этой итерацией.

Проверить:

- debug hooks/controls/logging;
- dead branches;
- временные assets;
- дублированные компоненты/сервисы;
- unused imports/dependencies;
- transitional files и их delete condition;
- резко выросшие source-файлы;
- соблюдение заявленных module boundaries;
- корректность feature flags и rollback path.

L1 не разрешает «заодно» чистить весь репозиторий.

## L2 — Iteration Hygiene Gate

**Когда:** не по времени, а по счётчику законченных итераций.

### Стандартный lane

L2 обязателен:

- после **каждых 3 принятых bounded slices** после предыдущего L2;
- либо на границе крупного milestone раньше этого порога;
- либо раньше по событийным триггерам из §3.

### Высокорисковые / тяжёлые lane

Для игр, 3D/WebGL, Electronics simulation, Scratch runtime, Public Projects viewers/media и других media-heavy/runtime-heavy участков L2 обязателен:

- после **каждых 2 принятых bounded slices**;
- либо на границе milestone раньше этого порога;
- либо раньше по событийным триггерам.

### Что считается завершением L2

Нужны:

- baseline SHA и target SHA;
- перечень итераций, вошедших в audit window;
- largest source/assets inventory;
- generated artifact inventory;
- duplicate/dead code review;
- dependency/bundle/lazy-load delta, где применимо;
- architecture boundary review;
- findings ledger;
- cleanup действий текущего scope;
- повторные regression tests;
- verdict `PASS / WARNING / BLOCK`.

При `BLOCK` следующий bounded slice этого lane не начинается до устранения finding либо отдельного owner-approved решения.

## L3 — Release / Owner-Acceptance Audit

**Когда:** перед production/release/owner acceptance крупной версии направления.  
**Цель:** проверить стоимость всего результата для системы.

Обязательно:

- L0 + L1 + актуальный L2;
- repository-size delta;
- крупные Git objects/history;
- production bundle/chunk baseline;
- lazy-load isolation;
- dependency audit;
- dead/duplicate assets;
- cleanup generated artifacts;
- performance evidence;
- unresolved hygiene debt с owner decision.

Release запрещён при незакрытом `BLOCK`.

---

# 3. Событийные триггеры: L2 раньше счётчика

L2 запускается немедленно, не ожидая 2/3 итерации, если:

- source-файл пересёк critical threshold;
- diff добавляет значительный binary/media объём;
- добавлена тяжёлая runtime dependency;
- route потерял lazy isolation;
- bundle/chunk заметно вырос;
- появился второй параллельный engine/service/domain с тем же назначением;
- одна логика исправляется в нескольких копиях;
- feature породил большое число screenshots/videos/traces;
- добавлены существенные 3D/audio/video assets;
- workaround начал использоваться несколькими компонентами;
- build/test заметно замедлился;
- архитектурное исключение стало нормой для следующего кода.

---

# 4. Учёт hygiene counter

Каждый bounded slice в отчёте/PR/evidence указывает:

```text
hygiene_iteration:
  lane: <lane>
  accepted_since_last_l2: <N>
  l2_threshold: 2 | 3
  l2_required_now: yes | no
  last_l2_target_sha: <sha | none>
```

Не требуется менять schema `docs/execution/current.yaml`, пока это отдельно не утверждено. Counter можно хранить в lane review/evidence или специальном hygiene ledger.

Если невозможно доказать предыдущий counter, считать состояние консервативно и выполнить L2 перед следующей крупной итерацией.

---

# 5. Source-файлы: thresholds

Количество строк — сигнал, а не самоцель.

- **>500 строк** обычного handwritten `ts/tsx/js`: structural review.
- **>800 строк:** обязательное решение «decompose / documented exception».
- **>1000 строк:** `BLOCK` для следующей крупной итерации без технически обоснованного исключения.

Исключения возможны для generated source, schema/data catalog, migration snapshot, vendor/upstream artifact, compatibility fixture и больших декларативных таблиц, если они не смешивают runtime responsibilities.

Для файла >500 строк review отвечает минимум:

1. сколько независимых обязанностей внутри;
2. есть ли UI + domain + IO + persistence/analytics в одном месте;
3. где canonical source of truth;
4. нужно ли вынести service/hooks/components/types/tests;
5. почему файл можно безопасно оставить большим, если decomposition не нужна.

---

# 6. Текстовые data-файлы

JSON/YAML/fixtures:

- >250 KB — обязательный review необходимости Git-хранения;
- >1 MB — не добавлять без documented exception;
- повторяющиеся данные нормализовать или генерировать, если это не ухудшает reproducibility;
- runtime не должен грузить огромный JSON целиком ради небольшой части данных.

---

# 7. Binary/media/3D assets

- Новый binary >2 MB — обязательный review.
- Новый binary >10 MB — `BLOCK` для обычного Git без отдельного storage decision.

Проверить:

- реальную необходимость;
- optimized runtime variant;
- duplicate/hash match;
- object storage/CDN/Git LFS suitability;
- lazy/deferred load;
- thumbnail/poster;
- delete/update lifecycle.

Owner-supplied/protected assets не удаляются и не перекодируются автоматически.

---

# 8. Изображения

Проверить dimensions, format, file size, duplicates, responsive variants и фактический CSS display size.

Правила:

- не грузить 4K source в 180 CSS px карточку без причины;
- thumbnails отделять от оригинала, когда оригинал нужен viewer/download;
- использовать modern formats там, где это не ломает контракт;
- HiDPI preview обычно достаточно 1.5–2× от реального display size.

---

# 9. Видео, аудио, 3D и runtime assets

Для каждого тяжёлого asset должно быть известно:

- canonical source;
- optimized runtime variant;
- owner;
- загрузка eager/lazy;
- poster/thumbnail;
- lifecycle удаления/обновления.

3D дополнительно: geometry complexity, texture dimensions, duplicate materials/textures, compression, LOD/deferred load.

Audio/video не импортируются автоматически в initial JS bundle.

---

# 10. Generated development artifacts

По умолчанию в source tree не хранятся:

```text
playwright-report/
test-results/
coverage/
traces/
*.trace.zip
*.log
*.tmp
*.bak
*.old
.cache/
dist/
build/
temp/
debug/
local-dumps/
database-dumps/
generated-test-data/
```

E2E screenshots/videos — CI/runtime artifacts. В Git допускаются только canonical visual snapshots/fixtures с понятным владельцем и тестовым потребителем.

---

# 11. Dependencies

Каждая новая runtime dependency отвечает на вопросы:

- какую конкретную возможность добавляет;
- нельзя ли решить существующим package/API;
- browser/server impact;
- tree-shaking/lazy-load;
- transitive weight;
- security/maintenance risk.

Dependency без реального consumer удаляется на L1.

---

# 12. Duplicate/transitional implementations

Подозрительные паттерны:

```text
ComponentV2
ComponentNew
ComponentFixed
ComponentFinal
service-copy
engine-old
```

Если параллельная реализация действительно нужна для миграции, обязательно указать:

- canonical source of truth;
- причину coexistence;
- migration gate;
- delete condition;
- какой bounded slice обязан удалить transitional path.

Без этого L2 verdict не может быть `PASS`.

---

# 13. Dead code и debug leftovers

Проверить:

- unused imports/exports;
- unreachable branches;
- obsolete feature flags;
- debug controls;
- console/debug logging;
- unused assets;
- commented-out old implementations;
- no-longer-used fixtures.

Нельзя сохранять старую реализацию «на всякий случай», если source of truth уже сменился.

---

# 14. Bundle и lazy loading

Для browser-heavy модулей L2/L3 фиксирует:

- baseline route/chunk;
- target route/chunk;
- delta %;
- shared chunk impact;
- unrelated route impact;
- new heavy dependencies;
- lazy-load preserved `YES/NO`.

Ориентиры:

- +10% — `WARNING`, требуется объяснение;
- +20% — `BLOCK` без профилирования и принятого решения.

Проценты не заменяют абсолютные метрики и user-perceived performance.

---

# 15. Git history

L3 проверяет крупнейшие Git objects и случайно попавшие media/dumps.

History rewrite:

- никогда не выполняется автоматически;
- требует отдельного owner-approved решения;
- не является обычной частью feature cleanup.

---

# 16. Архитектурные границы

Hygiene-аудит проверяет не только размеры файлов, но и ownership.

Примеры `BLOCK`:

- второй Project Core;
- duplicate rules engine;
- browser-only authorization;
- UI-компонент, ставший владельцем domain/persistence logic;
- shared route, который начал импортировать тяжёлый модульный runtime;
- public API, начавший отдавать private mutable document ради удобства UI.

---

# 17. Findings и severity

## PASS

BLOCK отсутствуют; cleanup текущего scope выполнен.

## WARNING

Проблема зарегистрирована, не создаёт немедленного архитектурного/безопасностного риска и имеет конкретный следующий gate.

## BLOCK

Следующая итерация lane запрещена до исправления либо owner-approved решения.

Любой finding содержит:

- ID;
- path/subsystem;
- evidence;
- impact;
- required action;
- required-before slice/gate;
- owner/decision status.

Календарный deadline не является заменой development gate.

---

# 18. Cleanup не расширяет scope автоматически

Если L2 нашёл дефект соседнего домена:

- зафиксировать finding;
- оценить severity;
- создать отдельную задачу при необходимости;
- не переписывать соседний модуль без разрешения.

Исключение: security/data-loss blocker, который делает текущий acceptance небезопасным — тогда текущий slice останавливается.

---

# 19. Обязательная форма evidence

Для L2/L3 используется:

`docs/review/HYGIENE_AUDIT_TEMPLATE.md`

Без baseline/target SHA, списка вошедших итераций, измерений и findings формулировка «всё проверено» не считается аудитом.

---

# 20. Короткая формула

```text
каждое изменение → L0
каждый законченный slice → L1
2 тяжёлых или 3 обычных принятых slice → L2
milestone boundary → L2 раньше счётчика
release / owner acceptance → L3
BLOCK → следующий slice не стартует
```

Таким образом очистка происходит по ритму реальной разработки, а не по календарю.