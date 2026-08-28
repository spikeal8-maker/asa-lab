# ASA Lab Electronics — единая спецификация системы

**Статус документа:** нормативный.
**Область:** электронная лаборатория ASA Lab: редактор схем, компоненты,
электрическая симуляция, инспектор, справка, сохранение и будущий Arduino
runtime.
**Текущее исполнение:** только
[`docs/execution/current.yaml`](../../execution/current.yaml). Этот документ не
хранит активный checkpoint, Issue, PR, SHA, результат CI или production revision.

## 1. Назначение

Electronics — единая образовательная среда, в которой пользователь может:

1. выбрать настоящий компонент из каталога;
2. разместить и повернуть его с сохранением физического масштаба;
3. соединить выводы напрямую или через макетную плату;
4. запустить поддерживаемый расчёт;
5. увидеть токи, напряжения, мощность и состояние компонентов;
6. наблюдать видимые последствия ошибочного подключения;
7. остановить, сохранить и повторно открыть ту же схему;
8. после завершения электрического ядра программировать Arduino блоками и C++.

Референс взаимодействия — Tinkercad Circuits и owner evidence. ASA Lab не
копирует чужие закрытые исходники или artwork. Используются только разрешённые
owner SVG и собственный код.

## 2. Нормативность и источники истины

| Слой | Единственный источник | Что ему запрещено определять |
| --- | --- | --- |
| Активная работа | `docs/execution/current.yaml` | постоянные продуктовые требования |
| Продуктовый контракт | этот документ | SHA, CI и временный checkpoint |
| Owner artwork | `apps/web/public/assets/electronics/owner-supplied/manifest.json` и защищённые SVG | электрические формулы |
| Каталог | production component manifest и adapter | runtime-измерения |
| Электрическая идентичность | `contexts/electronics/domain/model-identity.ts` | UI и геометрию |
| Model registry | `contexts/electronics/domain/model-registry.ts` | SVG и каталог |
| Solver | `contexts/electronics/domain/solver.ts` и DeviceModel | самостоятельную UI-анимацию |
| Inspector/help | типизированные профили и help content | вычисление электрической истины |
| Проверки | package scripts и GitHub workflows | owner acceptance |
| Production | `/api/version` и `/health/ready` | требования будущих этапов |

Машинные контракты находятся в [`contracts/`](contracts/). Они не являются
второй человеческой документацией: это входы автоматических валидаторов.

Статус машинного ledger (`proposed`, `approved`, `superseded`) описывает
готовность набора требований и evidence, а не отменяет нормативность этого
документа. `pending_owner` запрещает заявлять принятым только конкретное решение,
но не разрешает runtime выбрать поведение самостоятельно. Принятое
owner-направление фиксируется как `owner_direction`; `approved` требует
датированного resolution и SHA, на котором оно было проверено.

### 2.1. Текущее состояние и целевой контракт

В этом документе слова имеют точное значение:

- **инвариант** — обязан выполняться каждым принимаемым изменением уже сейчас;
- **текущий контракт** — имя и форма, которые существуют в production types;
- **целевой контракт** — требование будущего вертикального среза;
- **этап** — порядок реализации, а не заявление о готовности;
- **проверено** — есть тест и evidence на том же SHA;
- **принято владельцем** — есть owner acceptance, не заменяемый CI.

Целевая архитектура не выдаётся за существующую. Пока общий solver содержит
legacy-ветки конкретных компонентов, DeviceModel migration считается частичной.
Наличие компонента в каталоге, SVG, инспектора или identity также не означает
наличие электрической модели.

## 3. Неизменяемые правила

1. Netlist определяется соединёнными терминалами, а не формой провода.
2. Breadboard hole groups входят в те же электрические сети.
3. Все численные результаты конечны; `NaN` и `Infinity` запрещены.
4. Неизвестная или неподдерживаемая модель завершает документ как
   `unsupported`; частичный ложный `solved` запрещён.
5. Опасный режим уже поддерживаемой модели не является `unsupported` и не
   блокирует Start.
6. Короткое замыкание, перегрузка, обратная полярность, stall и LED без
   резистора рассчитываются и показывают локальное последствие.
7. Диагностика принадлежит конкретному компоненту, терминалу, проводу или сети;
   независимые цепи не получают чужую аварию.
8. KCL, остаток идеального источника и баланс мощности проверяются независимо.
9. Одинаковый документ и analysis request дают детерминированный результат.
10. Сортировка терминалов выполняется посимвольно, без `localeCompare`.
11. Браузер рассчитывает локально до завершения autosave.
12. Сервер проверяет результат тем же ядром и model set.
13. UI не определяет ток, напряжение, нагрев или поломку.
14. Рассчитанное повреждение имеет видимое состояние на самой детали.
15. Аварийная индикация минималистична: без новых постоянных панелей, toast и
    перекрывающих схему подписей.
16. Owner SVG не перерисовывается и не заменяется PNG, tracing или generated
    artwork.
17. Неизвестные поля будущей схемы не должны молча уничтожаться старым runtime.

## 4. Архитектура продукта

```text
Component Library
  → CircuitDocument
  → terminal topology / breadboard groups
  → normalized netlist
  → model identity + profile
  → DeviceModel stamping
  → solver
  → observations + diagnostics + damage state
  → inspector / SVG / sound
  → save, reload and server verification
```

Каждый слой отвечает только за свою часть. В общем solver не добавляются новые
ветки вида `componentTypeId === ...`, если поведение можно выразить DeviceModel.
Временные legacy-ветки удаляются после доказанного parity перенесённой модели.

## 5. CircuitDocument

Документ хранит только пользовательское и версионируемое состояние:

- stable component IDs;
- `componentTypeId` и `variantId`;
- позицию и rotation кратно 45 градусам;
- terminal IDs и connections;
- свойства пользователя;
- viewport;
- код и настройки Arduino после активации программируемого этапа;
- additive model/profile identity.

Документ не хранит вычисленные токи, напряжения, яркость, температуру или
диагностику как постоянную истину. Additive migration обязана читать прежние
схемы и давать `unsupported` неизвестной модели.

Forward compatibility считается выполненной только после проверки полного
`parse → edit → serialize` round-trip. Неизвестные поля сохраняются в
типизированном additive-контейнере `extensions` либо другим явно
версионированным механизмом. Парсер, который собирает новый объект только из
известных ключей, **не** удовлетворяет этому требованию. До появления такого
механизма runtime обязан отклонить более новую schema version, а не открыть её с
потерей данных. Миграция никогда не изменяет owner assets, а вычисленные
результаты не становятся частью сохранённой электрической истины.

## 6. Component Library

### 6.1. Карточка каталога

Карточка показывает только:

- утверждённое название семейства;
- owner SVG preview;
- доступность размещения.

Варианты корпуса и параметров выбираются после размещения и не подменяют
название карточки. PNG и растровые изображения для рабочего компонента
запрещены. Компонент без подтверждённого SVG остаётся disabled/missing.

### 6.2. Порядок и категории

Основной порядок следует подтверждённому Tinkercad reference, кроме отдельно
зафиксированных owner deviations. Micro:bit не входит в текущий продуктовый
путь; его позиция может использоваться для семисегментного индикатора только по
явному owner-решению.

Категории не определяют электрическую модель. Несколько визуальных вариантов
могут использовать один model ID и разные profiles.

### 6.3. Новый компонент

Компонент считается подключённым к системе только когда существуют:

1. owner provenance;
2. manifest entry;
3. физический размер;
4. pin anchors и terminal roles;
5. placement, selection, rotation и delete;
6. breadboard/wiring fixture;
7. inspector profile;
8. electrical identity;
9. DeviceModel либо честный `unsupported`;
10. focused tests и browser evidence.

Размещение компонента и поддержка симуляции — разные возможности.

## 7. Stage, selection и rotation

- Выделение компонента имеет один общий визуальный контракт для всего каталога.
  Для owner SVG контур MUST повторять непрозрачный силуэт фактически
  отрисованного SVG после всех `meet`/`stretch`, scale и rotate transforms.
  Прямоугольник, овал, capsule или вручную подобранные bounds вокруг отдельного
  типа компонента запрещены.
- Для программно построенного векторного компонента допускается только контур,
  повторяющий ту же геометрию тела и выводов. Отдельная bounding-box рамка не
  является выделением компонента.
- Толщина и цвет выделения едины для всех компонентов и визуально остаются
  постоянными при zoom. Контур не перекрывает изображение, не меняет размер,
  координаты, hit area или pin anchors компонента.
- Поворот, отражение и вариант компонента применяются одинаково к изображению и
  его контуру. Нельзя исправлять clipping частным стилем для одного компонента:
  исправляется общий transform/filter pipeline.
- При выделении терминалы могут становиться видимыми отдельно от контура. Hit
  area остаётся невидимой и никогда не используется как форма обводки.
- Диагностика, hover, simulation state и selection — разные слои. Ошибка или
  активность не должны менять геометрию контура выделения.
- Компонент перемещается только при захвате его реального тела или выделенной
  hit area, а не большой прозрачной SVG-области.
- Провод имеет приоритет выбора над компонентом под ним.
- Rotation выполняется шагом 45° вокруг физического центра компонента.
- Pin anchors вращаются тем же transform и остаются на выводах.
- Масштаб определяется макетной платой и шагом 2.54 мм.
- Открытие боковой панели не изменяет координаты схемы; viewport остаётся
  независимым.
- Fit/zoom центрируют содержимое внутри фактической рабочей области.

## 8. Провода и breadboard

Wire flow:

```text
pointer/touch down on terminal
→ видимый draft wire
→ optional bend points
→ snap to compatible terminal
→ one connection mutation
→ immediate local recalculation
```

Требования:

- доступные touch targets не меньше практического мобильного минимума;
- геометрия bend points не влияет на topology;
- endpoint можно выбрать поверх компонента;
- удаление компонента удаляет или корректно инвалидирует связанные провода;
- breadboard hole group имеет детерминированный net ID;
- save/reload сохраняет endpoints, color и vertices.

## 9. Единый инспектор

Для каждого компонента используется одна и та же трёхуровневая модель.

### 9.1. Компактное состояние

По умолчанию отображаются только:

- название компонента;
- минимальные редактируемые параметры, необходимые для работы;
- рядом две одинаковые компактные кнопки `I` и `?`.

Запрещены отдельная кнопка «Ещё параметры», повторяющиеся вкладки и постоянные
таблицы всех выводов.

### 9.2. Техническое состояние `I`

`I` раскрывает свойства и рассчитанное состояние выбранного экземпляра:

- terminal connectivity;
- ток, напряжение, мощность;
- operating region;
- температура/скорость/яркость, если модель их возвращает;
- пороги warning/failure;
- локальные diagnostics.

Кнопка нейтральна без проблемы, янтарная при warning и красная при error.
Числа появляются только из результата solver. Unsupported не показывает
фиктивные нули.

### 9.3. Учебная справка `?`

`?` открывает справку о семействе, не о runtime-состоянии экземпляра:

- назначение;
- принцип работы;
- выводы и полярность;
- типовое подключение;
- ограничения и безопасность;
- простой пример.

На desktop справка занимает область component library. На mobile используется
полноэкранный слой с явным закрытием и восстановлением предыдущего состояния.

### 9.4. Решения component information

Машинный ledger обязан содержать те же decision IDs:

- `DEC-INFO-001` — свойства, runtime state и help разделены;
- `DEC-INFO-002` — help временно заменяет каталог и возвращает его состояние;
- `DEC-INFO-003` — `I` является нейтральным control с severity state;
- `DEC-INFO-004` — `!` используется только как локальный diagnostic badge;
- `DEC-INFO-005` — mobile help открывается отдельным полноэкранным слоем;
- `DEC-INFO-006` — непроверенная help content не выдаётся за опубликованную.
- `DEC-INFO-007` — diagnostic badge является экранным слоем и не вращается,
  не зеркалится и не масштабируется вместе с деталью.

Единый контракт `!` для всех компонентов:

- значок появляется только при реальном локальном warning/error или при честном
  `unsupported`; штатные состояния «цепь разомкнута», «диод закрыт» и «нет
  нагрузки» не являются поводом для значка;
- один компонент показывает не более одного значка; подробности и численные
  значения остаются в `I`;
- warning имеет янтарный круг `#F4A51C`, error — красный `#E43B32`, знак внутри
  всегда белый;
- диаметр на экране равен 18 px и не меняется при zoom; центр привязан к правой
  верхней области повёрнутого bounding box компонента;
- `!` остаётся вертикальным при любом rotation/mirror детали. Он не входит в
  SVG, selection outline или физическую систему координат детали;
- destructive visual (например, звезда перегоревшего LED) является отдельным
  физическим состоянием, а не вариантом обычного diagnostic badge.

## 10. Электрическая модель

Каждый нормализованный компонент имеет:

```text
componentTypeId
variantId
electricalModelId
electricalModelVersion
modelProfileId
modelProfileVersion
```

Model profile — данные без исполняемого кода. Он хранит параметры, единицы,
диапазон, provenance и educational assumptions. Формулы находятся в DeviceModel.

### 10.1. Единицы, знаки и опорный потенциал

- Внутренние расчёты используют SI: V, A, Ohm, F, H, W, J, s, K, rad/s.
- UI может показывать mV, mA, kOhm и °C, но конвертация и округление происходят
  только в presentation layer и не входят в canonical result digest.
- Ток терминала положителен, когда входит в физический терминал компонента.
- Напряжение компонента всегда указывает объявленную пару `positiveTerminal →
  negativeTerminal`; скрытая зависимость от порядка массива запрещена.
- Целевой signed-power contract использует положительную мощность для
  поглощения и отрицательную для отдачи в сеть. Текущее legacy-поле
  `ComponentResult.power` во многих моделях содержит неотрицательную
  рассеиваемую мощность и не используется для определения направления передачи
  энергии. Переход на signed power принимается только вместе с types, solver,
  UI, energy-balance fixtures и server parity.
- Ground/reference node выбирается детерминированно из topology. Отсутствие
  явного GND в плавающей, но разрешимой цепи не меняет разности потенциалов;
  абсолютный reference описывается в diagnostics.
- Несовместимые источники не блокируют поддерживаемую симуляцию: каждый
  размещаемый source profile обязан иметь конечное защитное внутреннее
  сопротивление, а solver возвращает circulating current и destructive
  observations. `invalid` допустим только для некорректного model contract;
  бесконечный ток запрещён.
- Все profile constants имеют единицу, диапазон, provenance и версию. Значение
  без единицы не допускается в model registry.

### 10.2. Электрические острова и несколько источников

Normalized netlist разделяется на connected electrical islands. Для каждого
острова независимо выбирается reference node: сначала явный GND, иначе
лексикографически минимальный terminal key по ordinal comparison. Reference
одного острова не влияет на напряжения, токи или diagnostics другого.

Обязательная MATH-1 source matrix:

| Схема | Ожидаемый результат |
| --- | --- |
| три независимых исправных острова | три локальных результата без общей аварии |
| direct short одного finite-R источника | `solved` с destructive observation только этого источника |
| последовательные источники | алгебраическая сумма с declared polarity |
| параллельные одинаковые finite-R источники | конечное распределение токов |
| параллельные разные finite-R источники | конечный circulating current, `delivering`/`absorbing` и локальный stress |
| несовместимые источники | защитная finite-R модель, destructive preview без `NaN`/`Infinity` |
| встречная полярность | конечный расчёт, backfeed diagnostic и локальный stress |
| общий GND и независимые нагрузки | диагностика остаётся привязанной к своему branch/net |

Наличие unsupported-компонента по-прежнему делает весь document `unsupported`:
локальный расчёт других островов не выдаётся как частичный `solved`. Опасная, но
поддерживаемая цепь с конечными параметрами рассчитывается полностью.

Минимальная ответственность DeviceModel:

- validate parameters and terminals;
- normalize parameters;
- stamp DC/nonlinear/transient equations через ограниченный context;
- управлять собственным runtime state;
- возвращать terminal currents и observations;
- классифицировать stress/damage по рассчитанным величинам.

Модель не получает React, DOM, viewport, SVG или repository services и не имеет
права самостоятельно объявлять весь документ `solved`.

## 11. Результат симуляции

Текущий канонический TypeScript-контракт разделяет:

- `SolveResult.status`: `solved | invalid | unsupported | nonconvergent`;
- `SolveResult.solved`: совместимый boolean, который не заменяет `status`;
- `deviceHealth`: `normal | warning | overheated | failed_open | failed_short |
  stalled | reverse_damaged`;
- `damageState`: `none | destructive_preview | failed`;
- `presentationState`: `normal | warning | destructive | failed | stalled`;
- terminal currents, voltage, power и model-specific observations;
- diagnostics с anchors.

Новые имена (`analysisStatus`) или другое множество состояний нельзя вводить
только в документации. Изменение контракта выполняется одним срезом: types,
serializer, browser, server, fixtures и migration. Конкретный post-failure
режим (`open`, `short`, finite resistance, stalled) хранится как типизированная
observation/profile state, а не подменяет общий `damageState`.

Сходящийся расчёт может быть `solved`, пока один компонент находится в warning
или failed. После появления transient отказ компонента переключает его на
профильную post-failure модель и расчёт остальных частей продолжается.

## 12. Численная приёмка

| Проверка | Предел |
| --- | --- |
| Finite values | 100% |
| KCL residual | `<= 1e-6 A` |
| Ideal-source voltage residual | `<= 1e-9 V` |
| Линейная аналитическая схема | `abs <= 1e-9` или `rel <= 1e-7` |
| DC power balance | `max(1e-9 W, 1e-6 × supplied power)` |
| Детерминизм | байт-в-байт одинаковая сериализация |
| Browser/server parity | одинаковые identity, digest, status и значения в допуске |

Expected values не могут быть получены только тем solver, который проверяется.
Нужен analytical, measurement или независимый reference с provenance.

### 12.1. Сходимость и ресурсные пределы

- nonlinear loop имеет объявленный предел итераций, норму residual и damping;
- GMIN/source stepping разрешены только как детерминированные именованные фазы;
- исчерпание пределов возвращает `nonconvergent`, а не последние числа как
  `solved`;
- transient отклоняет неудачный шаг, откатывает runtime state и уменьшает шаг;
- solver timestep не зависит от FPS и частоты отрисовки;
- число retry, минимальный/максимальный timestep и sample cadence ограничены;
- устаревший browser job отменяется или игнорируется по input digest;
- server verification имеет timeout и те же численные пределы;
- обязательный performance fixture фиксирует число компонентов, сетей, шагов,
  p50/p95 времени и peak memory. Конкретные бюджеты утверждаются evidence до
  активации transient в production и затем становятся regression gate.

## 13. Опасные режимы и повреждение

Обязательный путь:

```text
electrical stress
→ calculated observation
→ warning threshold
→ destructive threshold
→ visible local state
→ post-failure model
→ recalculation of the remaining circuit
```

До transient-ядра разрешён только честный `destructive_preview`: численные
значения остаются видимыми, но накопленное время повреждения не выдумывается.
После transient нагрев, энергия и время отказа не зависят от FPS.

Runtime damage живёт только внутри одного simulation run. `Stop`, `Reset` и
новый `Start` создают чистое runtime state из сохранённого CircuitDocument.
Повреждение не autosave-ится как физически испорченный экземпляр, пока владелец
отдельно не активирует persistent damage. Переход в failure выполняется только
после принятого transient step; отклонённый шаг не оставляет частичного нагрева
или отказа. После failure solver применяет объявленную profile-модель (`open`,
`short`, finite resistance или stalled), пересчитывает оставшуюся цепь и
сохраняет локальную привязку причины.

### 13.1. Нормативные решения математического ядра

- `DEC-MATH-001` — математика развивается вертикальными срезами, не после
  завершения всего визуала;
- `DEC-MATH-002` — доступность в каталоге не равна model readiness;
- `DEC-MATH-003` — модель выбирается только versioned model/profile identity;
- `DEC-MATH-004` — один production solver авторитетен; comparator не выдаёт
  второй результат пользователю;
- `DEC-MATH-005` — TypeScript baseline сохраняется до доказанного parity любой
  Rust/WASM замены;
- `DEC-MATH-006` — model не изменяет document, SVG или UI;
- `DEC-MATH-007` — model time не зависит от FPS;
- `DEC-MATH-008` — unsupported topology всегда fail-closed;
- `DEC-MATH-009` — опасная поддерживаемая цепь рассчитывается, а не блокируется;
- `DEC-MATH-010` — solve status отделён от health, damage и presentation;
- `DEC-MATH-011` — damage видим локально на компоненте;
- `DEC-MATH-012` — UI только отображает observations;
- `DEC-MATH-013` — Stop/Reset/new Start очищают runtime damage;
- `DEC-MATH-014` — runtime damage не сохраняется без отдельного owner-решения;
- `DEC-MATH-015` — post-failure модель продолжает расчёт оставшейся цепи;
- `DEC-MATH-016` — diagnostics минимальны, локальны и не засоряют Stage.

## 14. Порядок развития математического ядра

### VISUAL-0 — физическая основа

- размещаемый DC motor и вертикальный DO-41;
- корректные размеры, rotation, pin anchors и breadboard placement;
- при отсутствии модели — честный `unsupported`.

### MATH-0 — контракт и baseline

- versioned model/profile registry;
- additive CircuitDocument normalization;
- fixture schema, model set digest и solver revision;
- измеренный performance baseline;
- разделённые analysis/health/damage/presentation states;
- unknown-model fail-closed fixtures.

### MATH-1 — источник и резистор

- DeviceModel для источника и резистора;
- finite internal resistance и battery variants;
- terminal-current KCL;
- open, divider, series, parallel, independent sources и conflicting sources;
- short/overload observations и локальный visual state;
- browser/server parity.

Source observation различает `delivering`, `idle` и `absorbing`. Обратный ток
не превращается в общий запрет запуска: связанный остров продолжает считаться,
а `conflicting_sources` получает anchors только участвующих источников. Равные
параллельные источники без circulating current не получают ложную диагностику;
свободный источник в другом острове остаётся `idle`.

### MATH-2 — диод и LED

- общий bounded nonlinear iteration loop;
- параметрические DO-35 и DO-41 profiles;
- LED profile по цвету, forward curve, current и power limits;
- reverse, resistor-less, series и parallel fixtures;
- brightness/damage только из observations;
- отсутствие component-specific nonlinear веток в общем solver.

Профили осевых диодов задаются в едином versioned nonlinear registry. Owner
вариант `DO-35` использует допущения класса 1N4148: 200 мА непрерывного тока и
100 В повторяющегося обратного напряжения по первичному datasheet Nexperia
([1N4148/1N4448](https://assets.nexperia.com/documents/data-sheet/1N4148_1N4448.pdf)).
Owner вариант `DO-41` использует допущения класса 1N4007: 1 А среднего прямого
тока, 1000 В повторяющегося обратного напряжения и контрольную точку до 1,1 В
при 1 А по datasheet Vishay
([1N4001–1N4007](https://www.vishay.com/docs/88503/1n4001.pdf)). Это модельные
профили пакетов, а не заявление, что любой внешний SVG автоматически является
конкретным артикулом производителя.

Безопасное обратное включение обычного диода является штатным запирающим
режимом и не получает ложную ошибку полярности. Превышение объявленного VRRM
остаётся рассчитанным `destructive_preview`: схема не блокируется, компонент
получает локальное состояние `reverse_damaged`, а накопленный физический отказ
не выдумывается до transient-ядра MATH-4. Численные профили входят в
`modelSetDigest`, поэтому изменение кривой не может выдаваться за тот же набор
моделей.

DO-35 и DO-41 используют только подтверждённые горизонтальные owner SVG с
физическими концами выводов на расстоянии 10,16 мм. DO-35 поворачивает исходный
owner SVG внутри совместимой с прежними документами вертикальной рамки, а смена
варианта переносит относительный поворот на DO-41. Поэтому уже сохранённая схема
не меняет ориентацию, а электрические точки совпадают с концами металлических
выводов. Отдельная упрощённая runtime-перерисовка DO-35 запрещена. Нулевой ток сам по себе
не является диагностикой: разомкнутый переключатель и запертый обычный диод —
нормальные рабочие состояния. Маркер появляется только при реальном превышении
предела, конфликте источников, коротком замыкании или иной физической проблеме.
Техническая карточка `I` показывает рассчитанное состояние перехода: проводит,
заперт прямым или обратным смещением либо находится в пробое. Справка `?`
объясняет назначение обоих вариантов и их модельные пределы; общий совет
«подключите два вывода» не подменяет это сравнение.

#### MATH-2 LED — обязательная матрица приёмки

Граница пакета — только обычный двухвыводный LED. RGB LED, Arduino-индикаторы,
transient-нагрев и накопленный отказ относятся к отдельным этапам и не могут
быть незаметно добавлены в этот пакет.

- один nonlinear branch используется для всех цветов; цвет выбирает versioned
  профиль, но не создаёт отдельную ветку общего solver;
- для красного, оранжевого, жёлтого, зелёного, синего и белого проверяются
  конечные ток, напряжение, мощность и непрерывная яркость;
- fixtures включают безопасную последовательную цепь, прямое подключение без
  резистора, обратное включение, два LED последовательно и независимые
  параллельные ветви;
- штатное обратное запирание не является ошибкой и не показывает маркер;
  превышение обратного предела остаётся рассчитанным разрушительным состоянием;
- `I` показывает состояние перехода, ток, напряжение, мощность, яркость,
  номинальный ток, разрушительный ток и допустимое обратное напряжение;
- `?` кратко объясняет влияние цвета, прямое и обратное включение и пределы
  модели; универсальный текст про два контакта запрещён;
- на холсте нет новых карточек, плашек и текстовых предупреждений: свет виден
  на SVG, а локальный минимальный индикатор появляется только при реальном
  превышении предела;
- Stop скрывает рассчитанное состояние текущего запуска. Накопленная во времени
  температура и постоянный отказ не имитируются статическим DC-расчётом: это
  критерий MATH-4, а не повод хранить выдуманное состояние в UI;
- приёмка требует focused solver/UI tests, typecheck и web build без Nx cache;
  browser journey отдельно доказывает нормальный, запертый, перегруженный и
  разрушительный визуальные режимы на опубликованной сборке.

Корректирующая owner-матрица перед MATH-3:

- красный LED от 3 В через 1 кОм имеет конечный ток, `lit: true` и тусклую, но
  заметную яркость в диапазоне 15–35%; изменение сопротивления остаётся
  непрерывным и монотонным;
- diagnostic badge при rotation 0/45/90/180/270° сохраняет экранную ориентацию,
  цвет severity и размер 18 px;
- положение потенциометра, выбранное одним и тем же локальным жестом, совпадает
  при rotation 0/45/90/180/270°;
- напряжение фиксированной батареи или батарейного отсека не редактируется:
  вариант задаёт число элементов и номинальное напряжение; `I` показывает
  рассчитанное напряжение на клеммах, просадку, нагрузку и нагрев.

### MATH-3 — NPN key

- generic NPN TO-92 DeviceModel;
- cutoff, active и saturation;
- `Ib`, `Ic`, `Ie`, power и operating region;
- bounded junction evaluation и declared Early effect;
- overload visual state и независимый reference sweep.

### MATH-4 — transient и конденсатор

- deterministic model time и scheduler;
- Backward Euler capacitor companion model;
- adaptive rejected-step handling;
- RC charge/discharge и NPN astable fixtures;
- thermal/energy accumulation;
- reproducible warning → overheat → failure;
- post-failure recalculation.

### MATH-5 — DC motor

Модель использует:

```text
V = R·i + L·di/dt + Ke·omega
J·domega/dt = Kt·i - b·omega - loadTorque
Pcu = i²·R
```

Обязательны startup, back-EMF, direction, load, stall, temperature, winding
failure, NPN drive и flyback diode. SVG вращается только от рассчитанной speed.

### MATH-6 — управляемые пассивные и переключатели

- **MATH-6A:** potentiometer как два связанных сопротивления с сохранением
  полного R;
- **MATH-6B:** photoresistor с versioned illumination-to-resistance profile;
- **MATH-6C:** кнопки и переключатели как детерминированное изменение topology;
- **MATH-6D:** лампа с электротепловой зависимостью и видимым failure;
- **MATH-6E:** RGB и seven-segment как независимые junctions без общей
  фиктивной яркости.

Каждый подпункт является самостоятельным вертикальным срезом и принимается
отдельно.

### MATH-7 — полупроводниковые расширения

- **MATH-7A:** PNP с independent reference sweep;
- **MATH-7B:** NMOS/PMOS с regions и bounded nonlinear evaluation;
- **MATH-7C:** дополнительные diode profiles и температурные assumptions;
- для каждого среза действуют единые sign conventions, а соответствующая
  component-specific legacy branch удаляется только после parity.

### MATH-8 — actuators и звук

- **MATH-8A:** piezo/buzzer с frequency, amplitude, source impedance и browser
  audio consent;
- **MATH-8B:** vibration motor с механическими пределами;
- **MATH-8C:** gearmotor с нагрузкой, редуктором и stall;
- **MATH-8D:** servo с управляющим сигналом, углом и ограничениями;
- визуальная анимация всегда следует рассчитанному состоянию, а DC/transient
  поддержка объявляется отдельно для каждого profile.

### MATH-9 — environment sensors

- **MATH-9A:** versioned environment input contract, не CSS-control;
- **MATH-9B:** temperature и soil moisture с диапазоном, transfer function,
  питанием и terminal behavior;
- **MATH-9C:** PIR и ultrasonic с детерминированным временем/событиями;
- sensor без утверждённой transfer function остаётся `unsupported`.

### MATH-10 — instruments и регулируемые источники

- **MATH-10A:** regulated supply — setpoint, current limit, CV/CC transition и
  finite output impedance;
- **MATH-10B:** multimeter — mode, polarity, input impedance, burden voltage и
  fuse state;
- **MATH-10C:** signal generator — waveform, amplitude, offset, frequency и
  output impedance;
- **MATH-10D:** oscilloscope — channel reference, input impedance, sample rate,
  timebase, trigger и bandwidth assumptions;
- probe geometry не меняет topology, а подключение probe меняет измерительный
  netlist предсказуемо.

Production activation этапа запрещена, пока его prerequisites не прошли
acceptance и owner review. Параллельная подготовка reference data, fixtures,
profiles и browser harness разрешена, если она не включает неподтверждённую
модель в production. Временная статическая модель компонента не закрывает
будущий этап.

## 15. Arduino и программирование

Arduino UI может развиваться визуально, но полноценный runtime активируется
после MATH-5 отдельным owner-решением. Он обязан включать:

- Blocks, Text и Blocks+Text;
- качественные Scratch-подобные блоки;
- детерминированную генерацию Arduino C++;
- syntax highlighting и diagnostics;
- compile/runtime boundary;
- GPIO, ADC, PWM, timing и supported libraries;
- Serial Monitor output/input/clear/baud;
- reset и LED L/TX/RX/ON states;
- код в versioned project digest;
- browser/server validation.

Code panel открывается сбоку и не закрывает выбранную Arduino. Ширина меняется
в пределах адаптивных min/max без изменения координат Stage. Открытие не должно
ждать загрузки необязательных блоков: тяжёлый редактор загружается лениво с
видимым bounded loading state.

Blocks contract включает отдельный масштаб toolbox и workspace, корректный
pointer/touch drag, fit-to-workspace, значения полей по умолчанию, создание
переменных и контекстное меню. Copy/delete применяется к выбранному блоку вместе
с присоединённым нижним стеком и поддерживает undo. Blocks+Text не обещает
обратимое преобразование произвольного C++ в блоки: граница round-trip должна
быть объявлена и протестирована.

Serial Monitor определяет input, output, clear, autoscroll, line endings и baud.
Clear очищает только видимый runtime log. Reset перезапускает код и runtime
board state, а LED `ON`, `L`, `TX`, `RX` получают состояние только от power,
GPIO и serial observations.

Наличие редактора или блока не означает наличие compiler/runtime.

## 16. Mobile contract

- Stage остаётся главным экраном.
- Component Library открывается снизу как sheet.
- Поиск может скрываться в компактном режиме.
- Терминалы, провода и controls доступны пальцем.
- Inspector открывается поверх нижней части без потери схемы.
- Help открывается полноэкранно.
- Code panel не перекрывает всю схему без возможности resize/collapse.
- Desktop document остаётся редактируемым на mobile и наоборот.
- Провод создаётся и переподключается точными endpoint handles; перемещение
  Stage двумя пальцами не перемещает компонент.
- Bottom sheet имеет collapsed, half и full состояния, не скрывает выбранный
  terminal без возможности свернуть его и восстанавливает поиск/категорию.
- Inspector `I` и help `?` доступны без hover; системная клавиатура не скрывает
  редактируемое поле или Start/Stop.
- Критические touch targets имеют минимум `44 × 44 CSS px`.
- Reduced motion отключает декоративное вращение и вспышки, сохраняя численное
  и статическое состояние.

## 17. Persistence и безопасность

- Autosave идемпотентен и не блокирует локальный расчёт.
- Save/reload сохраняет точный document, connections, properties и rotation.
- Unsupported или nonconvergent result не записывается как успешная физика.
- Учитель и public viewer не изменяют оригинал.
- Импорт проверяет schema, finite values, IDs и model versions.
- Никакие профили не содержат `eval` или клиентский исполняемый код.

### 17.1. Матрица покрытия каталога

Текущая готовность не переписывается вручную в этот документ. Обязательный
coverage validator должен строить матрицу из production catalog, owner manifest,
terminal registry, model identity, model registry, inspector/help profiles и
tests. Отсутствующий или устаревший generated artifact означает, что полнота
каталога не проверена. Для каждого доступного `componentTypeId + variantId`
обязательны колонки:

Канонический generated artifact: [`generated/component-coverage.json`](generated/component-coverage.json).
Focused gate пересчитывает его и останавливается, если файл устарел либо каталог
заявляет модель без установленной identity.

| Колонка | Допустимые значения |
| --- | --- |
| owner artwork | `verified | missing` |
| placement | `verified | unavailable` |
| physical scale | `verified | missing` |
| terminals | `verified | missing` |
| breadboard fixture | `verified | missing` |
| model identity | `verified | missing` |
| DC model | `verified | unsupported` |
| transient model | `verified | unsupported | not_applicable | unverified` |
| damage profile | `verified | unsupported | not_applicable | unverified` |
| inspector/help | `verified | missing | unverified` |
| browser evidence | `verified | missing | unverified` |

`enabled` разрешает размещение, но не подменяет model readiness. Любая строка с
`DC model: unsupported` делает содержащую её схему `unsupported`. Противоречие
между catalog simulation support и model registry является validation failure.
Итоговая матрица — generated evidence на конкретном SHA, а не ещё один источник
истины.

## 18. Gates и доказательства

Канонические команды:

```text
pnpm control-plane:check
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
pnpm gate:electronics-m1:browser
NX_SKIP_NX_CACHE=true pnpm gate:repository
```

Названия `electronics-m1` являются совместимым историческим alias и не означают,
что этап MATH-1 автоматически принят. В отдельном совместимом изменении они
переименовываются в `gate:electronics` и `gate:electronics:browser`.

Для каждого пользовательского рубежа нужны:

- точный commit SHA;
- некэшированные результаты gates;
- input fixture/document;
- solver revision и model set digest;
- browser screenshot/video;
- production revision и readiness;
- отдельное owner acceptance.

Зелёный CI, публикация в `main` и deployment не равны owner acceptance.

## 19. Запрещённые упрощения

- фиктивные токи и напряжения;
- `solved: true` при unsupported topology;
- блокировка опасной поддерживаемой схемы вместо расчёта;
- общий error badge на независимых источниках;
- UI-таймер, самостоятельно сжигающий компонент;
- CSS-анимация двигателя без рассчитанной speed;
- новая модель, добавленная только условием в общем solver;
- ручное дублирование implementation status в документации;
- изменение owner SVG ради подгонки runtime;
- новая постоянная панель для каждой диагностики.

## 20. Definition of Done

### 20.1. Kernel Short Path Done

Короткий путь завершён, когда пользователь может разместить батарею, резистор,
LED, NPN, конденсатор и DC motor на breadboard, собрать нормальную или опасную
поддерживаемую цепь, получить детерминированные значения, увидеть RC transient,
запуск двигателя, перегрев и профильный отказ, сохранить и открыть проект, а
браузер и сервер подтвердят один model set без ложных результатов.

Этот результат означает готовность электрического ядра, но не всей Electronics.

### 20.2. Current Placeable Catalog Verified

Placeable-каталог подтверждён, когда каждый enabled-компонент имеет owner
artwork, scale, terminals, placement, rotation, wiring/breadboard fixture,
inspector и save/reload evidence. Это ещё не означает готовность симуляции.

### 20.3. Current Simulatable Catalog Fully Modeled

Simulatable-каталог завершён только когда generated coverage matrix не имеет
`missing`, `unsupported` или `unverified` для объявленных режимов его enabled
компонентов, каждый режим имеет независимый reference fixture, а browser и
server подтверждают тот же model identity. Отложенный компонент либо явно
disabled/coming soon, либо остаётся placeable с честным `unsupported`, но не
входит в `Fully Modeled`.

### 20.4. Full Electronics Product Done

Кроме полного каталога работают instruments, environment inputs, responsive
wire editing, accessibility, Arduino runtime, Blocks/Text, Serial Monitor,
server verification, project versioning и owner journeys. PNP/MOSFET, RLC,
приборы, sensors и Arduino активируются отдельными вертикальными срезами, но не
могут быть объявлены готовыми только по наличию UI.

## 21. Правило изменения системы

Изменение Electronics принимается только цельным вертикальным срезом:

```text
contract/fixture
→ model
→ solver integration
→ observation
→ inspector/visual
→ persistence
→ browser/server evidence
```

Новый человеческий документ Electronics создавать запрещено. Новое нормативное
решение добавляется сюда; машинное поле — в `contracts/`; текущее состояние — в
`current.yaml`; одноразовый результат — в CI/evidence.
