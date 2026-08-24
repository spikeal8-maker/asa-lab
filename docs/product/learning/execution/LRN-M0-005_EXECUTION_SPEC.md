# LRN-M0-005 — Legacy Migration Dry Run Execution Spec

**Task:** `LRN-M0-005`

**Milestone:** `M0 — State Convergence`

**Status:** DONE — evidence complete; owner acceptance pending
**Baseline SHA:** `481f1d406f2322ce7999f1aab47c4f4eaff7fd77`

**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`

**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Implement and prove a repeatable, fail-closed, non-mutating analyzer that
classifies CURRENT Learning data using the accepted canonical resolver contract
and emits deterministic versioned JSON plus redacted aggregate Markdown.

## 2. Non-goals

No production scan, migration, DDL, backfill, LearnerIdentity table, Attempt,
Submission, Gradebook-pointer or legacy-timestamp mutation, product API/UI,
OpenAPI convergence, M0-006, or M1-M7 work is authorized.

## 3. Requirement IDs

```text
MIG-002 — repeatable non-mutating dry-run
MIG-003 — missing exact immutable evidence is legacy_unresolved
MIG-004 — legacy feedback remains metadata, never a school grade
MIG-006 — required report fields and breakdowns
MIG-007 — future additive rollback remains target; not proven by this task
MIG-001 / MIG-005 — remain in_progress until actual convergence/cutover
```

## 4. CURRENT evidence

```text
docs/product/learning/current/LRN_M0_CURRENT_ARCHITECTURE.md
docs/product/learning/current/LRN_M0_STATUS_DIVERGENCE_REPORT.md
docs/product/learning/current/LRN_M0_CANONICAL_STATE_RESULT_RESOLVER.md
docs/architecture/ADR-LEARNER-IDENTITY-001.md
migrations/0021_classroom_roster_studentseat.sql
migrations/0029_project_feedback.sql
migrations/0033_classroom_assignments.sql
migrations/0050_account_learners.sql
migrations/0068_classroom_course_runs.sql and related course migrations
migrations/0077_learning_assessment_foundation.sql
migrations/0083_quiz_engine.sql
migrations/0084_grade_scales_and_learner_results.sql
tests/courses/** and tests/portal/helpers.ts
```

CURRENT has seat-owned learning provenance, mutable legacy work timestamps,
immutable Attempt/Submission evidence, mutable Gradebook selection and no
`learner_identities`, `activity_runs`, `activity_participations` or result
revision tables.

## 5. Existing contracts to reuse

- root `tools/*.mjs` executable-tool convention;
- explicit environment variables and exit code 78 for unavailable/unsafe
  configuration;
- `pg` client and isolated `*_test` protection;
- `schema_migrations` as applied-schema evidence;
- accepted six-class priority from M0-004;
- Vitest PostgreSQL fixtures using `TEST_DATABASE_URL`.

## 6. Exact files to change

```text
docs/execution/current.yaml
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/execution/LRN-M0-004_EXECUTION_SPEC.md
docs/product/learning/execution/LRN-M0-005_EXECUTION_SPEC.md
docs/product/learning/current/LRN_M0_LEGACY_DRY_RUN_REPORT.md
package.json
tools/learning-migration-dry-run.mjs
tools/learning-migration-dry-run-v1.schema.json
tests/courses/learning-migration-dry-run.unit.spec.ts
tests/courses/learning-migration-dry-run.pg.spec.ts
```

## 7. Files explicitly out of scope

```text
migrations/**
schemas/openapi.yaml
apps/api/**
apps/web/**
contexts/**
e2e/**
docs/architecture/ADR-LEARNER-IDENTITY-001.md
```

## 8. Database / migration

N/A — no migration or persistent write. The analyzer uses exactly one explicit
`LEARNING_DRY_RUN_DATABASE_URL`, opens
`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, verifies
`SHOW transaction_read_only = on`, performs only SELECT/SHOW queries and always
issues `ROLLBACK`. Failure to establish/prove that boundary aborts before scan.

## 9. API / OpenAPI

N/A — CLI diagnostic only; no HTTP endpoint or OpenAPI change.

## 10. Transaction boundaries

One repeatable-read, read-only transaction covers metadata, schema validation,
identity, learning-unit, feedback and aggregate reads. `asOf` is captured once
from database `transaction_timestamp()`. Success and failure both end in
explicit rollback before connection close.

## 11. Idempotency / concurrency

The deterministic payload excludes `generatedAt`; metadata separates
`generatedAt` from the stable `asOf`. Arrays sort by stable non-PII keys and
aggregates have fixed key order. Two scans of unchanged committed fixture state
with the same explicit `--as-of` MUST produce byte-identical deterministic
payloads. The live report records one snapshot and does not lock/mutate rows.

## 12. Authorization / RLS

The analyzer is an offline owner diagnostic, not a user endpoint. It receives an
explicit database URL and never prints it. Production requires both
`--environment production` and `--allow-production`; neither is authorized or
used in this task. Test database names must end `_test`; local-dev must be
explicitly named and cannot be inferred from API runtime environment.

## 13. Migration / compatibility

The analyzer produces a future mapping plan only. Seat/account/school persisted
links may seed identity mappings; display name, login, email similarity, project
title and content are never merge evidence. Legacy submission is recoverable
only when an existing exact immutable chain supplies all required IDs.

## 14. Feature flag / rollout

N/A — diagnostic CLI. Command:

```text
pnpm learning:migration:dry-run -- --environment test --output <json-path> --markdown <md-path>
```

`LEARNING_DRY_RUN_DATABASE_URL` is mandatory. `--environment local-dev` is
allowed for local aggregate evidence. Production is fail-closed without the
additional explicit flag and separate owner authorization.

## 15. Rollback

Revert tooling/docs commits. Database rollback is intrinsic because every scan
runs in a read-only transaction and always rolls back. MIG-007 remains target
for the future additive migration; this analyzer cannot prove migration rollback.

## 16. Unit tests

```text
LRN-DRY-UNIT-001 exact six-class priority and no additional primary values
LRN-DRY-UNIT-002 legacy submitted without exact evidence -> legacy_unresolved
LRN-DRY-UNIT-003 valid older selection is not a conflict
LRN-DRY-UNIT-004 deterministic ordering/serialization
LRN-DRY-UNIT-005 feedback values remain metadata and never grade values
LRN-DRY-UNIT-006 environment/argument validation fails closed
```

## 17. Integration tests

```text
LRN-DRY-PG-001 clean project chain
LRN-DRY-PG-002 legacy submitted without Attempt
LRN-DRY-PG-003 legacy started without Attempt
LRN-DRY-PG-004 changes_requested with immutable Submission and cleared timestamp
LRN-DRY-PG-005 Result without Gradebook pointer
LRN-DRY-PG-006 valid old pointer plus newer in-progress Attempt
LRN-DRY-PG-007 broken/cross-scope pointer -> selection_conflict
LRN-DRY-PG-008 accepted direct quiz
LRN-DRY-PG-009 course-generated project
LRN-DRY-PG-010 suspended and removed seat history
LRN-DRY-PG-011 same Account in two classes of one school
LRN-DRY-PG-012 same Account in two schools
LRN-DRY-PG-013 email-free seat seed
LRN-DRY-PG-014 ambiguous/inconsistent identity -> identity_unresolved
LRN-DRY-PG-015 four legacy feedback tags preserved
LRN-DRY-PG-016 same snapshot/asOf -> byte-identical deterministic payload
LRN-DRY-PG-017 DB rejects write inside analyzer read-only boundary
LRN-DRY-PG-018 30 learners x 100 activities, bounded query count and elapsed time
```

The 16 classification fixtures are pure deterministic isolated inputs. The
PostgreSQL suite proves the real read-only boundary and repeatability against a
fully migrated `*_test` database. Fixture preparation, when needed, occurs
outside the analyzer transaction; the analyzer itself has no write path.

## 18. Browser E2E

N/A — no UI or runtime endpoint changes.

## 19. Security negative tests

- database URL/credentials never appear in JSON, Markdown or errors;
- PII fields are never selected into committed output;
- explicit test/local environment boundary;
- production invocation without explicit authorization flag fails;
- DB-level read-only write attempt fails with SQLSTATE `25006`;
- tenant/school/assignment lineage inconsistencies classify or fail closed
  according to the accepted data-conflict boundary.

## 20. Performance considerations

The scan uses bounded set-based queries: metadata/schema, learning-unit batch,
identity batch and feedback batch; no application query per assignment/seat.
Report records query count, scanned unit count and elapsed milliseconds. The
required synthetic floor is 3,000 units (30 learners x 100 activities).

## 21. Output schema and redaction

Machine report schema id: `asa-learning-migration-dry-run/v1`.

```text
metadata
deterministic
  totals
  byKind
  classifications
  identity
  legacySubmission
  selection
  visibility
  feedback
  errors
  warnings
```

Metadata includes environment kind, applied migration version, repository SHA,
analyzer version, generatedAt, asOf and a safe database fingerprint. The stable
payload contains aggregate counts and sorted diagnostic codes only. Names,
handles, emails, sessions, tokens, raw project content and raw UUIDs are never
written to report files. Detailed internal rows remain in memory only.

## 22. Error handling

Exit 78 for missing/unsafe environment configuration. Exit 1 for unsupported
schema, unsupported Attempt value, inability to prove read-only mode, malformed
tool input or query/runtime failure. Expected data conflicts become one of the
six classifications plus secondary facts and do not abort the scan.

## 23. Acceptance checklist

- [x] executable analyzer and one documented command
- [x] read-only transaction and DB-level negative proof
- [x] versioned deterministic JSON schema
- [x] exact six-class priority
- [x] required Master Spec counts and direct/course/quiz breakdown
- [x] identity mapping aggregates without guessing
- [x] missing immutable evidence -> legacy_unresolved
- [x] result-selection and lifecycle rules from M0-004
- [x] legacy feedback preserved without grade conversion
- [x] 16 required fixture families and expected classifications/counts
- [x] repeatability proof
- [x] 30 x 100 performance evidence and bounded query count
- [x] redacted test/local report; no PII committed
- [x] production not scanned
- [x] ledger drift repaired without false implementation claims
- [x] `git diff --check`
- [x] `pnpm contracts:check`
- [x] `pnpm control-plane:check`
- [x] `pnpm gate:governance`
- [x] relevant focused code/data tests

## 24. Evidence

Published evidence:

```text
docs/product/learning/current/LRN_M0_LEGACY_DRY_RUN_REPORT.md
tools/learning-migration-dry-run.mjs
tools/learning-migration-dry-run-v1.schema.json
tests/courses/learning-migration-dry-run.unit.spec.ts — 23 PASS
tests/courses/learning-migration-dry-run.pg.spec.ts — 2 PASS
gate:code — PASS with NX cache skipped
gate:data — FAIL outside Learning scope: one persistent Admin/Auth timeout;
            Learning suites PASS
```

Production was not scanned. No browser evidence is applicable because this
task adds no product runtime or UI.
