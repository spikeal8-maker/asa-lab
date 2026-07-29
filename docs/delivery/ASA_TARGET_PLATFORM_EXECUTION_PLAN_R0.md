# ASA Lab — актуальный owner-gated execution contract R0–R10

**Статус:** `owner_review_required`  
**Current gate:** `R0`  
**Активация:** только после owner approval и merge PR №43.  
**Product coding до активации:** запрещён.

Подробный документ [`ASA_TARGET_PLATFORM_EXECUTION_PLAN.md`](ASA_TARGET_PLATFORM_EXECUTION_PLAN.md) сохраняет дизайн workstreams и release details. Этот файл является актуальным человекочитаемым статусом и должен совпадать с [`ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`](ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml).

## 1. Главный принцип

```text
one accepted baseline
→ one canonical branch per release
→ one owner-facing PR
→ automated gate
→ live browser evidence
→ owner stop
→ merge
→ map transition
→ next release only ready
→ stop
```

Тесты подтверждают техническое состояние. Визуальная и продуктовая приёмка владельцем выполняется отдельно.

## 2. Конвергенция текущих веток

Текущие полезные, но расходящиеся линии:

```text
main        Teacher Portal foundation
PR #34      Electronics / Project foundation candidate
PR #43      target contract candidate
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
2. Owner принимает пять решений PR #43
3. PR #43 один раз rebased на актуальный main
4. R0 validators PASS
5. PR #43 merged
6. Один P1 integration PR из agent/parity-p1-visual-integration
7. Доказанный transfer и закрытие PR #35/#45/#47
8. Owner выбирает PR #59 ИЛИ PR #60
9. Выбранная R1-линия один раз rebased на accepted baseline
10. Вторая R1-линия закрывается superseded
```

Новые product branches до шага 10 запрещены.

## 3. Release R0 — Contract and one accepted baseline

**Issue:** №36  
**Branch:** `assistant/tinkercad-parity-baseline`  
**Статус:** `in_review`

### Видимый результат

Новой функции нет. Есть одна принятая точка старта, один target contract и отсутствие конкурирующих production-линий.

### Gate

- owner принимает пять решений;
- PR №34 принят или отклонён в ограниченном scope;
- target/parity/diff/architecture/map/catalog validators PASS;
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
register / login without workspace code
→ exactly one Personal Workspace
→ profile/security/sessions
→ audited educator capability
→ existing teacher compatibility
```

### Owner stops

C1.1 public entry, C1.2 registration, C1.3 Personal Workspace, C1.4 educator grant, C1.5 account settings.

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
→ Home
→ recent projects
→ Projects / Collections / Learning / Challenges / Help
→ account menu
→ workspace switcher
```

Classes виден только при server-issued educator capability. Existing Classes/Projects сохраняются как compatibility routes.

## 6. Release R3 — Module Registry, Project Hub and shared Editor Host

**Issue:** №37  
**Branch:** `agent/r3-project-hub`  
**Depends on:** R2  
**Статус:** `blocked`

### Видимый результат

```text
Projects
→ search/filter/sort/grid-list/trash
→ Create
→ registry-driven module chooser
→ personal project without Classroom
→ shared Editor Host
→ autosave/reload
→ immutable checkpoint
```

Core не содержит subject switch. PR №34/№45/№47 являются источниками для одной принятой integration-линии, а не отдельными продуктами.

## 7. Release R4 — Electronics parity

**Issue:** №63  
**Branch:** `agent/r4-electronics-parity`  
**Depends on:** R3  
**Статус:** `blocked`

### Видимый результат

```text
create Electronics project
→ place owner SVG components
→ connect terminals/wires
→ edit properties
→ run/stop deterministic simulation
→ measurements/LED state/diagnostics
→ save/reload/version
```

Identity/Portal/Classroom semantics в R4 не перерабатываются.

## 8. Release R5 — Classroom, class code, StudentSeat and Safe Mode

**Issue:** №40  
**Branch:** `agent/r5-classroom-studentseat`  
**Depends on:** R1, R3  
**Статус:** `blocked`

### Видимый результат

```text
educator creates class
→ class code/link/QR
→ individual/bulk StudentSeats
→ printable credentials
→ child login without email
→ private learner project
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
→ learner portfolio
→ module tabs
→ Project Viewer
→ exact immutable version
→ version history
→ optional audited assistance mode
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
→ publish immutable version
→ public page
→ Copy / Remix
→ attribution
→ unpublish / revoke
```

StudentSeat и assignment work не публикуются. Public page не читает mutable draft.

## 11. Release R8 — Profiles, Explore, Collections and moderation

**Issue:** №39  
**Branch:** `agent/r8-explore-moderation`  
**Depends on:** R7  
**Статус:** `blocked`

### Видимый результат

```text
published project
→ profile / Explore
→ search/filter
→ like/bookmark/collection
→ allowed public comment
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
→ assign
→ isolated learner work
→ progress
→ exact immutable submission
→ anchored feedback
→ request changes
→ resubmit
→ accept
→ grade / badge
```

Assignment work не становится public автоматически.

## 13. Release R10 — Multi-module proof and measured operations scale

**Issue:** №42  
**Branch:** `agent/r10-multimodule-ops`  
**Depends on:** R4, R7, R9  
**Статус:** `blocked`

### Видимый результат

Минимум Electronics, Blocks и Chess/Checkers или 3D проходят общий personal/publication/classroom lifecycle без subject branching в Core.

Workers, object storage, realtime, quotas, dedicated placement и billing вводятся только из измеренной необходимости.

## 14. Owner decision

Перед активацией R0 владелец подтверждает:

1. Account / Principal / Workspace / capability / membership различаются.
2. `tenant_id` и RLS сохраняются.
3. Personal Project не требует Classroom.
4. Account session и StudentSeat session различаются.
5. Очередь R0–R10 и additive-only migration policy принимаются.

Краткий документ: [`R0_OWNER_DECISION.md`](R0_OWNER_DECISION.md).

## 15. Проверки R0

```text
python tools/validate_r0.py
```

Suite включает product diff gate, parity, target execution, architecture, project map и test catalog validators.

Полный PASS не заменяет owner approval.

## 16. Definition of Done

Release не `done`, пока одновременно не выполнены:

- user flow работает в live Chromium без mocks;
- migrations проходят на empty и existing DB;
- existing users/classes/projects preserved;
- security negative tests PASS;
- exact automated gate PASS;
- accessibility PASS;
- desktop/mobile screenshots captured;
- owner explicitly accepts visible result;
- maps/test catalog/evidence synchronized;
- PR merged;
- map transition выполнен;
- next release только разблокирован, но не начат.
