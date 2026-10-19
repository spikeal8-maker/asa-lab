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

## Separate evidence — locate the two remaining Scratch save failures

TASK-PROJ-PUBLICATION-SCRATCH-SAVE-EVIDENCE-001.
Author branch: `codex/projects-scratch-save-evidence`.
Prepared base: exact analytics `4343b88b788f02a279fd18df3789582994cb6b9e`.
Only two authored paths: `e2e/blocks-product-integration.spec.ts` and
`e2e/blocks-recovery.spec.ts`.

Actual Scratch run `39160885787`, job `117773758655`, completed55 browser passes
and two failures. Artifact `12149940575`, SHA256
`d5ae4753962d6d9a0e5f3189b849e3a980ec5dff4977cd51bc3f50dd0fd448c8`, confirms
the exact host/source identity. The two test files and host editor/storage/recovery
are unchanged from the parent, but the analytics fixture is in the changed source;
that alone does not establish category C or exclude an introduced interaction.

The default-cached Pop/Abby case expects revision24 and observes23. Existing JSON
records a checkpoint, editor readiness, one project change and a fired60000ms
timer, but zero asset requests, draft requests and revision commits. The timer
observer accepts any55-65s timer without callback identity, so it does not prove
ProjectSaver began. The clean-Pop sibling saves five protected assets and one
draft and reopens the exact media. The failure is before the first durable-save
HTTP request; an asset/SQL rejection has not been established.

The failed-autosave case reaches the error UI and then exceeds150s. Completed
repair `cc18c540d8a2e717e1961a956c7d6db689b15cd7` is already in4343 and must
remain. Existing artifacts do not distinguish response headers, the unbounded
`response.finished()` await, post-failure IndexedDB read, or fixture teardown.
The finally-block inline attachment is absent from this list-only runner's
uploaded files. Neither recovery loss nor accepted retention is demonstrated.

Select passive, bounded stage evidence in the two tests, saved as real JSON files
under the existing uploaded `reports/blocks` tree before blocking awaits and
during failure/teardown. Distinguish observed timer/callback and exposed upstream
serialization/save-adapter boundaries without invoking or replacing a save.
Record non-observed stages explicitly; do not infer execution from an unrelated
timer. Record response headers/completion, recovery-read entry/exit and teardown
entry/exit separately. New metadata must exclude tokens, cookies, request bodies
and raw errors and must remain bounded. Preserve every existing user action,
clock advance, timeout/retry, exact revision/media/auth/origin/recovery assertion.
Observers must retain callback this/arguments/return/throw and execution order;
no forced save, extra click, reschedule, assertion catch or false success.

Fresh canonical and open-PR inspection found no current unfinished author on
these two E2E files. Issue601/599 completed owners retain their existing unit-test
and runtime boundaries; coordination was posted in Issue601 comment6254919404.
No host/bridge/storage, shared fixture, workflow, Analytics11 or GC1 file is
authored. Start from exact4343 to keep the actual numeric-receipt fixture under
test without composing unrelated main changes. A diagnostic PR may target that
frozen analytics source branch for a precise two-file review; it is not selected
for merging into that author's branch or for publication acceptance.

Require independent final-source review, then one justified changed-source
Scratch CI with exact build identity and uploaded JSON. A/B/C/D remain unresolved
until causal evidence is read. Preserve failure exit status; an unreproduced
failure is NOT_REPRODUCED, not proof of a repair. No product modification or
second unchanged CI attempt is selected by this evidence task.

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

## Learning capture result and bounded batch-isolation experiment

TASK-PROJ-PUBLICATION-LEARNING-BATCH-ISOLATION-001.
Author branch: `codex/projects-learning-batch-isolation`.
Only authored path: `.github/workflows/learning-e1-focused.yml`.

The first authorized diagnostic completed on exact diagnostic
`fb7a7b215096afd989a8b42635a14ffdd592259c` and independently pinned product
`4343b88b788f02a279fd18df3789582994cb6b9e`: run39168489103, attempt1,
job117796390954. Independent actual capture QA passed. The browser retained
18 PASS / 5 login429 FAIL across all23 cases, with no skipped/interrupted cases
or capture faults; the second batch was NOT_RUN and repair NOT_EVALUATED.

The artifact contains only the allowed metadata and7055 unique five-field HTTP
observations. Of these6097 were GET and958 were mutations. Before the first429,
953 non-runtime mutations were observed, including934 successful2xx responses
within256.006 seconds. Those successful requests passed the common guard; the
remaining19 failures/disconnects cannot automatically be counted in its internal
address counter. All293 analytics requests returned200, all164 diagnostics202,
and no analytics409 occurred. Receipt bodies/event IDs were deliberately omitted,
so HTTP200 alone cannot rule out every invalid-receipt retry.

The actual Playwright execution order differs from the argument order shown in
the original command above: courses-sharing (2 cases,222 mutations), then
learning-author-preview (7 cases,109), then learning-course-01 (14 cases,627).
The first two files accumulated331 mutations before the course suite. By the
end of ordinal18,953 mutations had been observed; ordinals19-23 each stopped at
their first login429. The course total627 includes five early failures and is
not an upper bound for its complete14-case successful run.

Exact source gives the address budget900/5min, session600/5min and shared-address
ceiling9000/5min. Verified requests also consume the ordinary address budget;
they may continue through aggregate allowance after it is exceeded, while a
fresh login without cookies cannot. This supports cumulative fixture interaction
through one API process. It does not establish whether the product policy should
change. The observed five-minute interval is anchored to the first API timestamp;
internal limiter counters and resetAt were NOT_OBSERVED.

Artifact12151514511 is195071 bytes, SHA256
`e56fccf3bfdfa02d25dfda2dcf2dd1c4c7a29a3fbf1ec98e497fa08014182f6c`.
Real Node22.23.3, pnpm9.15.9, PostgreSQL16.15, both exact checkouts and all setup,
build, migrations, restricted-role, focused Learning and Scratch stages passed.
Individual PG counts were not saved by this diagnostic whitelist. Its nonzero
browser exit remained the nonzero workflow result.

### Selected experiment and unchanged acceptance boundary

One CI author may now isolate the three original first-batch files with fresh
ordinary Playwright-managed API processes, using only the existing Learning
workflow. Start from the exact4343 analytics product to preserve causal comparison.
Main later accepted that analytics source through685762419; this diagnostic fork
does not compose the publication or replace the newer auth/AI changes in main.
Fresh main185f43e scope inspection found no unfinished author on the Learning
workflow. PR622 has since merged with frozen source3f37a8c, including newer
Learning journeys. Preserve these accepted tests and all main auth/AI changes in
final composition; this causal first23-case experiment cannot establish their
acceptance. Keep all other owners and require the current main journey matrix in
combined Learning CI.

Preserve the effective courses-sharing, author-preview, course-01 order, all23
cases and every assertion. Keep the original config, one worker, zero retries
and all timeouts. All three files must execute even when an earlier file fails;
aggregate their failure into a nonzero result. The original complete second
batch runs only if the first batch succeeds. Keep every second-batch selector,
assertion and existing setup/PG/unit/upgrade/build/Scratch gate. Reject changes
to the original package script/spec matrix rather than silently dropping future
cases. Preserve each invocation's artifacts under already-uploaded directories.

No package.json, test, config/server, runtime, auth policy, limit, fixture or
diagnostic630 edit is selected. No external-server reuse, artificial delay,
limiter reset endpoint, proxy-identity substitution or session privilege change.
The existing server lifecycle must remain responsible for setup and teardown.
Per-file isolation changes all API memory lifetime between files, including
caches and queues; it is a CI experiment, not a claim that only one counter resets.

Require a separate independent source review and meaningful shell control-flow
challenges for first/middle/last failure, complete first-batch execution, second-
batch gating, matrix drift and preserved artifact paths before opening the PR.
Then run actual changed-source Learning CI with all23 original cases, the full14
course cases and the complete original second batch. Full success may support
accepting this bounded CI repair; any remaining failure requires its actual
cause. Do not repeat an unchanged failed run or claim a product-policy repair.
GC1 and the single final PR613 convergence remain separate required dependencies.

## Auth audit action compatibility for Coverage

TASK-PROJ-PUBLICATION-AUTH-AUDIT-COVERAGE-001.
Author branch: `codex/projects-auth-audit-coverage`.
Prepared base: `33a2790cc8a95181f6fcff613e3a6ec6eaca78fe`.
Only authored path: `apps/api/src/database-diagnostic-contract.json`.

Independent read-only triage of actual Coverage run39174033312 on f562bee found
the same failure in Windows job117812883707/step5 and Linux117812883939/step8:
the existing dynamic migration regression at tools/test_coverage_diagnostics.py:136
expects the action-only projection for administration.verification_policy.update
but gets an empty object. Downstream PostgreSQL integration was NOT_RUN.

Accepted Auth migration0219, introduced by d6972337018ff6836aebc2773605c0e31db9d14e,
emits this audit action. It is missing from the existing closed diagnostic enum.
A pure exact-source scan finds12 distinct real migration actions and exactly one
missing value. Current33a2790 retains contract037200e44399b77df439dcf72ad2f4c7094182b7
and regression testff28c77830ed56797e79af45b6a02040bb110285 unchanged.
Relative to Public Projects this is a separate C baseline dependency.

Coverage Issue610 owner handed off point8 source90e09831 and STOP in6251702346.
Fresh Auth AUTH-C5-READINESS selection and published branch4614349 do not select
or modify this JSON path. Issue135 comment6264235551 coordinates one separate
author for this narrow compatibility repair and preserves all current Auth
provider/backend/UI/installation ownership. Do not assign a duplicate writer.

Add only the existing literal administration.verification_policy.update to
sources.administrative_audit_events.fields.action.values. Keep every other value
and closed projection unchanged. Existing tests must prove the original failure,
all real audit actions, unknown-action rejection and omission of private reason
and payload data. The dynamic regression already covers the omission; changing
its source or weakening its assertions is outside scope.

Require an independent review of the frozen one-file source before its PR starts
the unchanged full Coverage Diagnostics workflow. Both platform collectors and
the downstream actual PostgreSQL integration must pass on that exact source.
A local environment-only resource/host collection failure is not evidence of a
product regression and cannot replace the actual Windows/Linux CI result.

No migration, audit writer, collector algorithm, Auth policy, rate-limit,
timeout/retry, workflow, Learning, Scratch or GC1 modification is selected.
No deployment or working database action. This repair does not close the separate
Scratch, Learning or GC1 acceptance gates or select final PR613 convergence.

## Learning: bounded declaration isolation after the first experiment

TASK-PROJ-PUBLICATION-LEARNING-DECLARATION-ISOLATION-001 starts from frozen
7f4d87d3c5a361b25db2bc4f05b62501db856d52 and changes only
`.github/workflows/learning-e1-focused.yml`.

Actual Learning39234380988/job117999794208 executed all original first23 cases:
courses2/2 and preview7/7 passed; course12/14 passed and two fresh logins returned
429. The complete second group correctly did not run. Per-invocation exit receipts
are0/0,0/0,1/0; artifact12178582125 is66162305 bytes with SHA256
2c3a093ae0db2ed6b28c76ef713b0ee62fab7d74dfd73f13c240e79b77d2bc33.
Preserved evidence and correct failure propagation do not establish a repair.

Both failed POST /api/auth/login requests have no Cookie or Authorization.
Retry-After116/114 and the exact guard source support a remaining common mutation
budget within the separate course invocation. This is an inference from captured
headers and source; response bodies, internal counters and process PID were not
observed. No authentication policy change is selected.

Keep full courses-sharing and learning-author-preview calls. Partition only the
full14-case course spec by its12 actual declaration locations, in declaration
order. The two loops each contain two cases and stay together, retaining their
three-d then electronics, and electronics then three-d orders. This does not claim
one process per individual test. Each group gets the same ordinary Playwright
server lifecycle. Normal fresh invocations repeat beforeAll/afterAll, teacher/pool
creation and module teacher/sequence/keys state. Fixtures, seeds and specs remain
unchanged; independent review must check that a group needs no previous invocation's
state. Extra startup/setup/cleanup must fit the unchanged30-minute job timeout.
Exceeding it is incomplete verification, not permission to increase the limit or
claim that remaining cases ran.

Exact candidate CLI discovery must match the approved ordered case-identity
manifest, not only a count, and derive current locations. Pre-discover every
location selector: each result must equal its expected group, and the ordered
union must equal all14 original course cases without omissions or duplicates.
Accepted main PR622 moved declaration lines, so old hardcoded line numbers are
not a valid final-main selector. Unchanged fullyParallel:false does not shard one
file into individual cases; do not add fullyParallel or text-grep guesses.

Preserve all first23 cases and original full15-case second group. Execute every
selected first-group invocation even after failure, aggregate the first nonzero
exit, and keep every invocation's structured actual execution IDs/statuses and
evidence. Missing/duplicate/extra/skipped/interrupted/hook-unexecuted/ambiguous
cases cannot count as PASS. Missing or invalid execution reports fail coverage,
without replacing an earlier nonzero exit. Run the second group only after all23
actually pass. Keep the entire original test matrix, assertions/actions, workers1/retries0,
test and job timeouts, package-script drift rejection, config/server/fixtures,
Node22/pnpm9.15.9/frozen install, uncached build, PG16 restricted role, populated
upgrade, pinned Scratch preparation and cleanup. No sleep, limiter reset, proxy
identity, new privilege or application-policy change.

Require independent final-source review and actual discovery/coverage/order/error
challenges, followed by full changed-source Learning and required General CI.
No local application/server, PostgreSQL, Docker or browser journeys. Local source,
CLI discovery and bounded synthetic checks are allowed without starting ASA;
the actual runtime runs only in the selected GitHub CI.
Preserve PR634 and its failed experiment as history; no unchanged rerun.

### Current-main navigation remains an external dependency

Main e503d00fc3b045a65df0793e6a17b0d163833577 selected
AI-BASELINE-LEARNING-006 with the existing author branch
`assistant/ai-learning-compatibility-20261019`. That author exclusively changes
the three current-main learner-submit, surface-convergence and teacher-activity
specs for explicit native Assignments/Courses navigation. Projects' earlier
unpublished competing doc selection was rejected by independent review and
withdrawn before any author or source change. Ownership is acknowledged in
Issue373 comment6264966785. Require its completed frozen handoff, independent
combined review and actual newer23+15 matrix; do not create a second writer.

## Scratch: bounded timing at the unresolved recovery boundary

TASK-PROJ-PUBLICATION-SCRATCH-RECOVERY-TIMING-001 starts from frozen
8f2cc69835cb7cf135d2390319651c315c496e54. One separate author may edit only
`e2e/blocks-recovery.spec.ts`, specifically the failed-autosave case and required
local declarations/imports.

Actual Scratch39232051458/job117992095550 has56 PASS/1 FAIL among57 cumulative
cases, retries0. Only failed server autosave retains recovery times out at150000ms.
General39232051363 and standard fresh ZIP passed. The build is exact8f2 and pinned
Scratch82c5fea6d3e60c781f25c09b375045f9b46a43f7, version15.1.1. Both Abby/Pop cases
completed all original assertions and teardown, revision24, five assets, one draft
and one commit: their result is NOT_REPRODUCED, not proof of an underlying repair.

Recovery JSON has16 events: checkpoint73 observed, HTTP503 with
recoveryReadyAtResponse=true, response-completion-enter, finally-enter, then
legacy-attachment-enter. The marker precedes argument preparation and the actual
attachment call. Neither normal response.finished return, retention assertions nor
teardown entry was observed. The ZIP contains no trace/HAR/API-call trace and the
JSON has no timestamps. The error snapshot shows Project could not save, but
does not measure HTTP completion. Neither a sole response wait nor a sole
attachment hang is proven.

Add bounded monotonic Node times and fixed-enum stages for the exact draft's
requestfinished/requestfailed events, response.finished call/return/settlement/
rejection, and existing attachment preparation/call/settlement/rejection. Preserve
the response method's one invocation and original error propagation. Preserve
attachment rejection handling exactly, including its existing catch, every
assertion and original await order. Distinguish the returned Promise from its
settlement; do not introduce additional Promise reactions into product paths.

Keep safe durable JSON before waits, numeric/event limits and I/O-failure
counters. New evidence excludes raw URLs, bodies, cookies, tokens and raw errors.
Observe existing events without consuming response bodies, triggering save,
adding retries/timeouts or rescheduling. Keep150000ms and all existing recovery,
revision, media, authorization, origin and no-mutation assertions. Preserve all
other Scratch cases, protocol fixtures, product/runtime and workflow.

Require independent exact-source privacy and callback/error/persistence challenges,
then the complete changed-source Scratch CI with exact build identity. The next
capture targets when HTTP completed, how the existing completion wait ended and
whether attachment preparation/call settled. Missing callback/return/settlement
evidence leaves that boundary UNKNOWN or NOT_OBSERVED. Loss or write failures make
capture incomplete; they never justify inferring a successful boundary. No local
application/server, PostgreSQL, Docker or browser journeys. Local source/discovery
and bounded synthetic checks may not start ASA; actual runtime runs only in CI.
A timeout remains FAIL;
NOT_REPRODUCED never establishes a runtime repair. GC1 remains exclusively owned
by its external author; final PR613 convergence and stages3–7 remain pending.

## Recovery: terminal synchronization for the intentional 503 case

TASK-PROJ-PUBLICATION-SCRATCH-RECOVERY-TERMINAL-001 is a separate C test/dependency
repair. It starts from frozen published 8136084149cc0831e7aa8d6edcfaa1abc15af895,
whose full tree equals the completed local f7fec499 lint correction. The sole
write path is `e2e/blocks-recovery.spec.ts`: completion synchronization in the
failed-autosave case and its necessary local declarations/imports. Preserve
the prior timing and lint sources, PR632/PR640 and their actual failure evidence.

### Evidence and selected boundary

Actual old 7855 schema 2 observes the same draft Request failing at 59286 ms,
after `response.finished()` returned its Promise at 59281 ms. Its original
await continues through rejection only at 150040 ms; final recovery assertions
were not reached. Capture counters are zero. Artifact 12185785480 and independent
actual review 5571616550 preserve this failure, not a successful recovery test.

Independent source investigation of pinned Playwright 1.55.1 explains the wait:
client `Response.finished()` awaits `_finishedPromise`; `_onRequestFinished()`
resolves it, but `_onRequestFailed()` records timing/failure and emits the
terminal event without completing that client Promise. Chromium's server-side
response timing completion is not the client requestFinished event. The wait
was already present before timing instrumentation, so this is a separate
inherited test/dependency boundary, not one of its five lint defects.

The cause of the underlying Chromium loadingFailed remains UNKNOWN: no trace,
HAR, raw failure text or close/crash reason was captured. Do not claim CORS,
ERR_ABORTED, product abort or socket failure. The fixture intentionally sends
HTTP 503 and ends before any revision mutation. Neither fixture/product repair
nor a Playwright version change is supported or selected.

### Fixed repair contract

Observe public requestfinished/requestfailed before the triggering edit/request.
Select the existing draft response and associate its Request with the terminal
event by strict object identity, including terminal events delivered before
response selection. A foreign request, headers alone or ambiguous association
must not release the successful path. Preserve distinct FINISHED and FAILED
outcomes. Page close/crash, timeout and arbitrary promise rejection are failures,
not substitutes for an observed terminal Request.

Both genuine terminal outcomes may continue this intentional negative-503 case
only into every original assertion. Keep the status 503 and recovery-ready-before-
response checks; the single draft write; authorization, cookie, capability,
origin and content-type checks; baseRevision 23 and payload Steps 73; unchanged
server revision 23; and the real IndexedDB reread of exactly one recovery record
with Steps 73. The fixture is a protocol HTTP fixture, not a real API/PG transaction;
the acceptance record must preserve that distinction.

Retain all 118 existing assertion ASTs and original actions, test timeout
150000 ms, response timeout 90000 ms, one worker and zero retries. Preserve the
accepted lint correction, original attachment rejection suppression and
fixture.close error/cleanup semantics. Remove newly introduced listeners on
every exit. Registration and early failures must not create an unhandled
deferred rejection or replace an original setup/assertion error.

Keep bounded safe durable diagnostics and fail-open I/O behavior. Any new
terminal-wait markers must describe that actual operation. Do not label a
missing or omitted Response.finished call as successful; absent observations
remain NOT_OBSERVED. No raw URLs, credentials, payloads or error text. Do not use
private Playwright fields, catch(ignore), timeout-as-success, extra save,
retries, sleeps, clock changes, fixture changes or weaker assertions.

### Review and actual acceptance

Require independent exact-source review with meaningful early/late terminal,
foreign identity, ambiguous selection, FINISHED/FAILED, page close/crash,
setup/await/attachment failure, listener cleanup and diagnostic-fault challenges.
The exact Scratch ESLint command must pass with its rules active. Local source,
CLI discovery and bounded synthetic checks may not start ASA or a browser.

Then run full changed-source Scratch, including all original 57 cases and the
fresh ZIP gate, and required General CI on the exact source. The formerly
unreached recovery/security assertions and cleanup must actually execute.
Source PASS does not predict actual PASS. Any remaining Abby/Pop failure remains
a separate finding; this author does not edit that case or its runtime.

No unchanged rerun or cancellation of the existing 813 CI is selected. No local
ASA/server/browser/PostgreSQL/Docker, deployment or working database action.
The controller continues the authorized programme after this bounded author and
independent reviewer stop; final PR613 composition and stages 3-7 remain pending.

## Abby: link the observed callback to the original save path

TASK-PROJ-PUBLICATION-SCRATCH-ABBY-CALLBACK-EVIDENCE-001 selects passive evidence
only. A separate author starts from exact published
8136084149cc0831e7aa8d6edcfaa1abc15af895 or its tree-identical frozen local
f7fec499. The only write path is `e2e/blocks-product-integration.spec.ts`, within
the two existing Abby cases and their local observer. The recovery-terminal
author owns `e2e/blocks-recovery.spec.ts`; these scopes do not overlap.

### Established evidence and unresolved cause

The independent investigation used the preserved exact 7855 host artifact and
the source map of its actual pinned Scratch 82c5fea6 / 15.1.1 build. Native Pop
reached revision 24 with five asset writes, one draft and one commit. Clean Pop
remained revision 23 without asset-store or save-project entry, despite observed
timer entry/return and the original clean-load assertion passing. Neither capture
links that raw timer callback to the registered ProjectSaver. The original
START_AUTO_UPDATING dispatch/state transition and ProjectSaver serialization
remain unobserved. Receipt SHA256 is
`8d918e6f30074393fe10c797bec2646693b4fe190b5229840ea60d9bb7a27e30`.

Pinned source establishes that the bound tryToAutoSave reference is supplied
to onSetProjectSaver and scheduled by ProjectSaver. Its guard can return without
dispatch, and the callback does not return the save Promise. Therefore a callback
return proves neither save start nor async completion. The observed recovery
asset capture follows a different serialization call. Do not relabel it as the
ProjectSaver serialization that precedes dirty asset handling.

The two actual variants do not isolate the clean bit: the clean fixture also
adds an async load wrapper and their valid timer intervals were 63000 and 58000
ms. The existing helper observes a 55-65 second timer and advances 66000 ms.
No fixture, runtime, clock, retry, media or cache repair is justified or selected.

### Bounded observation contract

Use the existing test interception of mountEditor. Its standalone factory gets
the original EditorState with public store, and root.render receives the original
onSetProjectSaver and onVmInit callbacks. These are available embedding APIs;
they are not already implemented observers. Add no product debug surface.

Keep the raw function registered through onSetProjectSaver unchanged. Associate
it with the scheduled raw timer callback by strict reference identity. Record
replacement, unmount and unavailable/ambiguous association honestly. At linked
callback boundaries observe bounded Boolean/closed-enum Redux state and the
original START_AUTO_UPDATING dispatch/state transition. Never invoke dispatch or
save for observation, and never call a Redux snapshot the React instance props.

Through the original onVmInit path, observe original vm.toJSON entry, synchronous
return or throw using bounded VM identity and call ordinal. Do not invoke extra
serialization or retain its result. A recovery or unclassified invocation is not
ProjectSaver serialization without an observed causal link. Existing storage
boundaries remain distinct; no extra Promise reactions are needed or selected.

Preserve descriptors and forwarding: original this, arguments, call count,
immediate return and Promise identity, exact thrown values, callback registration
and teardown behavior. Observation setup and reporting failures must remain
fail-open without skipping or repeating an original operation. Metadata is
closed and bounded with no project payload, URL, credential or raw error text.
Unavailable observations remain UNKNOWN/NOT_OBSERVED; capture loss is INCOMPLETE.

Preserve all original assertions by AST, all case identities and actions, clock,
timeouts, zero retries, the clean load wrapper and cache/media behavior. No extra
await, product then/catch/finally reaction, timer, reschedule, save trigger,
serialization or fixture action may be introduced to help the case pass.

### Independent review and one changed-source gate

Require independent passivity, raw identity, replacement/unmount, descriptor,
return/error, cleanup, causality-label and writer-fault challenges. Run the exact
Scratch ESLint command with its rules enabled. Local verification is source,
discovery and bounded synthetic work only; no local app/server/browser/PG/Docker.

After both authors freeze and separate independent reviews pass, the controller
may mechanically compose their nonoverlapping files into a new child of 813.
First preserve the terminal 813 host artifact; do not update or cancel its run.
Review the exact composed source, then require full changed-source Scratch with
all original 57 cases and fresh ZIP, plus required General. Both Abby variants
must produce safe durable evidence. Any failure remains FAIL; nonreproduction
is NOT_REPRODUCED and does not prove an underlying runtime repair. This evidence
task does not complete stage 2 or start the final PR613 composition.
