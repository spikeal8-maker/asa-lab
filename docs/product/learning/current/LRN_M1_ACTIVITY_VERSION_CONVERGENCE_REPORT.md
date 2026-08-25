# LRN-M1-001 — LearningActivityVersion Convergence Report

**Task status:** EVIDENCE COMPLETE / owner review pending
**Baseline SHA:** `24ff391386d3ea6acb99bcbb73a0542802a1f785`
**Issue / PR:** `#154` / `#155`
**Production status:** NOT DEPLOYED

## CANONICAL LEARNINGACTIVITY MODEL

The existing `learning_activities` table is the only canonical activity root. No parallel content core was added. New authored roots hold identity, `owner_principal_id`, tenant/scope, live visibility, archive state, mutable revisioned draft, current-published-version pointer and exact optional `teacher_assignments` provenance.

Existing rows remain `authoring_origin=legacy_runtime`, `reusable_authored_content=false`, with no invented draft. Canonical roots are constrained to a positive `draft_revision` and object `draft_payload`.

## CANONICAL LEARNINGACTIVITYVERSION MODEL

The existing `learning_activity_versions` table now represents future canonical publications through `canonical_contract_version=1`. A canonical version stores:

- one of `quiz|project|essay|file|manual`;
- `ungraded|completion|graded` result semantics;
- immutable title/instructions/module and deterministic SHA-256 content digest;
- immutable policy snapshot;
- exact `quiz_version_id` and optional proven `starter_project_version_id` reference;
- provenance, source draft revision, publication request, publisher and timestamp.

Historical rows are not updated. `canonical_contract_version IS NULL` continues to mean historical/compatibility physical shape, not canonical authored content.

## ROOT VS VERSION RESPONSIBILITIES

| ROOT (`LearningActivity`) | IMMUTABLE VERSION (`LearningActivityVersion`) |
|---|---|
| identity and owner | published content snapshot |
| personal/school scope | pedagogical/runtime defaults needed for reproduction |
| live visibility and future grants | exact QuizVersion/ProjectVersion references |
| archive lifecycle | provenance and publisher |
| mutable optimistic draft | digest, version number and `published_at` |
| current published pointer | no live sharing state |

Changing visibility/sharing does not create a content version. The minimal normative correction is recorded in `ASA_LEARNING_TECHNICAL_SPEC.md` section 8.3.

## CURRENT → TARGET KIND MAP

| CURRENT value/source | M1-001 disposition |
|---|---|
| authored `project` | canonical `project` with exact teacher-assignment lineage or standalone project definition |
| authored `quiz` / exact `QuizVersion` | canonical `quiz`, exact QuizVersion content reference, policies copied into the new LAV snapshot |
| `open_response` | compatibility-only; no silent `essay` conversion |
| `composite` | unsupported/unresolved; no silent conversion |
| new `essay` | schema/domain/API supported; no learner runtime or UI claim |
| new `file` | schema/domain/API supported; no learner runtime or UI claim |
| new `manual` | schema/domain/API supported; no learner runtime or UI claim |

Repository CURRENT had writers for `project` and `quiz`; no writer/fixture for `open_response` or `composite` was found. The integration fixture population after M1 publication proved canonical rows separately from legacy rows rather than inferring semantics from enum names.

## RESULT MODE MODEL

- `ungraded`: `max_points IS NULL`; no grade semantics.
- `completion`: `max_points IS NULL`; completion is not a fabricated numeric scale.
- `graded`: `max_points > 0` is mandatory.

The migration only relaxes the historical physical NOT NULL constraint. It does not rewrite old values or claim that a legacy structural maximum is trustworthy grading semantics.

## QUIZ POLICY OWNERSHIP

For existing quiz runtime, immutable `quiz_versions` policy fields remain compatibility evidence and are not rewritten. For new canonical authoring, `LearningActivityVersion(kind=quiz)` is the future runtime-policy authority: it snapshots attempt limit, time limit, assessment/pass semantics, feedback release, result selection, completion and late policy while pinning the exact immutable QuizVersion content.

A compatibility-registered legacy LAV/root remains non-reusable. This does not poison a separately proven teacher-owned immutable QuizVersion: a new root may reference that exact QuizVersion with independent `authoring_origin=quiz_version` provenance and produces a different canonical LAV.

## PROJECT VERSION REFERENCES

Canonical project definitions require an exact `module_key` and immutable instructions/policies. CURRENT `ProjectVersion` rows do not prove whether they are authoring starters or learner submission checkpoints. Therefore any non-null `starterProjectVersionId` fails closed with `starter_project_unprovenanced`; learner-submitted ProjectVersion evidence is never promoted into authored content.

## COMPATIBILITY VERSION HANDLING

`learning_migration_compatibility_activity_versions` stays migration/history-only with `grading_semantics=unknown` and `reusable_authored_content=false`. Canonical list/get/publish functions exclude the corresponding legacy root/version. There is no title/module/name merge, no fabricated scale and no historical UPDATE.

## OLD RUNTIME REFERENCE PROOF

PostgreSQL integration evidence captures and rechecks:

- direct `classroom_assignments.assignment_id`;
- course-generated `classroom_assignments.course_run_id`;
- quiz `classroom_assignments.quiz_version_id`;
- `classroom_activity_versions.learning_activity_version_id`;
- existing `learning_attempts.learning_activity_version_id` and `learning_submissions.attempt_id`.

Project v1 is referenced by a classroom mapping and Attempt/Submission, the draft is edited and v2 is published, and all old references remain on v1. No migration statement retargets runtime rows.

## IMMUTABILITY PROOF

Publication inserts a new LAV; the pre-existing `learning_immutable_row` trigger rejects direct UPDATE/DELETE, including an attempted UUID-targeted title change by the migration-owner test connection. The v1 digest/content remains unchanged after v2 publication.

## PUBLISH IDEMPOTENCY

Retrying the same `(activity_id, publication_request_id)` returns the same version with `reused=true`. A partial unique index guards request identity and another guards one canonical publication per source draft revision.

## CONCURRENCY PROOF

Two concurrent publications for the same activity/draft are serialized by an activity-scoped transaction advisory lock. The integration test proves one row/version number is created and exactly one caller observes reuse. DB uniqueness remains the final duplicate guard.

## RLS/SECURITY

- runtime role has no direct SELECT or mutation grant on roots/versions;
- runtime access is only through explicitly granted security-definer functions;
- same-school different owner cannot read or edit an unpublished draft;
- cross-school principal cannot create content in another tenant;
- compatibility roots are absent from reusable listings and cannot publish;
- published UUID UPDATE is rejected by the immutable trigger;
- non-provenanced starter ProjectVersion is rejected;
- HTTP mutation requires an educator session and takes principal/tenant from server-side active context, not request JSON.

M5 cross-owner grants/sharing are intentionally not implemented.

## MIGRATIONS

`0091_learning_activity_version_convergence.sql` is additive. Current `main` added the unrelated `0090_project_draft_idempotency.sql` during execution, so the Learning migration was renumbered before merge rather than colliding in CI. A clean isolated PostgreSQL run applied all 90 migrations and repeated with `Applied 0 migration(s)`. Checksums for `0001..0090` are unchanged. There is no backfill and no production application.

Rollback before future runtime adoption is behavioral: unroute the additive API and leave nullable additive schema in place. Published versions are never deleted or rewritten as rollback.

## OPENAPI

OpenAPI now documents six educator endpoints:

```text
GET  /api/learning/activities
POST /api/learning/activities
GET  /api/learning/activities/{activityId}
PUT  /api/learning/activities/{activityId}/draft
POST /api/learning/activities/{activityId}/publish
GET  /api/learning/activities/{activityId}/versions
```

`pnpm contracts:check` validates 59 paths after integration with current `main`. No learner execution endpoint or UI is claimed.

## REQUIREMENTS STATUS

| Requirement | Status after LRN-M1-001 | Reason |
|---|---|---|
| `ARCH-001` | `in_progress` | definitions converge, but common persistent ActivityRun/course materialization is later M1 |
| `ARCH-006` | `proven` | canonical publication is immutable by DB trigger and v1/v2/direct-update tests |
| `VER-001` | `in_progress` | LAV portion is proven; the requirement lists additional version families |
| `VER-002` | `in_progress` | LAV policy snapshot is proven; unlock/run policy portions remain later scope |
| `IDN-003` | `in_progress` unchanged | this definition task does not create native learner-owned runtime lineage |

## ARCH-001 STATUS

`in_progress`. LRN-M1-001 establishes one definition/version contract only. It does not claim one runtime until persistent ActivityRun and course materialization are implemented and proven.

## IDN-003 STATUS

`in_progress`, unchanged. Stable learner ownership must be used by native CourseEnrollment/ActivityParticipation/Attempt lineage in later approved tasks.

## TEST EVIDENCE

- `pnpm test:learning-m1-001`: 2 files, 14 tests passed.
- five focused legacy regression files: 22 tests passed.
- `NX_SKIP_NX_CACHE=true pnpm gate:data`: 169 files / 1146 tests plus 15/15 RLS tests passed after rebuilding and integrating current `main`.
- `NX_SKIP_NX_CACHE=true pnpm gate:code`: PASS; Nx lint/typecheck/build cache skipped; contracts/security/release/build passed; Compose rendering was explicitly `SKIPPED` because Docker CLI is unavailable.
- browser: N/A because this task adds no UI and switches no learner/teacher surface.

## KNOWN GAPS

- no CourseEnrollment, ActivityRun, ActivityParticipation, audience or effective-settings runtime;
- no canonical course materialization;
- no learner flow or teacher authoring UI for the new API;
- essay/file/manual are definition/API-capable only;
- authoring-safe starter ProjectVersion provenance remains unresolved and is fail-closed;
- QuizVersion compatibility fields remain for old runtime until a later cutover;
- no M5 catalog/capability sharing;
- no production migration, deployment, backfill, flag or restart.

## PRODUCTION STATUS

NOT DEPLOYED. All database evidence used the isolated `asalab_m1_001_test` database on local port `55433`. No production data or service was touched.

## NEXT READY TASK

After owner acceptance only: `LRN-M1-002 — CourseEnrollment`. It is not activated by this report.
