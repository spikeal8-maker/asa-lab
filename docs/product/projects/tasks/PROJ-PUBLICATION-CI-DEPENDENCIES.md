# Public Projects: verification baseline dependencies

Parent programme: TASK-PROJ-R7-VISIBLE-PUBLICATION-001, Issue #211.
The controller selects the separate bounded C repairs and D dependencies below
under AGENTS.md sections 2.1 and 7. These support the first visible publication
increment. Each selection authorizes only its stated paths and behavior; no
deployment, working database action or weakening of a gate is authorized.

## Scratch type checking

TASK-PROJ-PUBLICATION-TYPECHECK-BASELINE-001.
Author branch: `codex/projects-typecheck-baseline`.

Actual failure: Scratch Focused run39144252514/job117724748652 on
`a1283b27ecad266053d403a25a041c21172546a8`.
Only two ESLint configurations differ from its main baseline; the failing
TypeScript roots and gate are unchanged. The manual NodeNext command includes
browser diagnostics and React tests without their browser module resolution,
existing build declaration or JSX setting.

Owned paths: `tools/blocks/gate.mjs` and
`tests/blocks/save-diagnostics.spec.ts`.
Keep all 37 original root inputs and strict options. Check API roots under
NodeNext and browser roots under the actual web settings with the existing
build-metadata declaration. Restore the optional test-only act flag faithfully.
Do not change application runtime, Scratch autosave, dependency versions,
compiler strictness, Vitest/ESLint coverage or Docker.

Acceptance: complete uncached `pnpm gate:blocks`, exact root/option comparison,
independent final-source review, and actual Node 22 Scratch CI.

## Exact upgrade catalogue

TASK-PROJ-PUBLICATION-MIGRATION-BASELINE-001.
Author branch: `codex/projects-migration-baseline`.

Actual failure: general run39144252513/job117725991526 on the same baseline:
4364 tests passed, one failed because the explicit catalogue stops at0214 while
main includes0215,0216,0217. The public-projects diff is absent from that run.

Owned path: `tests/migration/course-structure-forward-upgrade.pg.spec.ts`.
Reuse the completed test blob from PR607
(`af4d897685238eecb395970cdf2702f21969c654`), also present unchanged in PR609.
That exact prepared source passed the real PostgreSQL data job
run39134848479/job117698625866, including the Course forward-upgrade test and RLS.
The aggregate workflow failed elsewhere; do not misreport it as overall PASS.
Existing branches remain intact.

Explicitly extend the prepared exact catalogue through the already published0217.
Retain the two exact ordered lists, historical Course draft/version/run snapshots,
pre153 preservation, idempotency, roles and RLS checks. Do not replace equality
with a subset or derive the expected list from the implementation under test.
No schema, migration script or Learning runtime modification is selected.
Publication migration0218 requires its own synchronous test-list extension in
the publication candidate; a test-only baseline through0217 cannot certify0218.

Acceptance: formatter/diff checks, exact catalogue audit, independent final-source
review and real PostgreSQL forward-upgrade plus general data gate.

## Existing compact header verification

TASK-PROJ-PUBLICATION-HEADER-BASELINE-001.
Prepared source: PR603, `9e12e981e4b7ece388cc226bf8cd878908a5aed3`.

Actual failure: general run39144252513/job117725991617 on the same baseline:
the Access Account UI step passed381 scenarios and failed26, principally obsolete
100px/two-row geometry and a button locator for the native Create summary.
The independently prepared PR603 retains the accepted single-row56px header,
44px controls and current two public sections; it also constrains wide-text
intrinsic sizing. Its completed source is compatible with the publication
candidate's passing Portal Header Responsive run39145854981.

Adopt only its exact two authored blobs:
`apps/web/src/creator-portal/portal-header-adaptive.css` and
`e2e/access-account-ui.spec.ts`. Preserve the existing branch and do not adopt
unrelated PR609/package changes. Retain strict normal/wide-text geometry,
responsive boundaries, visible content, popup, Escape and focus checks.
The removed synthetic third public link was outside the current two-section
contract; any future third section requires its own layout acceptance.

This baseline does not fix the publication guest-header overlap or the observed
owner-card overflow at360px. Those remain separately diagnosed product findings;
do not hide them with global overflow clipping or weakened assertions.
Acceptance: new independent review of the exact combined source, actual Access
Account UI and Portal Header Responsive CI, plus the complete general gate.

## Integration

### Isolated data-job Node transport

TASK-PROJ-PUBLICATION-DATA-TRANSPORT-001 is a separate bounded D dependency.
Exact combined candidate `4db817619772480f7a126ab8b761052e19c19b9e` passed source
review, the code gate, Scratch contracts/types and Header Responsive. Its general
run39147961045/job117736631518 failed at Build migration and test images before
PostgreSQL startup: the pinned Node manifest on public.ecr.aws returned HTTP429
Data limit exceeded at2026-10-18T17:10:30Z. No data tests ran.

Selected author branch: `codex/projects-data-transport`. Owned paths are only
`.github/workflows/spec-validation.yml`, `tools/test_ci_image_transport.py` and
`docs/product/projects/evidence/ci-node-transport-429-receipt.json`.
Change only the General disposable data job's Node registry reference to the
same immutable manifest on mirror.gcr.io. The prepared, completed Electronics
transport source `02ae08a82eb8ad65eda52a47c2100ef7830e45d5` provides identity
evidence for that same Node image, not authority to import its workflow or alter
its active mobile task. No active unfinished writer was found on these paths.

Keep Node manifest43aeff40, configc72861c6, every ordered layer/rootfs identity,
the original545 receipt, Dockerfile/Compose/production defaults, Caddy/PostgreSQL
and BuildKit references, workflow security/triggers/gates and existing runtime
image proof unchanged. The semantic guard may represent only this explicitly
selected General/Node reference substitution and must still reject all other
unapproved drift. Add focused positive/negative proof for its exact scope.
Do not import the separate Electronics workflow, retry a red run unchanged,
substitute an image version or turn off a required check.

Acceptance requires independent exact-source review and one justified new
combined CI run with actual image pull/build, existing rootfs/revision proof,
real PostgreSQL migration/data/RLS checks and the full required general gate.
Registry metadata alone is preparation, not this evidence.

The existing independently reviewed ESLint prerequisite remains separately
selected in `PROJ-PUBLICATION-BUILD-BASELINE.md`. The controller may assemble
these finished bounded sources into a new verification integration candidate,
preserving their commits and authored bytes. C defects are not repaired inside
the Public Projects feature slice or concealed by changing its gate.
The final combined SHA requires independent review and the relevant actual CI.
An old cancelled run or a passing isolated check is not combined acceptance.

The first publication candidate remains unaccepted until its lock-order,
Learning compatibility, PostgreSQL and built-browser checks pass. Independent
review of `7745b5f4bc9d52d759562f4ce092ca94c7381ee7` found an introduced HIGH
generic-checkpoint/legacy-submission lock cycle. Its actual profile passed127
code/PostgreSQL and48 portal checks, but browser passed6 of8 and Learning had
three failures. These partial results are not acceptance.

The selected product repair confines the added early Project lock to resources
without immutable Learning origin, including a fresh post-lock classification
and savepoint rollback on concurrent origin attachment. Existing Learning
business writers are not rewritten. The potential older canonical submission
SHARE/Draft inversion is a separate, unconfirmed baseline finding; neither this
repair nor these verification prerequisites claim general School concurrency
acceptance.


## Successor D — adopt the published General PostgreSQL transport

The Node transport repair reached real image builds. On exact candidate
`efbaeada18819fff9f76a08a4acc74bfa468d397`, General run `39150123385`,
job `117743433533`, **Build migration and test images** succeeded; the next
**Start isolated PostgreSQL** failed with ECR `toomanyrequests: Data limit exceeded`.
Migrations and the Data gate did not run. This is a separate infrastructure
dependency, not a product or PostgreSQL assertion failure.

Before a new Projects transport author started, fresh Git inspection found the
release620 controller's completed source
`28d1af61107fdee1f4f1a4884a04658bbb16902e`, included in
`75cbad5bb49fcc06b97d2a489f1e0f0c53dcc8ef`. It supplies a generated General-only
runner overlay and exact model/pulled-image proof. The controller selects
independent review of this actual source; no duplicate transport implementation
or replacement of its receipt is authorized by this selection.

The required General PostgreSQL 17.7-bookworm identity remains:

- manifest `sha256:e9243ab06e47223dedeb3c129fa9ece8d37f506bdc6ee943afb9335f98bb4854`;
- config `sha256:52d5e34fcf5c882a859c1269963b35bdc7dcc2814ef0a0de6b8b408b2eb09db1`;
- all 14 layers and rootfs entries in their recorded order.

Access PostgreSQL 16 is a different image and cannot substitute for it. Preserve
the shared registry overlay, original 545 receipt, all other job mappings,
Dockerfiles, Compose defaults, revision checks, security and mandatory gates.
The extended external receipt and its dated host probe are reviewed as recorded
evidence; they do not replace actual Actions layer pull, startup and full Data.

### Coordination with the active GC1 guard author

Electronics GC1 owns the active shared-guard composition. The Projects controller
supplied eight independently reproduced duplicate/build-continuation probes in
issue 280 comment 6253626829. A Projects author does not write competing changes
to the guard, workflow or receipts. A remaining finding must be composed by the
agreed single author from the completed current source, preserving both
General/Electronics contracts and release620's PostgreSQL checks.

Require a frozen handoff, a fresh overlap check, NEW independent final-source
review and exact-SHA image/model/config/rootfs/revision proof plus full
Data/required CI before integration. One controlled repeat convergence is justified
by this real shared infrastructure change; unrelated documentation movement does
not invalidate focused publication evidence. Canonical selection/status remain in
`current.yaml`. This scope authorizes no local Docker, working database,
production cleanup or deployment.

## Separate C — acknowledge the actual persisted visit receipt

TASK-PROJ-PUBLICATION-ANALYTICS-RECEIPT-001.
Author branch: `codex/projects-analytics-receipt`.
Selection baseline: `e2677c3735b8a14b99691c59a38b050f685f10b3`.

Learning run `39154885422`, job `117755945106`, on publication candidate
`662c8af4fbffead0f71b2fb95a4e9768d0c4b9fb` reproduces the same seven failure
causes as the earlier non-publication baseline `4db817619`. Independent read-only
triage found a specific existing client/server contract defect:

- Migration0098 defines `product_analytics_events.id` as `bigserial`.
- Migration0207 emits `recordId` through `jsonb_build_object` from `v_id bigint`.
- The actual successful HTTP200 wire response contains a JSON number.
- `confirmedAnalytics` instead requires a UUID for this visit receipt.
- In one mixed-course trace, four unique visits cause69 sends. One persisted
  event with `recordId:43` is replayed seven times; after a later context switch
  it correctly receives `409 context_mismatch`. A separate actual200 probe with
  `recordId:51` is rejected by the current frontend despite its valid envelope.

Evidence artifact `12146793263` has verified SHA256
`fd5a2cd5ce1f941952152636e52eed794fb79c1269810610d09848b982442376`.
The seven trace files were downloaded once and inspected read-only. This
establishes unnecessary replay; it does not prove every later login failure will
disappear after the receipt repair.

### One bounded author scope

1. `apps/web/src/telemetry-contract.ts`
2. `apps/web/src/telemetry-contract.spec.ts`
3. `apps/web/src/analytics-delivery.spec.ts`
4. `apps/web/src/analytics-runtime.spec.ts`
5. `apps/web/src/analytics-auth-recovery.spec.ts`
6. `apps/web/src/blocks/testing/editor-runtime-session.spec.ts`
7. `tests/portal/analytics-delivery.pg.spec.ts`
8. `e2e/fixtures/telemetry-receipts.ts`
9. `tests/portal/ui-telemetry-receipts.spec.ts`
10. `tools/blocks/browser/telemetry-fixture.mjs`
11. `e2e/classroom-scratch-time.spec.ts`

For a visit only, recognize a numeric `recordId` satisfying
`Number.isSafeInteger(value) && value > 0`. Reject UUIDs, numeric strings, zero,
negative, fractional, unsafe and absent values. Do not coerce values or redesign
bigint serialization. Keep every existing accepted/state/schema/event/receipt/
operation/timestamp check, session interval and actor/context binding, and all
terminal HTTP-error handling.

The additional fixture changes correct only visit `recordId` to the wire type.
They retain event/receipt UUID equality, quality receipts, Project/session IDs,
routes, timers, activity intervals and autosave. Consumers of shared fixtures do
not require changes. The uppercase-UUID API compatibility test remains intact;
frontend exact equality is tested with a normal lowercase browser envelope or
the canonical replay payload, not by weakening equality.

The independent triage and controller searched current source and active PR
scopes. No unfinished author overlap was found on these11 paths; PR622's Learning
journey files and the active GC1 guard composition remain outside this repair.
The controller authors only governance and mechanically integrates completed
source. A separate author implements; a different reviewer checks frozen bytes.

### Acceptance and unresolved failures

Require meaningful focused numeric-validation and queue tests, including removal
of the acknowledged visit from memory/storage and no replay on workspace change.
The PostgreSQL regression must pass a real API200 body through the shipping
frontend validator and `AnalyticsDelivery`, prove a single durable domain effect,
an empty queue and no replay. Then require independent exact-source review and
actual changed-source General/Learning CI. Local smoke or skipped PG is not PG
acceptance.

Six fresh unauthenticated Learning logins receive429 with a common reset window
and `Retry-After`; the common mutation hook sets that header while the controller's
per-identity login limiter does not. Repeated analytics spends this shared budget.
First fix the proved receipt defect. Any residual429 requires separate diagnosis;
do not change auth limits, add retry/sleep or ignore browser errors here.

General Access A job `117757301887` separately times out at5011ms in the existing
ratings journey, while the exact same test passes in Data job `117757301925` at
1135ms. It does not invoke the publication repository lock wrapper, but the cause
of the timing difference remains unproved. Keep it unresolved; no timeout or
parallelism increase is selected. A further failure on the changed candidate
requires phase/SQL/blocker evidence before a separate repair decision.
