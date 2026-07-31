# AGENTS.md — обязательный контракт coding-агента ASA Lab

## 1. Каноническое состояние

```text
canonical branch:        main
product merge SHA:       67b4f8eea3804d750684dd1c6dce929f5f1f9bfa
completed task:          TASK-CREATOR-PORTAL-001
completed gateway:       TASK-R3A-ELECTRONICS-GATEWAY-001
active task:             TASK-ELECTRONICS-M1-001
active issue:            #63
active branch:           agent/r4-electronics-m1
status:                  in_progress / production_vector_and_animation_rework
reference audit SHA:     9654ce3b9cd2605cb69d9b2d3f8821618364e480
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
owner directive:         PR #72 comment 5146193982
```

`docs/delivery/EXECUTION_MANIFEST.yaml`, Issue #63 and the latest owner directive
are the executable sources of scope. R3B remains blocked/deferred; R4-M2 and R5+
are not activated.

## 2. Источники истины

Читать в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. PR #72 owner comment `5146193982`;
6. Issue #63 owner comment `5146201925`;
7. `docs/testing/test-catalog.yaml`;
8. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Нельзя снова сузить
работу до восьми компонентов: полный owner inventory является production backlog.
Breadboard, RGB LED и seven-segment обязательны для текущего owner checkpoint.

## 3. Ветка и Git

- работать только в `agent/r4-electronics-m1`;
- не создавать дополнительные ветки;
- не менять `main`, не merge, не tag, не force-push и не rebase опубликованной истории;
- не трогать PR #29 и `assistant/map-ux-owner-view`;
- не коммитить backups, dumps, credentials и приватные исходные ZIP;
- reference evidence, production SVG, manifests и review screenshots допускаются только в PR #72.

## 4. R3A Gateway

Gateway завершён только как короткая проверка существующей архитектуры:

- один server-side `ModuleRegistry`;
- Electronics и Chess подключены через manifest/provider;
- Project Core не ветвится по `moduleKey`;
- общий `ModuleEditorHost` монтирует зарегистрированный editor key;
- create/open/rename/save/reload/checkpoint остаются module-neutral;
- personal project не требует Classroom;
- существующие Electronics и Chess документы открываются без потери данных.

Полный R3 не заявляется: R3B остаётся blocked/deferred.

## 5. TASK-ELECTRONICS-M1-001 — production vector and animation foundation

Полный архивный аудит на SHA `9654ce3...` сохранён как reference evidence.
Наличие PNG, screenshots или pixel-vector SVG не означает готовность компонента.
Текущий checkpoint — создать production-библиотеку, точно производную от
owner-reference, с прозрачной векторной геометрией, физикой, pins, footprints и
управляемыми симуляцией состояниями.

### 5.1. Reference и production разделяются

```text
reference/   неизменённые owner PNG/SVG/кадры, только доказательство
production/  прозрачные SVG, допускаемые в рабочий редактор после owner acceptance
```

Каждая production-запись содержит:

```text
componentId
referenceFiles[] + SHA-256
provenance: exact_owner_svg | derived_from_owner_reference
productionSvg + SHA-256
physicalWidthMm / physicalHeightMm / bodyBoundsMm
viewBox
pins[]
footprint
stateContract
animationContract
reviewStatus
```

Производный SVG нельзя маркировать `owner_supplied` или `byte_exact`.

### 5.2. Полный каталог

Обрабатывать все логические позиции и семейства owner-пакета, в том числе:

- battery holders 1×AA, 2×AA, 3×AA, 4×AA, 6×AA, 8×AA;
- 5×AA остаётся `missing_reference`, без выдуманного изображения;
- ordinary LED всех найденных цветов, яркости и специальных состояний;
- RGB LED, его физические variants и четыре pins;
- seven-segment и другие displays;
- breadboards 170/420/882;
- passives, switches, sensors, motors, servo, buzzer, boards и прочие найденные позиции.

### 5.3. Production SVG

Production SVG обязан:

- иметь прозрачный фон и tight visual bounds;
- не содержать raster `<image>`, base64, embedded PNG/JPEG, checkerboard,
  full-canvas opaque shape, card, caption или label background;
- не содержать scripts, handlers, external URLs и `foreignObject`;
- сохранять внешний вид owner-reference без упрощённой самодеятельности;
- использовать отдельные semantic groups для управляемых состояний, когда это
  возможно (`body`, `pins`, `glow`, `segments`, `knob`, `rotor` и т. п.).

Checkerboard существует только в CSS review surface.

### 5.4. Один физический масштаб

```text
worldUnitsPerMm = одно значение
renderedWidth  = physicalWidthMm  × worldUnitsPerMm
renderedHeight = physicalHeightMm × worldUnitsPerMm
```

Произвольный `renderWidth` запрещён. Хранить габарит всего компонента, корпус,
pin pitch, footprint и допустимые rotations. Обязательны ratio tests и линейка
10 мм.

### 5.5. Pins и footprints

Pin anchor ставится только в центре физической ножки, breadboard hole или на
свободном конце реального провода. Допуск не хуже `0.25 мм`.

- tactile button: 4 pins и корректные внутренние пары;
- SPDT: common + throw-left + throw-right;
- RGB LED: четыре pins и explicit common-anode/common-cathode variant;
- seven-segment: segment pins и common pins;
- battery holder: BAT+/BAT− на концах выводных проводов;
- breadboard: stable hole IDs, terminal strips, rails и реальные разрывы.

### 5.6. State и animation contracts

Анимация управляется только simulation state; decorative GIF/CSS loop запрещён.

Ordinary LED:

- все цвета;
- brightness `0..100`;
- off/on, intermediate brightness, reverse, overcurrent, burned;
- exact transparent owner frames либо параметрический SVG, откалиброванный по
  golden frames; приблизительный blur/opacity без comparison запрещён.

RGB LED:

- independent red/green/blue intensity `0..100`;
- additive colour mixing;
- common-anode/common-cathode;
- golden states: off, R, G, B, RG, RB, GB, RGB-white и промежуточные mixes.

Seven-segment:

- semantic groups `a,b,c,d,e,f,g,dp`;
- common-anode/common-cathode contract;
- 0–9, A–F и arbitrary segment mask;
- brightness каждого сегмента от simulation state.

Другие stateful parts:

- button: momentary released → pressed → released;
- SPDT: left/right;
- potentiometer: knob angle = wiper position;
- lamp: off/dim/on/max по мощности;
- motor: direction/speed;
- servo: angle;
- buzzer: active state;
- sensors/displays: только подтверждённые owner states и simulation values.

### 5.7. Breadboard

Для 170/420/882 boards обязательны:

- прозрачный production SVG;
- pitch 2.54 мм;
- stable hole IDs;
- terminal-strip connectivity;
- power rails и реальные разрывы;
- pin-to-hole snap и placement validation;
- footprint preview;
- netlist connectivity от внутренних групп платы.

Показать на плате RGB LED, seven-segment, button, SPDT, resistor, diode и
ordinary LED с правильным pitch. Battery leads подключаются к rails.

## 6. Readiness state machine

Каждая логическая позиция проходит:

```text
reference_found
vector_reconstruction_ready
transparency_pass
physical_scale_pass
pins_pass
state_animation_pass
breadboard_fit_pass (если применимо)
owner_accepted
production_ready
```

Только `production_ready` отображается в рабочей библиотеке Electronics.

## 7. Запрещено до owner acceptance

- full repository matrix;
- merge PR #72;
- R4-M2;
- новые solver features;
- PNG/pixel-vector assets в production editor;
- автоматическая векторизация с сохранённым белым холстом;
- самодельные упрощённые изображения;
- заявление о готовности только на основании найденного файла.

## 8. Focused checks и owner checkpoint

Запускать только focused checks:

- reference/production manifest consistency;
- transparent SVG validator с negative fixtures;
- physical scale/ratio и 10 mm ruler tests;
- pin-anchor tolerance;
- footprint and breadboard connectivity;
- ordinary LED colours/brightness/special states;
- RGB mixing and four-pin contract;
- seven-segment groups, masks and brightness;
- button/SPDT/potentiometer/lamp/motor/servo state contracts;
- browser smoke пяти review surfaces.

Подготовить пять отдельных owner surfaces:

1. `reference-vs-production`;
2. `physical-scale`;
3. `led-rgb-state-lab`;
4. `display-and-motion-state-lab`;
5. `breadboard-fit-connectivity`.

Exact SHA развернуть только в существующем `asa-lab-dev` на
`http://localhost:4610`. Не создавать постоянные test/audit/matrix/final/rc/
staging Compose projects. Рабочую БД, volume и backup сохранять.

После focused PASS и публикации пяти screenshots остановиться. Wiring/solver UI,
full gate, merge и R4-M2 разрешаются только после отдельного решения владельца.
