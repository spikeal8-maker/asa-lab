# ASA Lab — Module Platform Specification

**Статус:** нормативная спецификация подключения учебных сред.  
**Связанный документ:** [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md).  
**Основные capability IDs:** `CAP-MODULE-REGISTRY`, `CAP-PROJECTS`, `CAP-AUTOGRADING`, `CAP-ELECTRONICS`, `CAP-BLOCK-CODING`, `CAP-THREE-D`, `CAP-ROBOTICS`, `CAP-CHESS`, `CAP-DRAWING`.

## 1. Цель Module Platform

Module Platform позволяет подключать к ASA Lab разные учебные редакторы и лаборатории без переписывания Classroom Core.

Платформа должна одинаково обслуживать:

- электронную схему;
- Scratch-подобный проект;
- 3D-сцену;
- виртуального робота;
- шахматную позицию или партию;
- чертёж;
- текстовую программу;
- исследовательский документ.

Для Classroom Core все они являются проектами с версией, preview, результатами проверок и возможностью сдачи.

## 2. Главный инвариант

```text
Classroom Core
    знает moduleKey, capabilities и универсальные project contracts

Subject Module
    знает предметный payload, editor, simulation, validation и export
```

Запрещено:

```typescript
if (project.moduleKey === 'electronics') {
  // специальная предметная логика внутри Classroom
}
```

## 3. ModuleManifest

Минимальный manifest:

```yaml
moduleKey: electronics
moduleVersion: 1.0.0
displayName: Электронная лаборатория
projectTypes:
  - circuit
schemaVersions:
  circuit: 1
capabilities:
  - editor
  - viewer
  - preview
  - validation
  - autograding
  - export
safeMode:
  supported: true
  externalNetwork: false
workerProfiles:
  - simulation-basic
exports:
  - circuit-json
  - image
  - bom
```

Поля:

- stable `moduleKey`;
- semantic `moduleVersion`;
- display metadata;
- project types;
- supported schema versions;
- required platform capabilities;
- editor/viewer routes;
- validation contract;
- migration contract;
- preview contract;
- diff contract;
- autograding contract;
- export contract;
- worker profiles;
- resource limits;
- Safe Mode compatibility;
- analytics allowlist;
- data classification;
- lifecycle status.

## 4. Module lifecycle

```text
Draft
→ Submitted for admission
→ Automated validation
→ Security and privacy review
→ Approved
→ Enabled for selected tenants
→ General availability
→ Deprecated
→ Read-only support
→ Retired after migration/export policy
```

Нельзя удалить module version, если существуют проекты или submissions, которые требуют её для открытия или воспроизведения.

## 5. Project envelope

Универсальная оболочка:

```json
{
  "projectId": "...",
  "tenantId": "...",
  "moduleKey": "electronics",
  "moduleVersion": "1.0.0",
  "projectType": "circuit",
  "schemaVersion": 1,
  "payloadDigest": "sha256:...",
  "payloadLocation": "...",
  "assetManifestDigest": "sha256:...",
  "createdBy": "...",
  "createdAt": "..."
}
```

Payload валидируется модулем, но доступ к envelope контролирует платформенное ядро.

## 6. Editor contract

Editor получает:

- project envelope;
- draft payload;
- actor context с минимально необходимыми grants;
- assignment context optional;
- locale;
- feature/capability flags;
- Safe Mode policy;
- autosave API;
- module assets.

Editor обязан:

- работать без доступа к таблицам Classroom Core;
- не принимать tenant от клиента как доверенный;
- сообщать dirty/saved/conflict states;
- выдавать операции или checkpoint;
- поддерживать version migration;
- не отправлять analytics вне allowlist;
- не логировать содержимое детского проекта.

## 7. Viewer contract

Viewer открывает точную ProjectVersion и используется для:

- проверки педагогом;
- просмотра учеником отправленной версии;
- комментариев;
- preview;
- сравнения попыток;
- read-only portfolio.

Viewer не должен автоматически открывать текущий draft вместо сданной версии.

## 8. Validation contract

Результат:

```json
{
  "valid": false,
  "diagnostics": [
    {
      "code": "WIRE_DANGLING",
      "severity": "error",
      "messageKey": "electronics.wireDangling",
      "anchor": {"type":"wire","ref":"w17"}
    }
  ]
}
```

Диагностика:

- имеет стабильный code;
- локализуется вне domain logic;
- поддерживает anchor;
- разделяет error/warning/info;
- не содержит hidden test details.

## 9. Migration contract

Каждое несовместимое изменение project schema требует migrator.

```text
schema 1
→ migrator 1→2
→ schema 2
```

Требования:

- детерминированность;
- idempotency;
- сохранение исходной immutable version;
- migration report;
- rollback через открытие исходной версии;
- golden samples старых проектов.

## 10. Diff contract

Diff нужен для проверки и истории.

Универсальный результат:

- summary;
- added/removed/changed counts;
- module-specific changes;
- anchors;
- semantic severity.

Примеры:

- electronics: изменён номинал резистора;
- blocks: добавлен event block;
- chess: изменён вариант решения;
- 3D: изменены размеры детали.

## 11. Preview contract

Preview может быть:

- PNG/SVG;
- короткая анимация;
- thumbnail;
- board position;
- schematic snapshot;
- rendered 3D image.

Preview job:

- идемпотентен;
- привязан к digest версии;
- имеет timeout;
- не получает лишние tenant data;
- сохраняет technical metadata.

## 12. Autograding contract

Вход:

- immutable ProjectVersion;
- public/hidden test bundle refs;
- deterministic environment manifest;
- attempt context;
- resource profile.

Выход:

```json
{
  "status": "completed",
  "score": 8,
  "maxScore": 10,
  "checks": [
    {
      "testId": "public-led-pin",
      "status": "pass",
      "messageKey": "electronics.correctPin"
    }
  ],
  "evidence": [],
  "engineVersion": "...",
  "durationMs": 421
}
```

Hidden test names, code and expected internals не возвращаются ученику.

## 13. Export contract

Exporter описывает:

- format key;
- MIME type;
- filename policy;
- synchronous/asynchronous;
- worker profile;
- restrictions;
- provenance metadata.

Примеры:

- electronics: `.ino`, BOM, image;
- 3D: STL, 3MF, G-code в отдельном безопасном этапе;
- blocks: project package;
- chess: PGN/FEN;
- drawing: SVG/PDF/DXF при поддержке.

## 14. Worker profiles

Предметные вычисления выполняются отдельно от API.

Профиль задаёт:

- runtime image/version;
- CPU/RAM/time limits;
- network policy;
- filesystem policy;
- input/output limits;
- allowed secrets;
- determinism level;
- retry policy.

Примеры:

- `simulation-basic`;
- `arduino-compile`;
- `autograder-restricted`;
- `render-3d`;
- `robotics-physics`;
- `chess-analysis`.

## 15. Module admission checklist

Перед включением:

- manifest schema PASS;
- project schema PASS;
- old project migration tests PASS;
- editor/viewer contract PASS;
- Safe Mode declared;
- no direct Classroom imports;
- no unapproved network access;
- telemetry allowlist defined;
- resource profile defined;
- licenses reviewed;
- security scan PASS;
- accessibility review;
- sample activity and starter project;
- export and data deletion behavior documented.

## 16. Electronics module

### 16.1. Project payload

```text
CircuitDocument
├── components
├── wires
├── annotations
├── code files
├── instruments
└── module metadata
```

### 16.2. Capabilities

- scene editing;
- connectivity resolution;
- netlist;
- validation;
- simulation;
- MCU code;
- instruments;
- BOM/export;
- behavioral autograding.

### 16.3. Первый вертикальный срез

- source;
- resistor;
- LED;
- wire;
- save/reload;
- netlist;
- DC calculation;
- diagnostics;
- assignment submission;
- teacher viewer/comment.

## 17. Block coding module

### 17.1. Product scope

- stage;
- sprites;
- costumes;
- sounds;
- event scripts;
- blocks;
- variables/lists;
- runtime;
- project templates;
- safe sharing inside class;
- activity tests.

### 17.2. Integration options

- собственный runtime на Blockly;
- адаптация открытой совместимой среды;
- импорт/export при соблюдении лицензий.

Даже при встраивании существующего editor Classroom Core остаётся владельцем assignment, project envelope, submission, review и grade.

## 18. 3D module

- scene graph;
- geometry/assets;
- transforms;
- units;
- constraints;
- measurement;
- preview;
- print export;
- model validation;
- teacher annotations.

Slicing и G-code выполняются отдельным worker с явным printer profile.

## 19. Robotics module

- world schema;
- robot schema;
- sensors/actuators;
- controller code;
- simulation seed;
- physics version;
- replay;
- goal conditions;
- autograding evidence.

## 20. Chess/checkers module

- board state;
- move history;
- task conditions;
- accepted variants;
- hints;
- engine analysis policy;
- annotations on moves;
- score and evidence.

Движок не должен автоматически показывать ученику скрытое решение.

## 21. Drawing/drafting module

- document pages;
- layers;
- vector objects;
- dimensions;
- snapping;
- standards/profile;
- annotations;
- export;
- rubric evidence.

## 22. Entitlements

Module Platform запрашивает capability:

```typescript
canUse({ tenantId, capability: 'electronics.arduino' })
```

Модуль не знает тариф, оплату и провайдера.

## 23. Analytics

Каждый модуль публикует только разрешённые события:

- editor opened;
- first meaningful action;
- validation run;
- simulation run;
- save success/conflict;
- submission created;
- test result category.

Запрещены payload, source code, child comments, student credentials и arbitrary labels.

## 24. Compatibility policy

Поддерживаются:

- active version;
- previous compatible versions;
- read-only legacy versions по policy;
- migration/export path.

Assignment фиксирует ActivityVersion и module requirements, чтобы обновление модуля не меняло критерии уже выданного задания.

## 25. Definition of Done модуля

Модуль готов к учебному использованию, если:

1. создаётся проект;
2. работает autosave;
3. проект открывается после reload;
4. создаётся immutable version;
5. assignment может принять проект;
6. submission открывается в viewer;
7. комментарий имеет module anchor;
8. validator/autograder воспроизводим;
9. старые fixtures открываются;
10. Safe Mode и security подтверждены;
11. export/data deletion документированы;
12. E2E `teacher assigns → student works → submits → teacher reviews` проходит.
