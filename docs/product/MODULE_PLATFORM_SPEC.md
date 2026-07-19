# ASA Lab — Module Platform Specification

**Статус:** нормативная спецификация подключения учебных сред.  
**Связанные документы:** [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md), [`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml), [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md).  
**Capability IDs:** `CAP-MODULE-REGISTRY`, `CAP-PROJECT-SHELL`, `CAP-CHECKERS-LITE`, `CAP-ELECTRONICS-ALPHA`, `CAP-AUTOGRADING`, `CAP-ELECTRONICS-ADVANCED`, `CAP-BLOCK-CODING`, `CAP-THREE-D`, `CAP-ROBOTICS`, `CAP-CHESS`, `CAP-DRAWING`.

## 1. Назначение

Module Platform позволяет подключать разные учебные редакторы без переписывания Classroom Core и Project Core.

Для платформы все предметные работы имеют общий lifecycle:

```text
ModuleManifest
→ Project
→ ProjectDraft
→ immutable ProjectVersion
→ optional Assignment
→ SubmissionAttempt
→ Viewer / Comment / Review
```

Предметный payload и правила остаются внутри модуля.

## 2. Главный инвариант

```text
Classroom Core
    знает users, classrooms, assignments, submissions and permissions

Project Core
    знает moduleKey, versions, draft/checkpoint lifecycle and access

Subject Module
    знает payload schema, editor, validation, preview and subject computation
```

Запрещено:

```ts
if (project.moduleKey === 'electronics') {
  // circuit-specific behavior inside Classroom or Project Core
}
```

Запрещены direct imports внутренних файлов между Core и subject module.

## 3. Два уровня Module Platform

## 3.1. Module SDK v0.1 — Technical Product Alpha

Используется в Issues №24, №25 и №26.

Минимальный manifest:

```ts
interface ModuleManifestV1 {
  moduleKey: string;
  moduleVersion: string;
  displayName: string;
  projectType: string;
  schemaVersion: number;
  editorRoute: string;
  viewerRoute: string;
  safeModeSupported: boolean;
}
```

Минимальный provider:

```ts
interface ModuleProviderV1<TPayload> {
  createEmptyProject(): TPayload;
  validate(payload: unknown): Diagnostic[];
  createPreview(payload: TPayload): PreviewDescriptor;
}
```

V0.1 включает только:

- local/static module registry;
- manifest validation;
- project JSON Schema;
- create empty project;
- editor route;
- viewer route;
- validation;
- preview;
- ProjectDraft save/reload;
- ProjectVersion checkpoint;
- schema compatibility fixture;
- Nx boundaries.

V0.1 **не включает**:

- remote marketplace/admission workflow;
- worker pools;
- hidden autograding;
- export providers;
- entitlements/quotas;
- remote module loading;
- analytics platform;
- S3/MinIO requirement;
- realtime collaboration.

Эти возможности нельзя добавлять в Issues №24–26.

## 3.2. Extended Module Platform — после School Pilot

Добавляется отдельными Issues:

- module admission/security review;
- enabled versions per tenant;
- worker profiles;
- general autograding;
- hidden test bundles;
- export providers;
- semantic diff providers;
- entitlement requirements;
- analytics allowlists;
- deprecation/retirement lifecycle;
- remote/open-source editor integration.

## 4. Module Registry v0.1

Registry хранит:

```text
moduleKey
moduleVersion
displayName
projectType
schemaVersion
editorRoute
viewerRoute
safeModeSupported
status
```

V0.1 registry допускает только first-party modules, собранные в monorepo.

Статусы:

```text
draft
active
deprecated
```

Удаление active/deprecated module version запрещено, если существуют проекты, которым она нужна.

## 5. Project envelope

```ts
interface ProjectEnvelope {
  projectId: string;
  tenantId: string;
  ownerPrincipalId: string;
  classroomId?: string;
  moduleKey: string;
  moduleVersion: string;
  projectType: string;
  schemaVersion: number;
  title: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}
```

Core контролирует доступ к envelope. Module контролирует payload.

## 6. ProjectDraft

Для Technical Alpha небольшие payloads хранятся в PostgreSQL `jsonb`.

```ts
interface ProjectDraft<TPayload> {
  projectId: string;
  tenantId: string;
  schemaVersion: number;
  payload: TPayload;
  rowVersion: number;
  updatedBy: string;
  updatedAt: string;
}
```

Требования:

- optimistic concurrency;
- stale rowVersion возвращает conflict;
- retry не создаёт duplicate project;
- tenant/owner access server-side;
- reload возвращает тот же payload;
- validation выполняется до accepted save/checkpoint;
- payload не логируется.

Object storage вводится только после измеренного роста payload/assets.

## 7. ProjectVersion

Checkpoint создаёт immutable version:

```ts
interface ProjectVersion<TPayload> {
  id: string;
  projectId: string;
  tenantId: string;
  versionNumber: number;
  moduleKey: string;
  moduleVersion: string;
  schemaVersion: number;
  payload: TPayload;
  payloadDigest: string;
  parentVersionId?: string;
  createdBy: string;
  createdAt: string;
}
```

Инварианты:

- SHA-256 digest рассчитывается на canonical serialized payload;
- version immutable;
- old version remains readable;
- later draft changes do not mutate checkpoint;
- future SubmissionAttempt references exact version.

## 8. Editor contract

Editor получает:

- envelope;
- current draft;
- actor grants;
- locale;
- Safe Mode policy;
- save/checkpoint API;
- optional assignment context only after Assignment stage.

Editor обязан:

- не обращаться к Core tables;
- не доверять client tenant ID;
- показывать dirty/saving/saved/conflict/error;
- возвращать structured payload;
- поддерживать keyboard-accessible critical actions;
- не отправлять payload в telemetry;
- не создавать собственную identity/session system.

Все Technical Alpha editors работают внутри существующего Web origin. Новые server ports не создаются.

## 9. Viewer contract

Viewer открывает точную ProjectVersion.

Использования:

- project preview;
- read-only history;
- future teacher review;
- future child submission view;
- future module anchors and diff.

Viewer не подменяет requested version текущим draft.

## 10. Validation contract

```ts
interface Diagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  messageKey: string;
  anchor?: {
    type: string;
    ref: string;
    property?: string;
  };
}
```

Требования:

- stable diagnostic code;
- localization outside domain logic;
- deterministic ordering;
- structured anchor;
- no stack trace/internal hidden test data;
- unsupported feature gives explicit diagnostic, not fake result.

## 11. Preview contract

```ts
interface PreviewDescriptor {
  kind: 'svg' | 'png' | 'board' | 'schematic' | 'json-summary';
  digest: string;
  inlineData?: string;
  artifactRef?: string;
}
```

Technical Alpha may generate inline SVG/summary from saved payload. Async rendering workers are not required.

Preview:

- linked to payload digest;
- deterministic for same payload/module version;
- private by default;
- contains no credentials;
- safe for project card/viewer.

## 12. Schema compatibility

Каждый module project has:

```text
moduleVersion
schemaVersion
```

Rules:

- JSON Schema required;
- invalid payload rejected;
- incompatible change increments schemaVersion;
- migrator required when old projects must be upgraded;
- old fixture is part of tests;
- original immutable version is preserved;
- migration produces report/digest.

Technical Alpha can start with schema version 1 and a no-op compatibility fixture, but cannot omit version fields.

## 13. Blank Canvas Technical Module

Issue №24 introduces one technical module to test Project Shell.

Scope:

- small JSON payload;
- one editable field or simple canvas object;
- validation;
- preview;
- save/reload;
- checkpoint.

It is not a subject product and is removed/deprecated after two real modules prove the contract.

## 14. Checkers Lite

Issue №25.

Payload v1:

```ts
interface CheckersProjectV1 {
  schemaVersion: 1;
  sideToMove: 'light' | 'dark';
  pieces: Array<{
    id: string;
    side: 'light' | 'dark';
    kind: 'man' | 'king';
    square: string;
  }>;
  moveHistory: Array<{
    pieceId: string;
    from: string;
    to: string;
    capturedIds: string[];
  }>;
}
```

V0.1 capabilities:

- 8×8 board;
- simple position;
- one legal move;
- invalid move diagnostic;
- save/reload;
- board preview.

Non-goals:

- AI/engine;
- multiplayer;
- tournament/rating;
- full chess rules;
- assignments/grade.

Checkers Lite exists to prove that Project/Core code does not change for a new subject module.

## 15. Electronics Alpha

Issue №26.

CircuitDocument v1:

```text
metadata
components
pins
wires
positions
properties
annotations optional
schemaVersion
```

Components:

- DC source;
- resistor;
- LED;
- wire.

Module provides:

- manifest/schema;
- React editor;
- component placement and wiring;
- property editing;
- connectivity resolver;
- deterministic normalized netlist;
- validation diagnostics;
- minimal native/WASM DC solver;
- schematic preview;
- save/reload/checkpoint.

Supported solver topology:

```text
source → resistor → LED → return
```

Unsupported topology returns `TOPOLOGY_UNSUPPORTED`.

Electronics Alpha excludes:

- breadboard realism;
- transient;
- Arduino;
- instruments;
- general autograding;
- assignment/review integration.

## 16. School Pilot integration

After StudentSeat and Assignment stages, universal workflows use module contracts:

```text
ActivityVersion pins module requirements
→ starter ProjectVersion/checkpoint
→ child ProjectDraft
→ final checkpoint
→ SubmissionAttempt references exact ProjectVersion
→ Viewer opens exact version
→ Comment stores universal module anchor
```

Classroom/Assessment Core never import Checkers/Circuit types.

## 17. Module anchor envelope

```ts
interface ModuleAnchor {
  moduleKey: string;
  projectVersionId: string;
  anchorType: string;
  anchorRef: string;
  property?: string;
}
```

Module validates anchor existence against exact ProjectVersion.

Examples:

- electronics component/wire/pin;
- checkers piece/square/move;
- block coding block/sprite;
- 3D object/constraint;
- drawing object/dimension.

## 18. Semantic diff — after Project Shell

Optional provider:

```ts
interface ModuleDiffProvider<TPayload> {
  diff(before: TPayload, after: TPayload): ModuleDiff;
}
```

Required only when Review task needs attempt comparison.

Technical Alpha does not need a general diff framework.

## 19. General autograding — later capability

`CAP-AUTOGRADING` is not a dependency of Electronics Alpha.

General platform input:

- immutable ProjectVersion;
- public/hidden test bundle refs;
- environment manifest;
- resource profile;
- attempt context.

General output:

- status;
- score/max;
- public check results;
- evidence;
- engine version;
- duration/failure category.

Hidden test names/code/expected values are never returned to child.

Electronics Alpha uses local deterministic validation/golden tests; full classroom task adds small public checks without prematurely building the entire autograding platform.

## 20. Workers — only when required

Potential future profiles:

- `simulation-basic`;
- `arduino-compile`;
- `autograder-restricted`;
- `render-3d`;
- `robotics-physics`;
- `chess-analysis`.

Worker introduction requires a current Issue and measurable reason. Module SDK v0.1 does not require worker infrastructure.

## 21. Export — later capability

Potential exports:

- electronics: JSON, image, BOM, `.ino` later;
- 3D: STL/3MF;
- chess: FEN/PDN/PGN as applicable;
- drawing: SVG/PDF/DXF when supported.

Export is not required for Project Shell, Checkers Lite or Electronics Alpha.

## 22. Safe Mode and privacy

Every module declares:

- external network usage;
- upload/download behavior;
- public sharing behavior;
- telemetry allowlist;
- child communication behavior;
- resource limits when computation exists.

V1 rules:

- external network off by default;
- project private by default;
- no child direct messaging;
- no payload/source code in telemetry;
- no credentials in project/export/preview;
- module cannot bypass Core authorization.

## 23. Analytics

Technical Alpha records only safe technical events if required:

- editor opened;
- draft saved/conflict;
- validation invoked;
- checkpoint created.

Payload, source code, child comments and arbitrary labels are forbidden.

Extended analytics requires separate capability/Issue.

## 24. Entitlements

Module code asks for capability, not tariff:

```ts
canUse({ tenantId, capability: 'electronics.advanced' })
```

Entitlements are a scale capability and do not block Alpha modules.

## 25. Required boundaries

Nx/project rules must prove:

```text
Classroom Core !→ module internals
Project Core !→ module internals
Subject module !→ Core internals
Subject module → Module SDK/public Project contracts
apps/web → module public UI entry
apps/api → context public APIs
```

A second module must be added without changing Core domain code.

## 26. Test profiles

### Project Shell

- module manifest/schema;
- draft save/reload;
- optimistic conflict;
- immutable checkpoint/digest;
- tenant/owner isolation;
- E2E.

### Checkers Lite

- schema fixtures;
- deterministic move rules;
- diagnostics;
- save/reload;
- preview;
- no Core imports;
- E2E.

### Electronics Alpha

- CircuitDocument fixtures;
- connectivity/netlist;
- diagnostics;
- native golden;
- WASM parity;
- save/reload;
- preview;
- no Core imports;
- E2E.

## 27. Definition of Done Module SDK v0.1

V0.1 is proven when:

1. Project Shell works with Blank Canvas;
2. Checkers Lite uses the same lifecycle;
3. Electronics Alpha uses the same lifecycle;
4. Core domain code has no subject conditionals/imports;
5. each module has versioned schema/fixtures;
6. draft save/reload works;
7. immutable checkpoints work;
8. preview and diagnostics work;
9. tenant/owner isolation works;
10. automated E2E and screenshots exist;
11. no future worker/export/autograding infrastructure was added without a separate task.

## 28. Definition of Done School integration

A module is proven for school use when:

1. teacher can assign pinned ActivityVersion;
2. child gets/opens the correct project;
3. final sync creates exact immutable ProjectVersion;
4. SubmissionAttempt references it;
5. teacher viewer opens exact version;
6. comment anchor is version-safe;
7. revision creates a new attempt/version;
8. assessment evidence is reproducible;
9. full classroom E2E passes;
10. Core still contains no subject-specific domain logic.