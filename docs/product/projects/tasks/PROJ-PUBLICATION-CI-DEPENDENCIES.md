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

### Retired verification package

PR619 was closed without merge as SUPERSEDED at unchanged head
`efbaeada18819fff9f76a08a4acc74bfa468d397`. Independent comparison against main
`d4dd2115c34415bd8ad0ef4968f02ffaffd62578` found seven of its fourteen blobs
already byte-identical and seven superseded by newer accepted content. No
missing ready source remained. Its branch, two source-only commits and earlier
reviews remain provenance; this is not a claim that every commit was merged.
See PR619 comment `6255104981`. Historical transport evidence below remains
valid. GC1's scanner/duplicate finding, release620 and Public Projects combined
acceptance remain open under their existing ownership.

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

## Separate C — preserve independent decoding of small print QR rasters

TASK-PROJ-PUBLICATION-QR-PRINT-RASTER-001.
Author branch: `codex/projects-qr-print-raster`.

Classroom run `39154885479`, job `117755945105`, on publication source
`662c8af4fbffead0f71b2fb95a4e9768d0c4b9fb` fails the owner mixed-card print
scenario in `e2e/student-access-cards.spec.ts`. Independent read-only diagnosis
verified artifact `12146839286`, SHA256
`205457c8e4e5ccd34fe462818d1998716fee906c19e93ab47ecaab1e60bd5991`, and replayed
the actual trace DOM, all fourteen loaded stylesheets and original SVG using
the same Playwright 1.55.1 / Chromium 140.0.7339.186 as CI, with zero network
requests and no ASA application, database or installation.

The long-site fixture changes a printed label and CSS class, not the QR URL.
Existing print CSS reduces the QR from 20mm to 16mm. At DPR1 its fractional
position yields a 62x61 screenshot. Independent jsQR 1.4.0 returns null, although
the original white quiet zone and opaque black/white pixels remain intact.
Nearest-neighbor 2x replication of that exact PNG, the unchanged DOM at DPR2/3,
and the unchanged two-page A4 PDF rasterized at 300dpi each decode the exact
expected URL, including a separate monochrome check. Blank and removed-finder
controls remain undecodable after replication. Physical paper/camera testing
was not performed; these results establish the screenshot/decoder boundary,
not a defect in the product encoder or print CSS.

### Bounded author scope

- `e2e/student-access-cards.spec.ts`.
- `e2e/fixtures/qr-print-raster.ts`.
- `tests/portal/qr-print-raster.spec.ts`.

Keep one real Locator screenshot and inspect its original quiet zone. First
decode the original pixels, preserving every raw success. Only a null raw print
decode may select one fixed nearest-neighbor2x fallback from that same PNG;
screen decoding never takes the fallback. Decode monochrome on the same selected
raster with no further fallback. Preserve every original pixel and channel;
do not smooth, crop, regenerate modules or read
the expected URL from DOM/React/encoder state. Retain raw screen decoding,
independent jsQR, monochrome decoding, full expected URL comparison, privacy,
layout, roster, credential and no-mutation assertions. Preserve original PNG
failure evidence. No retry, timeout, rate-limit, viewport/DPR, product CSS/SVG,
API, database, dependency or workflow change is selected.

Acceptance requires a focused regression using the reproduced failing raster,
blank/corrupt-finder negative controls and input immutability; a new independent
review of the final SHA; and actual changed-source Classroom/Access browser CI.
Synthetic replay and source approval alone do not establish the full classroom
journey. This repair is independent of analytics PR628, the final publication
shell source7db13b9 and the single-owner GC1 shared-guard work.

### Actual b138 runtime finding and bounded correction

PR629 source `b1387d32db98e70d635b9843016fee2f81b83cf7` passed focused/source
checks but actual Classroom `39163873957` found a new category A regression.
The attached original 20mm print PNG is 76x77 and decodes the exact URL raw;
forced nearest-neighbor2x produces 152x154 and jsQR null. Three/fourfold inputs
also decode, but selecting an arbitrary new mandatory scale does not preserve
the previous raw-success contract. The serial mixed16mm journey was skipped.

Review5564865973 therefore rejects acceptance of b138. Correct the pipeline as
specified above: raw first, at most one print-only pixel fallback from the same
original PNG, no recapture/delay/rerun and no expected-URL-dependent selection.
Wrong decoded URLs and monochrome failures must still fail. Add the new actual
raw-success PNG beside the existing raw-failing62x61 fixture, testing the shared
decode-selection implementation itself. Preserve all negative controls and
original evidence. A different independent reviewer and new changed-SHA real
Classroom/Access CI are required; existing unrelated failures remain open.

## Separate C — preserve the accepted AI header in publication verification

TASK-PROJ-PUBLICATION-SHELL-AI-COMPATIBILITY-001.
Author branch: `codex/projects-shell-ai-compatibility`.
Only authored path: `e2e/access-account-ui.spec.ts`.

Main accepted PR616 at `6abacef6eb6a083a72392e4786fb3f5a1e6a9738`, adding the
third global AI destination and scoped responsive styling. Independent read-only
audit against `d4dd2115c34415bd8ad0ef4968f02ffaffd62578` found no new text conflict
with publication662 and frozen shell `7db13b9ecce77139866708353e4f418f37141e3c`.
However, both the current main Access test and that shell companion still demand
exactly two top links and no AI. They also require an eight-pixel right inset at
every mobile width and a visible Create label for every width above560. Those
oracles contradict the accepted AI stylesheet: four-pixel inset below360 and
compact Create between601 and760. This is a separate inherited compatibility
finding, not permission to revert the accepted AI feature.

One author starts from current accepted main, adopts the exact completed Access
source from7db13b9, and changes only the demonstrated obsolete expectations and
their boundary coverage. Preserve its canonical Explore/native-link and actual
legacy Gallery redirect assertions. Keep the strict56px header and every44px
target, no overflow/overlap, all normal and stress-text checks, role, focus/Escape,
dirty-navigation, profile and no-mutation guards. Cover359/360,600/601,760/761 and
1023/1024 as well as1440/1024/390/320. Do not change timeouts/retries, fixture
authority, runtime, CSS, MyProjectsPage or any other author's files.

The final composition must retain the new AI navigation, stylesheet and tests
from616 together with publication routing. Existing AI entry/exit must preserve
the personal sidebar preference, close the mobile drawer, and show a locked Seat
view without granting AI API access. Those already authored responsive and
capability tests remain mandatory; this single-file companion does not replace
them. The final shell footer remains `Приватный`, with protected Learning work
and feedback semantics intact.

Acceptance requires a new independent exact-source review against both frozen7db
and accepted616, then real changed combined Access and Portal Header Responsive
CI on desktop/mobile. A companion branch without publication runtime cannot
establish the combined journey. The controller retains the single final
convergence requirement and the exclusive GC1 author.

## Separate evidence — identify the remaining Learning mutation traffic

TASK-PROJ-PUBLICATION-LEARNING-MUTATION-EVIDENCE-001.
Author branch: `codex/projects-learning-mutation-evidence`.

Analytics source `4343b88b788f02a279fd18df3789582994cb6b9e` passed General
`39160885774`, including the real delivery PG regression (14/14), and Classroom
`39160885775`. Learning `39160885790` completed with 18 browser passes and five
fresh login HTTP429 failures. The second browser command after `&&` did not run.
The five failing traces have no session cookies and a shared Retry-After reset;
a preceding diagnostics429 contains `too_many_requests`. Exact source identifies
the common MutationAbuseProtection before AuthController. Its address budget is
also consumed by authenticated requests, but the earlier passing request stream
and API stdout were not saved. The traffic that exhausted the window remains
unknown. This selection gathers evidence; it does not alter or accept a repair.

### Four new paths only

- `.github/workflows/learning-mutation-budget-diagnostic.yml`.
- `tools/learning-mutation-diagnostic/runner.mjs`.
- `tools/learning-mutation-diagnostic/reporter.mjs`.
- `tools/learning-mutation-diagnostic/harness.spec.mjs`.

Use two independent exact checkouts: `source/` contains tested product SHA
`4343b88b788f02a279fd18df3789582994cb6b9e`; `diagnostic/` contains the reviewed
diagnostic head. Verify both actual revisions and record `testedProductSha` and
`diagnosticSha` separately. Reuse original Learning Node22, pnpm9.15.9, frozen
lockfile, build, PostgreSQL16, restricted application role, migrations, focused
Learning tests and Scratch host preparation on the disposable GitHub runner.
The new workflow may start from its own candidate PR only after independent
source review; it uses a separate concurrency group. A manual trigger may also
be provided. Existing workflows and their results remain unchanged.

Run the complete first batch in its original order: `learning-author-preview`,
`learning-course-01`, `courses-sharing` (23 cases), using the existing source
Playwright config, one worker, zero retries and every existing assertion. The
second batch is explicitly NOT_RUN in this diagnostic. Do not use `--debug` or
`PWDEBUG`. Set `ASA_HTTP_LOG=1` and `DEBUG=pw:webserver`; ensure VITEST is absent
from the browser child. The verified Playwright1.55.1 WebServer plugin forwards
API stdout to the custom reporter. Runner pipes capture both stdout/stderr;
neither a normal list reporter nor raw debug output may bypass sanitization.

Persist HTTP JSONL with exactly `method`, `routecategory`, `status`, `timestamp`
and `requestId`. Route categories are fixed, never raw paths/query or dynamic
identifiers. Persist only separately allowlisted revision, stage and test-matrix
metadata; do not store request bodies, headers, cookies/tokens, raw process
output, trace ZIPs or raw test errors. `--trace=off` changes only this diagnostic
capture mode. Handle ANSI, split chunks and incomplete/malformed streams with
bounded buffers and explicit capture failure. Preserve observed test counts,
actual child exit status and failed CI conclusion; upload sanitized artifacts
with `if: always()` and no failure-to-success conversion.

Acceptance requires meaningful privacy/chunking/matrix/capture-failure/exit-code
tests, a new independent review of the frozen source before its real diagnostic
workflow starts, and actual isolated CI with both exact identities. HTTP counts
are observed traffic, not reads of the internal byAddress counter. If429 does
not recur, report NOT_REPRODUCED and keep the cause unresolved. Existing Learning
PR622 files, runtime/config/server, analytics11, QR629 and GC1 are outside scope.
