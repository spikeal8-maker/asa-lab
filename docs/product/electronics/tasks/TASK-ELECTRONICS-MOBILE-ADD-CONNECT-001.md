---
task_id: TASK-ELECTRONICS-MOBILE-ADD-CONNECT-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Mobile component placement and terminal connection

## One user result

Within existing programme #452 and Issue #280, a pupil can select components from
the phone shelf, place them on the visible field and connect their exact terminals
using native touch. Preserve the whole circuit through real Save and cookies-only
reopen. Issue #280 supplies historical placement-failure evidence; it does not prove
the cause on the current version or accept the wider programme.

The owner selected adding and connecting components before cosmetic work and
requires all implementation through subagents, controller verification and a
different independent reviewer. Product task selection and execution state live
only in canonical `docs/execution/current.yaml` on main.

## Component and minimal reading

Primary component: `electronics.ui.workbench` in
`../components/ui-assets-persistence.yaml`.

Read `../START_HERE.md`, the exact workbench entry in `../COMPONENT_MAP.yaml`,
README sections 6, 7.1 and 8, and `../AGENT_GUIDE.md` sections 2, 5 and 11-15.
Read `docs/agent/review-protocol.md` for affected-surface functional and visual
review. Source reads are limited to Stage, Sidebars, existing placement/wire
handlers, CSS and the registered simulation browser test. The hook is read-only.

## Direct owner main integration exception

The owner's later explicit instruction, "ну так слей работу в майн", supersedes
BEFORE-first sequencing and the integration-only restriction below for this
bounded mobile result. It authorizes ordinary main publication after source
checks and new independent source review, while runtime/visual/owner acceptance,
issue closure and release remain blocked pending actual evidence.

Preserve the latest accepted main simulation prefix byte-for-byte and append the
source-approved R3 665-line/26718-byte suffix unchanged. Earlier prefix/full-file
identities below are dated historical inputs, not authority to replace new main.
Apply the reviewed placement cue and 44px Cancel in Stage/CSS, and route Header
Save through existing ToolButton.touchCommand. Preserve Save class, title,
disabled state, keyboard/mouse activation and compatibility-click deduplication.
No hook/core/LED/API/persistence or workflow/guard/receipt changes are permitted.
Inherit the accepted D13 bundle ceiling (218000 bytes) unchanged; the earlier
209000-byte mobile ceiling is historical. Require a fresh actual measurement.
Full native Save/CAS/cookies-only reopen on all six journeys and new runtime and
visual review at 320/390/568 landscape/1024/1440 remain required for acceptance.

## Supporting CI image transport: narrow workflow exception

The owner explicitly instructed continued subagent work through the HTTP 429
blocker to verified mobile behaviour, preserving the separate core author. This
supporting repair belongs to the same #280/#452 result; it does not reopen #545
or create a new programme. Canonical `current.yaml` selects the phase. The earlier
wait-only action is replaced by this bounded repair and evidence sequence; the
typed acceptance blocker and all closure restrictions remain in force.

This section is the explicit exception to this card's otherwise unchanged
no-workflow rule. One infra executor may write exactly these three paths:

1. `.github/workflows/electronics-r4-m1-focused.yml`: change only the Node/Caddy
   build arguments in the existing browser and review-images jobs to the pinned
   references below, leaving their SHA-256 identities unchanged. Add **one**
   read-only identity-proof step after successful browser image build and before
   the journey. It invokes the scoped proof mode in the existing guard using
   stdlib Python and Docker inspection on the disposable GitHub runner, without
   host pnpm/dependency setup. If necessary for future transport-only verification,
   add only two positive existing PR path filters for the guard and new receipt;
   do not narrow existing events/filters or add required dispatch inputs.
2. `tools/test_ci_image_transport.py`: derive an Electronics-only effective
   receipt from the new transport receipt while requiring all original #545
   immutable identities to match. Retain the default offline semantic/security
   guard, existing General/#545 proof and strict CI Linux/amd64 opt-in. The new
   additive proof mode does not replace or relax those checks. Add meaningful
   negative challenges for wrong scope/transport/digests/config/layers/diff IDs,
   missing image provenance and wrong/missing revision labels.
3. New `docs/product/electronics/evidence/ci-image-transport-429-receipt.json`:
   record scoped Node/Caddy transport, the preserved original receipt identity,
   and verifiable manifest/config/ordered-layer/rootfs provenance. Do not rewrite
   the old #545 receipt or its historical full-file hashes.

Exact transport references:

- Node: `mirror.gcr.io/library/node@sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2`.
- Caddy: `mirror.gcr.io/library/caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83`.

The one runtime proof must inspect actual built API/test image Node rootfs
prefixes, the actual Web image Caddy rootfs prefix, and the existing mandatory
API/Web revision labels equal to the exact candidate SHA. Keep source SHA/image
tag identity, platform and every existing check fail-closed. Printing expected
receipt values without inspecting those actual images is not proof. This
post-build step is needed because review-images may be skipped after the expected
missing-cue BEFORE failure.

General workflow, PostgreSQL transport/shared overlay, Compose, Dockerfiles and
production defaults remain byte-identical. Do not alter frontend image identity,
package/lock/dependencies, authentication, security, gates or their commands,
budgets/timeouts, cleanup, ports or service origins. No retries, fallback chains,
mutable tags, registry login, host daemon or network changes. A PostgreSQL 429 or
any additional file boundary requires a precise separate proposal before edits.

Read the [compact deployment contract](../../../agent/contracts/deployment.yaml)
and [portable standard](../../../architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md),
especially immutable release identity and health versus journey evidence. This
is disposable CI image transport, with no local Docker, installation, live/owner
database, host networking, backup or deployment authority. Existing isolated CI
fixture database and real Save/CAS usage stay allowed as already contracted.

### Proven preparation and residual transport risk

The preserved #545 receipt has SHA-256
`9b3b516e257aa31d3feb4a64c9dc8bfe7c33c9ad7d1be448245d8df044f7f273`.
Controller-reviewed host probe receipt
`c1264a738e5a0ed29de2b25626ce9642f1a4d561f3f86282f4a1ca9ebdddd989`
and original raw files remain outside the repository. Source and mirror manifest
bytes/config bytes, config descriptors, ordered layer descriptors, platform and
rootfs diff IDs matched that original receipt. No image layers were downloaded
by this host probe; no token or local Docker operation was used.

HTTP 200 and those comparisons are **preparation only**. Actual GitHub pull/build
and inspected source-revision/base-image identity must pass before transport is
accepted. [Google's cache documentation](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images)
states that images can leave the cache and long-term availability is not
guaranteed. Its documented integration uses daemon mirror configuration; this
bounded direct pinned CI reference does not authorize changing the host daemon.
A cache miss or changed response fails closed and returns evidence to the
controller; it does not authorize an automatic registry fallback or hopeful rerun.

### Historical exact-source CI and continuation

The immutable [6184 review receipt](../evidence/mobile-add-connect-6184f331-review.md)
keeps its original dated pending observation. Subsequently exact source
`6184f331d0add84f5cdca32da545080cc6caad65`
[General run 39135057380](https://github.com/spikeal8-maker/asa-lab/actions/runs/39135057380)
finished **FAIL**: Data had 4329 passed/one failed, with the actual migration list
including 0215/0216 while the old expectation ended at 0214. Access's 893 focused
tests and 21 real browser cases passed; its synthetic suite had 381 passed and
26 Portal failures. These are historical category C baseline findings, not
permission to repair Course/Portal in the mobile or transport slice. The exact
Electronics Node/Caddy pre-test HTTP 429 remains category D.

One infra author implements only this budget, performs narrow checks/self-review,
emits one candidate and STOP. A NEW independent reviewer challenges the source.
The controller then canonically selects corrected BEFORE composition from latest
main, including a separate composition review of the added simulation spec and
generated hash paths. Only after those reviews may one justified Actions run
combine the real pull/build/identity proof with corrected BEFORE. The existing
workflow has no build-only mode: do not add a separate full browser run solely
for transport or weaken its gates. The infra author cannot change spec/UI before
that selection. AFTER uses identical corrected mobile test bytes and the required
full gates plus NEW runtime/visual review. Preserve the immutable
corrected mobile test content from `93c8d0308cedd74454e4553ca9ee17e75ef66575`,
reviewed UI from `6184f331...`, accepted main and all foreign test/source changes;
never copy an old whole spec/YAML tree over them. Require actual dirty-path
checks, source/composition review and complete native journeys with the existing
strict Save/CAS/cookies-only reopen/gate contracts and NEW runtime/visual review.

For the separately selected corrected BEFORE composition, the executor may write
only the existing simulation spec and its generated coverage browser-evidence
hash. Inherit the three source-approved infra blobs unchanged. Append the exact
corrected93c suffix: **631 lines / 25341 bytes**, SHA-256
`5272d3b08d52eb77b544fa121ef4c34272076d49435d570b7c5167c18997e2b4`.
Preserve the latest accepted main prefix byte-for-byte, including any accepted
#546 test repair; never import unintegrated #546 refs or replace an old whole
spec. Keep old cases/helpers/interactions, assertions and timeouts unchanged.
Six native placement/connection journeys must finish their respective strict
document and Save/CAS/cookies-reopen oracles despite expected soft cue failures;
five strict Cancel/desktop missing-cue cases retain their causal expected failures.
A NEW independent reviewer must inspect actual BEFORE raw/visual evidence before
the controller selects the exact6184 Stage/CSS-only AFTER. Complete BEFORE/AFTER
simulation test bytes must match. No mobile/source/infra repair is implied by
composition authority.

Transport proof is not mobile acceptance and does not remove the blocker.
Subsequent mobile/test/product authors must not fix old #546 specs, core, hook or
LED code. Any real source overlap requires a controller handoff. No integration,
issue closure, release claim, deployment or next product slice follows merely
from this supporting source change or an infra PASS.

## R3 exception: reload oracle only, before any AFTER selection

Actual b967 runtime review found both a harness oracle error and an unactivated
single Save tap. This narrow versioned R3 exception supersedes only the earlier
exact631-line suffix requirement for the precise new-block storage oracle and
its passive instrumentation. R2 bytes and historical receipts stay historical;
canonical active phase, revisions and observations remain in `current.yaml`.

The test-only executor may change only the registered simulation spec and the
canonical generated `browserEvidenceSha256`. Preserve its accepted **394151-byte
prefix** and every other corrected93c suffix byte. Replace the new mobile block's
invalid post-load all-storage-empty assertion with:

- Passive `addInitScript` sampling on the main app origin only, before app code:
  both local/session entries must be exactly empty. No app or storage writes.
- After load, local draft entries remain empty and session draft entries equal
  exactly one scoped pair: [`${localKey}:electronics-editor:`, `saved`]. The
  actual value must be proved by the new real CI journey, not inferred from a key.
  Compute expected localKey from the existing fixture formula using identityKind
  (account), userId and projectId; never derive it from a discovered storage key.

Retain `fresh.storageState().origins` equal to `[]`, the complete saved,
delivered/server/rendered documents, component positions, wires, one PUT and CAS
assertions. Keep all native gestures/checkpoints, helpers and timeouts unchanged.
No additional Save activation, keypress, second tap, wait, forced hit or fake
controller/API/document result. Freeze the NEW complete R3 test blob so R3 BEFORE
and AFTER use byte-identical tests. The generator may change only the registered
browser hash; any wider change requires a new proposal.

A NEW source review precedes one justified R3 BEFORE. All three original placement
cases must reach saved/reopened/complete. The three wire cases retain strict full
Save/CAS/reopen expectations: BEFORE may fail only on the observed single-Save
no-click/PUT0 product behaviour, never on a remaining harness failure. Five
Cancel/desktop cases retain the causal missing-cue failures. A NEW actual BEFORE
raw/runtime review is required before AFTER is selected. All six journeys must
fully complete AFTER; no current UI edit is selected by this oracle exception.

Only after that new R3 review and a separate controller selection may the future
UI budget include `WorkbenchHeader.tsx` alongside the reviewed Stage/CSS diff.
The bounded Save proposal would reuse the existing `ToolButton` touch command,
preserving Save class/title/disabled state and keyboard/mouse behaviour. Invoke
the command exactly once; suppress a subsequent compatibility click if it arrives,
and never synthesize a click. It must not change hook/core/state/API. This is a source
mechanism proposal, not a proven fix; actual AFTER evidence remains required.

## Supporting guard composition: version GC1

A real shared/security overlap with accepted General Node transport requires a
separate supporting composition. GC1 supersedes the earlier exact02ae three-file
infra requirement **only for the shared guard**. It does not alter the R3 oracle
contract, expand UI authority or rewrite historical receipts. Canonical active
selection and dated source results remain solely in `current.yaml`.

The executor authors only `tools/test_ci_image_transport.py`. Start from fresh
accepted main and exactly recompose the four reviewed R3 inherited source blobs:
Electronics workflow, Electronics 429 receipt, simulation spec and generated
coverage. The workflow/429 receipt must stay byte-identical to reviewed02ae; the
R3 spec/generated must stay byte-identical to the source-approved R3 candidate.
These are frozen composition inputs, not permission to edit them. Never replace
an old whole tree or blindly resolve a shared/security conflict.

Preserve accepted General `.github/workflows/spec-validation.yml`, projects
`docs/product/projects/evidence/ci-node-transport-429-receipt.json` and original
545 receipt byte-for-byte. Compose both scoped receipts/contracts by separating
conflicting transport constants and effective mappings:

| Scope/job | Node transport | Caddy transport |
| --- | --- | --- |
| General/postgres-tests | pinned mirror | preserved ECR |
| Electronics/browser + review-images | pinned mirror | pinned mirror |
| Every other job | original545 baseline | original545 baseline |

Retain every immutable identity/security check, General proof mode and stdlib,
strict CI-only Electronics actual-image mode. Preserve all 33 baseline + 12
Electronics + 27 General semantic cases and 14 Electronics runtime cases. Adapt
both cross-scope negative replacements to mutate the actual selected mapping;
a no-op replacement is not a valid negative challenge. Add receipt swaps, extra
jobs and explicit no-op mutation protection. No weakening or skipping checks.

Do not change registrations, workflows, receipts, Compose/Docker, package,
timeouts, security, defaults or registry references. No registry probe or local
Docker operation. A new boundary needs a precise controller proposal.

One author emits one self-reviewed composition candidate and STOP. A NEW
independent guard/composition reviewer must approve before one justified R3
BEFORE run. Freeze the complete reviewed R3 simulation blob for byte-identical
BEFORE/AFTER. Original3 must reach saved/reopened/complete; wire3 retain genuine
single-Save full PUT/CAS/reopen expectations and BEFORE may fail only on the
observed Save no-click/PUT0; cue5 retain causal failures. All six must complete
AFTER. A NEW actual R3 runtime/raw review and separate UI selection remain
required; no Header/UI change is selected by GC1 or by source approval.

## Initial bounded phase: native BEFORE before product changes

Add meaningful cases only to the already registered
`e2e/electronics-simulation.spec.ts`, using its existing real `seedTeacher`, login,
`createProject`, `saveDocument` and `openProject` helpers. Preserve every existing
case and helper body. Keep `e2e/electronics-interactions.spec.ts` byte-identical;
its existing upward-drag placement count 4-to-5 and native drag checks remain
required relevant regressions, not substitutes for real server Save. They do not
cover Issue #280's original tap-select then canvas-tap failure. Add a separate
native regression in the simulation spec starting with four components: tap the
card, let the shelf collapse, tap the intended canvas landing point, then require
exactly five components with exactly one new placed component. Preserve and verify
the original four. This explicit 4-to-5 tap regression is required before closing
#280; the separate two-component add/connect flow alone cannot close it.

Exercise genuine Chromium native touch on 390/320 portrait and short landscape:
open/scroll the catalogue, select a card, place exactly one component at the
chosen point, add a second component, connect exact terminals with sequential
taps and a held drag, and cancel an unfinished gesture without extra mutation.
Record actual visible field, panel bounds, screen/world coordinates, pointer
targets and placement/wire state. Preserve native pan/zoom and desktop controls.

The existing tap-select-place and upward-drag behaviours are premises to inspect,
not missing features to implement again. Test whether an active keyboard-mode
catalogue placement is visible and offers the existing cancellation action after
the shelf closes. A source hypothesis about a missing cue is not a proven defect.

Preserve the complete document, exact endpoints and connection count. Perform
real one-PUT Save/CAS revision increment, compare the full server document, then
open a context with cookies only and no local/session storage and compare the
full reopened document. Store primary failure/raw/PNG before risky supplemental
awaits; evidence capture must not hide the original failure.

Use the existing registered isolated CI browser workflow and its disposable
fixture database for these real API/Save/CAS/reopen operations. This permission
does not authorize local Docker or local/live/owner database, networking, backup
or deployment operations. Workflow/database configuration stays unchanged except
for the explicit supporting CI transport budget above.

An executor emits one test-only candidate with meaningful narrow checks and
self-review, then STOP. The controller verifies its source and a different
reviewer challenges it before one justified built-editor BEFORE. Only actual
evidence of the selected UI defect permits the bounded product phase; no hopeful
unchanged rerun or manufactured success.

## Conditional product budget

Only `apps/web/src/electronics/WorkbenchStage.tsx` and
`apps/web/src/electronics/workbench.css`, and only if the actual BEFORE proves the
missing active-placement cue. Reuse existing `c.catalogPlacement` in keyboard
mode and `c.cancelFamilyPlacement`; do not add a second placement state or wire
state machine. Keep the visual/cancel action reachable without covering intended
landing points or terminals, including short landscape.

Do not edit Sidebars without returning a separately proved necessary boundary to
the controller. If wire gestures or placement require changes in the active
Arduino-owned hook, preserve the exact failure and request a precise handoff;
do not modify that hook concurrently.

No new spec, package/workflow registration, dependency, routing-map or generic
cleanup edits are needed for the product phase: the existing simulation spec is
already registered and mapped. Only the supporting CI transport section above
permits its declared workflow/guard/receipt changes. All prior simulation cases,
field/wire candidates, accepted persistence and core results remain preserved.

## Coordination and explicit owner exception

The owner's instruction, "делай так чтобы вы не мешали друг другу и не портили
результат", authorizes this narrow isolated mobile slice despite the recorded
unrelated dirty Classroom workflow shared-path `WAITING_HANDOFF`. Work only in a
clean separate mobile checkout, retain the actual guard output and report the
exception; never claim `SAFE_TO_START`, remove shared paths or disable a guard.
This exception covers no actual overlapping source edit. Check all actual dirty
paths before each write; overlapping unfinished target work still means STOP.

The Classroom root checkout and its unfinished changes remain untouched. Active
#546 exclusively retains its hook/LED/core work. Existing preserved candidates
#525/#538/#544/#547/#548/#549 and all foreign canonical state remain unchanged.

## Acceptance, gates and independent review

- Actual built native BEFORE identifies the failed stage and causal UI boundary;
  the identical AFTER preserves all prior assertions, waits and real gestures.
- Phone placement is visible, deliberate, cancellable and produces exactly one
  component. Both terminal-connection gestures preserve exact endpoints and one
  connection mutation; pan, scroll and cancellation do not place extra objects.
- Issue #280 closure separately requires the original tap-select then canvas-tap
  4-to-5 regression; an upward drag or two-component journey is insufficient.
- Complete Save/CAS and cookies-only reopen pass with unchanged full documents.
  Check desktop regression and relevant original native placement/drag cases.
- Final exact SHA runs `pnpm gate:electronics-m1`,
  `pnpm gate:electronics-m1:browser` and `pnpm gate:repository`, with frozen
  dependencies and literal `NX_SKIP_NX_CACHE=true`; report fresh Nx counts and
  actual SHA/run/job/artifact identities. Narrow discovery is not browser PASS.
- Classify unrelated CI failures before action; no repair of foreign modules or
  weaker assertions/timeouts to obtain green. Retain required gate failures.
- Controller verifies actual diff and evidence; a NEW independent reviewer
  checks the final exact SHA, raw/PNG, whole-document persistence and actual CI.
  Review findings require a separate bounded repair cycle.

Chromium touch emulation is browser evidence, not evidence from a physical phone
or school installation. Owner/device acceptance remains pending separately.

## Forbidden and STOP

Read-only: `use-electronics-workbench.ts`, LED presentation, ready-cadence tests,
Arduino, solver/Worker/clock/physics; existing interactions and simulation helpers.
No owner artwork, persistence/schema/API/auth, package/lock/workflow, deployment,
local Docker, local/live/owner network/database/backup operations, or neighbouring
repairs, except the exact three-path supporting CI transport exception above.
Existing isolated CI fixture-database operations and real Save/CAS/reopen through
the registered workflow are permitted as described above.
No generated artwork, fake document/controller actions, forced-hit success,
changed physical precision or expanded timeouts.

Each executor reports one candidate and STOP; each independent reviewer returns
one verdict and STOP. Only the controller selects subsequent bounded work under
the owner's programme. NEXT_ALLOWED_TASK: STOP.
