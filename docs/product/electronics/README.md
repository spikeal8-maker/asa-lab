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
схемы, сохранять неизвестные поля и давать `unsupported` неизвестной модели.

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

Общий результат разделяет:

- `analysisStatus`: `solved | invalid | unsupported | nonconvergent`;
- `deviceHealth`: `normal | warning | overheated | failed`;
- `damageState`: `none | destructive_preview | failed_open | failed_short`;
- `presentationState`: минимальное визуальное состояние;
- terminal currents, voltage, power и model-specific observations;
- diagnostics с anchors.

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

### MATH-2 — диод и LED

- общий bounded nonlinear iteration loop;
- параметрические DO-35 и DO-41 profiles;
- LED profile по цвету, forward curve, current и power limits;
- reverse, resistor-less, series и parallel fixtures;
- brightness/damage только из observations;
- отсутствие component-specific nonlinear веток в общем solver.

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

Следующий этап нельзя начинать, пока предыдущий не прошёл acceptance и owner
review. Временная статическая модель компонента не закрывает будущий этап.

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

## 17. Persistence и безопасность

- Autosave идемпотентен и не блокирует локальный расчёт.
- Save/reload сохраняет точный document, connections, properties и rotation.
- Unsupported или nonconvergent result не записывается как успешная физика.
- Учитель и public viewer не изменяют оригинал.
- Импорт проверяет schema, finite values, IDs и model versions.
- Никакие профили не содержат `eval` или клиентский исполняемый код.

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

Основной путь завершён, когда пользователь может разместить батарею, резистор,
LED, NPN, конденсатор и DC motor на breadboard, собрать нормальную или опасную
поддерживаемую цепь, получить детерминированные значения, увидеть RC transient,
запуск двигателя, перегрев и профильный отказ, сохранить и открыть проект, а
браузер и сервер подтвердят один model set без ложных результатов.

Расширения PNP/MOSFET, RLC, приборы, environment sensors и Arduino runtime
активируются отдельными решениями после выполнения соответствующей основы.

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
