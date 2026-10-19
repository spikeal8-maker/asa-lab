---
task_id: TASK-ELECTRONICS-CLASSROOM-D13-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Explicit owner 2026-10-19 instruction to deliver and integrate visible classroom slices with measured common slowdown allowed
  - Preserved Issue546 R26 and R27 source and independent review history
  - Canonical main selection and fresh source overlap and control-plane checks
acceptance_boundary: slice
review: independent
---

# Classroom D13: visible programme-controlled blinking

## Product decision and boundary, revision 1

The owner explicitly requests a first independently useful D13 result, integration
in main after real browser evidence, independent review and required CI, followed
by D2-D4, D0-D13, all ordinary LED colours, RGB, seven-segment GPIO and bitwise
programmes. This bounded task accepts only D13; it does not complete Issue546.

The owner permits a measured common slowdown relative to physical Arduino.
Correct pins, ordered electrical states and visibly proportional delay remain
mandatory. Absolute real-time throughput and school capacity remain open under
TASK-ELECTRONICS-SOLVER-PREPARATION-001 and ELECTRONICS-546-R9-ACCEPTANCE.
The new classroom acceptance does not reinterpret historical FAIL as PASS.

This is an explicit versioned intermediate acceptance of the same programme,
not a new implementation of the kernel. The retained full-realtime blocker
continues to block its original task's integration/closure/release claims.
The new ELECTRONICS-CLASSROOM-D13-ACCEPTANCE independently blocks integration
and acceptance of this slice until every requirement below is evidenced.
Neither task selection nor changing a blocker text is product acceptance.

The classroom programme is tracked in Issue638 as a child of Issue546; the
separate number satisfies the canonical unique-issue invariant and does not
reset or replace the existing work.

## Existing code and coherent scope

Preserve R26 cdad26c361cb4cf8ed2d095fae3c087b5d2abb2d and R27 base
1669d7b2f1f630b3c4da045147500a343e139ca9. Bring only their necessary coherent
Electronics product/test dependencies onto current main. Retain all unrelated
main changes, dependency/security fixes and all original source/evidence refs.

The saved package contains 22 production Electronics paths, not 22 newly
selected independent repairs. The controller permits this bounded dependency
composition above the usual five-file budget because the existing runtime,
solver, Worker and optical presentation must agree. Record the exact imported
path list and source blobs. Do not copy all diagnostic branch files or replace
main package.json/lockfile with an old version. Keep rejected R20/R24 quality
experiments out and preserve current independent physical quality checks.

New R27 implementation is limited to ordinaryOwnedContinuation in
contexts/electronics/domain/arduino-circuit-scheduler.ts and meaningful existing
contexts/electronics/testing/engine-timed-api.spec.ts regressions. Retain passive
already-executed history, schema/counter/sequence/time/kind/finite validation,
loaded-source and producer-origin proof, eligible AST/component boundaries and
sticky generic fallback. Do not erase or replay history. Prove owned execution
on genuine subsequent requests that execute instructions; sleeping windows may
legitimately construct no runtime. Include 256 events and corrupted states.

Only a demonstrated remaining D13 display defect may add a bounded amendment in
the existing optical presentation, workbench or component renderer and mapped
tests. State the cause before the edit. Never animate from sketch text or an
independent timer, fabricate current, skip physical work or change numerical
tolerances, instruction time, event budgets or circuit diagnostics.

Test author owns only e2e/electronics-classroom-timing.spec.ts until separately
coordinated additive package/workflow registration. Preserve all existing tests.
One author per path; final source author does not independently review itself.

## Acceptance fixed before measurement

Use one real UNO-D13-resistor-ordinary-LED-GND project in the built editor.
All phase decisions must come from completed quality-checked electrical history.
The displayed external LED and built-in L must share the same model time.

1. Change the programme through the real code editor: symmetric delay100, then
   delay200, then delay300, and a preselected additional delay150. Record the
   actually loaded source, not only the text or saved document.
2. Record at least eight full visible cycles per symmetric programme after
   startup, with the complete startup prefix retained separately. Require first
   visible activity within 5 s and collect each scenario within a predeclared
   45 s observation budget. These finite usability limits do not require 1x
   real-time execution. For median
   periods require T100 < T150 < T200 < T300, T200/T100 in [1.6,2.4],
   T300/T100 in [2.4,3.6], and T150/T100 in [1.2,1.8].
3. Model periods must follow the instruction-us-v1 programme (approximately
   200/300/400/600 ms including existing instruction costs). Record model time,
   completed-result receipt time and painted browser time separately.
4. HIGH100/LOW300 must preserve both ordered phases, with median dark/light
   duration ratio in [2.4,3.6]. One common measured slowdown is allowed; do not
   choose a separate artificial speed for each programme.
5. The correct electrical branch lights, a broken circuit and reverse polarity
   do not falsely light. Keep finite values, KCL, current and failure rules.
6. Verify visible compilation error, correction to a valid new programme and
   the actual loaded source. Retained last-good source must not be presented as
   successful compilation of the invalid edit. Do not change fallback policy
   without an evidenced need.
7. Real Stop/Reset/Start must retain responsive controls, rerun setup and exclude
   stale-generation events. Save and cookies-only reopen must retain the full
   circuit, wires, properties and code and repeat the visible scenario.
8. Capture a predeclared 60 s sustained run. Observe at most one outstanding
   real Worker advance request. Match complete ordered electrical and painted
   transition prefixes from startup: after startup at most two completed
   electrical transitions may remain unpainted. Do not invent private counters
   or substitute wall/model lag for this transition backlog. Stop must visibly
   finish within 1 s. Report measured wall/model slowdown separately; genuine
   common slowdown is permitted, loss of substantial phases is not.

Save complete ordered traces plus a short native browser visual demonstration.
Observe actual loaded artwork, visibility/occlusion and painted states; GPIO logs
or one screenshot alone do not pass. Compare the same scenario/observer before
and after and identify the actual source/build SHA for each. A before failure
is evidence, not a silently passing expected outcome for the repaired source.

## Gates and independent acceptance

First use short source checks. Fresh local/CI evidence uses literal
NX_SKIP_NX_CACHE=true. Required final commands remain:

- pnpm gate:electronics-m1
- pnpm benchmark:electronics:ci
- pnpm gate:electronics-m1:browser
- pnpm gate:repository

The classroom journey must be registered in the canonical browser command.
Keep prior real-time assertions executable and their real conclusions visible.
If a prior real-time-only requirement is separated from this classroom gate,
make the exact command/contract amendment explicit, independently reviewed and
versioned; do not hide failure with skip, catch, timeout inflation or green labels.
Any failing mandatory non-realtime regression blocks this slice. Classify
independent baseline failures under AGENTS.md; repair them only in a separately
selected bounded task if necessary for integration.

A new independent reviewer examines the exact final source, dependency
composition, tests and original browser evidence. Historical source approvals,
unit parity and an optimisation benchmark cannot replace this acceptance.
Only then may the controller record this accepted slice and integrate it through
the repository's permitted normal Git route, without force or protection bypass.

## Continuation and deployment

After accepted D13 integration, the controller restores current Git/CI state and
selects the next visible D2-D4 slice, then the remaining owner programme in order.
Author/reviewer STOP ends their bounded task, not the controller's programme.
Keep full Issue546 and unsupported Arduino capabilities explicitly open.

GitHub main and a running installation are separate facts. This task grants no
school, live database, Docker, network, origin/port, backup or protected-data
operation and no second permanent test stack. Heavy built browser/Docker/data
evidence runs in isolated GitHub Actions. Prepare a concrete exact-SHA update of
the known installation only after code acceptance; deployment requires its
separate authorization under AGENTS.md section 4.
