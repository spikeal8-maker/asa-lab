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
status:                  in_progress / production_editor_integration
production evidence SHA: e604762057a839c2683c5788e83e1b686273828c
owner directive:         PR #72 comment 5147079314
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml`, Issue #63 and PR #72 comment
`5147079314` are the executable sources of scope. R3B remains blocked/deferred;
R4-M2 and R5+ are not activated.

## 2. Источники истины

Читать в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. PR #72 owner comment `5147079314`;
6. Issue #63;
7. `docs/testing/test-catalog.yaml`;
8. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Standalone review pages
не являются пользовательским результатом. Текущий результат должен работать в
реальном маршруте Electronics project `/projects/:projectId`.

## 3. Ветка и Git

- работать только в `agent/r4-electronics-m1`;
- не создавать дополнительные ветки;
- не менять `main`, не merge, не tag, не force-push и не rebase опубликованной истории;
- не трогать PR #29 и `assistant/map-ux-owner-view`;
- не коммитить backups, dumps, credentials и приватные исходные ZIP;
- reference evidence, production SVG, manifests и owner screenshots допускаются только в PR #72.

## 4. R3A Gateway

Gateway завершён как короткая проверка существующей архитектуры:

- один server-side `ModuleRegistry`;
- Electronics и Chess подключены через manifest/provider;
- Project Core не ветвится по `moduleKey`;
- общий `ModuleEditorHost` монтирует зарегистрированный editor key;
- create/open/rename/save/reload/checkpoint остаются module-neutral;
- personal project не требует Classroom;
- существующие Electronics и Chess документы открываются без потери данных.

Полный R3 не заявляется: R3B остаётся blocked/deferred.

## 5. TASK-ELECTRONICS-M1-001 — production editor integration

Reference audit `9654ce3...` и production-vector/state evidence
`e604762...` сохраняются. Теперь задача — применить их в рабочем Electronics
editor. Отдельные review-labs остаются доказательством и не считаются delivery.

### 5.1. Runtime catalog

- hard-coded `/assets/electronics/components` не является источником новых проектов;
- runtime catalog строится из `/assets/electronics/production/manifest.json` через типизированный adapter;
- старые assets допускаются только как migration fallback для legacy documents;
- в Draft runtime допускается статус `integration_candidate`;
- `production_ready` и merge-ready acceptance остаются false до отдельного owner review.

### 5.2. Обязательные интегрированные компоненты

Existing M1 electrical parts:

- battery holders 1×AA, 2×AA, 3×AA, 4×AA, 6×AA, 8×AA;
- 5×AA остаётся `missing_reference`;
- parametric resistor;
- ordinary LED: 6 colours, brightness 0–100, reverse/overcurrent/burned;
- tactile button: 4 pins, momentary press/release, корректные paired contacts;
- SPDT: common + throw-left + throw-right;
- potentiometer: 3 pins, angle follows wiper;
- diode with lead-end anchors;
- lamp off/dim/on/max.

Required new editor parts:

- RGB LED: 4 pins, common-anode/common-cathode, independent R/G/B channels;
- seven-segment: physical pins, groups `a,b,c,d,e,f,g,dp`, glyph/mask and brightness;
- breadboards 170/420/882.

Остальные найденные production candidates показываются в полной библиотеке как
`visual_only / simulation_not_yet_supported`. Они не возвращают fake current,
voltage или successful simulation.

### 5.3. One physical scale

```text
renderedWidth  = physicalWidthMm  × WORLD_UNITS_PER_MM
renderedHeight = physicalHeightMm × WORLD_UNITS_PER_MM
```

Произвольный `renderWidth` запрещён. Pin anchor находится в центре физической
ножки, breadboard hole или свободного конца реального провода с допуском не хуже
`0.25 mm`.

Battery holder использует variant с выводными проводами. Если такого exact
reference нет, variant остаётся blocked; контакты на корпусе запрещены.

### 5.4. Breadboard as electrical object

Для 170/420/882 обязательны:

- pitch 2.54 mm;
- stable hole IDs;
- terminal-strip groups;
- power rails и реальные разрывы;
- internal connectivity в netlist;
- pin-to-hole snap;
- placement validation;
- footprint preview;
- сохранение board/hole bindings;
- battery leads и jumpers подключаются к holes/rails.

Показать реальные посадки resistor, diode, ordinary LED, RGB LED, tactile
button, SPDT, seven-segment и совместимого potentiometer.

### 5.5. Runtime states and animations

- resistor bands update from resistance/tolerance;
- ordinary LED asset follows colour, calculated brightness and fault state;
- RGB LED follows calculated R/G/B channel intensities;
- seven-segment follows segment currents or explicit typed state;
- button is momentary for pointer and keyboard;
- SPDT switches common between two throws;
- potentiometer angle follows wiper;
- lamp state follows power;
- motor/servo/buzzer candidates activate only with supported typed models.

Decorative infinite CSS/GIF animation is forbidden.

### 5.6. Document schema and migration

Additively store:

```text
componentTypeId
variantId
physical placement
pin bindings
breadboardId / hole bindings
state properties
simulation properties
```

Legacy schema-v1/v2 documents must open without data loss. Old kind IDs migrate
to production IDs. Save/reload/checkpoint preserve variants, state and hole
bindings.

## 6. Owner-visible acceptance flow

Show only the real editor on `http://localhost:4610`:

1. create/open a real Electronics project;
2. place breadboard 420;
3. place battery holder 2×AA outside the board and connect lead ends to rails;
4. snap resistor, ordinary LED, button and SPDT into holes;
5. snap RGB LED and seven-segment with correct physical pitch;
6. change resistor value and see its bands change on stage;
7. change ordinary LED colour/brightness;
8. change RGB channels;
9. show seven-segment `0`, `8`, `A` and arbitrary mask;
10. prove rail/strip connectivity and placement diagnostics;
11. save/reload with identical positions, variants, states and hole bindings;
12. create immutable checkpoint.

Old visual assets must not appear in new library cards or on the stage.

## 7. Focused checks only

Before owner review run only:

- production-manifest adapter tests;
- legacy migration tests;
- physical-scale and pin-anchor tests;
- breadboard hole/connectivity/snap tests;
- ordinary LED/RGB/seven-segment runtime-state tests;
- real editor E2E for the flow above;
- browser collectors: console/pageerror/requestfailed/HTTP 5xx = 0.

Full repository matrix remains forbidden.

## 8. Deployment and stop condition

- deploy exact final SHA only in existing `asa-lab-dev`;
- keep `localhost:4610` open on the actual Electronics project;
- publish editor screenshots:
  - `library-production`;
  - `breadboard-empty`;
  - `breadboard-components-snapped`;
  - `led-rgb-display-states`;
  - `connected-running`;
  - `reload-checkpoint`;
- after focused PASS stop for owner visual review.

Until owner acceptance: no merge, no full matrix, no R4-M2, no new branch and no
additional permanent Compose project.
