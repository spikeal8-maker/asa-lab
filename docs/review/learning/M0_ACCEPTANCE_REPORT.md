# ASA Learning M0 Acceptance Report

**Task:** `LRN-M0-008 — M0 Acceptance Gate`  
**Baseline:** `309c66b4c04d769945af2f7c0c3bdb728ccb2a97`  
**Acceptance candidate SHA:** assigned to the evidence commit containing this report; recorded by the closure commit after exact-SHA CI  
**Product source SHA:** `309c66b4c04d769945af2f7c0c3bdb728ccb2a97`  
**Production:** `NOT DEPLOYED / MIGRATIONS 0086..0089 NOT APPLIED / BACKFILL NOT RUN`

## M0 VERDICT

`M0 ACCEPTED`

M0 provides a coherent compatibility foundation: it proves CURRENT divergence,
introduces the ADR-selected school-scoped learner mapping, supplies repeatable
diagnostics and guarded additive convergence, resolves canonical workflow and
selected-result semantics, and makes existing learner/teacher surfaces agree.
It does not claim the M1 universal runtime or the M3 Gradebook Matrix.

## M0-001..007 matrix

| Task | Result | Evidence | Source SHA |
|---|---|---|---|
| M0-001 CURRENT audit | PASS | exact entity/API/UI/data-lineage map in `LRN_M0_CURRENT_ARCHITECTURE.md` | `cf43a359` audit baseline; `374c54f5` activation |
| M0-002 identity ADR | PASS | `ADR-LEARNER-IDENTITY-001`, decision B with one school-scoped mapping layer | `6866e05d` baseline |
| M0-003 divergence trace | PASS / PROVEN | legacy classroom status and assessment/Gradebook sources shown to disagree | `57a3dfa3` baseline |
| M0-004 resolver design | PASS | one orthogonal workflow/result/flags resolver contract | `879f6594` baseline |
| M0-005 dry run | PASS | read-only analyzer, versioned schema, deterministic repeat | `17e617e6` analyzer; owner accepted by `2f675d9` |
| M0-006 foundation/corrections | PASS | 0086–0088, no timestamp-inferred submission, unknown grading, isolated-only guard | `c8fe06cc` accepted corrective evidence |
| M0-007 surfaces | PASS | shared projection, OpenAPI, browser A–D, security and 30×100 | `9e7398a8` product merge; `309c66b4` owner-accepted closure |

No accepted correction contradicts an earlier decision. Migration 0088
supersedes unsafe semantics in the immutable published 0087 file; 0089 consumes
that corrected compatibility evidence without introducing a second resolver.

## Master Spec M0 Definition of Done

| REQUIREMENT | STATUS | CODE EVIDENCE | DATA / MIGRATION EVIDENCE | TEST EVIDENCE | BROWSER EVIDENCE | ACCEPTED / SOURCE SHA |
|---|---|---|---|---|---|---|
| Observed inconsistency reproduced/proven | PASS | CURRENT legacy and assessment readers traced in M0-003 | one legacy submitted row without Attempt was proven | M0-003 diagnostics; M0-007 surface PG | regression A | `57a3dfa3`, `309c66b4` |
| Canonical learner/activity mapping exists | PASS | identity and activity adapters plus shared resolver | 0086 learner/link mapping; 0087/0088 classroom activity compatibility mapping | additive-backfill, identity RLS, adapters | A–D consume mapped projection | `c8fe06cc`, `9e7398a8` |
| Dry-run report exists and is repeatable | PASS | `learning-migration-dry-run.mjs` | fresh 0089 DB; two same-as-of reports have equal deterministic sections, four queries | dry-run unit + PG | N/A | acceptance candidate |
| Historical submissions never fabricated | PASS | analyzer exact-evidence classification | timestamped ProjectVersion creates zero Attempt and zero Submission; guarded CLI also reports zero backfilled | additive-backfill same/cross-tenant fixtures | regression A shows truthful unresolved state | `c8fe06cc`, acceptance candidate |
| Legacy feedback preserved without grade conversion | PASS | no feedback-to-grade mapping | guarded CLI reports `gradeConversions=0`; compatibility grading unknown | dry-run + additive-backfill | regression D excludes fake points/percent/grade | `c8fe06cc`, acceptance candidate |
| Relevant teacher/student surfaces agree | PASS | `LearningCanonicalProjectionService` and existing controllers | 0089 batched read functions | resolver, adapters, controllers and surface PG | A–D passed | `9e7398a8`, acceptance candidate |
| Migration tests green | PASS | migration runner target guards | fresh database applied every file through 0089; repeat applied zero | embedded migration + full data/RLS gates | N/A | acceptance candidate |

## Requirements matrix

| ID | M0 disposition | Exact evidence |
|---|---|---|
| DB-000 | PASS / proven | CURRENT audit plus ADR proves why Account, StudentSeat, Principal and membership alone cannot safely own cross-seat history |
| MIG-001 | PASS / proven | M0-003 root cause, 0089 projection, surface A |
| MIG-002 | PASS / proven | non-mutating analyzer; fresh meaningful repeat equality |
| MIG-003 | PASS / proven | 0088 removes timestamp-only backfill; tests and CLI create zero historical Attempt/Submission |
| MIG-004 | PASS / proven | feedback metadata retained; zero grade conversion |
| MIG-005 | PASS / proven for existing M0 surfaces | shared resolver/projection wins over legacy fallback in canonical mode; universal Participation runtime remains M1 |
| MIG-006 | PASS / proven | analyzer totals, kinds, conflicts and feedback fields validate against v1 schema |
| MIG-007 | PASS / proven | additive artifacts, retained legacy rows, batch authority and legacy reader rollback |
| IDN-001 | PASS / proven | school-scoped `learner_identities` and links exist |
| IDN-002 | PASS / proven | four candidates audited and ADR B accepted before the table was created |
| IDN-003 | NOT CLOSED IN M0 | M0 compatibility mapping is proven; universal new runtime ownership is moved to M1 without weakening the requirement |
| IDN-004 | PASS / proven | seat-to-account linking retains the learner ID in one school; same Account remains distinct across schools |
| ARCH-003 | PASS / proven for existing M0 readers | Gradebook consumes canonical workflow/selected result and does not invent another result source |

`GRD-002` and `GRD-005` remain `in_progress`. M0 proves their compatibility
semantics on the existing Gradebook only. Gradebook Matrix, Works, Review Queue,
mobile modes and UI expansion remain M3.

## Data / migration status

Acceptance used a newly created isolated database named
`asalab_m0_acceptance_test`. Repository provisioning dropped only that exact
`*_test` target, recreated it, and applied 88 migration files from the beginning
through schema version 0089. A second smoke run printed `Applied 0 migration(s)`
and `Idempotency verified: re-run applied 0 migrations`.

On seeded fixtures the M0-005 analyzer repeated with equal deterministic output:
four set-based queries, `legacy_unresolved=4`, `selection_conflict=0`,
`auto_reconcilable=3023`, `clean_canonical=1`. The guarded M0-006 CLI reported
second-run creations 0, grade conversions 0, backfilled Attempts 0, backfilled
Submissions 0 and `productionTouched=false`.

## Canonical state and regression matrix

| Case | Result |
|---|---|
| A legacy submitted, no Attempt | learner and teacher `submitted`; never `not_started`; selected result null |
| B changes requested, legacy flag cleared | learner and teacher `changes_requested` |
| C accepted result plus new in-progress Attempt | old selected result retained; workflow `in_progress`; `revision_in_progress` |
| D unknown legacy grading | no fake 1 point, 100, 60%, percentage or grade |
| E unpointed result | selected result remains null; no guessing |
| F direct project/course project/quiz | equivalent evidence produces the same semantic DTO |
| G suspended/removed learner | no current learner projection; authorized teacher history retained |
| H StudentSeat linked to Account | same persisted LearnerIdentity within a school; no cross-school merge |

## Learner identity status

The stable key is `learner_identities.id`, scoped by physical tenant and school.
M0 proves deterministic compatibility links from StudentSeat and Account. Native
CURRENT writers may still use seat-compatible ownership; M1 must make all new
CourseEnrollment, ActivityParticipation, Attempt and Result lineage reference
the stable learner key.

## IDN-003 disposition

**IDN-003 DISPOSITION:** implementation milestone moved from M0 to M1; status remains `in_progress`.  
**WHY:** its normative text requires universal runtime ownership, but ActivityRun and ActivityParticipation do not exist in M0.  
**M0 PROOF:** stable identity/link tables, same-school Seat→Account continuity, cross-school separation and canonical adapter resolution.  
**M1 REMAINING WORK:** native universal writers and foreign-key ownership for CourseEnrollment, ActivityParticipation, Attempt lineage and Result history.

## Surface consistency and browser evidence

Fresh Playwright execution passed the existing learner/teacher journey in 6.9
seconds and refreshed six artifacts under `e2e/artifacts/learning/m0-007/`:
legacy submitted learner/Gradebook, changes requested, learner/teacher selected
result and unknown grading. Learner UI contains no migration diagnostic; the
authorized teacher receives the exact compatibility explanation.

## Security

| Negative case | Result / boundary |
|---|---|
| Learner reads another learner | PASS — learner HTTP routes accept no seat/learner selector; server derives authenticated seat/account context |
| Outside teacher reads class | PASS — teacher projection returns zero rows |
| Direct UUID internal reader enumeration | PASS — `asalab_app` execution of the internal classroom/seat function is revoked and tested |
| Cross-school learner/result | PASS — physical learner-link constraints/RLS reject cross-school links; selected-result scope conflict fails closed |
| Suspended/removed learner current access | PASS — zero learner rows; authorized teacher history remains |
| Teacher diagnostic leaks to learner | PASS — learner DTO flags are allow-listed and browser assertion sees no internal wording |
| Client chooses tenant/school/learner | PASS — touched endpoints expose no such parameters; controller supplies server context |
| App role executes convergence procedures | PASS — table enumeration, mutation and owner procedure execution are denied |

## Performance

Fresh acceptance fixture: 30 learners × 100 assignments = 3,000 rows, one
application query, 89.3 ms. Query count is bounded and there is no Gradebook
cell N+1. M3 UI virtualization is not claimed.

## Feature flag and rollback

Test evidence now executes canonical → legacy → canonical using the same input.
Legacy mode issues no canonical query; restored canonical output equals the
first output and the evidence object remains unchanged. The SQL projection is
read-only, so switching readers does not mutate Attempt, Submission, Result,
Gradebook pointer, legacy work or LearnerIdentity data.

## OpenAPI

The M0-007 HTTP paths and `CanonicalLearningSurfaceState` are present in
`schemas/openapi.yaml`. `pnpm contracts:check` validates 52 paths. Historical
Learning OpenAPI debt outside M0-007 remains explicitly out of scope.

## Roadmap corrections

**ROADMAP CONFLICT:** `LRN-M2-009` previously required a minimal M3 projection while strict gating prohibited M3 before M2 acceptance.  
**OLD DEPENDENCY:** M1 accepted + M2-001..008 + minimal M3 result projection.  
**NEW DEPENDENCY:** `LRN-M2-010` accepts M2 after M2-001..008; historical `LRN-M2-009` is scheduled immediately after M3-006 and before Gradebook UI expansion.  
**WHY:** M2 can be accepted on its runtime semantics, while VS-1 is proven only when the canonical M3 result projection actually exists. The old ID is retained for traceability.

## Production status and safe release order

Production remains untouched. M0 acceptance is not deployment approval.
Because unset `LEARNING_CANONICAL_READS` enables canonical mode, deploying new
API code before 0089 without an explicit flag would call missing SQL functions.
The following order is therefore mandatory and each phase requires separate
owner authorization:

1. Before any code deployment, set `LEARNING_CANONICAL_READS=legacy` explicitly and verify the effective process environment without exposing secrets.
2. Deploy code with legacy reads still forced; verify readiness and existing learner/teacher reads.
3. Apply 0086→0089 through explicit `MIGRATION_DATABASE_URL`, exact database-name attestation and `MIGRATION_CONFIRM`; do not run backfill.
4. Verify schema/checksums/function grants and run separately authorized read-only diagnostics/canary.
5. Switch explicitly to `LEARNING_CANONICAL_READS=canonical`, restart only the authorized runtime, then verify learner and teacher canaries.
6. Roll back reads by restoring `LEARNING_CANONICAL_READS=legacy`; do not delete evidence or reverse schema during emergency rollback.

Failure to prove phase 1 before the first code deployment is a release blocker.
The isolated-only M0-006 convergence procedure is not a production backfill
path. Production identity/backfill convergence requires a separate task and
owner authorization.

## Known non-M0 gaps

- M1 universal ActivityRun, ActivityParticipation and CourseEnrollment do not exist.
- Native universal stable-key ownership (`IDN-003`) remains incomplete.
- M2 reliable quiz runtime and M3 Gradebook Matrix/Works/Review Queue/mobile modes remain future work.
- Historical Learning OpenAPI debt not touched by M0-007 remains.
- No production deployment, migration, backfill or restart has been performed.

## Gate evidence

Recorded before closure:

- fresh database 0001→0089: PASS; 88 files applied;
- migration repeat: PASS, zero pending twice;
- focused M0 unit/PG matrix: 12 files / 83 tests PASS;
- flag round trip: 7/7 service tests PASS;
- meaningful analyzer repeat: equal deterministic output, four queries;
- guarded convergence CLI: second run 0, grade conversion 0, fabricated history 0;
- browser: 1/1 PASS, six screenshots;
- performance: 3,000 rows, one query, 89.3 ms;
- remaining required repository gates and exact-SHA GitHub workflow are recorded by the closure commit.

## Next boundary

M1 is not activated. After owner acceptance of this report, a separate owner
transition may activate only the first M1 task.
