# ASA Learning M0 Legacy Migration Dry Run Report

**Task:** `LRN-M0-005`

**Result:** EVIDENCE COMPLETE

**Baseline SHA:** `481f1d406f2322ce7999f1aab47c4f4eaff7fd77`

**Analyzer implementation SHA:** `6ad79ae6ab6b25c08f88f670d6f1f23f6fb9af2d`

**Analyzer:** `1.0.0`, SHA-256
`d726f16c8890c4377a096fe319df963c2ca49a92a1d3a6bb7ab9fb3ac9257076`

**Schema:** `asa-learning-migration-dry-run/v1`

**Production population:** NOT SCANNED / NOT AUTHORIZED

## 1. Outcome

The repository now contains a real executable analyzer, a versioned JSON
schema, a redacted Markdown renderer and deterministic fixture/PostgreSQL
tests. The analyzer opened both permitted populations inside a PostgreSQL
`REPEATABLE READ READ ONLY` transaction, proved
`transaction_read_only = on`, used set-based reads and always rolled back.

No migration, backfill, DDL, product runtime, UI, OpenAPI, Gradebook pointer,
legacy timestamp or learner identity row was created or changed.

The local-dev result is not a production result. It proves one current
`legacy_unresolved` unit and that no local-dev unit is presently canonical.
The test population proves all three kinds and provides broader integration
evidence. Synthetic fixture expectations, rather than incidental local data,
prove every required classification scenario.

## 2. Analyzer contract

Command:

```text
pnpm learning:migration:dry-run -- --environment test --output <json-path> --markdown <md-path>
```

`LEARNING_DRY_RUN_DATABASE_URL` is mandatory. A test database name must end in
`_test`; local development is explicitly named; production requires a separate
explicit flag and was not run. The URL is never printed or written to either
artifact.

The JSON contains separate `metadata` and `deterministic` sections. Volatile
`generatedAt` and performance timing live only in metadata, so the same
snapshot can compare the deterministic body byte-for-byte. Output is aggregate:
it contains no UUIDs, names, handles, emails, sessions, tokens or project
content.

## 3. Local-dev read-only scan

Snapshot: 2026-08-24T15:10:14.616Z, PostgreSQL 16.10, migration `0085`.

| Measure | Count |
|---|---:|
| learning units | 190 |
| distinct classroom assignments | 20 |
| mapped activity assignments | 0 |
| mapped course runs | 0 |
| exact legacy submissions recoverable | 0 |
| unresolved legacy submissions | 1 |
| status conflicts | 1 |
| manual-review conflicts | 1 |

Primary classification:

| Classification | Direct project | Course project | Quiz | Total |
|---|---:|---:|---:|---:|
| identity_unresolved | 0 | 0 | 0 | 0 |
| legacy_unresolved | 1 | 0 | 0 | 1 |
| selection_conflict | 0 | 0 | 0 | 0 |
| visibility_only | 0 | 0 | 0 | 0 |
| auto_reconcilable | 189 | 0 | 0 | 189 |
| clean_canonical | 0 | 0 | 0 | 0 |

The one submitted legacy unit has no immutable Attempt/Submission/ProjectVersion
chain. It is therefore `legacy_unresolved`; the analyzer does not reconstruct a
historical submission from the current mutable project.

## 4. Test population scan

Snapshot: fixed as-of 2026-08-24T00:00:00.000Z, PostgreSQL 16.10, migration
`0085`.

| Classification | Direct project | Course project | Quiz | Total |
|---|---:|---:|---:|---:|
| identity_unresolved | 0 | 0 | 0 | 0 |
| legacy_unresolved | 79 | 0 | 0 | 79 |
| selection_conflict | 0 | 0 | 0 | 0 |
| visibility_only | 0 | 0 | 0 | 0 |
| auto_reconcilable | 2,688 | 1 | 0 | 2,689 |
| clean_canonical | 0 | 0 | 1 | 1 |
| **total** | **2,767** | **1** | **1** | **2,769** |

The populated integration database contained 2 mapped activity assignments,
1 mapped run, 1 exact recoverable legacy submission, 79 unresolved legacy
submissions and 79 manual-review conflicts. It is isolated test data, not a
claim about production.

## 5. Identity mapping plan

| Aggregate | Local-dev | Test |
|---|---:|---:|
| future identities deterministically seedable | 19 | 276 |
| seat links deterministically seedable | 19 | 276 |
| account links deterministically seedable | 0 | 19 |
| email-free seat seeds | 19 | 257 |
| same-school multi-seat accounts | 0 | 0 |
| cross-school account splits | 0 | 0 |
| unresolved identity units | 0 | 0 |

The plan uses only persisted school, account and seat lineage. The pure fixture
suite additionally proves that multiple seats for one verified Account in one
school collapse to one seed, the same Account in different schools yields
separate seeds, and an email-free seat seeds independently. Display name,
handle, email similarity, project title and content are never queried or used as
merge evidence. No future `learner_identities.id` value is generated.

## 6. Result selection and lifecycle

The test scan found two units with a result and valid persisted pointer; no
missing/broken/cross-scope pointer in the current test population. Fixtures
separately prove missing pointer and broken/cross-scope pointer become
`selection_conflict`, while an older valid selected Attempt plus a newer
in-progress Attempt remains valid and is reported as a secondary revision fact.

| Seat lifecycle units | Local-dev | Test |
|---|---:|---:|
| active | 20 | 492 |
| issued | 170 | 10 |
| suspended | 0 | 2,267 |
| removed | 0 | 0 |
| ended classroom/assignment | 0 | 1 |

`visibility_only` is used only when evidence and selection are coherent and the
remaining difference is lifecycle access. Suspended/removed/ended history is
counted even when a unit has a higher-priority migration problem.

## 7. Legacy feedback

| Feedback | Local-dev | Test |
|---|---:|---:|
| total preserved as metadata | 1 | 176 |
| excellent | 1 | 53 |
| good | 0 | 123 |
| progress | 0 | 0 |
| redo | 0 | 0 |
| linked to assignment work | 1 | 37 |
| orphan/inconsistent link | 0 | 139 |
| converted to school grade | **0** | **0** |

All four allowed legacy values are covered by deterministic fixtures. The
analyzer retains them only as metadata and contains no mapping to `5/4/3/2`.

## 8. Read-only and repeatability proof

- PostgreSQL negative test attempted `CREATE TEMP TABLE` inside the analyzer
  boundary and PostgreSQL rejected it with SQLSTATE `25006`.
- Both success and failure paths execute explicit `ROLLBACK`.
- Two analyzer runs over the same test database with the same fixed `asOf`
  produced byte-identical `deterministic` JSON bodies.
- Unknown migration/checksum state, unsupported Attempt enum, inability to
  prove read-only mode and unsafe environment configuration fail closed.
- Data-quality cases defined by M0-004 are reported as classifications rather
  than hidden as tool errors.

## 9. Performance

The analyzer uses four queries with explicit `asOf` and five when it obtains
database transaction time. Reads are set-based; there is no query per
assignment/seat unit.

| Evidence | Units | Queries | Elapsed |
|---|---:|---:|---:|
| test database | 2,769 | 4 | 53.16 ms |
| local-dev database | 190 | 5 | 28.79 ms |
| synthetic 30 learners × 100 activities | 3,000 | N/A pure pass | < 2,000 ms assertion |

## 10. Fixture and test evidence

The 16 required fixture families cover clean project evidence, legacy submitted
without Attempt, legacy started, `changes_requested`, result without pointer,
older valid pointer, broken pointer, accepted quiz, course project, suspended
and removed history, same-account same-school/different-school rules,
email-free seat, ambiguous identity and all feedback tags. Every fixture has an
expected primary classification or aggregate assertion.

Commands passed:

```text
pnpm vitest run tests/courses/learning-migration-dry-run.unit.spec.ts
  22/22 tests PASS

pnpm vitest run tests/courses/learning-migration-dry-run.pg.spec.ts
  2/2 tests PASS

pnpm contracts:check
pnpm control-plane:check
pnpm gate:governance
pnpm gate:code  (NX_SKIP_NX_CACHE=true; Nx cache skipped)
git diff --check
```

`pnpm gate:data` was also run. It was not PASS: the complete run finished with
1,029/1,031 tests passing, including both new Learning suites, but two unrelated
tests hit their five-second timeout. The `tenant-context` test passed on a
single-worker retry; the existing Admin/Auth test `allows platform directory
reads across organizations` still timed out on retry. No Admin/Auth code was
changed in this task, and the red gate is not represented as Learning PASS or a
release-candidate result.

## 11. Requirement status

- `MIG-002`: proven for the executable repeatable non-mutating dry-run.
- `MIG-003`: in progress; the analyzer proves exact-evidence classification,
  while M0-006 must still obey it during any future backfill.
- `MIG-004`: in progress; dry-run preservation/no-conversion is proven, while
  future migration behavior is not implemented.
- `MIG-006`: proven; required counts and kind breakdown are emitted.
- `MIG-007`: target; a read-only analyzer does not prove rollback of a future
  additive migration.
- `MIG-001` and `MIG-005`: remain in progress; convergence/cutover did not occur.

## 12. Unresolved risks and next boundary

- The 1 local-dev and 79 test `legacy_unresolved` submissions require manual
  disposition or newly discovered exact immutable evidence; they cannot be
  auto-backfilled truthfully.
- Test feedback includes 139 records without an assignment-work link. They are
  preserved as metadata and require policy in M0-006 before any mapping.
- Local-dev contains no course or quiz population, so those paths are proven by
  fixtures/test data, not by local-dev counts.
- Production population remains unknown and unscanned.
- The repository-wide data gate retains one pre-existing Admin/Auth timeout;
  this M0 evidence does not claim the repository gate is green.
- The analyzer proposes only aggregate future operations. It does not create
  identities, Activities, Attempts, Submissions or result pointers.

`LRN-M0-006` is not activated and must not begin without separate owner
authorization.
