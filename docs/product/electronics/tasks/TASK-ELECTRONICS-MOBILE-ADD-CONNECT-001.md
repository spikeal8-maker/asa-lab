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
or deployment operations. Do not change the workflow or database configuration.

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
cleanup edits are needed: the existing simulation spec is already registered and
mapped. All prior simulation cases, field/wire candidates, accepted persistence
and core results remain preserved.

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
repairs. Existing isolated CI fixture-database operations and real Save/CAS/reopen
through the unchanged registered workflow are permitted as described above.
No generated artwork, fake document/controller actions, forced-hit success,
changed physical precision or expanded timeouts.

Each executor reports one candidate and STOP; each independent reviewer returns
one verdict and STOP. Only the controller selects subsequent bounded work under
the owner's programme. NEXT_ALLOWED_TASK: STOP.
