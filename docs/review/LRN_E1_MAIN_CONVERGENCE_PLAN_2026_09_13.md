# E1 / main convergence plan — 2026-09-13

Historical integration planning receipt for ASA-STABILIZATION-02, not execution state or permission to start a new product slice.

**NO integration performed yet.** `git merge-tree --write-tree` was used only to compute a diagnostic tree/conflict list; no merge, checkout, index or branch update installed it. No ours/theirs resolution was used. Recovery refs remain immutable.

## Exact comparison

- Latest fetched main: `48770100f58e0a4383ee0695802c5daaf5204d31`.
- Learning recovery: `8ea7771d902d92f5288685a031b134feb353f4cc`.
- Bounded Preview at observation: `dce140868601b55c9a5449b38012e297c116d8be`; review PR [#210](https://github.com/spikeal8-maker/asa-lab/pull/210), base recovery, never a main merge PR.
- Historical merge base: `b963ef828f0e10042adacba4199bba972526c0df`.
- Main has 151 changed paths since the base; E1 recovery has 135. Of these, 131 are E1-only and 4 changed on both sides.
- Diagnostic merge: **3 textual conflicts**; 1 additional shared source file merges textually but requires semantic review. Textual success is not product integration evidence.

## Final main advancement

While documentation CI ran, main advanced from 982f6377 to the SHA above through Scratch M1-002C protocol and Checkers CK-105 work. The 17 newly changed paths do not overlap the stabilization amendment or E1's four shared paths. They add protocol/checkers source and tests, provider documentation and a package script; no dependency lock, Identity, Learning, migration or Electronics input changed. A fresh diagnostic merge against this latest main still reports the same three conflicts. Preserve these newer main additions during future integration. The reviewed docs code remains on its existing baseline; no main merge or product integration was performed just to refresh this observation.

## Conflicts and semantic strategy

| Path | Diagnosis | Future resolution |
|---|---|---|
| `docs/execution/current.yaml` | content conflict | Inherit owner-selected main task state; incorporate an accepted revision-observation contract if/when #208 is approved. Keep Learning task ID/status/pending acceptance. Never take recovery's stale task/SHA wholesale or use a feature branch to select a new slice. |
| `docs/product/ASA_INTEGRATED_IMPLEMENTATION_SPEC.md` | add/add conflict | Use the owner-approved canonical edition with its Registry/version pins. Historical V1.3 and Users/Learning 2.0 remain exact snapshots. Current #208 V1.4 is a proposal until approved, not authority to implement E2/E3. |
| `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md` | content conflict | Retain main's task-routing/governance constraints; carry E1 checkpoint evidence only as history, not new live state or automatic readiness. Current state remains in current.yaml. |
| `apps/web/src/electronics/use-workbench-project-state.ts` | auto-merges, semantic overlap | Preserve main's simulation `starting` barrier, status ref, `confirmSimulationStarted`, local solve flow and autosave/flush protection. Add E1's server-confirmed project-save evidence reporter without reporting a dirty/failed/in-flight revision as saved. Do not restore recovery's obsolete synchronous simulation-start behavior. Verify both editor and exact-submit journeys. |

## Shared App/API/Web boundaries

These paths changed only in E1 since this merge base, but still require semantic integration review:

| Path / boundary | Required outcome |
|---|---|
| `apps/web/src/api.ts` | Preserve all main API contracts; carry exact content/attempt/result DTOs and commands consistently with OpenAPI, no casts masking old lifecycle states. |
| `apps/web/src/App.tsx` | One author library for author-only and teaching Accounts; preserve current entitlement routing and all unrelated module routes. E1 removes the role-dependent duplicate authored-material route. |
| `apps/web/src/components/PortalHeader.tsx` | LearningInbox integrates with existing navigation; Academic queue state is not unread notification count. Preserve Account and Seat boundaries. |
| `apps/web/src/modules/ModuleEditorHost.tsx` and `project-save-evidence.tsx` | ProjectSaveEvidence resets on project ID and wraps the real editor; AssignmentBrief supports Account and Seat. Save evidence must correspond to the current project's confirmed revision. |
| Electronics hook above; `apps/web/src/three-d/use-three-d-project.ts` | Both reporters prove saved revisions before submit; test delayed save, failed save, project switch and edits after immutable Submission. 3D has no textual overlap here, which does not prove end-to-end parity. |
| `apps/api/src/app.module.ts` | Register LearningNotificationsController and LearningRemindersService once; preserve existing services and isolate timers in tests. No new reminder feature work in this stabilization. |
| Identity/session code | Recovery changed no `contexts/identity/**` files relative to the common base; main also has no overlap there. Final Preview variant B removes all three special Identity diffs and 0137. Keep ordinary author heartbeat and unchanged validity predicates; no tenant/RLS redesign. |
| `apps/web/src/session-fetch.ts` | Preview GET does not perform automatic POST refresh on 401, while ordinary client requests retain existing refresh behavior. |
| `schemas/openapi.yaml` | E1-only changes, shared contract: preserve all current main routes, add exact Preview source validation and existing E1 APIs; validate actual HTTP status/error DTOs. |
| Docs/control-plane | Governance/package/lockfile changes on main remain authoritative. Recovery contains older prose and must not replace the documentation foundation or current main state. Merge #208 only by owner decision, separately from E1 integration. |

## Migration order and boundaries

Main has **105 SQL files through 0106**; recovery/final Preview have **135 through 0136** (0005 is absent historically). There are **30 new files, 0107–0136**, no main-only migration and no changed common migration bytes. No numbering collision at this snapshot. 0137 was withdrawn from the bounded branch; it is not part of the planned migration chain.

Apply in the existing numeric migration order, never cherry-pick an endpoint before its dependent functions. Dependency groups are:

1. 0107–0111: content pins, direct assignment, course runtime, exact project submission, authoring revision.
2. 0112–0116: append-only result revisions, selected projection, revision budget, exact review context and gradebook.
3. 0117–0123: operational conditions, admission, notifications/preferences/reminders and projections.
4. 0124–0132: review boundary, grade scale, theory audience, timezone, legacy reads, allowance, notification access, named audiences, completion denominator.
5. 0133–0134: lifecycle convergence and projection synchronization; must pass mixed-data preservation/correction tests, not merely fresh install.
6. 0135–0136: batch StudentSeat and exact author Preview.

No destructive migration is authorized. Fresh install success does not approve upgrade of production data. Review the transformations in 0133/0134 on a disposable `_test` database seeded with old attempts/results and inconsistent projections, preserving immutable submissions/history and testing selected-result clearing. If a future proposal requires destructive data changes or incompatible legitimate product behavior, stop for owner decision. No production backup/restore/deploy is performed here.

## Integration sequence and gates

1. Owner decides documentation #208 and the separate bounded Preview #210 review. Recovery branches remain untouched. Refresh remote heads and this conflict map before an authorized integration task.
2. Create a bounded integration candidate from latest main; semantically port/reconcile the preserved E1 delta and final Preview cleanup in small commits. Do not merge recovery wholesale using ours/theirs. Retain main's security/dependency baseline and no unrelated module changes.
3. Resolve the three documentation conflicts and Electronics save/simulation interaction explicitly. Keep the isolated Gradebook TS2367 compatibility fix as its own lifecycle dependency. Select no next E1 feature.
4. Address the 10 inherited Prettier failures as a separately identified E1 baseline formatting step during that authorized convergence. The bounded Preview PR does not rewrite unrelated E1 files just to make full CI green.
5. `NX_SKIP_NX_CACHE=true NX_DAEMON=false`: documentation validators/targeted context + `pnpm gate:governance`; relevant lint, typecheck, contracts, migration check, API/Web builds.
6. Focused identity/controller/session-fetch units; PostgreSQL course canonical delivery, exact submission, selected result, conditions/audience, correction and bounded Access/Preview cases on fresh and mixed-data `_test` databases.
7. Real Playwright Account and Seat author/create/assign/submit/review/revision/gradebook, both Electronics and 3D saved-revision journeys, plus exact draft/published Preview and late-response protection.
8. `pnpm gate:electronics-m1` and `pnpm gate:electronics-m1:browser`, `pnpm test:three-d`, then **`pnpm gate:repository` on the final integration SHA in GitHub**. A focused pass cannot compensate for a red repository gate. Classify inherited/flake failures before editing another module.
9. Required critical review and owner acceptance with exact SHA, no cache evidence, and a visible demo. No merge/deploy without separate owner authorization. STOP before any next E1/E2/E3 slice.

## Exact E1-only path inventory (131)

E1-only means no same-path edit in main since the merge base. It does not mean independently deployable or semantically conflict-free. Files already integrated before the base are not counted again.

### API (15)

- `apps/api/src/app.module.ts`
- `apps/api/src/classroom-join.controller.spec.ts`
- `apps/api/src/classroom-join.controller.ts`
- `apps/api/src/classrooms.controller.ts`
- `apps/api/src/courses.controller.spec.ts`
- `apps/api/src/courses.controller.ts`
- `apps/api/src/health.spec.ts`
- `apps/api/src/learning-activities.controller.ts`
- `apps/api/src/learning-assessments.controller.spec.ts`
- `apps/api/src/learning-assessments.controller.ts`
- `apps/api/src/learning-canonical-projection.service.spec.ts`
- `apps/api/src/learning-canonical-projection.service.ts`
- `apps/api/src/learning-direct-assignment.controller.ts`
- `apps/api/src/learning-notifications.controller.ts`
- `apps/api/src/learning-reminders.service.ts`

### Web (38)

- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/components/AssignLearningActivityDialog.tsx`
- `apps/web/src/components/AssignmentBrief.tsx`
- `apps/web/src/components/ClassroomAssignments.tsx`
- `apps/web/src/components/ClassroomCourses.tsx`
- `apps/web/src/components/ClassroomGradebook.tsx`
- `apps/web/src/components/ClassroomGradingScheme.tsx`
- `apps/web/src/components/ClassroomJoinRequests.tsx`
- `apps/web/src/components/ClassroomLearning.tsx`
- `apps/web/src/components/CoursesPanel.tsx`
- `apps/web/src/components/LearningAudience.tsx`
- `apps/web/src/components/LearningConditions.tsx`
- `apps/web/src/components/LearningInbox.tsx`
- `apps/web/src/components/LearningNotificationPreferences.tsx`
- `apps/web/src/components/LegacyLearningReview.tsx`
- `apps/web/src/components/PortalHeader.tsx`
- `apps/web/src/components/SeatAssignments.tsx`
- `apps/web/src/components/SeatCourses.tsx`
- `apps/web/src/components/WorkPreview.tsx`
- `apps/web/src/components/classroom-gradebook.css`
- `apps/web/src/components/learning-notifications.css`
- `apps/web/src/learning/assignment-date-time.spec.ts`
- `apps/web/src/learning/assignment-date-time.ts`
- `apps/web/src/learning/course-completion.spec.ts`
- `apps/web/src/learning/course-completion.ts`
- `apps/web/src/learning/submit-saved-assignment.ts`
- `apps/web/src/learning/use-learning-destination.ts`
- `apps/web/src/modules/ModuleEditorHost.tsx`
- `apps/web/src/modules/project-hub.css`
- `apps/web/src/modules/project-save-evidence.tsx`
- `apps/web/src/pages/AccountPage.tsx`
- `apps/web/src/pages/AssignmentLibraryPage.tsx`
- `apps/web/src/pages/AttendedClassesPage.tsx`
- `apps/web/src/pages/AuthoredMaterialsPage.tsx`
- `apps/web/src/pages/ClassroomPage.tsx`
- `apps/web/src/pages/SeatAccountPage.tsx`
- `apps/web/src/three-d/use-three-d-project.ts`

### domain (2)

- `contexts/learning/domain/canonical-learning-state.ts`
- `contexts/learning/testing/canonical-learning-state.spec.ts`

### docs/control-plane (9)

- `docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml`
- `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`
- `docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md`
- `docs/product/learning/START_HERE_FOR_AGENT.md`
- `docs/product/learning/execution/LRN-COURSE-01.md`
- `docs/review/LRN_COURSE_E1_ATTEMPT_LIFECYCLE_CHALLENGE_2026_09_12.md`
- `docs/review/LRN_COURSE_E1_BATCH_STUDENTSEAT_CHALLENGE_2026_09_12.md`
- `docs/review/LRN_COURSE_E1_GRADEBOOK_PROJECTION_CHALLENGE_2026_09_12.md`
- `docs/review/LRN_COURSE_E1_ROLLOUT_COMPATIBILITY_CHALLENGE_2026_09_12.md`

### browser evidence (28)

- `e2e/artifacts/learning/course-01/3d-exact-submission.png`
- `e2e/artifacts/learning/course-01/account-course-completed.png`
- `e2e/artifacts/learning/course-01/account-course-electronics-completed.png`
- `e2e/artifacts/learning/course-01/account-course-electronics-submitted.png`
- `e2e/artifacts/learning/course-01/account-course-three-d-completed.png`
- `e2e/artifacts/learning/course-01/account-course-three-d-submitted.png`
- `e2e/artifacts/learning/course-01/author-teaching-same-material.png`
- `e2e/artifacts/learning/course-01/authored-material-published.png`
- `e2e/artifacts/learning/course-01/course-authored-published.png`
- `e2e/artifacts/learning/course-01/dialog-two-learners.png`
- `e2e/artifacts/learning/course-01/dialog-whole-class.png`
- `e2e/artifacts/learning/course-01/electronics-exact-submission.png`
- `e2e/artifacts/learning/course-01/electronics-placement-diagnostic.png`
- `e2e/artifacts/learning/course-01/gradebook-accepted-3d.png`
- `e2e/artifacts/learning/course-01/gradebook-accepted-electronics.png`
- `e2e/artifacts/learning/course-01/gradebook-accepted-three-d.png`
- `e2e/artifacts/learning/course-01/graded-correction-history.png`
- `e2e/artifacts/learning/course-01/graded-stale-correction-denied.png`
- `e2e/artifacts/learning/course-01/learner-third-excluded.png`
- `e2e/artifacts/learning/course-01/learner-whole-class.png`
- `e2e/artifacts/learning/course-01/matrix-30x10-desktop.png`
- `e2e/artifacts/learning/course-01/matrix-30x10-mobile.png`
- `e2e/artifacts/learning/course-01/muted-inbox-queue-independent.png`
- `e2e/artifacts/learning/course-01/named-audience-withdrawn.png`
- `e2e/artifacts/learning/course-01/teacher-two-learners.png`
- `e2e/artifacts/learning/course-01/teacher-whole-class.png`
- `e2e/artifacts/learning/course-01/three-d-exact-submission.png`
- `e2e/artifacts/learning/course-01/ungraded-official-review.png`

### browser tests (1)

- `e2e/learning-course-01.spec.ts`

### migrations (30)

- `migrations/0107_course_canonical_material_pins.sql`
- `migrations/0108_direct_canonical_material_assignment.sql`
- `migrations/0109_course_runtime_materialization.sql`
- `migrations/0110_learning_exact_project_submission.sql`
- `migrations/0111_course_authoring_revision.sql`
- `migrations/0112_learning_result_revisions.sql`
- `migrations/0113_learning_selected_result_projection.sql`
- `migrations/0114_learning_revision_attempt_budget.sql`
- `migrations/0115_learning_teacher_review_context.sql`
- `migrations/0116_gradebook_selected_revision.sql`
- `migrations/0117_learning_operational_conditions.sql`
- `migrations/0118_learning_effective_conditions_commands.sql`
- `migrations/0119_classroom_account_join_approval.sql`
- `migrations/0120_learning_in_app_notifications.sql`
- `migrations/0121_learning_notification_preferences.sql`
- `migrations/0122_learning_reminders_and_completion.sql`
- `migrations/0123_learning_effective_conditions_projection.sql`
- `migrations/0124_learning_review_command_boundary.sql`
- `migrations/0125_learning_results_and_grade_scale.sql`
- `migrations/0126_learning_theory_audience.sql`
- `migrations/0127_learning_assignment_timezone.sql`
- `migrations/0128_learning_legacy_review_read.sql`
- `migrations/0129_learning_conditions_allowance.sql`
- `migrations/0130_learning_notification_course_access.sql`
- `migrations/0131_learning_named_audience_controls.sql`
- `migrations/0132_learning_course_completion_denominator.sql`
- `migrations/0133_learning_attempt_lifecycle_convergence.sql`
- `migrations/0134_learning_gradebook_projection_sync.sql`
- `migrations/0135_classroom_studentseat_batch.sql`
- `migrations/0136_learning_author_preview.sql`

### contracts/other (1)

- `schemas/openapi.yaml`

### PostgreSQL/tests (7)

- `tests/account/access-a.pg.spec.ts`
- `tests/courses/course-canonical-delivery.pg.spec.ts`
- `tests/courses/learning-assessment.pg.spec.ts`
- `tests/courses/learning-course-upgrade.pg.spec.ts`
- `tests/courses/learning-direct-assignment.pg.spec.ts`
- `tests/courses/learning-direct-project-attempts.pg.spec.ts`
- `tests/courses/quiz-engine.pg.spec.ts`
