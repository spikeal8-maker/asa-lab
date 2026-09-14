# ASA Lab — Repository Hygiene & Optimization Policy

## 0. Статус и назначение

**Статус:** обязательная инженерная политика для активной разработки.  
**Область:** весь репозиторий ASA Lab; особенно обязательна для игровых, 3D, electronics, Scratch/Blocks и media-heavy модулей.  
**Цель:** не допускать накопления больших неоптимальных файлов, generated-мусора, дублированных реализаций, мёртвого кода, необоснованного роста bundle/dependency graph и Git history.

Эта политика не разрешает самовольный глобальный refactor. Она определяет, **когда и что надо проверить**, а найденный дефект исправляется только в рамках разрешённого scope или регистрируется отдельным technical-debt item.

Главный принцип:

> Качество репозитория поддерживается непрерывно маленькими проверками и обязательными milestone-аудитами, а не редкой «генеральной уборкой» после нескольких месяцев разработки.

---

# 1. Почему это обязательная часть разработки

В ASA Lab одновременно развиваются сложные интерактивные подсистемы. При такой разработке особенно быстро накапливаются:

- крупные `ts/tsx/js` файлы, смешивающие несколько обязанностей;
- временные screenshots, videos, traces, coverage, dumps и debug-данные;
- дублированные PNG/WebP/SVG/3D assets;
- тестовые fixture, которые перестали использоваться;
- старые компоненты после появления `V2`, `New`, `Fixed`, `Final`-версий;
- новые зависимости ради одной маленькой функции;
- большие JSON и встроенные data blobs;
- маршруты, которые тянут код чужих модулей;
- тяжёлые game/3D/WebGL runtime chunks;
- удалённые из working tree, но оставшиеся в Git history большие бинарные объекты.

Работающий feature не считается качественным, если его цена — систематическое ухудшение обслуживаемости и веса репозитория.

---

# 2. Термины

## 2.1. Production asset

Файл, реально необходимый продукту в runtime: изображение, модель, аудио, локализованный контент, fixture совместимости, обязательный vendor artifact и т. п.

## 2.2. Generated development artifact

Файл, созданный инструментом разработки и не являющийся исходником продукта:

- test screenshot/video;
- trace;
- report;
- coverage;
- build output;
- temporary export;
- debug dump;
- local database dump;
- profiling capture;
- generated cache.

## 2.3. Canonical test evidence

Generated-файл, который намеренно хранится как часть regression contract: например утверждённый visual snapshot или compatibility fixture. Такой файл должен находиться в явно определённом каталоге и иметь понятного владельца/назначение.

## 2.4. Large file

Файл, который пересёк soft/hard threshold этой политики либо заметно увеличил repository/bundle footprint относительно baseline.

## 2.5. Hygiene debt

Найденная проблема, которая не должна исправляться в текущем scope, но обязана быть явно зарегистрирована с путём, причиной, риском и предлагаемым следующим действием.

---

# 3. Четыре уровня контроля

## L0 — Continuous Hygiene

**Когда:** на каждом рабочем срезе/PR/merge-кандидате.  
**Стоимость:** минуты.  
**Цель:** поймать очевидный мусор до попадания в историю.

Проверяется:

- неожиданные большие файлы в diff;
- generated artifacts;
- новые binaries;
- случайные `*.tmp`, `*.bak`, `*.old`, logs;
- новые зависимости;
- рост route/bundle там, где метрика доступна;
- появление подозрительных `V2/New/Fixed/Final/Copy` файлов;
- случайно закоммиченные build/cache outputs.

L0 должен стать автоматизированным CI/gate. Пока automation не реализована, проверка выполняется явно в review и фиксируется в evidence.

## L1 — Feature Cleanup

**Когда:** завершён пользовательский feature или вертикальный slice до его acceptance.  
**Цель:** убрать мусор и временные обходы, появившиеся непосредственно в этом feature.

Проверяется:

- временные debug hooks;
- мёртвые ветви кода;
- временные assets;
- дублированные компоненты;
- неиспользуемые imports/dependencies;
- файлы, резко выросшие в ходе среза;
- совпадение final architecture с заявленными module boundaries.

L1 не является разрешением чистить весь репозиторий.

## L2 — Milestone Audit

**Когда:** после каждого законченного milestone/крупного вертикального среза, но **не реже одного раза на 10 рабочих дней активной разработки данного направления**.  
**Цель:** не позволить локальным компромиссам нескольких feature превратиться в новую архитектуру по умолчанию.

Проверяется:

- топ крупных source-файлов активного модуля;
- топ крупных repository assets активного модуля;
- duplicated/dead code;
- dependency graph;
- bundle/lazy-loading regression;
- generated artifact inventory;
- architecture boundary violations;
- Git delta за milestone;
- накопившийся hygiene debt;
- необходимость декомпозиции файлов/сервисов.

Следующий крупный milestone не должен начинаться при наличии незакрытого **BLOCK** из L2.

## L3 — Release Audit

**Когда:** перед production/release/owner acceptance крупного игрового или media-heavy направления.  
**Цель:** проверить не только feature, но и его стоимость для всей системы.

Обязательно:

- L0 + L1 + L2;
- repository-size delta;
- проверка крупных Git objects/history;
- production bundle baseline/regression;
- lazy-load isolation;
- dependency audit;
- dead/duplicate asset audit;
- cleanup generated artifacts;
- performance evidence;
- unresolved hygiene debt с явным owner decision.

Release запрещён при незакрытом P0/BLOCK hygiene finding.

---

# 4. Событийные триггеры вне расписания

Глубокий аудит запускается раньше L2, если произошло хотя бы одно событие:

- один source-файл резко вырос и превысил hard threshold;
- PR/diff добавляет большой объём бинарных данных;
- добавлена новая тяжёлая runtime-зависимость;
- игровой маршрут перестал быть lazy;
- общий bundle заметно вырос;
- появляется второй параллельный engine/service/component с тем же назначением;
- для feature создано много новых screenshots/videos/traces;
- добавлены 3D/audio/video assets;
- временный workaround стал использоваться несколькими компонентами;
- build/test начал заметно замедляться;
- один и тот же баг приходится исправлять в нескольких копиях логики.

---

# 5. Source-файлы: размер как сигнал, а не самоцель

Количество строк не является абсолютной метрикой качества, но используется как ранний индикатор смешения обязанностей.

## Soft threshold

**> 500 строк** для обычного `ts/tsx/js` source-файла:

- обязательный review структуры;
- ответить, сколько независимых обязанностей находится в файле;
- проверить возможность вынести engine/service/hooks/components/types/tests.

## Hard review threshold

**> 800 строк**:

- требуется явное решение: декомпозиция либо документированное исключение;
- новый feature не должен механически продолжать раздувать такой файл.

## Critical threshold

**> 1000 строк** обычной handwritten runtime-логики:

- считается BLOCK для следующего крупного milestone, если нет технически обоснованного исключения;
- исключение должно объяснять, почему разделение ухудшит контракт, генерацию или проверяемость.

### Допустимые исключения

Порог не применяется механически к:

- generated source;
- schema/data catalog;
- migration snapshot;
- явно утверждённому compatibility fixture;
- vendor/upstream artifact;
- большим declarative tables, если они не смешивают runtime responsibilities.

Большой файл нельзя бессмысленно делить только ради количества строк.

---

# 6. Текстовые data-файлы

## JSON/YAML/fixtures

- >250 KB — обязательная проверка необходимости хранения в Git;
- >1 MB — запрещено добавлять без явного documented exception;
- повторяющиеся данные должны нормализоваться/генерироваться, если это не ухудшает reproducibility;
- production runtime не должен загружать огромный JSON целиком, если пользователю нужна малая его часть.

Fixtures совместимости допускаются, если они доказуемо нужны тесту и имеют owner/назначение.

---

# 7. Binary/media/3D assets

## Soft threshold

Любой новый binary >2 MB требует review:

- действительно ли он нужен продукту;
- существует ли оптимизированная версия;
- можно ли хранить его в object storage/CDN вместо Git;
- есть ли дубликат;
- соответствует ли качество реальному CSS/runtime размеру.

## Hard threshold

Новый binary >10 MB не должен попадать в обычный Git без явного архитектурного решения. Рассматриваются:

- object storage;
- CDN;
- Git LFS, если инфраструктура проекта его сознательно поддерживает;
- build-time download для vendor artifacts;
- более компактный формат.

### Защищённые owner assets

Эта политика **не разрешает** автоматически удалять, перекодировать или заменять owner-supplied assets, backups и другие защищённые данные из `AGENTS.md`. Если такой файл велик, он фиксируется в отчёте как исключение или отдельная задача владельца.

---

# 8. Изображения

Проверять:

- фактические dimensions;
- format;
- размер файла;
- дубли;
- наличие responsive variants;
- соответствует ли исходное разрешение месту показа.

Правила:

- не отправлять 4K-изображение в карточку 180 CSS px без причины;
- использовать WebP/AVIF там, где это не нарушает продуктовый контракт;
- HiDPI asset обычно достаточно держать около 1.5–2× от CSS display size;
- thumbnails должны генерироваться отдельно от оригинала, если оригинал нужен для viewer/download.

---

# 9. Видео, аудио, 3D и game assets

Для каждого тяжёлого asset должно быть ясно:

- кто его владелец;
- где canonical source;
- где optimized runtime variant;
- есть ли poster/thumbnail;
- нужен ли он при первом открытии route;
- можно ли lazy-load;
- как он удаляется/обновляется.

3D-модели проверяются на:

- poly/triangle count;
- texture dimensions;
- duplicate textures/materials;
- compression;
- необходимость LOD;
- возможность deferred load.

Аудио/video не должны автоматически импортироваться в initial game bundle.

---

# 10. Generated development artifacts

В source tree не должны бесконтрольно попадать:

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

Конкретный каталог с таким названием может быть разрешён, если он является canonical product/test data и это явно документировано.

### E2E screenshots/videos

- runtime evidence предпочтительно хранить как CI artifact, а не постоянно в Git;
- visual-regression golden snapshots допускаются только в canonical snapshot directory;
- debug screenshot после завершения задачи удаляется/не коммитится;
- видео браузерного теста не считается исходным кодом продукта.

---

# 11. Git history

Удаление большого файла из рабочей ветки не означает, что Git стал маленьким.

L3 включает:

- поиск самых больших Git objects;
- выявление случайно закоммиченных media/dumps;
- поиск повторяющихся бинарных версий;
- оценку repository clone size.

**Запрещено** самостоятельно переписывать опубликованную историю (`filter-repo`, force push и т. п.). Если очистка history действительно нужна, создаётся отдельный owner-approved maintenance plan.

---

# 12. Контроль размера diff/repository delta

Для каждого крупного feature/milestone фиксируется delta.

Начальные ориентиры:

- +5 MB к обычному feature diff — WARNING и обязательное объяснение;
- +20 MB — BLOCK до классификации файлов и owner/architecture decision;
- production assets могут быть обоснованным исключением, generated artifacts — нет.

Цель — не запретить нужные media, а сделать их появление сознательным.

---

# 13. Bundle и runtime footprint

Для frontend/module route требуется baseline.

Минимальные правила:

- тяжёлый модуль должен загружаться лениво, если он не нужен всему ASA Lab;
- game/3D/editor runtime не должен попадать на unrelated routes;
- +10% к контролируемому route chunk — WARNING;
- +20% — BLOCK до объяснения, профилирования и owner/architecture decision;
- новый heavy dependency требует сравнения alternative/benefit/cost;
- изменение, уменьшающее source lines, но увеличивающее initial bundle без причины, не считается оптимизацией.

Проценты применяются к зафиксированному baseline. До появления автоматического bundle reporter baseline фиксируется в milestone audit вручную.

---

# 14. Dependencies

Каждый новый package должен отвечать на вопросы:

1. Какая пользовательская или инженерная потребность без него не решается разумно?
2. Не существует ли уже dependency с той же функцией?
3. Попадает ли package в browser bundle?
4. Есть ли side effects/tree-shaking проблемы?
5. Кто будет обновлять его и какие security риски он добавляет?

Неиспользуемая dependency удаляется в L1 текущего feature, если это безопасно и относится к его scope.

---

# 15. Дублированные реализации

Запрещён шаблон накопления:

```text
GameBoard.tsx
GameBoardNew.tsx
GameBoardV2.tsx
GameBoardFixed.tsx
GameBoardFinal.tsx
```

или:

```text
game.service.ts
game-service-new.ts
game.service.v2.ts
```

Перед созданием нового engine/service/component/hook/utility разработчик обязан найти существующий аналог.

Если новая реализация заменяет старую:

- старая удаляется в том же milestone; либо
- получает явный transitional status, owner, reason и delete condition.

«Оставим старую на всякий случай» без delete condition запрещено.

---

# 16. Dead code

Dead code нельзя сохранять комментариями или `if (false)` «для истории». Историей владеет Git.

Удаляются в рамках L1:

- неиспользуемые imports;
- недостижимые ветви текущего feature;
- старые feature flags без владельца/срока;
- временные debug controls;
- console/debug logging, не являющийся observability contract.

Удаление чужого dead code вне scope регистрируется как debt, а не выполняется автоматически.

---

# 17. Scope safety: аудит не равен праву на глобальный refactor

Если audit обнаружил проблему в соседнем модуле:

1. записать finding;
2. указать путь, размер/симптом и риск;
3. определить severity;
4. создать/предложить отдельную maintenance-задачу;
5. **не расширять текущий scope**, если дефект не блокирует текущий пользовательский контракт.

Это правило сохраняет принцип bounded execution из `AGENTS.md`.

---

# 18. Severity

## PASS

Нарушений нет либо всё исправлено в разрешённом scope.

## WARNING

Проблема существует, но:

- не ухудшает критический runtime;
- имеет явного владельца;
- зарегистрирована;
- не должна блокировать текущий milestone.

## BLOCK

Хотя бы одно:

- generated/secrets/dump попадает в release/history;
- тяжёлый модуль протёк в unrelated initial route;
- новый большой binary не классифицирован;
- critical source-file threshold превышен без решения;
- старый и новый engine одновременно считаются production source of truth;
- bundle regression >20% без одобрения/объяснения;
- обнаружена неконтролируемая утечка временных артефактов;
- hygiene finding создаёт риск безопасности, данных или воспроизводимости.

BLOCK закрывается до следующего крупного milestone/release.

---

# 19. Обязательный audit evidence

Каждый L2/L3 аудит создаёт короткий воспроизводимый отчёт по шаблону:

[`docs/review/HYGIENE_AUDIT_TEMPLATE.md`](../review/HYGIENE_AUDIT_TEMPLATE.md)

Отчёт должен содержать числа, а не фразу «проверено»:

- baseline commit;
- target commit;
- scope;
- крупные source-файлы;
- крупные assets;
- generated artifacts;
- repository delta;
- bundle delta, если применимо;
- dependency changes;
- duplicate/dead code findings;
- architecture findings;
- исправления;
- deferred debt;
- итог `PASS / WARNING / BLOCK`.

---

# 20. Автоматизация

Целевой набор команд должен быть реализован отдельной инженерной задачей, а не притворяться существующим заранее.

Рекомендуемая целевая форма:

```bash
pnpm audit:hygiene
pnpm audit:hygiene --scope checkers
pnpm audit:hygiene --scope chess
pnpm audit:hygiene --scope games
pnpm audit:hygiene --since <baseline-sha>
```

Автоматизация должна уметь как минимум:

- показать top-N крупных файлов;
- классифицировать tracked generated artifacts;
- найти новые binaries;
- сравнить repository delta;
- вывести подозрительные duplicate naming patterns;
- проверить ignore rules;
- интегрироваться с bundle stats, когда они доступны.

До появления инструмента audit выполняется вручную и фиксируется отчётом.

---

# 21. Definition of Done для milestone

Milestone нельзя считать технически завершённым только потому, что feature работает.

Для media-heavy/game/3D/editor направлений требуется:

- functional acceptance — PASS;
- focused tests — PASS;
- L1 cleanup — PASS;
- L2 audit — PASS или документированный WARNING без blocker;
- generated artifacts очищены;
- новый large-file debt отсутствует либо принят явно;
- module/bundle isolation не ухудшена;
- следующий milestone не зависит от временного workaround без owner.

---

# 22. Инвариант

> Оптимизация — не финальный косметический этап. Это периодический gate между законченными кусками продукта.

Правильный цикл:

```text
bounded feature development
→ functional tests
→ L1 cleanup
→ milestone boundary
→ L2 hygiene audit
→ исправление findings текущего scope
→ regression tests
→ milestone acceptance
→ следующий milestone
```

Для длинной непрерывной разработки L2 всё равно проводится максимум через 10 рабочих дней активной работы по направлению.