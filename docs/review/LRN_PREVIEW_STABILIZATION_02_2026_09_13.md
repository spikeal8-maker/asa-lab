# Bounded Preview technical review — stabilization 02

This receipt supersedes the earlier Preview receipts specifically on the all-database-write interpretation and 0137. Owner acceptance remains pending. Base is immutable `recovery/e1-learning-20260913` at `8ea7771d902d92f5288685a031b134feb353f4cc`; this review is not a main merge candidate or E1 acceptance.

## Decision: ordinary author session resolver (variant B)

Authority: proposed Integrated V1.4 §4.4 and LRN-PRV-001, reviewed against the same academic prohibition already present in the inherited specification. They prohibit Account/Seat, Enrollment/Participation, Attempt/Submission, Completion/Result/Gradebook/Notification and real learner-session changes. They do not prohibit the normal `sessions_v2.last_seen_at` heartbeat of the existing authenticated author. The compact contract now says this explicitly; this clarifies the existing domain boundary rather than weakening learner isolation.

Variant A provided total SQL read-only behavior, but duplicated the session validity query, expanded Identity ports/use cases, and imposed an additional DB-first migration. Its parity tests showed no current weakening, yet maintaining a second resolver would add an unnecessary future divergence risk. Total SQL silence is stronger than the canonical requirement and is not selected merely to satisfy the previous test.

Variant B restores the three Identity files byte-for-byte to recovery, removes the special controller readOnly path and withdraws unreleased 0137 from the branch. Existing clients and session validity predicates remain unchanged. 0136 remains the Preview data function and is already in recovery. No production DB was migrated, and no database object/data was dropped. The earlier isolated test database containing 0137 is retained; fresh tests now build a separate `_test` database through 0136. A deployment from the intermediate branch with 0137, if one ever existed, must retain its migration ledger and be reviewed before a future release; this task performs no deployment.

The HTTP regression rejects INSERT/UPDATE/DELETE/TRUNCATE on every public table, including all academic and learner-session tables, except that existing requesting-author sessions may advance only last_seen_at. Inserts/deletes, credentials, expiry, scope and unrelated-session updates remain forbidden. The exception uses exact fixture token hashes; test counters are supplementary, not the write proof. The test proves the guard rejects author expiry changes and zero-row academic UPDATEs, and proves normal heartbeat occurs.

Fresh PostgreSQL: 135 migration files applied through 0136; two selected tests pass (six unrelated Result A tests excluded). Author session validity rejects revoked/expired sessions, suspended accounts and revoked membership. Actual Preview HTTP covers exact saved/published content and digest, stale draft 409, foreign author/version 404, missing auth 401 and malformed/conflicting source 400. The first guard self-test referred to an absent updated_at column; corrected to the real state column, then both tests passed. API build passed with 15 tasks rerun and Nx cache disabled.

## Lifecycle dependency

Restoring the recovery Gradebook file reproduces exactly one Web type error, TS2367 at ClassroomGradebook.tsx:490: canonical state excludes `accepted`. `accepted` is a pedagogical result decision, not an Attempt lifecycle state. Recovery's `canonical-learning-state.ts` already supplies the authoritative state union; completed/result rendering remains unchanged. The one-line stale comparison removal is carried in a separate lifecycle commit, not justified as Preview behavior. Its acceptance source is the existing lifecycle contract, not a new result-selection decision.

## Remaining evidence

Final focused unit/type/build/browser, lint/contracts/governance evidence and exact GitHub status are recorded below when performed. This decision alone is not a full PASS, independent review, owner acceptance, release candidate, integration or deployment.

## Final focused evidence and critical review

Product/test revision: `68fbc3a2ec7334a8134c88025cd60bdcfd5d87cf` (variant B commit `6285f19a`, separate lifecycle commit `68fbc3a2`). Subsequent receipt/screenshot commit changes no source, migration, configuration or executable test.

All applicable local commands used `NX_SKIP_NX_CACHE=true`, `NX_DAEMON=false`. Nx reported `Cache: Skipped (--skip-nx-cache)`:

| Actual command | Result |
|---|---|
| `pnpm nx run api:build` | PASS, 15 tasks rerun |
| `pnpm nx run web:typecheck` | PASS after isolated lifecycle fix, 6 tasks rerun |
| `pnpm nx run web:build` | PASS, 6 tasks rerun |
| `pnpm vitest run contexts/identity/testing apps/api/src/learning-activities.controller.spec.ts apps/web/src/session-fetch.spec.ts` | PASS, 43 tests in 5 suites; Vitest no Nx cache |
| `node tools/migrate.mjs --apply` with exact `_test` confirmation | PASS, 135 files through 0136 on a newly created isolated database |
| `pnpm vitest run tests/account/access-a.pg.spec.ts -t 'ordinary author session|preview as learner'` | PASS, 2 tests, 6 unrelated tests skipped |
| `pnpm playwright test e2e/learning-author-preview.spec.ts --workers=1` | PASS, 1 real browser journey, exact published/draft and delayed response; no Preview mutation requests |
| `pnpm exec eslint` on all bounded changed TS/TSX files | PASS |
| `pnpm exec prettier --check` on those files and `schemas/openapi.yaml` | PASS |
| `pnpm contracts:check` | PASS, 95 OpenAPI paths |
| `pnpm db:migrate:check` | PASS, 135 files; no production connection |
| `git diff --check recovery/e1-learning-20260913...HEAD` | PASS |
| `pnpm gate:governance` | PASS, executed validators; no cache |

Screenshots `e2e/artifacts/learning/author-preview/published-v1.png` and `saved-draft-r2.png` were refreshed by the browser run and visually inspected. They show the exact source and existing AssignmentView with readable instructions and no start/submit action. They are synthetic test evidence, not an owner UI/design acceptance or a full E1 journey.

GitHub PR #210 uses the normal unmodified workflow on recovery base. Run [34756583238](https://github.com/spikeal8-maker/asa-lab/actions/runs/34756583238), exact product SHA `68fbc3a2`, has governance PASS; code gate FAIL at Prettier on 10 files whose blobs equal recovery; PostgreSQL and browser jobs SKIPPED. The duplicate push run was cancelled by PR-run concurrency and is not a product failure. Those formatting paths are AssignmentBrief.tsx, ClassroomAssignments.tsx, LearningConditions.tsx, LearningNotificationPreferences.tsx, SeatCourses.tsx, assignment-date-time.spec.ts, course-completion.spec.ts, canonical-learning-state.ts, learning-course-01.spec.ts, course-canonical-delivery.pg.spec.ts. They are deferred to the explicitly planned E1 baseline convergence, not silently repaired here. The final receipt commit's exact CI is reported on the PR; no green full repository gate is claimed.

POST_STEP_REVIEW: L3_CRITICAL boundary cleanup. Promised Preview behavior preserved, Identity extension removed, exact source/version and learner-data denials proved, no academic mutation or new authority. DOC_DRIFT: earlier receipts labelled historical; proposed V1.4 compact clarification matches the academic boundary. VERDICT: PASS for bounded local technical checks, not full GitHub integration or owner acceptance.

CHALLENGE_REVIEW (separate critical self-review, not independent acceptance): normal author heartbeat cannot change Account/Seat, credentials, expiry or session scope under the guard. Real learner sessions and academic tables reject all writes. Revoked/expired/suspended/membership-denied sessions remain denied by the unchanged resolver. Foreign versions/authors cannot reveal private sources; stale drafts conflict; late responses cannot select a stale source. Version/digest repeatability and no auto-refresh mutation are tested. No duplicate Identity source of truth or DB-first requirement remains beyond inherited Preview function 0136. Historical data and the already-created 0137 test DB remain intact.

UNVERIFIED: full GitHub data/browser gate on final integrated E1/main; mixed-data upgrade; all remaining E1 flows; independent reviewer and owner acceptance. PR #210 stays Draft; no merge into recovery/main, no new feature slice, E1 DONE: NO, DEPLOYED: NO, E2/E3 STARTED: NO. STOP after this bounded review.
