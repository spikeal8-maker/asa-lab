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
status:                  in_progress / owner_visual_rework
owner rejection:         PR #72 comment 5145281700
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
5. Issue #63, включая owner comments `5145285731` и `5145281700`;
6. `docs/testing/test-catalog.yaml`;
7. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Нельзя возвращать
breadboard во «вне scope»: владелец явно сделал его обязательным для M1.

## 3. Ветка и Git

- работать только в `agent/r4-electronics-m1` от merge-коммита `67b4f8e`;
- не создавать дополнительные ветки;
- не менять `main`, не merge, не tag, не force-push и не rebase опубликованной истории;
- не трогать PR #29 и `assistant/map-ux-owner-view`;
- не коммитить backups, dumps, credentials и приватные исходные ZIP;
- безопасные manifest, проверенные owner SVG и review screenshots допускаются только в PR #72.

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

## 5. TASK-ELECTRONICS-M1-001 — текущий corrective checkpoint

Текущий solver/editor код сохраняется, но визуальная и физическая component
foundation отклонена владельцем. До отдельного owner acceptance запрещено
расширять solver или возвращаться к общему wiring demo.

Обязательный текущий scope:

1. **Полный аудит owner archives** — не ограничиваться `runtime-ready-pack` и
   восемью выбранными файлами. Для каждого кандидата фиксировать archive path,
   SHA-256, viewBox, physical mm, прозрачность, state family и pin metadata.
2. **Только owner-supplied transparent SVG** — никаких самодельных замен,
   raster/base64, внешних ссылок и непрозрачного full-canvas background.
3. **Параметрический резистор** — один owner корпус, корректные 4/5-band colours
   для поддерживаемых номиналов и допуска; pins на реальных концах выводов.
4. **Полная LED family** — все найденные цвета, реальные brightness steps и
   special states из owner pack; запрещены CSS blur/opacity и придуманные кадры.
5. **Battery holder с выводными проводами** — contacts только на свободных
   концах проводов. Если точный owner asset не найден, результат `BLOCKED`.
6. **Breadboard/maketka — обязательный M1 фундамент**:
   - точный owner SVG;
   - physical width/height;
   - hole pitch 2.54 mm;
   - стабильные hole IDs и координаты;
   - внутренние terminal-strip groups и power rails с реальными разрывами;
   - pin-to-hole snap и placement validation;
   - netlist connectivity через внутренние шины;
   - компоненты сохраняют реальный pin pitch и rotation;
   - battery leads и jumper wires подключаются к holes/rails.
7. **Pin anchors** — marker совпадает с металлической ножкой, концом провода
   или центром breadboard hole с допуском не более 0.25 mm. Число и роль pins
   совпадают с физическим компонентом.

Обязательный breadboard fit proof:

- 6×6 mm tactile button с четырьмя pin;
- SPDT с тремя pin;
- resistor и diode с корректным lead pitch;
- LED anode/cathode;
- potentiometer, если его footprint рассчитан на breadboard;
- battery holder вне платы, концы проводов входят в rails.

## 6. Запрещено до owner acceptance

- full repository matrix;
- merge PR #72;
- R4-M2;
- новые solver features;
- самодельные SVG и угадывание отсутствующих assets;
- использование фоновых pixel-vectorized `resistor-axial.svg` и
  `potentiometer-rotary.svg`;
- заявление, что весь owner pack восстановлен, пока breadboard и полные state
  families отсутствуют.

Вне текущего corrective checkpoint остаются instruments, Arduino, micro:bit,
transient/AC, публикация, Classroom/Assignment и R5+.

## 7. Проверки и owner checkpoint

До визуального принятия запускать только focused checks:

- archive/manifest consistency;
- transparent-SVG validator с negative fixtures;
- physical ratio и 10 mm ruler tests;
- pin-anchor tolerance tests;
- resistor-band tests;
- LED inventory/state tests;
- breadboard hole map, rail connectivity и pin-to-hole snap tests;
- browser smoke четырёх review surfaces.

Contact sheet должен иметь четыре отдельные секции:

1. `Transparency audit` — raw assets на checkerboard без подложек;
2. `Physical scale` — единый масштаб и линейка 10 mm;
3. `State families` — resistor bands, LED colours/brightness, button/switch/lamp states;
4. `Breadboard fit and connectivity` — компоненты реально посажены в holes.

Exact SHA развернуть только в существующем `asa-lab-dev` на
`http://localhost:4610`. Не создавать постоянные test/audit/matrix/final/rc/
staging Compose projects. Рабочую БД, volume и backup сохранять.

После публикации четырёх screenshots и живого contact-sheet checkpoint
остановиться. Wiring/simulation UI, full gate, merge и R4-M2 разрешаются только
после отдельного решения владельца.
