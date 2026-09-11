# ASA Lab Electronics — план стабилизации, оптимизации и развития

**Область:** только `Electronics / Arduino`.

**Тип документа:** execution plan. Он задаёт порядок инженерных работ, gates и критерии приёмки. Он **не** заменяет нормативную спецификацию `docs/product/electronics/README.md`, машинные контракты `docs/product/electronics/contracts/**` и текущее состояние исполнения `docs/execution/current.yaml`.

**Базовая ревизия аудита:** `main@93668d4a05d7816884e44721b9a6cf0bc3bd78bc`.

---

## 0. Что именно оптимизируется

Цель программы — **не документация ради документации** и не переписывание Electronics с нуля.

Основной объект оптимизации:

1. математическое электрическое ядро;
2. transient / electrothermal calculation;
3. Arduino parser/runtime/scheduler;
4. связь Arduino ↔ электрическая физика;
5. клиентская производительность CPU/RAM/latency;
6. переносимость Electronics в другой проект;
7. расширяемость компонентами и датчиками;
8. тестовая и численная доказуемость физики.

Документация выполняет вспомогательную функцию: фиксирует архитектурные границы, machine-readable capabilities, измерения, решения и acceptance criteria так, чтобы люди и агенты не создавали несколько несовместимых реализаций одной и той же физики.

### Решение по существующему ядру

Текущее ядро **не переписывается целиком**. Сохраняются:

- детерминированный netlist;
- versioned model identity;
- fail-closed `unsupported`;
- finite-number contract;
- KCL/source residual/power-balance quality checks;
- transient state;
- Arduino runtime state;
- deterministic digests;
- server verification тем же ядром.

Переписываются или выделяются только те части, где текущая архитектура мешает производительности, переносимости или корректному времени симуляции.

---

## 1. Эксплуатационный контур и правила безопасности

На Windows-компьютере владельца существует рабочий локальный Compose-стенд `asa-lab-dev`.

На момент аудита:

- Web опубликован локально на `127.0.0.1:4610`;
- API и PostgreSQL healthy;
- рабочий Compose-каталог: `C:\Users\spike\AppData\Local\asa-lab-docker-main`;
- runtime revision: `fe94a214def1a967cc3d892f532a92d00a0ea2ec`;
- `/api/version` сообщает `schemaVersion=106` и `synchronized=true`;
- этот checkout не равен текущему GitHub `main`.

### 1.1. Неприкосновенность рабочего стенда

Рабочий `asa-lab-docker-main` **не является песочницей разработки**.

До отдельного deployment шага запрещено:

- делать в нём экспериментальные refactor;
- автоматически выполнять `git pull && docker compose up`;
- использовать рабочую PostgreSQL для destructive/integration тестов;
- менять schema или volume ради benchmark;
- заменять текущие контейнеры непроверенными image;
- запускать reset/rebuild production-like данных.

Разработка Electronics выполняется в отдельном checkout/worktree/branch. Для browser/integration gates используется отдельная тестовая БД или одноразовый Compose-проект.

Deployment — отдельное действие после gates; push в GitHub deployment не означает.

### 1.2. Перед каждым изменением

Исполнитель обязан зафиксировать:

- exact base SHA;
- `git status`;
- затрагиваемые Electronics paths;
- текущий engine/model/runtime version;
- ожидаемые тесты;
- необходимость или отсутствие DB migration.

Для этой программы DB migration по умолчанию **не требуется**. Если задача неожиданно требует изменения persistence schema, она останавливается и рассматривается отдельно.

---

## 2. Целевая архитектура

```text
ASA Lab UI / host application
        |
        v
Electronics Host Adapter
        |
        v
versioned Electronics Engine API
        |
        +--> Document / topology / netlist
        +--> Component Model Registry
        +--> Arduino Program Runtime
        +--> Canonical Simulation Clock
        |
        v
Dedicated Electronics Worker
        |
        +--> DC solver
        +--> transient / electrothermal solver
        +--> Arduino scheduler
        +--> peripheral timing
        |
        v
SimulationResult + typed diagnostics + metrics
```

### 2.1. Portable engine boundary

Чистое engine-ядро не должно зависеть от:

- React;
- DOM;
- browser UI components;
- ASA Lab API client;
- PostgreSQL;
- auth/classroom/learning contexts;
- portal state;
- CSS/assets;
- `@asa-lab/module-sdk` там, где он не является частью чистого вычислительного контракта.

Standalone consumer должен иметь возможность:

1. импортировать engine;
2. передать versioned electronics document;
3. выполнить solve/advance/reset;
4. получить deterministic result;
5. использовать собственный UI и persistence.

### 2.2. Клиентские вычисления

Интерактивная симуляция выполняется на устройстве пользователя.

Сервер:

- хранит проект и версии;
- может повторно проверить deterministic result;
- не участвует в каждом simulation tick;
- не является обязательным вычислительным backend для работающей схемы.

Тяжёлая физика не должна выполняться на React/main thread.

---

## 3. Подтверждённые архитектурные проблемы

### 3.1. Main-thread simulation

Текущий Web live runtime регулярно вызывает электрический анализ из React-пути. Это означает локальные вычисления на компьютере пользователя, но сложная схема способна создавать long tasks и тормозить pointer/drag/UI.

**Решение:** dedicated Web Worker, async request protocol, cancellation/generation id, bounded queues.

### 3.2. Два временных пути

Существуют:

- UI-oriented live path;
- более точный Arduino circuit scheduler с microsecond time и физическими barriers.

Физическое время не должно зависеть от `setInterval`, FPS или скорости React render.

**Решение:** один canonical clock. UI только запрашивает новый horizon и отображает последний committed frame.

### 3.3. Engine ещё не является независимым продуктом

`@asa-lab/electronics` уже выделен как library, но полный runtime/UI contract остаётся тесно связан с ASA Lab.

**Решение:** formal public API + portable package boundary + standalone example + dependency gate.

### 3.4. Крупные hotspot-файлы

Несколько solver/runtime/UI файлов имеют слишком высокую когнитивную сложность. Для агента это увеличивает стоимость контекста и вероятность побочных изменений.

Разделение выполняется **по ответственности**, а не ради количества файлов.

### 3.5. Arduino — хороший subset, но не полная Uno

Существующий runtime достаточно серьёзен для учебных сценариев, но не должен позиционироваться как произвольный AVR/Arduino runtime.

До расширения peripherals необходимо стабилизировать:

- parser/IR;
- numeric semantics;
- instruction clock;
- GPIO timing;
- event scheduling;
- runtime serialization;
- capability diagnostics.

---

## 4. Инварианты, которые нельзя нарушать оптимизацией

1. Unsupported component/topology никогда не превращается в частичный `solved`.
2. `NaN` и `Infinity` не допускаются в успешном result.
3. KCL, ideal-source residual и power-balance checks остаются независимыми.
4. Один input + одинаковые engine/model versions дают deterministic normalized result.
5. Геометрия нарисованного wire не определяет netlist.
6. Breadboard hole groups участвуют в реальной topology.
7. UI не вычисляет электрическую истину самостоятельно.
8. Damage/overload/thermal state исходит из model/solver.
9. Arduino и circuit physics используют один временной контракт.
10. User document не хранит ток/напряжение как persisted truth.
11. Новая модель не добавляется путём скрытого special-case, если она может быть оформлена как DeviceModel/profile.
12. Старый документ либо мигрируется additively, либо честно отклоняется; data loss запрещён.
13. Client runtime остаётся работоспособным без непрерывного обращения к API.
14. Результат Worker и server verification должны использовать один engine/model set.

---

## 5. Измеримые performance budgets

Сначала снимается baseline. Цели уточняются по фактическим данным, но gate должен содержать численные ограничения.

Минимальный набор метрик:

- cold load electronics route;
- engine/worker chunk bytes gzip/brotli;
- first simulation latency;
- steady-state solve p50/p95/p99;
- UI main-thread long tasks;
- worker CPU time;
- peak JS heap / worker heap proxy;
- serialization/message payload bytes;
- component/net count;
- Arduino events per simulated second;
- transient steps per simulated second;
- cancellation rate;
- stale-result rejection count.

Benchmark corpus должен включать малые, средние и стрессовые схемы и запускаться одной командой локально и в CI.

Оптимизация без сравнения `before -> after` на одном corpus не считается доказанной.

---

## 6. Программа исполнения

Статус конкретной активной задачи хранится только в `docs/execution/current.yaml`. Этот документ содержит последовательность программы, но не дублирует live checkpoint.

### E-OPT-0 — Baseline и benchmark harness

**Цель:** получить воспроизводимую исходную точку.

Работы:

- собрать 30–50 golden circuits;
- выделить micro/medium/stress corpus;
- добавить benchmark runner;
- измерять CPU/latency/result quality;
- добавить Arduino sketches corpus;
- снять текущий main-thread profile;
- сохранить baseline report с exact SHA;
- отдельно измерить browser bundle/chunk loading.

Обязательные типы схем:

- resistor divider;
- LED normal/overcurrent/reverse;
- RC charge/discharge;
- potentiometer;
- button/SPDT;
- photoresistor;
- TMP36;
- soil sensor;
- transistor regions;
- motor startup/stall/thermal;
- regulated supply current limit;
- multimeter;
- function generator / oscilloscope supported cases;
- Arduino GPIO/ADC/PWM/tone;
- несколько Arduino boards;
- invalid/unsupported/nonconvergent cases.

**Gate:** corpus deterministic; baseline report создан автоматически; ни одна метрика не измеряется вручную через субъективное «быстро».

---

### E-OPT-1 — Portable Engine Boundary

**Цель:** сделать вычислительное ядро переносимым.

Работы:

- определить `ElectronicsEngine` public contract;
- сократить public exports до намеренно поддерживаемой поверхности;
- отделить ASA module descriptor от engine;
- удалить UI/API dependencies из чистого engine graph;
- ввести versioned engine/model capability descriptor;
- добавить standalone Node/browser contract tests;
- добавить dependency-boundary rule для `context:electronics`.

Пример целевой поверхности:

```ts
createEngine(options)
parseDocument(input)
validateDocument(document)
compile(document)
solve(document, options)
advance(document, previousState, targetTime, options)
reset(document)
capabilities()
```

**Gate:** engine используется из минимального тестового consumer без React, ASA API и DB.

---

### E-OPT-2 — Dedicated Electronics Worker

**Цель:** убрать solver и Arduino execution с UI thread.

Worker protocol обязан иметь:

- protocol version;
- engine revision;
- request id;
- generation id;
- document/input digest;
- requested horizon;
- cancellation;
- typed result/error;
- timing metrics;
- stale response protection.

Работы:

- перенести solve/advance в Worker;
- UI оставляет только document commands и rendering;
- debounce не определяет физику;
- stale computation отбрасывается;
- Worker crash даёт typed recoverable state;
- Reset создаёт новый generation.

**Gate:** stress corpus не создаёт solver-induced long task на main thread; результат совпадает с direct-engine golden result.

---

### E-OPT-3 — Canonical Electronics Clock

**Цель:** сделать время физическим, а не UI-временем.

Существующий Arduino circuit scheduler используется как основа единого orchestration layer; не создаётся третий независимый scheduler.

Нужно отделить:

- canonical simulation time;
- physics barriers;
- adaptive electrical substeps;
- Arduino instruction/events;
- input events;
- display sampling frequency.

UI может обновляться 30/60/120 FPS или зависнуть на секунду; это не должно менять результат одного и того же simulation horizon.

**Gate:** один event trace воспроизводится byte-for-byte независимо от UI refresh cadence.

---

### E-OPT-4 — Solver / DeviceModel hardening

**Цель:** стабилизировать численную и физическую основу до массового расширения каталога.

Работы:

- инвентаризация legacy component-specific branches;
- перенос допустимых веток в DeviceModel/profile;
- typed convergence diagnostics;
- conditioning/singularity cases;
- timestep convergence tests;
- tolerance policy по классам моделей;
- numerical safety limits;
- профили источников и нагрузок;
- golden analytical fixtures;
- reference-validation для ключевых схем.

Validation pyramid:

1. аналитическое решение;
2. datasheet/reference point;
3. независимый circuit reference, где применимо;
4. ASA solver;
5. browser/worker parity.

Нельзя объявлять SPICE-grade точность только потому, что unit tests зелёные.

**Gate:** все production-supported models имеют model identity, физическую basis, reference fixtures и deterministic tests.

---

### E-OPT-5 — Arduino Runtime Hardening

**Цель:** подготовить runtime к реальным периферийным устройствам.

Логические подсистемы:

- tokenizer/parser;
- IR/control flow;
- Uno numeric semantics;
- scope/variables;
- builtins;
- GPIO/ADC/PWM;
- virtual clock;
- event queue;
- peripheral runtime;
- serializable state;
- diagnostics/capabilities.

Сначала стабилизировать:

- `millis()` / `micros()`;
- `delay()` / `delayMicroseconds()`;
- edge/event scheduling;
- timed PWM representation;
- `pulseIn()` foundation;
- Serial runtime foundation;
- deterministic reset;
- bounded execution and infinite-loop protection.

Отдельный spike обязан сравнить:

A. развитие текущего source-level runtime;

B. AVR emulation;

C. hybrid model.

Критерии выбора: compatibility, browser size, speed, determinism, diagnostics, licensing, implementation cost. Решение принимается по benchmark/prototype, не по предпочтению.

**Gate:** supported sketch corpus детерминирован, unsupported syntax/API диагностируется до запуска и не выполняется частично.

---

### E-OPT-6 — Sensors and peripherals

**Цель:** после clock/runtime foundation расширять реальную лабораторию.

Порядок первой волны:

1. Servo SG90;
2. HC-SR04 / PING ultrasonic;
3. PIR sensor;
4. Serial Monitor;
5. I2C foundation;
6. common I2C display/sensor;
7. SPI foundation;
8. IR receive/transmit;
9. NeoPixel / timing-sensitive output.

Servo и ultrasonic **не реализуются через UI timers**. Они потребляют canonical peripheral clock.

Каждый компонент проходит единый checklist:

- owner SVG provenance;
- physical size;
- terminals;
- electrical identity;
- model/profile;
- Arduino peripheral integration при необходимости;
- inspector/help;
- tests;
- golden fixture;
- browser evidence;
- capability registry.

**Gate:** UI не рекламирует возможность, которой runtime не поддерживает.

---

### E-OPT-7 — UI / assets / maintainability

После отделения engine:

- разбить крупные React/controller hotspots;
- lazy-load code editor/instruments/peripherals;
- исключить повторные parse/clone/canonicalize на каждый render;
- уменьшить document-wide recomputation;
- memoize derived topology по digest/version;
- не загружать component database вне Electronics route;
- измерить SVG/catalog memory;
- убрать duplicate hand-maintained registries.

**Gate:** улучшение подтверждено bundle/runtime benchmarks, а не только уменьшением строк файла.

---

### E-OPT-8 — Portability proof

Создать маленький standalone example, который не использует ASA Lab portal.

Он должен:

- загрузить Electronics engine;
- создать или прочитать схему;
- запустить Worker;
- выполнить simulation;
- показать результаты;
- выполнить Arduino example;
- работать с локальным in-memory persistence adapter.

Добавить `PORTING.md`:

- install/build;
- public API;
- worker integration;
- document schema;
- model extension;
- host adapter;
- supported browser baseline;
- version compatibility.

**Gate:** перенос проверяется кодом, а не утверждением в README.

---

### E-OPT-9 — Electronics v1 hardening gate

Финальный gate включает:

- format/lint/typecheck;
- electronics boundaries;
- engine unit tests;
- golden circuits;
- Arduino corpus;
- solver quality checks;
- Worker parity;
- benchmark budget;
- browser E2E;
- standalone portability example;
- generated component coverage;
- generated Arduino capability coverage;
- no unsupported silent fallback.

Только после этого допускается формулировка `portable Electronics v1 foundation`.

---

## 7. Что делать с документацией

Документацию **не переписывать целиком**.

Текущий большой `docs/product/electronics/README.md` остаётся нормативным product contract.

Оптимизируется документационный процесс:

1. один execution plan — этот файл;
2. live state — только `docs/execution/current.yaml`;
3. capability tables генерируются из registry/code;
4. benchmark reports генерируются;
5. component coverage генерируется;
6. architecture decisions оформляются короткими ADR только при реальном выборе;
7. вручную не дублируются списки поддерживаемых Arduino API и components.

Необходимо постепенно выделить из огромного README ссылки на специализированные документы, но не создавать вторые источники истины:

- `ARCHITECTURE.md`;
- `ARDUINO_RUNTIME.md`;
- `COMPONENT_MODEL_SDK.md`;
- `PORTING.md`;
- generated capability/coverage reports.

Это **не отдельный проект по документации**. Такие файлы создаются вместе с соответствующей инженерной работой.

---

## 8. Правила для агентов разработки

1. Один этап не расширяется самовольно соседними features.
2. Перед изменением solver сначала добавляется failing/reproduction fixture.
3. Optimizing refactor должен сохранять golden result либо иметь зафиксированное обоснованное изменение модели/version.
4. Новая component physics не добавляется в UI.
5. Новая Arduino capability сначала появляется в runtime/capability registry, затем в blocks/reference UI.
6. Нельзя замалчивать unsupported path fallback-значениями.
7. Worker не должен иметь собственную копию формул, отличающуюся от engine.
8. Server verification не должен иметь собственную альтернативную физику.
9. Performance change обязан иметь before/after report.
10. Большой рефактор разбивается на вертикальные slices с gates.
11. Owner assets и рабочая БД неприкосновенны.
12. Deployment не выполняется автоматически после merge.

---

## 9. Definition of Done переносимого Electronics

Версия считается готовой как переносимая основа только если одновременно выполнено:

- engine собирается отдельно;
- public API versioned;
- dependency graph не тащит portal/auth/learning/UI;
- continuous simulation выполняется в Worker;
- main thread не содержит solver loop;
- один canonical time contract обслуживает circuit + Arduino;
- server и browser используют один engine/model set;
- deterministic golden corpus проходит;
- numerical quality gates проходят;
- CPU/RAM/latency budgets проходят;
- component support генерируется из registry;
- Arduino support генерируется из runtime capability registry;
- standalone consumer проходит CI;
- supported peripherals имеют reference fixtures;
- unsupported capabilities fail closed;
- текущие проекты открываются совместимо;
- рабочий ASA Lab UI сохраняет функциональность.

---

## 10. Ближайшая последовательность

Первая реализация выполняется в строгом порядке:

`E-OPT-0 baseline`  
→ `E-OPT-1 portable engine boundary`  
→ `E-OPT-2 Worker`  
→ `E-OPT-3 canonical clock`  
→ `E-OPT-4 solver/model hardening`  
→ `E-OPT-5 Arduino runtime`  
→ `E-OPT-6 peripherals`.

Новые датчики до завершения E-OPT-3 добавляются только если они не создают новый временной или solver special-case и необходимы для устранения регрессии.

### Первый практический checkpoint

Первым изменением кода является **не новый датчик**, а benchmark harness E-OPT-0.

Он должен дать численный ответ:

- сколько сейчас занимает DC solve;
- сколько занимает transient solve;
- сколько стоит Arduino+circuit clock;
- сколько памяти потребляет small/medium/stress circuit;
- насколько React/main thread блокируется текущим live path;
- какой размер Electronics route и catalog;
- какой вклад даёт serialization/digest;
- где находятся реальные hotspots.

После этого следующий refactor выбирается на данных.

---

## 11. Итоговая инженерная позиция

ASA Lab Electronics уже имеет полезное и достаточно зрелое физическое ядро. Основной риск сейчас — не отсутствие формул, а рост связности вокруг solver, наличие разных temporal paths, выполнение live calculation в web main-thread path и неполная граница переносимого engine.

Поэтому стратегия:

> **сначала измерить → изолировать engine → вынести вычисление в Worker → унифицировать время → доказать физические модели → укрепить Arduino → затем расширять реальные датчики и peripherals.**

Документация сопровождает этот процесс и предотвращает архитектурный дрейф; она не подменяет саму оптимизацию.
