# ASA Lab — актуальный owner-gated execution contract R0–R10

**Статус:** `owner_review_required`  
**Current gate:** `R0`  
**Активация:** только после owner approval и merge PR №43.  
**Product coding до активации:** запрещён.  
**Текущий parity claim:** `not_100_percent`.

Подробный документ [`ASA_TARGET_PLATFORM_EXECUTION_PLAN.md`](ASA_TARGET_PLATFORM_EXECUTION_PLAN.md) сохраняет дизайн workstreams и release details. Этот файл является актуальным человекочитаемым статусом и должен совпадать с [`ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`](ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml).

Полный интерфейсный и functional-parity scope:

```text
docs/product/ASA_TINKERCAD_100_PERCENT_SCOPE.yaml
docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml
docs/product/ASA_COMPLETE_INTERFACE_BLUEPRINT.md
docs/product/ASA_VISUAL_PRODUCT_SYSTEM.md
docs/product/ASA_ELECTRONICS_TOOL_CATALOG.yaml
docs/product/ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md
docs/product/ASA_STUDENT_EXPERIENCE_SPEC.md
docs/product/ASA_ADMIN_CONSOLE_SPEC.md
```

## 1. Главный принцип

```text
one accepted baseline
→ one canonical branch per release
→ one owner-facing PR
→ product task references exact surface_id and capability_id
→ automated gate
→ live browser evidence
→ owner stop
→ merge
→ map transition
→ next release only ready
→ stop
```

Тесты подтверждают техническое состояние. Визуальная и продуктовая приёмка владельцем выполняется отдельно.

Наличие документа, mockup или unit test не означает, что функция реализована. Статусы `absent`, `partial`, `in_review` и `evidence_required` блокируют заявление 100% parity.

Цель — независимая ASA Lab реализация с 100% functional parity согласованного reference scope. Чужой код, брендинг, логотипы, закрытые assets и пиксельная копия запрещены.

## 2. Конвергенция текущих веток

Текущие полезные, но расходящиеся линии:

```text
main        Teacher Portal foundation
PR #34      Electronics / Project foundation candidate
PR #43      complete target/interface/parity contract candidate
PR #35      transfer-only Electronics workbench
PR #45      transfer-only Registry / Project Hub / Editor Host
PR #47      transfer-only Visual Product System
PR #59      frozen competing R1 candidate A
PR #60      frozen competing R1 candidate B
PR #29      non-blocking Map UX candidate
```

Целевое правило:

> После R0 не создавать новые long-lived stacked product branches. Сначала получить one accepted baseline, затем строить каждый release от него.

### Обязательный порядок

```text
1. Owner review PR #34 только как Electronics/Project foundation
2. Исправить и фактически проверить PR #34
3. Owner принимает и merge PR #34 либо требует пересмотра R0 source contract
4. Owner принимает шесть решений PR #43
5. Owner принимает complete interface and functional parity scope
6. PR #43 один раз rebased на актуальный main
7. 25 R0 validators PASS
8. PR #43 merged
9. R0A governance activation; R1 остаётся blocked
10. Один P1 integration PR из agent/parity-p1-visual-integration
11. Baseline preservation и доказанный transfer; закрытие PR #35/#45/#47
12. Owner выбирает PR #59 ИЛИ PR #60
13. Выбранная R1-линия один раз rebased на accepted baseline
14. Вторая R1-линия закрывается superseded
15. Только R0D отмечает R1 ready
```

Новые product branches до шага 10 запрещены.

## 3. Release R0 — Contract, complete interface inventory and one accepted baseline

**Issue:** №36  
**Branch:** `assistant/tinkercad-parity-baseline`  
**Статус:** `in_review`

### Видимый результат

Новой runtime-функции нет. Есть:

- одна принятая точка старта;
- одна строгая очередь R0–R10;
- полный каталог public/creator/educator/learner/admin/editor страниц;
- полный Electronics tools/component contract;
- отдельные Student и Administration specs;
- честный weighted functional-parity scope;
- визуальный каталог для владельца;
- отсутствие конкурирующих production-линий.

### Gate

- owner принимает шесть решений;
- complete interface/parity scope принят;
- current claim остаётся `not_100_percent`;
- PR №34 принят и merged либо R0 contract пересмотрен;
- target/parity/interfaces/diff/architecture/map/catalog validators PASS;
- PR №43 не меняет product runtime или migrations;
- существующие teacher/classes/projects/Electronics сохранены;
- одна baseline commit в `main`;
- следующие release остаются blocked до map transition.

## 4. Release R1 — Account, Profile, Personal Workspace, Sessions and Educator Grant

**Issue:** №48  
**Branch:** `agent/r1-account-onboarding`  
**Depends on:** R0  
**Статус:** `blocked`

### Видимый результат

```text
public intention router
→ register / login without workspace code
→ exactly one Personal Workspace
→ profile/security/session management
→ workspace switcher
→ audited educator capability
→ existing teacher compatibility
```

### Основные поверхности

```text
PUB-002 PUB-003 PUB-004 PUB-008
CRT-013 CRT-014 CRT-015
EDU-001
```

### Owner stops

C1.1 public entry, C1.2 registration, C1.3 Personal Workspace, C1.4 educator grant, C1.5 account/session/settings.

### Non-goals

Classroom/StudentSeat, publication, Electronics changes, destructive legacy cleanup.

## 5. Release R2 — Creator Home and capability-aware Portal shell

**Issue:** №62  
**Branch:** `agent/r2-creator-portal`  
**Depends on:** R1  
**Статус:** `blocked`

### Видимый результат

```text
Account login
→ Creator Home
→ recent projects / continue work
→ capability-aware navigation
→ notifications / help
→ account and workspace controls
```

Classes виден только при server-issued educator capability. Existing Classes/Projects сохраняются как compatibility routes.

Основные surfaces: `PUB-001`, `PUB-010`, `CRT-001`, `CRT-012`.

## 6. Release R3 — Module Registry, Project Hub and shared Editor Host

**Issue:** №37  
**Branch:** `agent/r3-project-hub`  
**Depends on:** R2  
**Статус:** `blocked`

### Видимый результат

```text
Projects
→ search/filter/sort/grid-list/archive/delete
→ Create
→ registry-driven module chooser
→ personal project without Classroom
→ shared Editor Host
→ autosave/reload/conflict
→ immutable checkpoint/version journal
```

Core не содержит subject switch. PR №34/№45/№47 являются источниками для одной принятой integration-линии, а не отдельными продуктами.

Основные surfaces: `CRT-002`, `CRT-003`, `CRT-004`, `EDT-001`.

## 7. Release R4 — Complete Circuits and Electronics functional parity

**Issue:** №63  
**Branch:** `agent/r4-electronics-parity`  
**Depends on:** R3  
**Статус:** `blocked`

### Видимый результат

```text
create Electronics project
→ component library and reference-derived component families
→ breadboard/terminals/realistic connectivity where confirmed
→ select/multi-select/move/rotate/duplicate/delete/undo/redo
→ create/reconnect/route/recolour wires
→ properties and diagnostics
→ deterministic supported simulation
→ multimeter / oscilloscope / confirmed instruments
→ Arduino and micro:bit
→ Blocks/Text/Mixed code modes where confirmed
→ compile/run/serial monitor
→ save/reload/version/preview
```

Неподдержанная модель всегда даёт diagnostic, а не fake numerical success.

Полный milestone/tool/component contract:

```text
docs/product/ASA_ELECTRONICS_TOOL_CATALOG.yaml
docs/product/ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md
```

Identity/Portal/Classroom semantics в R4 не перерабатываются. Assignment/teacher/public contexts используют общий Editor Host, но закрываются в R5–R9.

## 8. Release R5 — Classroom, class code, StudentSeat and Safe Mode

**Issue:** №40  
**Branch:** `agent/r5-classroom-studentseat`  
**Depends on:** R1, R3  
**Статус:** `blocked`

### Видимый результат

```text
educator creates class
→ class overview/roster/settings/co-teachers
→ class code/link/QR
→ individual/bulk StudentSeats
→ printable one-time credentials
→ child login without email
→ Learner Home and private learner project
→ Safe Mode and class moderation
```

StudentSeat session отдельна от Account session. Safe Mode блокирует public/social actions, но не private creation и classroom feedback.

## 9. Release R6 — Learner portfolio and audited teacher Project Viewer

**Issue:** №64  
**Branch:** `agent/r6-learner-portfolio`  
**Depends on:** R5  
**Статус:** `blocked`

### Видимый результат

```text
roster
→ learner project gallery
→ learner portfolio
→ module tabs
→ read-only Project Viewer
→ exact immutable version
→ version history / restore to copy
→ optional visible audited assistance mode
```

Read-only default. Restore creates copy. Teacher visibility не означает ownership.

## 10. Release R7 — Sharing, publication, public page and Remix

**Issue:** №38  
**Branch:** `agent/r7-publication-remix`  
**Depends on:** R3  
**Статус:** `blocked`

### Видимый результат

```text
private project
→ unlisted link
→ publish exact immutable version
→ public page
→ Copy / Remix
→ attribution lineage
→ revoke / unpublish
```

StudentSeat и assignment work не публикуются. Public page не читает mutable draft.

## 11. Release R8 — Profiles, Explore, Learning, Challenges, Collections and moderation

**Issue:** №39  
**Branch:** `agent/r8-explore-moderation`  
**Depends on:** R7  
**Статус:** `blocked`

### Видимый результат

```text
published project
→ privacy-aware Profile / Explore
→ search/filter/featured/recent/popular
→ Collections/bookmarks/allowed interactions
→ Learn/curriculum/projects
→ Challenges/archive
→ report/moderation
```

StudentSeat public/social actions запрещены. PublicComment и educational ReviewComment различаются.

## 12. Release R9 — Activities, assignments, submissions, review, grades and badges

**Issue:** №41  
**Branch:** `agent/r9-learning-cycle`  
**Depends on:** R5, R6  
**Статус:** `blocked`

### Видимый результат

```text
teacher immutable activity starter
→ assign to class/group/learner
→ isolated AssignmentWork
→ progress monitor
→ exact immutable submission
→ anchored feedback to module object/code
→ request changes
→ learner revision and resubmit
→ accept/incomplete/excuse
→ rubric / grade / badge evidence
```

Assignment work не становится public автоматически. Learner Home, submission receipt, feedback and badge surfaces обязательны.

## 13. Release R10 — 3D, Codeblocks, Sim Lab, administration, mobile/integrations and measured scale

**Issue:** №42  
**Branch:** `agent/r10-multimodule-ops`  
**Depends on:** R4, R7, R9  
**Статус:** `blocked`

### Видимый результат

```text
3D Design
  shapes/import/workplane/exact dimensions/group/hole/align/duplicate/ruler/export/AR

Codeblocks
  block workspace/run/generated 3D/version/export

Sim Lab / robotics physics
  materials/mass/friction/bounce/gravity/shake/connectors/motors/block control/traces

Administration
  school admin + platform admin + moderation + audit + support + policies + health + storage + incidents

Mobile / integrations
  touch/pen/AR and confirmed ecosystem integrations or explicit approved deviations

All modules
  same personal/project/version/publication/classroom/assignment lifecycle
```

Workers, object storage, realtime, quotas, dedicated placement и billing вводятся только из измеренной необходимости. Capacity claims подтверждаются измерением, а не прогнозом.

## 14. Owner decision

Перед активацией R0 владелец подтверждает:

1. Account / Principal / Workspace / capability / membership различаются.
2. `tenant_id` и RLS сохраняются.
3. Personal Project не требует Classroom.
4. Account session и StudentSeat session различаются.
5. Очередь R0–R10 и additive-only migration policy принимаются.
6. Полный interface catalog и 100% functional-parity scope принимаются; literal source/brand/asset/pixel copy запрещён, а current claim остаётся `not_100_percent` до runtime/evidence.

Краткий документ: [`R0_OWNER_DECISION.md`](R0_OWNER_DECISION.md).

## 15. Проверки R0

```text
python tools/validate_r0.py
```

Suite включает 25 gates: product diff, target references, six owner decisions, convergence, baseline preservation, parity, complete interfaces/admin/student/Electronics, target execution, architecture, project map, test catalog и live GitHub state.

Полный PASS не заменяет owner approval и не означает, что описанные future surfaces уже реализованы.

## 16. Definition of Done

Release не `done`, пока одновременно не выполнены:

- every planned `surface_id` и `capability_id` текущего release закрыты;
- user flow работает в live Chromium без mocks;
- migrations проходят на empty и existing DB;
- existing users/classes/projects preserved;
- security negative tests PASS;
- exact automated gate PASS;
- accessibility PASS;
- desktop/mobile screenshots captured;
- `evidence_required` разрешены reference capture или owner decision;
- owner explicitly accepts visible result;
- maps/test catalog/evidence synchronized;
- PR merged;
- map transition выполнен;
- next release только разблокирован, но не начат.

100% functional parity всей программы заявляется только после выполнения completion rule в `ASA_TINKERCAD_100_PERCENT_SCOPE.yaml`, а не после одного R4 или одного Electronics demo.
