# ASA-E1-CONVERGENCE-01 — main / preserved E1 / Preview B

THIS IS INTEGRATION BASELINE, NOT E1 COMPLETION.

## Revision receipt

- BASE_MAIN_SHA: `b31e113a19f6234a0504ff6bade991294b10d38b`.
- INITIAL_MAIN_SHA: `3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`.
- DOCS_BASE_SHA: `d71e8610d1b014a3981560678dd33118b233edc4`, Draft [PR #208](https://github.com/spikeal8-maker/asa-lab/pull/208).
- RECOVERY_SHA: `8ea7771d902d92f5288685a031b134feb353f4cc`.
- DOCS_RECOVERY_SHA: `ea3ad1a8e092e0e7681f9900bc99b3709550783c`.
- PREVIEW_SHA: `dce140868601b55c9a5449b38012e297c116d8be`, Draft [PR #210](https://github.com/spikeal8-maker/asa-lab/pull/210).
- INTEGRATION_SHA: `f126442223a51abe170e7008a8e85b046b5187eb` (final candidate before this receipt update).
- PRIOR_GREEN_CI_SHA: `dee32701d47f4742a4083c1aa26e8a18358cb5f6`, including the migration coordinator fix. Subsequent changes import accepted main governance and update this receipt. Product code, migration SQL and Learning tests remain unchanged; the PR body attests final exact-HEAD CI.
- Independent product/migration review: `0fac1851759e7e76a4027aa0b3408ce1c84f0fed`, followed by both reviewers' bounded PASS attestations at `3c522194eec686cbb690e76fab88f27fbf523bd9`.
- Branch: `integration/e1-main-convergence-20260913`.
- Stacked Draft [PR #213](https://github.com/spikeal8-maker/asa-lab/pull/213), base `docs/product-spec-v1.4`.

A commit cannot embed its own SHA. The final documentary descendant and exact-HEAD workflow conclusions are attested in the PR body and the local final REPORT. This receipt pins the reviewed executable source and the recorded runs; it does not assign the candidate to canonical live state.

The docs branch first merged main at `6ca683029404013b1004a2dbe2650d3f2bb6fbb0`. All nine checks passed before E1 integration began. A final fetch then found only Scratch guide commit #212. The second docs merge `50be97ce` retains main's compact execution routing and V1.4's global review authority. Its nine checks passed too. A final pre-receipt remote check found six additional Scratch documentation commits through `7cf55723`; docs merge `9c500ceb` includes their mandatory pre-editor maintainability repair. It merged without conflict and passed governance and exact-HEAD CI before integration. No main code, migration or current.yaml changed across these later observations. After candidate `dee32701` passed all 18 checks, main merged Electronics governance PR #203 at `b31e113a`. Its shared package/governance changes warranted one controlled repeat convergence under AGENTS.md section 2.1. Docs merge `d71e8610` preserves both V1.4 targeted routing and recovery instructions in START_HERE, and both the document-registry/targeted/maintenance validators and the new recovery tests in gate-governance. The new Electronics validator is retained in gate:code. No runtime code, migration or canonical current.yaml changed. The main SHA above is the final synchronization cutoff; this receipt does not create an endless main-moved/CI loop.

## Import and semantic decisions

The common base was `b963ef828f0e10042adacba4199bba972526c0df`. The initial main inventory had 151 paths; the final synchronized main has 175. Recovery has 135 paths and final Preview 13. Four main/recovery paths overlap: three textual conflicts and one shared Electronics auto-merge. The later Scratch guide update adds one separate docs-only merge conflict. Final Electronics governance adds two more docs/governance conflicts (START_HERE_FOR_AI.md and tools/gate-governance.sh), resolved by preserving both instruction sets and all validators. Thus three initial text conflicts and three later docs/governance conflicts were resolved.

Recovery classification: 64 E1 code/test paths; one shared Electronics hook; seven documentation/state paths; 30 migrations; 33 historical evidence paths (five text, 28 PNG). Every recovery path is accounted for in the appendix. No new E2/E3 functionality was imported from another source.

| Path | Main/docs semantics | E1 semantics | Resolution | Test |
|---|---|---|---|---|
| `docs/execution/current.yaml` | Scratch accepted/merged; Learning split_history with null unified HEAD; V1.4/2.1 refs | Obsolete task 179→178, V1.2 worktree/checkpoint and stale accepted/product SHAs | Keep exact updated docs baseline state; candidate only in review/PR | state equality + governance |
| `docs/product/ASA_INTEGRATED_IMPLEMENTATION_SPEC.md` | Canonical V1.4 | Superseded complete V1.2 roadmap | V1.4 remains byte-exact; academic deltas mapped to existing V1.4 sections | registry/refs + historical digests |
| `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md` | Six canonical results and E1 requirements | Old V1.2 index/section mapping | Keep current index; correct label to V1.4 and permitted author heartbeat | governance/router |
| `apps/web/src/electronics/use-workbench-project-state.ts` | Starting barrier, local solve, protected autosave/flush, confirmSimulationStarted | Confirmed revision reporter | Retain both independent changes; no obsolete synchronous start | Electronics browser + exact submission |
| Master/Users/router (auto-merge) | Current V2.1 authority | Result selection clarification + routing/in-app notes using V1.2 labels | Retain compatible E1 semantics; references updated to V1.4 §§4.12/4.13 | registry/refs + focused Learning |


`current.yaml` is byte-identical to updated docs: main Scratch `VSCR-M1-002C` closure and existing owner acceptance remain intact; Learning stays `TASK-LRN-COURSE-001`, Issue 179, pending owner acceptance, `split_history`, null unified HEAD. Observational SHAs in that inherited state are historical observations, not a claim that the candidate is main. Eighteen recovered INT-E1 requirements remain in_progress; the eight V1.4 additions remain target with empty evidence/tests.

Preview was applied from the final recovery-to-`dce14086` tree delta, without its historical merges. Variant B uses the ordinary author session resolver and permits the existing `last_seen_at` heartbeat. It does not refresh/rotate credentials after 401, change scope/expiry, or write learner sessions/Seat/Enrollment/Participation/Attempt/Submission/Completion/Result/Gradebook/notifications. No 0137 file or special Identity resolver exists. The obsolete accepted Attempt comparison is its own commit `a8574d32`, separate from Preview `6fa346a0`.

The merge retains main's Electronics simulation-start barrier, local solve, autosave/flush guards and `confirmSimulationStarted` together with E1's confirmed-save evidence. Historical V1/V1.1/V1.2 owner snapshots are unchanged. Compatible Result-selection/in-app notes remain, with normative links corrected to V1.4 §§4.12/4.13.

Three obsolete, unreferenced synthetic PNG imports were omitted only from the new integration tree: `3d-exact-submission.png`, `gradebook-accepted-3d.png`, and `electronics-placement-diagnostic.png` under `e2e/artifacts/learning/course-01`. Recovery retains their exact bytes; current real journey screenshots use `three-d-*`. No owner-supplied assets, owner screenshots, ZIPs or backups were removed.

## Bounded repairs discovered by validation

1. 3D checkpoint save race: editing B while A's draft/checkpoint response was pending erased the local B draft and briefly advertised A as saved. The hook now preserves/retries newer edits and exposes saved evidence only when the current document matches the acknowledged revision. Independent two-interleaving probe failed before and passed after; actual React/jsdom hook tests cover both races.
2. Unreleased 0134 had unreadable audit reason text. Correct Russian reasons replace the corrupt source strings and an actual grade-change-event assertion covers them. No applied main migration or existing audit row was rewritten.
3. The migration analyzer now accepts canonical closed/expired states, counts distinct Attempts, and prevents multiple Result revisions from multiplying analysis units. For schema>=0133 it uses the existing server selected-result resolver, while old schema queries retain legacy rules. Legitimate empty selection/cleared Gradebook anchors are allowed; stale or dangling selection remains a conflict. The analyzer remains read-only and retains fail-closed schema checks.
4. The Access A migration test stays 0103→0106 and seeds the actual old four-argument submission command. New application/old schema readiness explicitly fails; full 0106→E1 is proven separately.
5. Historical submitted timestamps without exact evidence remain visible as submitted but do not enter the teacher review queue. Real canonical submissions still count. A legacy browser regression verifies zero awaiting items, later changes_requested, resubmit, immutable Result and retained selected grade during a newer Attempt.
6. Browser fixtures now use actual sidebar links, one-time Seat credentials, batch preview/commit, explicit saved-revision confirmation, current author Preview and teacher-approved Account admission. Production permissions/rate limits were not weakened.
7. New Learning CI runs the same `test:learning-e1` and `e2e:learning-e1` commands as local evidence. Browser origin 4612 is scoped to the browser step, because injected API tests use 4610. E1 and legacy browser groups use separate test application lifetimes; unrelated classes no longer accumulate one process's IP attempt budget. Database/full-suite and browser runs are sequential because lifecycle tests own 4612. Access A/Preview PostgreSQL tests now create their own UUID-named temporary database: strict no-write triggers and whole-database snapshots retain every original assertion while no longer interfering with concurrent suites. Cleanup validates and drops only the database created by that fixture; the original test database and credentials are unchanged.
8. The documentary candidate `997a61a1` exposed a second fixture race: simultaneous fresh plans in different databases both execute unchanged migration 0002's cluster-wide `ALTER ROLE`, while the production runner's advisory lock is database-local. [The failed Learning run](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764135179) reported `tuple concurrently updated` before Preview tests; its other 17 checks passed. A test-only helper now holds a session advisory lock on the original `_test` coordinator database around unchanged `applyPlan`. All three real PostgreSQL migration suites use it; PGlite, production migration SQL/runner, all assertions and Preview write guards remain unchanged. The coordinator releases its lock and connection in `finally`, without serializing unrelated test work.

## Migration mapping and upgrade proof

There are 30 additive E1 migration filenames 0107–0136, no collisions and no renumbering. Main contains 105 files through 0106 (0005 is an existing gap); integrated fresh install applies 135 files and reports schema 136. Common main migrations are byte-identical. Only whitespace in 0110/0111 and the explicit 0134 audit-text repair differ from the recovered E1 migration source. All old/new numbers map to themselves.

| Migration | Purpose | Main? | Collision? | Dependency | Production-applied? | Integrated mapping |
|---|---|---|---|---|---|---|
| `0107_course_canonical_material_pins.sql` | course canonical material pins | NO | NO | `0106 canonical main` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0108_direct_canonical_material_assignment.sql` | direct canonical material assignment | NO | NO | `0107_course_canonical_material_pins.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0109_course_runtime_materialization.sql` | course runtime materialization | NO | NO | `0108_direct_canonical_material_assignment.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0110_learning_exact_project_submission.sql` | learning exact project submission | NO | NO | `0109_course_runtime_materialization.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0111_course_authoring_revision.sql` | course authoring revision | NO | NO | `0110_learning_exact_project_submission.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0112_learning_result_revisions.sql` | learning result revisions | NO | NO | `0111_course_authoring_revision.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0113_learning_selected_result_projection.sql` | learning selected result projection | NO | NO | `0112_learning_result_revisions.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0114_learning_revision_attempt_budget.sql` | learning revision attempt budget | NO | NO | `0113_learning_selected_result_projection.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0115_learning_teacher_review_context.sql` | learning teacher review context | NO | NO | `0114_learning_revision_attempt_budget.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0116_gradebook_selected_revision.sql` | gradebook selected revision | NO | NO | `0115_learning_teacher_review_context.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0117_learning_operational_conditions.sql` | learning operational conditions | NO | NO | `0116_gradebook_selected_revision.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0118_learning_effective_conditions_commands.sql` | learning effective conditions commands | NO | NO | `0117_learning_operational_conditions.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0119_classroom_account_join_approval.sql` | classroom account join approval | NO | NO | `0118_learning_effective_conditions_commands.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0120_learning_in_app_notifications.sql` | learning in app notifications | NO | NO | `0119_classroom_account_join_approval.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0121_learning_notification_preferences.sql` | learning notification preferences | NO | NO | `0120_learning_in_app_notifications.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0122_learning_reminders_and_completion.sql` | learning reminders and completion | NO | NO | `0121_learning_notification_preferences.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0123_learning_effective_conditions_projection.sql` | learning effective conditions projection | NO | NO | `0122_learning_reminders_and_completion.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0124_learning_review_command_boundary.sql` | learning review command boundary | NO | NO | `0123_learning_effective_conditions_projection.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0125_learning_results_and_grade_scale.sql` | learning results and grade scale | NO | NO | `0124_learning_review_command_boundary.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0126_learning_theory_audience.sql` | learning theory audience | NO | NO | `0125_learning_results_and_grade_scale.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0127_learning_assignment_timezone.sql` | learning assignment timezone | NO | NO | `0126_learning_theory_audience.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0128_learning_legacy_review_read.sql` | learning legacy review read | NO | NO | `0127_learning_assignment_timezone.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0129_learning_conditions_allowance.sql` | learning conditions allowance | NO | NO | `0128_learning_legacy_review_read.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0130_learning_notification_course_access.sql` | learning notification course access | NO | NO | `0129_learning_conditions_allowance.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0131_learning_named_audience_controls.sql` | learning named audience controls | NO | NO | `0130_learning_notification_course_access.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0132_learning_course_completion_denominator.sql` | learning course completion denominator | NO | NO | `0131_learning_named_audience_controls.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0133_learning_attempt_lifecycle_convergence.sql` | learning attempt lifecycle convergence | NO | NO | `0132_learning_course_completion_denominator.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0134_learning_gradebook_projection_sync.sql` | learning gradebook projection sync | NO | NO | `0133_learning_attempt_lifecycle_convergence.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0135_classroom_studentseat_batch.sql` | classroom studentseat batch | NO | NO | `0134_learning_gradebook_projection_sync.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |
| `0136_learning_author_preview.sql` | learning author preview | NO | NO | `0135_classroom_studentseat_batch.sql` (ordered chain) | NO: unreleased E1, owner-provided; production not inspected | unchanged |


The fresh local target is `asa_e1_convergence_final_20260913_test` on the existing PostgreSQL 16 cluster at 127.0.0.1:5433, with the pre-existing restricted runtime role. Credentials were read locally without printing them; no global role password or working database was changed. The earlier isolated test database remains retained.

`learning-course-upgrade.pg.spec.ts` creates its own generated `_test` databases and checks:

- populated 0106→136, exactly 30 new files, repeat apply 0; integrated readiness 200/schema 136; existing teacher login and gradebook 84/100; Account login/read excludes its withdrawn assignment;
- exact preservation of project/draft/version content, feedback, legacy work, course versions, accounts/principals/Seat credentials, learner IDs/links, immutable Submissions, original Result fields and evaluation/audit rows; membership/Attempt IDs are neither lost nor duplicated;
- accepted and returned historical attempts converge to closed plus Result decisions; NULL scores stay NULL; withdrawn Enrollment/Participation stay withdrawn;
- existing 0132 read/unread notifications and preferences survive migration to 136; compatibility Result revisions emit their two expected additional events, retries deduplicate and foreign inbox stays empty;
- 0133→0134 clears stale selected pointers while preserving the Gradebook audit anchor, and 0134→0135 preserves existing Seat credentials.

Notifications did not exist on 0106. Their old/new mix is therefore honestly seeded on 0132 rather than fabricated as a main 0106 table. The populated upgrade also exercises the read-only analyzer against multiple revisions, checks exact unit counts and rejects false pointer conflicts.

## Format-only checkpoint

Actual `pnpm format:check` found ten inherited blockers. Commit `4ddbeb33` applies only Prettier to them. `git diff -w` was manually reviewed; transpiled JavaScript ASTs were equivalent for all ten. Later explicit behavioral changes in some of those files belong to separate commits.

- `apps/web/src/components/AssignmentBrief.tsx`
- `apps/web/src/components/ClassroomAssignments.tsx`
- `apps/web/src/components/LearningConditions.tsx`
- `apps/web/src/components/LearningNotificationPreferences.tsx`
- `apps/web/src/components/SeatCourses.tsx`
- `apps/web/src/learning/assignment-date-time.spec.ts`
- `apps/web/src/learning/course-completion.spec.ts`
- `contexts/learning/domain/canonical-learning-state.ts`
- `e2e/learning-course-01.spec.ts`
- `tests/courses/course-canonical-delivery.pg.spec.ts`


## Validation receipt

All owner evidence commands used `NX_SKIP_NX_CACHE=true` and `NX_DAEMON=false`. Direct Vitest/Playwright runs did not use Nx. The full code run freshly executed 26 lint tasks, 41 typecheck/dependency tasks and 26 build tasks (93 total); its cache summaries say Skipped, not cache hits. Docker compose validation actually passed.

| Command | Result on integrated source |
|---|---|
| `pnpm nx run api:build` | PASS; 16 fresh tasks |
| `pnpm nx run web:build` | PASS; 6 fresh tasks, including subsequent Gradebook repair build |
| `pnpm nx run web:typecheck` | PASS; 6 fresh tasks |
| `pnpm contracts:check` | PASS |
| `pnpm db:migrate:check` | PASS; 135 valid files |
| `pnpm gate:governance` | PASS, including remote checks and final imported recovery tests |
| `pnpm validate:electronics-agent-docs` | PASS after final main import; 74 tests, routing validator with 29 components / 4 cards / 1 task card |
| `pnpm gate:code` | PASS; format/lint/types/boundaries/contracts/compose/security/license/dependencies/release/build/bundle |
| `pnpm gate:data` | PASS final isolated-Preview run; 1949/1949 in 245 files, then 15/15 RLS |
| `pnpm test:learning-e1` | PASS 238/238 in 33 files |
| `pnpm vitest run tests/courses/learning-course-upgrade.pg.spec.ts` | PASS 4/4, disposable populated upgrades |
| `pnpm vitest run tests/account/access-a.pg.spec.ts tests/account/access-a-upgrade.pg.spec.ts tests/courses/learning-course-upgrade.pg.spec.ts --maxWorkers=3 --minWorkers=3` | PASS 13/13 in each of three consecutive concurrent runs after the coordinator fix |
| `pnpm e2e:learning-e1` | PASS 15/15: E1/Preview 10 and legacy 5, separate application lifetimes |
| `pnpm e2e:access-a` | PASS 5/5, real author Preview and teacher-approved Account admission |
| Independent probes/tests | 3D race 2/2; canonical/projection 20/20; dry-run 5/5 |
| `git diff --check` | PASS against docs PR base |

The first combined local data+browser rerun was invalidated by a shared 4612 port, concurrent database snapshots and locks. It is not PASS evidence. The final serial logs supersede it. The first new Learning workflow failed 18 injected API checks because its browser origin was applied globally; the workflow fix scopes that environment to browser only. The initial general CI data failure exposed Preview write guards affecting other files in the shared database; the private fixture database fixes that interference without weakening any guard. Access A's old author/immediate-admission UI expectations were updated to current E1 semantics, without bypassing a gate.

Real browser evidence covers saved/published Preview with late-response races and no academic commands; author identity/material version continuity; 30×10 desktop/mobile matrix; named exclusions; Seat Electronics and 3D edit/save/exact Submission→return→newAttempt→acceptance; Account-approved course participation/theory/project completion; ungraded NULL scores; list revision confirmation; historical review/selection compatibility. Screenshot paths are under `e2e/artifacts/learning/`; Access A uses its existing synthetic evidence directory. The final `pnpm exec playwright test e2e/learning-author-preview.spec.ts e2e/learning-course-01.spec.ts e2e/learning-learner-submits-project-assignment.spec.ts e2e/learning-surface-convergence.spec.ts e2e/learning-teacher-assigns-activity.spec.ts --grep "exact saved" --workers=1` capture passed 1/1 and both Preview region PNGs were visually inspected. Preview screenshots are evidence of the specific source, not owner acceptance.

## GitHub workflow receipts

Executable/test candidate `dee32701d47f4742a4083c1aa26e8a18358cb5f6` — all 18 required checks completed SUCCESS, including the coordinator fix and every required data/browser job. Final exact-HEAD CI after importing accepted governance is recorded in the PR body.

| Workflow | Conclusion |
|---|---|
| [3D Core Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657083) | PASS |
| [ASA Lab Governance and Code Gates](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657127) | PASS |
| [Checkers M1 Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657133) | PASS |
| [Chess R1 Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657102) | PASS |
| [Contribution License Agreement](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764655644) | PASS |
| [Electronics R4-M1 Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657165) | PASS |
| [Learning E1 Convergence](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657121) | PASS |
| [Scratch Documentation Routing](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657112) | PASS |
| [Scratch Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34764657099) | PASS |

Final docs `d71e8610d1b014a3981560678dd33118b233edc4` — every exact-HEAD check completed SUCCESS.

| Workflow | Conclusion |
|---|---|
| [ASA Lab Governance and Code Gates](https://github.com/spikeal8-maker/asa-lab/actions/runs/34765228744) | PASS |
| [Contribution License Agreement](https://github.com/spikeal8-maker/asa-lab/actions/runs/34765227811) | PASS |
| [Electronics R4-M1 Focused](https://github.com/spikeal8-maker/asa-lab/actions/runs/34765228760) | PASS |
| [Scratch Documentation Routing](https://github.com/spikeal8-maker/asa-lab/actions/runs/34765228726) | PASS |

Intermediate failures are retained in GitHub history. Only the final PR HEAD's completed conclusions count toward integration readiness; the PR body includes the final SHA and all exact-HEAD workflow URLs. Automatic green CI is not owner acceptance.

## Review and remaining E1 scope

POST_STEP_REVIEW: PASS for this integration scope; L3_CRITICAL. Shared authority remains the existing domain/DB resolver. Server guards, immutable evidence, idempotency, concurrent saves, old/new rollout readiness and negative authorization are covered by the named tests. No canonical state promotion occurred. No project-map nodes changed.

Independent CHALLENGE_REVIEW: PASS at product candidate `0fac1851`, with no remaining actionable findings in the selected migration/shared-product boundaries. Both reviewers then re-attested executable HEAD `3c522194` as PASS: product/migration trees were unchanged; the private Preview fixture retained all write guards (reviewed blob `60ea32c35509c3cd2b6f3d32bc84a828c4d8a97a`). Migration review independently ran five pure classifier probes; shared review independently ran the two 3D races and 20 canonical/projection tests. PostgreSQL/browser/CI results above are the author's separate evidence, not falsely attributed to the reviewers.

The migration reviewer also returned PASS for the final coordinator helper (blob `f4c71d1249e264403865efd63e58060c66634a8f`), confirming one dedicated session holds the common lock across each plan, all three real-PG callers participate, and failure/success cleanup preserves existing guards and assertions. Concurrent PostgreSQL runs and the full post-fix Learning/data reruns are separate author evidence.

Independent final docs review: PASS at `d71e8610`. Both conflict resolutions preserve V1.4 authority, all pre-existing validators, current.yaml, canonical specifications, registry and snapshots. The helper and Learning product/tests remain unchanged from the green `dee32701` candidate.

Remaining E1 functional acceptance is explicit: draft recovery from a historical published version; Teacher Home attention block; complete class archive/restore integration acceptance; broader reminder/mixed-history acceptance beyond the preserved services and tested cases; and final owner E1 acceptance/release hardening. Existing reminder/notification/legacy behavior is retained. This task does not add archive features, reminder semantics, E2 quizzes, Python runtime, E3 Knowledge UI, self-study or linking functionality.

Original dirty Learning 135 files and the three docs snapshots were hash-verified against their preservation manifests with unchanged Git status. Both recovery refs and Preview remain unchanged. Production, FRP, Docker services and PostgreSQL volumes were not modified. Existing web 4610 remained running; test server 4612 was temporary and released after runs. No public demo/deployment is claimed.

DOCS PR MERGED: NO. E1 INTEGRATION MERGED: NO. PREVIEW MERGED: NO. MAIN DIRECT PUSH: NO. DEPLOY: NO. PREVIEW OWNER ACCEPTED: NO. E1 OWNER ACCEPTED: NO. E1 DONE: NO. E2 STARTED: NO. E3 STARTED: NO. NEXT_ALLOWED_TASK: STOP for owner docs/baseline/next-slice decision.

## Recovery path classification

This appendix records the initial 135-path recovery delta. Code/migration imports are retained with the bounded repairs above; superseded authority/state merges are semantic rather than whole-file recovery replacements. Historical Preview receipts may describe rejected intermediate 0137/VariantA work; they are historical evidence and this final-tree receipt defines the actual imported VariantB.

| Recovery path | Classification | Integration treatment |
|---|---|---|
| `apps/api/src/app.module.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/classroom-join.controller.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/classroom-join.controller.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/classrooms.controller.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/courses.controller.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/courses.controller.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/health.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-activities.controller.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-assessments.controller.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-assessments.controller.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-canonical-projection.service.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-canonical-projection.service.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-direct-assignment.controller.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-notifications.controller.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/api/src/learning-reminders.service.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/App.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/api.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/AssignLearningActivityDialog.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/AssignmentBrief.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/ClassroomAssignments.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/ClassroomCourses.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/ClassroomGradebook.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/ClassroomGradingScheme.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/ClassroomJoinRequests.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/ClassroomLearning.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/CoursesPanel.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/LearningAudience.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/LearningConditions.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/LearningInbox.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/LearningNotificationPreferences.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/LegacyLearningReview.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/PortalHeader.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/SeatAssignments.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/SeatCourses.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/WorkPreview.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/classroom-gradebook.css` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/components/learning-notifications.css` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/electronics/use-workbench-project-state.ts` | B shared auto-merge | represented; see semantic decisions/repairs above |
| `apps/web/src/learning/assignment-date-time.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/learning/assignment-date-time.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/learning/course-completion.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/learning/course-completion.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/learning/submit-saved-assignment.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/learning/use-learning-destination.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/modules/ModuleEditorHost.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/modules/project-hub.css` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/modules/project-save-evidence.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/pages/AccountPage.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/pages/AssignmentLibraryPage.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/pages/AttendedClassesPage.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/pages/AuthoredMaterialsPage.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/pages/ClassroomPage.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/pages/SeatAccountPage.tsx` | A E1-only | represented; see semantic decisions/repairs above |
| `apps/web/src/three-d/use-three-d-project.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `contexts/learning/domain/canonical-learning-state.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `contexts/learning/testing/canonical-learning-state.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `docs/execution/current.yaml` | E documentation/control-plane | represented; see semantic decisions/repairs above |
| `docs/product/ASA_INTEGRATED_IMPLEMENTATION_SPEC.md` | E documentation/control-plane | represented; see semantic decisions/repairs above |
| `docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml` | E documentation/control-plane | represented; see semantic decisions/repairs above |
| `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md` | E documentation/control-plane | represented; see semantic decisions/repairs above |
| `docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md` | E documentation/control-plane | represented; see semantic decisions/repairs above |
| `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md` | E documentation/control-plane | represented; see semantic decisions/repairs above |
| `docs/product/learning/START_HERE_FOR_AGENT.md` | E documentation/control-plane | represented; see semantic decisions/repairs above |
| `docs/product/learning/execution/LRN-COURSE-01.md` | F historical evidence | represented; see semantic decisions/repairs above |
| `docs/review/LRN_COURSE_E1_ATTEMPT_LIFECYCLE_CHALLENGE_2026_09_12.md` | F historical evidence | represented; see semantic decisions/repairs above |
| `docs/review/LRN_COURSE_E1_BATCH_STUDENTSEAT_CHALLENGE_2026_09_12.md` | F historical evidence | represented; see semantic decisions/repairs above |
| `docs/review/LRN_COURSE_E1_GRADEBOOK_PROJECTION_CHALLENGE_2026_09_12.md` | F historical evidence | represented; see semantic decisions/repairs above |
| `docs/review/LRN_COURSE_E1_ROLLOUT_COMPATIBILITY_CHALLENGE_2026_09_12.md` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/3d-exact-submission.png` | F historical evidence | omitted obsolete synthetic image; retained in recovery |
| `e2e/artifacts/learning/course-01/account-course-completed.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/account-course-electronics-completed.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/account-course-electronics-submitted.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/account-course-three-d-completed.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/account-course-three-d-submitted.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/author-teaching-same-material.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/authored-material-published.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/course-authored-published.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/dialog-two-learners.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/dialog-whole-class.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/electronics-exact-submission.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/electronics-placement-diagnostic.png` | F historical evidence | omitted obsolete synthetic image; retained in recovery |
| `e2e/artifacts/learning/course-01/gradebook-accepted-3d.png` | F historical evidence | omitted obsolete synthetic image; retained in recovery |
| `e2e/artifacts/learning/course-01/gradebook-accepted-electronics.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/gradebook-accepted-three-d.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/graded-correction-history.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/graded-stale-correction-denied.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/learner-third-excluded.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/learner-whole-class.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/matrix-30x10-desktop.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/matrix-30x10-mobile.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/muted-inbox-queue-independent.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/named-audience-withdrawn.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/teacher-two-learners.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/teacher-whole-class.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/three-d-exact-submission.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/artifacts/learning/course-01/ungraded-official-review.png` | F historical evidence | represented; see semantic decisions/repairs above |
| `e2e/learning-course-01.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `migrations/0107_course_canonical_material_pins.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0108_direct_canonical_material_assignment.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0109_course_runtime_materialization.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0110_learning_exact_project_submission.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0111_course_authoring_revision.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0112_learning_result_revisions.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0113_learning_selected_result_projection.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0114_learning_revision_attempt_budget.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0115_learning_teacher_review_context.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0116_gradebook_selected_revision.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0117_learning_operational_conditions.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0118_learning_effective_conditions_commands.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0119_classroom_account_join_approval.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0120_learning_in_app_notifications.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0121_learning_notification_preferences.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0122_learning_reminders_and_completion.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0123_learning_effective_conditions_projection.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0124_learning_review_command_boundary.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0125_learning_results_and_grade_scale.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0126_learning_theory_audience.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0127_learning_assignment_timezone.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0128_learning_legacy_review_read.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0129_learning_conditions_allowance.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0130_learning_notification_course_access.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0131_learning_named_audience_controls.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0132_learning_course_completion_denominator.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0133_learning_attempt_lifecycle_convergence.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0134_learning_gradebook_projection_sync.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0135_classroom_studentseat_batch.sql` | D migrations | represented; see semantic decisions/repairs above |
| `migrations/0136_learning_author_preview.sql` | D migrations | represented; see semantic decisions/repairs above |
| `schemas/openapi.yaml` | A E1-only | represented; see semantic decisions/repairs above |
| `tests/account/access-a.pg.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `tests/courses/course-canonical-delivery.pg.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `tests/courses/learning-assessment.pg.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `tests/courses/learning-course-upgrade.pg.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `tests/courses/learning-direct-assignment.pg.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `tests/courses/learning-direct-project-attempts.pg.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
| `tests/courses/quiz-engine.pg.spec.ts` | A E1-only | represented; see semantic decisions/repairs above |
