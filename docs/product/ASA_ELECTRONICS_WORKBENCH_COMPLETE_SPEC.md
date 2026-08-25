# ASA Lab — полная спецификация электронной лаборатории

**Статус:** нормативный кандидат R0 для R4 Electronics parity.  
**Машиночитаемый каталог:** [`ASA_ELECTRONICS_TOOL_CATALOG.yaml`](ASA_ELECTRONICS_TOOL_CATALOG.yaml).  
**Общий Project lifecycle:** [`TINKERCAD_PARITY_SPEC.md`](TINKERCAD_PARITY_SPEC.md).
**Карточки, состояние и справка компонентов:**
[`ASA_ELECTRONICS_COMPONENT_INFORMATION_SYSTEM.md`](ASA_ELECTRONICS_COMPONENT_INFORMATION_SYSTEM.md).

## 1. Цель

Электронная лаборатория должна воспроизводить полный пользовательский результат Tinkercad Circuits в согласованном reference scope:

```text
создать личный или учебный circuit project
→ разместить компоненты
→ настроить свойства
→ соединить terminals проводами
→ добавить microcontroller/code при необходимости
→ запустить simulation
→ измерить и диагностировать
→ сохранить draft
→ создать immutable version
→ открыть после reload
→ использовать в Classroom/Assignment/Viewer/Remix
```

Текущий базовый solver и workbench являются только foundation. Они не дают права заявлять полную parity.

## 2. Полноэкранная компоновка

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ← Мои проекты | Схема 1 | Сохранено | Версии | Copy | Share*       │
├──────────────────────────────────────────────────────────────────────┤
│ Edit | Wire | View | Code | Instruments | Start / Stop simulation   │
├────────────────┬──────────────────────────────────┬──────────────────┤
│ Components     │                                  │ Inspector        │
│ Search         │              Stage               │ Preview          │
│ Category       │         grid / circuit            │ Properties       │
│ Preview cards  │                                  │ Terminals        │
│                │                                  │ Measurements     │
├────────────────┴──────────────────────────────────┴──────────────────┤
│ Diagnostics | netlist | compile/runtime | serial/instrument panels   │
└──────────────────────────────────────────────────────────────────────┘
* Share/Publish только по policy и server grants.
```

Stage остаётся доминирующей областью. Library/Inspector/Code/Instrument panels не могут закрывать критическую часть схемы без возможности collapse/resize.

## 3. Общая проектная панель

Обязательны:

- возврат в правильный контекст: Personal Projects, Classroom, Assignment, Viewer;
- название проекта с безопасным rename;
- save state: `saving`, `saved`, `offline`, `retry`, `conflict`;
- version journal;
- checkpoint;
- duplicate;
- share/publication affordance только при разрешении;
- actor/workspace/class/assignment context;
- publication lock banner для AssignmentWork;
- teacher-assistance banner;
- request ID для server errors.

## 4. Stage и навигация

### 4.1. Координатная система

Document хранит независимые от размера экрана координаты. Resize окна не изменяет схему.

Обязательны:

- pan мышью/тачем;
- zoom in/out;
- wheel/pinch zoom;
- Fit;
- grid;
- snap policy;
- сохранение или предсказуемое восстановление viewport;
- отсутствие горизонтального page-scroll при работе editor;
- terminal hit area больше видимой terminal mark.

### 4.2. Выделение

```text
click            one component/wire
shift-click      add/remove selection
marquee          select objects in rectangle
drag             move selection
Escape           clear selection
Delete/Backspace delete selected if permitted
```

Multi-selection обязана сохранять взаимное расположение компонентов и проводов.

### 4.3. History

Undo/redo охватывает:

- placement;
- move/rotate;
- property changes;
- wire creation/delete/routing/colour;
- duplicate/delete;
- code changes where supported.

Autosave не создаёт отдельный user-visible undo step.

## 5. Component Library

### 5.1. Представление

```text
[Search]
[Basic | Input | Output | Power | IC | Sensors | Motors | Displays | Boards | Instruments]
[Compact / List]
[component card]
```

Карточка:

- original ASA/owner SVG;
- display name;
- category;
- short hint;
- availability;
- optional simulation limitations;
- drag affordance;
- keyboard placement affordance.

### 5.2. Component contract

Каждый доступный компонент обязан иметь:

```text
typeId
displayName
category
SVG asset
physical scale
terminal definitions
editable properties
default properties
validation rules
simulation model or explicit unsupported diagnostic
preview provider
document schema version
Safe Mode declaration
```

Компонент без simulation model может быть доступен только если UI честно объясняет ограничение. Он не может возвращать фиктивные напряжения/токи.

### 5.3. Полный inventory

`ASA_ELECTRONICS_TOOL_CATALOG.yaml` перечисляет обязательные families:

- пассивные элементы;
- полупроводники;
- sensors;
- actuators/motors;
- displays;
- IC;
- Arduino;
- micro:bit;
- instruments.

Точный текущий reference inventory должен быть отдельно снят из доступной reference-среды. Пока он не снят, `evidence_required` блокирует заявление 100% parity.

## 6. Терминалы и провода

### 6.1. Terminal

```text
terminalId
label
electricalRole
polarity
localPosition
hitRadius
```

`terminalId` стабилен между save/reload/version/migration.

### 6.2. Wire flow

```text
select terminal
→ begin wire
→ preview route
→ select destination terminal
→ validate endpoint pair
→ create wire
→ update deterministic connectivity/netlist
```

Действия:

- select;
- endpoint reconnect;
- bend-point add/move/remove;
- route style;
- colour;
- delete;
- undo/redo;
- net highlight;
- dangling/invalid endpoint diagnostic.

Перемещение компонента обновляет визуальную геометрию, но не меняет stable endpoint references.

## 7. Inspector

Архитектура информации компонента, разделение компактных свойств, технического
состояния и учебной справки определены в
[`ASA_ELECTRONICS_COMPONENT_INFORMATION_SYSTEM.md`](ASA_ELECTRONICS_COMPONENT_INFORMATION_SYSTEM.md).
Этот раздел перечисляет совокупную функциональность inspector surface, но не
требует одновременно показывать все перечисленные данные в компактной карточке.

Для выбранного component:

```text
name / type / preview
user label/designator
rotation
editable parameters
terminal names/polarity/connectivity
live measurements
validation messages
delete action
```

Для wire:

```text
source terminal
target terminal
colour
route/bends
net identity
measured current/voltage if supported
disconnect/delete
```

Для instrument:

```text
mode
range/scale/timebase/trigger
probe connections
live values/traces
```

Inspector не может позволять изменять server-owned ownership/tenant/classroom/module identity.

## 8. Simulation

### 8.1. State machine

```text
stopped
→ validating
→ starting
→ running
→ stopping
→ stopped

validation_failed
runtime_failed
unsupported
```

### 8.2. Результат

Для поддержанной topology:

- deterministic netlist;
- deterministic numerical result within tolerance;
- component visual state;
- measured values;
- instrument traces;
- microcontroller runtime interaction where supported.

Для неподдержанной topology:

- `unsupported`;
- конкретный diagnostic;
- anchor to component/wire/net/code;
- никакого fake numerical success.

### 8.3. Diagnostics

Минимальные classes:

```text
invalid_document
invalid_property
unconnected_terminal
dangling_wire
short_circuit
unsupported_component
unsupported_topology
non_convergent
compile_error
runtime_error
instrument_configuration_error
```

Каждый diagnostic:

```text
severity
code
human message
anchor type/reference
suggested action
technical detail optional
```

## 9. Instruments

Полная parity требует reference-capture точного состава и поведения. Каталог заранее резервирует:

### Multimeter

- voltage/current/resistance modes;
- probe polarity;
- unit/range;
- overload/open-circuit state;
- live value;
- placement/panel behavior.

### Oscilloscope

- channels;
- probe connections;
- timebase;
- vertical scale;
- trigger;
- start/stop trace;
- clear;
- channel colour;
- graph export optional.

### Other reference instruments

- signal/function generator if confirmed;
- bench supply if confirmed;
- instrument probes;
- settings persisted in draft.

До evidence capture неизвестный инструмент не маркируется реализованным.

## 10. Arduino и micro:bit

### 10.1. Board contract

```text
board type/version
pin map
power pins
digital/analog capabilities
PWM/interrupt support where modeled
serial channels
built-in peripherals
simulation limits
```

### 10.2. Code modes

Target modes:

```text
Blocks
Text
Blocks + Text
```

Точный набор режимов и переходов подтверждается reference capture.

Обязательны:

- editor;
- compile;
- diagnostics anchored to block/line;
- run/stop with simulation;
- board pin interaction;
- code saved in same versioned project document;
- unsupported API/library diagnostic;
- deterministic reset.

### 10.3. Serial monitor

Target:

- output;
- input line;
- clear;
- autoscroll;
- timestamps optional;
- line endings/baud only if modeled/confirmed;
- no secret or student-personal-data logging.

## 11. Persistence schema

Electronics ProjectDocument must contain, versioned together:

```text
schemaVersion
components[]
wires[]
viewport
instruments[]
code optional
simulationSettings
moduleMetadata
```

Required invariants:

- IDs stable;
- unknown future field preserved when safe;
- additive migrations;
- old document opens or receives explicit migration error;
- save/reload exact canonical equality;
- ProjectVersion immutable;
- preview linked to exact version/digest;
- code and circuit cannot version independently by accident.

## 12. Classroom and public contexts

### AssignmentWork

- starter references exact immutable version;
- learner receives isolated draft;
- publication locked;
- submit creates immutable version;
- resubmission creates new attempt/version.

### Teacher Viewer

- exact version selection;
- safe simulation;
- no silent mutation;
- anchors to component/wire/terminal/property/code;
- assistance requires banner/grant/audit.

### Public Viewer

- immutable published version only;
- safe simulation;
- no mutation;
- Remix creates new personal project with lineage.

## 13. Accessibility

- all tools have accessible names;
- tooltips describe action and shortcut;
- disabled tools explain why;
- focus visible;
- critical actions reachable by keyboard;
- component library searchable by keyboard;
- wire endpoints have non-colour focus/selection state;
- simulation state not communicated by colour alone;
- WCAG AA;
- reduced motion;
- no unsafe flashing.

## 14. Screenshot and owner evidence

Required set:

```text
electronics-empty
electronics-component-library
electronics-component-properties
electronics-wire-selected
electronics-wire-routing
electronics-multiselect
electronics-running
electronics-diagnostic
electronics-multimeter
electronics-oscilloscope
electronics-arduino-code
electronics-serial-monitor
electronics-microbit
electronics-assignment-context
electronics-teacher-viewer
electronics-mobile-or-approved-responsive-state
```

Каждый screenshot должен быть связан с:

- commit SHA;
- ProjectDocument fixture digest;
- viewport;
- test ID;
- owner decision.

## 15. Definition of 100% Electronics parity

Можно заявить только когда:

1. все `required_for_full_parity` component families сняты с reference и реализованы либо имеют approved deviation;
2. все tools в каталоге имеют `parity_pass` или `approved_deviation`;
3. basic circuits, instruments, Arduino и micro:bit проходят save/reload/simulation;
4. code modes и serial behavior подтверждены reference evidence;
5. current draft, immutable version, assignment, teacher viewer и public Remix используют один document lifecycle;
6. owner принимает полный screenshot/live-flow set;
7. accessibility/security gates PASS;
8. unsupported models не имитируют успех.

Текущий статус проекта этим критериям не соответствует.
