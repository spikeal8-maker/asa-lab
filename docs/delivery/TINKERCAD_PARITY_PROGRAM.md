# ASA Lab — Tinkercad Parity Execution Program

**Статус:** обязательная программа продуктовой разработки.  
**Источник продуктовой истины:** `docs/product/TINKERCAD_PARITY_SPEC.md`.  
**Машиночитаемая матрица:** `docs/product/TINKERCAD_PARITY_MATRIX.yaml`.  
**Правило:** сначала подтверждается parity reference-flow, затем допускаются улучшения ASA Lab.

---

## 1. Почему прежняя очередь была недостаточной

Прежняя очередь фокусировалась на отдельных технических вертикальных срезах:

```text
Teacher Portal → Project Shell → subject editor → StudentSeat → assignment
```

Она не фиксировала как обязательные продуктовые поверхности:

- My Projects;
- module chooser;
- public/unlisted sharing;
- published project page;
- copy/remix;
- user profile/portfolio;
- Explore/gallery/search;
- likes/bookmarks/public comments;
- teacher visibility of all student projects;
- classroom activity feed;
- publication lock for homework;
- separation of public comments from educational feedback.

Новая программа восстанавливает целостный пользовательский продукт.

---

## 2. Ограничения для текущих PR

### PR №34 — Electronics Project Slice

Считать foundation одного subject module:

- editor;
- CircuitDocument;
- save/reload;
- ProjectVersion;
- DC calculation;
- preview foundation.

PR №34 не считается реализацией всей проектной платформы, Classroom parity или Tinkercad parity.

### PR №35 — Electronics workbench redesign

Считать candidate implementation редактора Electronics и project-first UI foundation.

До merge требуется:

- локальная интеграционная проверка;
- отсутствие class-first зависимости для personal project;
- подтверждение настоящих SVG;
- отсутствие hard-coded platform behavior, зависящего только от electronics;
- фиксация оставшихся parity gaps.

PR №35 не должен напрямую merge в `main`; переносится в PR №34 после проверки.

---

## 3. Каноническая очередь

## TASK-PARITY-000 — Contract Freeze

### Результат

- спецификация принята;
- matrix валидируется;
- текущие Issues и карта ссылаются на parity-релизы;
- создан Parity Deviation Register;
- PR №34/35 не переоценивают scope.

### Gate

```text
TINKERCAD_PARITY_SPEC exists
TINKERCAD_PARITY_MATRIX parses
current active task maps to one parity capability
no undocumented deviation
```

---

## TASK-PARITY-100 — Universal Project Hub

### Видимый результат

```text
login
→ My Projects
→ project cards by module
→ Create
→ module chooser
→ create personal project without class
→ open editor
→ autosave
→ reload
→ version
```

### Scope

- project scope personal/classroom/assignment/team;
- module registry;
- module chooser;
- universal cards;
- preview contract;
- editor host;
- rename/duplicate/archive/delete;
- last modified;
- private-by-default.

### Non-goals

- public gallery;
- student seats;
- assignments;
- likes/comments.

### Gate

At least Electronics and a second lightweight module or contract fixture use the same hub and lifecycle without Core `if (moduleKey)` branches.

---

## TASK-PARITY-200 — Sharing and Publication

### Видимый результат

```text
private project
→ create immutable version
→ share unlisted link
→ publish
→ public page
→ other user views
→ creates copy/remix
→ original unchanged
→ unpublish
```

### Scope

- visibility policy;
- assignment publication lock;
- ShareLink;
- PublishedProject;
- PublicationRevision;
- public viewer;
- attribution;
- fork/remix lineage;
- preview and metadata;
- revoke/unpublish;
- audit.

### Gate

Anonymous public viewer and authenticated remix flow pass; Safe Mode user cannot publish.

---

## TASK-PARITY-300 — Profiles, Explore and Community

### Видимый результат

```text
published project
→ appears in author profile
→ appears in module gallery
→ search/filter
→ like/bookmark
→ allowed comment
→ report
→ moderation action
```

### Scope

- public profile;
- portfolio;
- gallery feeds;
- search;
- tags;
- likes;
- bookmarks/collections;
- public comments;
- reporting;
- moderation queue;
- ranking safety.

### Gate

Only eligible content appears publicly; child/Safe Mode restrictions are proven by negative tests.

---

## TASK-PARITY-400 — Classroom and Student Work Visibility

### Видимый результат

```text
teacher creates class
→ class code
→ student joins by nickname or account
→ teacher sees roster
→ student creates/opens project
→ teacher sees current work and versions
→ classroom activity feed updates
```

### Scope

- class code/link;
- StudentSeat;
- co-teacher grants;
- Safe Mode;
- student project gallery;
- current draft read-only viewer;
- version history;
- teacher copy;
- class activity events;
- audit teacher access.

### Gate

Student cannot see others’ private work; teacher can see only authorized class work; public publication remains blocked.

---

## TASK-PARITY-500 — Assignment and Review Cycle

### Видимый результат

```text
teacher personal project
→ publish activity/starter version
→ assign to class
→ student receives own copy
→ teacher monitors progress
→ student submits version
→ teacher comments on exact object/version
→ request changes
→ resubmit
→ accept
→ grade/badge
```

### Scope

- ActivityTemplate/Version;
- Assignment;
- AssignmentWork;
- progress states;
- immutable submission;
- review queue;
- anchored feedback;
- request changes/accept;
- grade;
- badge;
- notifications.

### Gate

Assignment work never becomes public automatically; every review result references an exact immutable version.

---

## TASK-PARITY-600 — Multi-module Proof

### Видимый результат

One account uses the same product lifecycle for:

- Electronics;
- Block coding;
- Chess/checkers or 3D.

Each module supports:

```text
create
save
preview
version
share/publish
copy/remix
class assignment
submission viewer
comment anchor
```

### Gate

Core has no subject-specific branches; Module Registry drives all surfaces.

---

## 4. Required evidence per task

Each task PR must include:

1. owner-visible flow;
2. desktop screenshot/video or deterministic artifact;
3. role and permission matrix tests;
4. privacy negative tests;
5. exact parity capability IDs;
6. map and matrix status update;
7. explicit deviations;
8. clean local gate.

A large test count without the owner-visible flow is not an exit gate.

---

## 5. Coding-agent task contract

Every NEXT_COMMAND must include:

```text
PARITY_CAPABILITIES
REFERENCE_FLOW
VISIBLE_RESULT
ROLES
VISIBILITY_POLICY
SAFE_MODE_POLICY
MODULE_NEUTRALITY
FILES_ALLOWED
NON_GOALS
TEST_IDS
OWNER_DEMO
STOP_CONDITION
```

Missing fields mean the task is not executable.

---

## 6. UI parity review

For every major surface, owner review compares side by side:

- information hierarchy;
- navigation depth;
- primary actions;
- empty/loading/error states;
- density;
- discoverability;
- module switching;
- sharing/publication affordances;
- classroom workflow.

The review does not require copying Autodesk branding or protected assets. It requires equivalent product function and interaction structure under ASA Lab branding.

---

## 7. Deviation governance

A deviation is allowed only when one condition applies:

- child safety;
- applicable law/policy;
- inaccessible proprietary dependency;
- owner-approved improvement after parity;
- measured technical blocker with target removal.

Every deviation has:

- ID;
- reference behavior;
- ASA behavior;
- reason;
- owner decision;
- target release;
- test.

---

## 8. Immediate decisions

1. Preserve Electronics backend/editor work as module foundation.
2. Stop treating class ownership as mandatory for all projects.
3. Make My Projects and Module Chooser the primary adult experience.
4. Do not start additional subject modules before universal hub contracts are real.
5. Do not start public social functionality before visibility, Safe Mode and moderation foundations.
6. Do not call checkpoints submissions until Assignment/Submission entities exist.
7. Do not call a project public until it points to an immutable PublishedProject version.
8. Do not combine public comments with teacher/student feedback.
