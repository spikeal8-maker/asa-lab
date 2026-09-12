# CK-000 — ASA Checkers activation baseline

**Date:** 2026-09-12
**Baseline SHA:** `46e328dbd621af3ba129801a93b706b3c7e91b94`
**Programme:** `docs/product/ASA_CHECKERS_EXECUTION_PLAN.md`
**Status:** BASELINE CAPTURED; browser re-run is BLOCKED until an explicit isolated `*_test` database is configured.

## 1. Purpose

This document freezes the pre-rework Checkers behaviour before CK-101 changes the product entry flow.
It is evidence, not a target UX specification. Known bad UX is recorded intentionally so later work cannot hide regressions by redefining the baseline.

Protected foundations at this checkpoint:

- Russian-64 rules and move application;
- bot engine and Web Worker execution;
- puzzle/learning evidence;
- save queue and project/student-state persistence contracts;
- classroom server-authoritative move validation;
- existing accessibility semantics of the 8x8 board.

No production Checkers behaviour is changed by CK-000.

## 2. Current user entry and surfaces

The current personal browser journey enters Checkers from Games and resolves to a project-backed editor.
The accepted E2E journey uses `/#/games` → `Играть: Шашки` → `/#/games/checkers/:projectId`.
Internal `CheckersModuleExperience` surfaces are currently:

```text
home | play | learning | bots | review | class | teacher
```

Current top-level web files are:

```text
CheckersModuleExperience.tsx  orchestration/state switch
CheckersStudentHome.tsx       student aggregate/home
CheckersWorkspace.tsx         board + side-panel gameplay/lesson shell
CheckersBoard.tsx             current 8x8 renderer
CheckersClassPlay.tsx         classroom challenge/play UI
CheckersTeacherDashboard.tsx  educator surface
CheckersPositionComposer.tsx  authored position UI
use-checkers-project.ts       load/save/bot/classroom orchestration
checkers-bot.worker.ts        bot search worker
checkers.css                  module presentation
```

Landing behaviour is currently `home` for personal/student use and `teacher` for a classroom owner.

## 3. Current accepted smoke journey

The existing Playwright smoke proves the following sequence in one browser scenario:

```text
Games → Checkers project → generic “Продолжить”
→ learning path → “Обязательное взятие” puzzle
→ solve c3:e5 → persisted progress → reload
→ choose “Искра” → bot ladder → “Начать партию”
→ player c3-b4 → bot reply → persisted game
→ review
```

This is deliberately a baseline of the current product, not the intended CK-101 flow.
The generic `Продолжить` and the requirement to pass through learning/bot-ladder UI are known product problems.

The same browser spec checks:

- 64 board cells and square geometry;
- desktop screenshot;
- tablet 1024×768 screenshot and no horizontal overflow;
- mobile 390×844 screenshot, board visibility and no horizontal overflow;
- teacher assignment/evidence flow;
- classroom safe-play flow later in the same spec.

## 4. Baseline visual evidence already stored in the repository

Current `main` contains these owner/browser evidence artifacts:

- `e2e/artifacts/checkers/checkers-student-desktop.png`;
- `e2e/artifacts/checkers/checkers-student-tablet.png`;
- `e2e/artifacts/checkers/checkers-student-mobile.png`;
- `e2e/artifacts/checkers/checkers-teacher-desktop.png`;
- `e2e/artifacts/checkers/checkers-class-safe-play.png`.

They are the comparison set for CK-101/CK-104. CK-000 does not regenerate them against an unsafe or unknown database.
## 5. Classroom persistence and API baseline

Controller prefix: `api/checkers/projects`.

Current Checkers classroom endpoints:

```text
GET  :projectId/state
PUT  :projectId/state
POST :projectId/students
GET  :projectId/classroom
POST :projectId/feedback
GET  :projectId/play
POST :projectId/challenges
POST :projectId/events
POST :projectId/games/:gameId/accept
POST :projectId/games/:gameId/moves
POST :projectId/games/:gameId/reactions
PUT  :projectId/reactions/mute
POST :projectId/games/:gameId/reactions/:eventId/report
```

Checkers-owned persistence introduced by migrations 0016–0018:

```text
checkers_student_states
checkers_class_games
checkers_reaction_events
checkers_reaction_mutes
checkers_safety_signals
checkers_teacher_feedback
```
Supporting database functions include:

```text
checkers_enrol_student_by_email(...)
checkers_classroom_roster(...)
checkers_classroom_members(...)
```

The controller also reads shared `projects`, `project_drafts`, `classroom_memberships` and writes `audit_events`.

For an active classroom move the backend checks membership, participant side, side-to-move, legal move application and optimistic `expectedVersion` before updating the game. A stale version returns a conflict rather than overwriting a newer move.

## 6. Transport baseline

Active classroom play is **not realtime** at CK-000.

`CheckersModuleExperience` refreshes `classPlay` every 2,500 ms while the `class` surface is open. The current `apps/realtime-gateway` contains no Checkers integration.

Therefore:

- server authority already exists for classroom moves;
- client synchronization is HTTP polling;
- polling is the current baseline, not the R2/R3 target;
- CK-107 must add realtime/reconnect without weakening server move validation.

## 7. Winner-side regression baseline

CK-000 adds `contexts/checkers/testing/winner-sides.spec.ts`.
It characterizes the rules engine for both terminal outcomes:

```text
light captures the final dark piece → 1-0, winner=light
dark captures the final light piece → 0-1, winner=dark
```

This test protects the domain result contract only. It intentionally does **not** hide the known higher-layer progression defect:

- `progressionAfterWin()` currently returns unless the result is `1-0`;
- `commitGame()` invokes progression only for `1-0`;
- a human may start a bot game as dark;
- therefore a human dark-side win (`0-1`) can fail to advance bot-ladder education progress.

That behaviour remains an explicit CK-102 fix, not a CK-000 product change.

## 8. Fresh focused evidence

Executed from a clean one-time clone at exact baseline SHA with:

```powershell
$env:NX_SKIP_NX_CACHE='true'
corepack pnpm gate:checkers-m1
```

Result: **PASS**, exit code 0. Nx cache was explicitly skipped.

Inside the baseline run before the new regression file was added:

```text
test:checkers: 18 test files, 70 tests PASS
typecheck:checkers: PASS
repository-wide typecheck: PASS
full build: PASS
```
Fresh direct test of the new winner-side characterization:

```text
winner-sides.spec.ts: 2 tests PASS
```

## 9. Browser evidence status

A fresh `gate:checkers-m1:browser` run is **BLOCKED**, not failed.

Reason: `e2e/server.mjs` refuses to start without `APP_TEST_DATABASE_URL`, and the URL must target a database whose name ends in `_test`. The clean evidence environment has no such variable configured.

CK-000 explicitly does not:

- point E2E at the working/production database;
- guess database credentials;
- create or destroy a database inside the persistent ASA Lab stack;
- claim browser PASS from an unexecuted command.

The committed browser spec and committed baseline screenshots remain available as historical/current-tree evidence. A fresh browser rerun requires an explicitly provisioned isolated test database.

## 10. Test coverage gap discovered by CK-000

There is currently no dedicated `apps/api/src/checkers-classroom.controller.spec.ts`.

Focused `test:checkers` covers domain, web presentation/save queue and module controller tests, while classroom HTTP behaviour is primarily exercised by `e2e/checkers-module.spec.ts` and database/RLS coverage outside the focused Checkers command.

This is a baseline gap. Do not report classroom API as independently unit-covered until focused controller coverage exists or the browser/database gate is freshly executed.
## 11. CK-000 acceptance ledger

| Deliverable | Status | Evidence |
| --- | --- | --- |
| Execution plan | PASS | `ASA_CHECKERS_EXECUTION_PLAN.md` |
| Current routes/screens | PASS | §2 |
| Puzzle → bot → move → reply smoke contract | PASS (test exists) | `e2e/checkers-module.spec.ts` |
| Light/dark winner regression | PASS | `winner-sides.spec.ts` |
| Desktop/tablet/mobile baseline screenshots | PASS (committed evidence exists) | §4 |
| Classroom tables/API inventory | PASS | §5 |
| Polling/realtime characterization | PASS | §6 |
| Fresh focused rules/bot/build gate | PASS | §8 |
| Fresh browser/classroom rerun | BLOCKED | explicit isolated `*_test` DB not configured |

## 12. Exit rule

CK-000 is complete as a **baseline capture**, but it does not authorize anyone to claim a fresh browser/classroom PASS.
The remaining browser evidence action is environmental, not a reason to change Checkers product code.

The next product task is **CK-101 — Checkers Lobby**. CK-101 must preserve the domain/result contracts and compare visible changes against the committed baseline evidence above.

Before any release claim, the browser gate must be rerun against an explicit isolated `*_test` database.

### Final CK-000 verification after adding the regression

The full focused gate was rerun with `NX_SKIP_NX_CACHE=true` after the CK-000 files were added.

```text
gate:checkers-m1: PASS, exit 0
test:checkers: 19 test files, 72 tests PASS
typecheck:checkers: PASS
repository-wide typecheck: PASS
full build: PASS
Nx cache: skipped
```
