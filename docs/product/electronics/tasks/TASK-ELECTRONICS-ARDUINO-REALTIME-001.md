---
task_id: TASK-ELECTRONICS-ARDUINO-REALTIME-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Direct owner request for real Arduino timing, loops, button interaction and Serial Monitor
acceptance_boundary: slice
review: independent
---

# Arduino real-time programme

Task, issue, status and checkpoint are canonical only in `docs/execution/current.yaml`.

## Selected first slice: test-only baseline

One new author reuses existing Arduino/domain/Worker/browser suites and the existing Electronics gates. Add only missing regression coverage, not a duplicated large matrix. Supported `if`, `if/else`, `for`, `while` and `loop` must exercise external LED output and timestamped button `digitalRead`, with `delay`/`millis` at 30 ms, 1 s and 20 s. Serial evidence covers domain TX/RX plus actual monitor display and native input delivery. No claim of complete Arduino/C++ support follows from this finite matrix.

Keep model time and real time distinct. Deterministic assertions require exact integer-microsecond event times and existing instruction-cost semantics, preserved state and bounded/yielding loop behavior. Native evidence records wall/model clocks, committed output transitions, requested/actual delay, jitter, backlog, compute/transport/idle time and UI responsiveness. Use existing timing tolerances; freeze any newly required explicit tolerances before execution, never widen after failure. A 30 ms delay and a 20 s delay must be evaluated proportionally without presenting slowed simulation as realtime. Timestamped button changes must affect loop execution and external LED states; monitor input/output must be observed end to end rather than inferred from source.

Select the minimal trusted native journeys that cover these paths, with genuine UI input, existing exact document/Save/CAS/reopen protections where applicable, and durable raw evidence before assertions. Do not replace real actions with private dispatch, forced hits, repeated inputs or timeout increases. Model-clock PASS does not establish wall-clock PASS. Missing native evidence is NOT_RUN. An honest baseline timing FAIL is useful evidence, not permission to weaken it.

Only test files and their strictly necessary generated test-evidence metadata may change. Author identifies exact existing test paths from targeted context before edits, performs focused checks/self-review, freezes unpublished SHA/report and stops. New independent source review is mandatory. If deterministic units are intentionally red, retain a private candidate and evidence; never publish red units to main. After review, the controller may publish a test candidate branch and run one existing CI workflow. No product pace change, clock implementation, hook/core optimization, Serial repair or label change belongs to this first slice.

## Subsequent bounded selections

A cause-based model/wall-clock implementation requires a new canonical selection and new author/reviewer. Serial Monitor implementation changes require a demonstrated regression; existing TX/RX implementation alone proves neither defect nor user-visible success. Remove LIMITED only for individually proven fully supported capabilities; keep it for partial support. Do not add explanatory product copy against the owner's request.

Current temporal-history pace 0.125 and lookahead 6250 microseconds are source observations, not the selected fix. Other profiles and clock routes must be audited rather than globally overwritten. Existing safe instruction clock integer-microsecond semantics remain invariant. Prior native sample model1007.088 ms/wall9548.5 ms with compute3139.9/RTT6182.7/idle3379.8 ms is historical diagnostic evidence, not proof of a single cause or 1x readiness: `Temp/asa-a37-range/blockly1-analysis.json`, SHA256 `3be9a15fbc01e74302ebe72ff7cb1d516117ed67428c4b17acfcc87c618415a0`.

Preserve old Issue546 owner STOP, original R27 entry1669d7b2, all old task/revision/gate/blocker/suspended history. This is a NEW owner programme, not automatic R27 resume. The other Arduino controller reports no active timing/core/hook/LED writer and paused observation. #679 Stage budget repair stays separate; #525 is paused without losing work. Owner KEEP dependency for #544/#547/#548 remains unchanged.

No local browser, Docker, heavy build, DB, install, deployment or protected assets. No foreign Classroom/Learning/workflows/guard/transport changes. Actual dirty overlap stops writes; the known workflow exception is disjoint only. Source publication is not deployment, owner acceptance, issue closure or release.

## Selected product slice: proportional LED temporal clock

The completed b6 native acquisition proves a slowed product clock: model2669.457ms over wall21852.2ms, with1127 complete ready results and no yielded results. Electrical transitions retain30.002ms and1000.002ms while visible transitions take297.6ms and8173.6ms. This selects one bounded repair, superseding the first slice test-only restriction only for the paths below. The baseline test candidate and raw report remain preserved; no acceptance is implied by cancellation.

Scope: `apps/web/src/electronics/led-temporal-presentation.ts`, `apps/web/src/electronics/use-electronics-workbench.ts` only where a common monotonic wall anchor is required, and focused specs `led-temporal-presentation.spec.ts`, `use-electronics-workbench-clock.spec.ts`, `live-simulation-worker-controller.spec.ts` under the electronics testing directory. Existing pace declarations and whole-file source pins in `e2e/electronics-ready-cadence.spec.ts` and `tests/electronics/classroom-qualification.spec.ts` may be updated to the new actual1x contract, preserving all native bounds, assertions, acquisition durations and timeout limits. Remove deliberate slow clock and lost prepare-to-ACK elapsed time. Investigate bounded25–50ms complete horizon windows and measure actual engine compute headroom before claiming realtime. Presentation remains limited to committed complete history; never publish yielded/incomplete results or fabricate electrical fronts.

Preserve physical instruction costs, integer microseconds, deterministic electrical state, native image/RAF barriers, independent outputs, input causality, Reset/Stop and all capacitor/heat/damage/Arduino state. No physics/timeout/tolerance weakening, workflow/dependency changes, other modules or deployment. Existing native timing assertions remain unchanged. Button hit-precondition and Serial end-to-end proof remain pending separate work; this slice does not establish their repair.

One new author freezes code and focused evidence; a new independent reviewer checks the exact SHA and actual headroom. Then one justified exact-head native AFTER uses the existing workflow. Source review and unit success do not establish realtime or full programme acceptance.

## Selected test completion repair after actual realtime result

Exact9c native evidence reached all30ms/1s/20s electrical and visible phases, with model21862.6ms/wall21868.9ms. This is actual useful realtime evidence, not full acceptance: Node validation gap40861ms preceded page.evaluate timeout; button hit-precondition returned undefined before nativepress. Cold firstHIGH receipt-to-paint96.8ms remains unresolved.

Freeze product9c. One bounded author may change only `e2e/electronics-interactions.spec.ts` and narrowly necessary existing regression coverage in `tests/electronics/classroom-qualification.spec.ts`: profile and remove demonstrated saved-journal validation overhead while preserving every predicate, every record, durable ACK-before-assertions and primary failure. No timeout/tolerance increase or sampling away records. Diagnose button coordinates/viewport/topmost element using source and actual saved evidence; only a proven intended-fixture/real-UI-fit precondition correction is permitted, never forced hit/private dispatch. If evidence is insufficient, retain focused geometry evidence to resolve the cause rather than invent a product defect.

New independent exact-SHA review must compare old/new validation outcomes on saved raw plus negative mutations, check full intended document/CAS/native actions and runtime byteidentity. Then one justified existing exact-head AFTER;no unchanged rerun. Product/clock/physics/Serial/workflows/dependencies remain outside this slice.

## Selected separate neutral bundle repair

Source9c realtime and native completion a3d5 are independently approved;actual combined browser verification remains pending. General9c measures218111 bytes against unchanged218000. Select one separate behavior-neutral author slice in `apps/web/src/electronics/led-temporal-presentation.ts`: shorten only internal TS-private member identifiers preserved by the bundler. No algorithm/public API/state values change;no budget increase, dependencies, workflow or other module changes. New independent reviewer checks semantic identifier-only equivalence, focused regression and exact build budget;then one combined AFTER with the already approved native completion. This selection does not accept the release or erase outstanding cold-paint/button/Serial/Stop evidence.

## Selected cold readiness publication repair

Exacted delay journey COMPLETE/PASS, button andSerial native actions work but50ms publication fails. Exact trace proves i070 GET only9.887ms, request begins39.3–60.5ms afterREADY; native load+110.4ms, HIGHwitness+179.3ms. Do not blame server or pretend one cause is fully established. Source proves readiness callback only records leases, so a ready mounted vector waits for anotherRAF beforepublish.

Select one bounded product author repair in `apps/web/src/electronics/use-electronics-workbench.ts`, targeted `use-electronics-workbench-clock.spec.ts` and `led-temporal-presentation.spec.ts`: cancellation-safe microtask publication triggered by actual native readiness through the SAME exact-pending/generation/native-lease/layoutACK/distinct-RAF guards. No synchronous flush from render/layout callbacks, no private input dispatch, incomplete result, unready image, stale token promotion, skipped rollback or multiple distinct vectors in oneRAF. Preserve physical wall clock and all canonical state. No mass preload of all brightness variants, owner artwork changes or generated runtime artwork. This repairs only avoidable postload waiting;cold50ms acceptance still requires actual evidence.

For bundle invariance only, further internal TS-private member identifier shortening in presenter is allowed with independent AST-equivalence;ceiling unchanged. Add narrowly necessary actual readiness/lease/publication timing evidence to the existing native682journal if source/trace cannot observe it, without changing any predicates, native actions, tolerances, budgets or timeout. New exact independent source review and targeted cancellation/queued-readiness tests precede one justified AFTER. All previous accepted partial results remain preserved;Reset/Stop buttoncase and cold50ms remain pending.

## Selected interactive redundant-solve repair

Actualf90 delay journey COMPLETE/PASS but button/Serial route advances only800ms over3380.7ms. Targeted exact saved-fixture production replay identifies3619 solveRc calls (~824ms) versus474 Arduino runtime calls (~30ms);momentary-button keeps legacy electrothermal-v1 with1ms physics. Do not flip an event whitelist or change this physical profile to hide costs.

Select one bounded author optimization in `contexts/electronics/domain/arduino-circuit-scheduler.ts` and targeted existing scheduler/timed-engine tests. For the proven Arduino/resistor/redLED/momentarybutton topology only, avoid an additional zero-duration observation solve when every board is sleeping, no input/board/sensor/tone/event is due, and the identical physical step already produced a complete quality-passing electrical result. Retain1ms physical steps, integer instruction/event times, profile identity and all canonical Arduino/heat/damage/capacitor/netlist state. Due input, wakeup, output changes, faults and unsupported topology must preserve eager semantics. Broader optimization needs a new selection.

Author must prove identical complete ready results/canonical state/events at every saved horizon with the same button press/release/Serial inputs and compare compute/call counts. Add negative wake/input/Reset/fault coverage;no timeout/accuracy/physics/native-render tolerance change. If byte-equivalence or eligibility cannot be proved, STOP without claiming repair. New independent exact-SHA review before actual browserAFTER. Cold-image50ms and GeneralAccount blockers remain open;partial publication question awaits owner.

## Selected native pointer-release receipt repair

Exact7a interactive model1101.9ms/wall1119.1ms and54 qualifying publication records have zero50mswitness failures. Actual native down/up and LEDHIGH/LOW andSerial65 are present, but the observer did not retain up rawtarget/pointerId, so the trustedpointerup assertion stopped Reset/Stop. Trace/source support possible stage capture retargeting, not proof of the missing raw target. Do not fabricate a button-target release or declare an unrecorded event trusted.

One test-only author may change `e2e/electronics-interactions.spec.ts` and narrowly necessary existing journal regression coverage. Preserve original raw target and genuine pointerId/isTrusted/buttons, retain relevant stage-captured up/cancel events, and correlate release to the earlier genuine button down with the same pointerId. Reject absent/untrusted/orphan/mismatched/cancelled releases. Preserve all full-document/CAS/ACK/clock/native/Serial/Reset/Stop assertions and timeouts;no forced inputs, private dispatch or product edits. New independent exact review and targeted negative tests before one justified native AFTER. Product remains the accepted partial7a source.

## Selected owner repair: repeated short visual cycles20/30/50/100ms

Owner explicitly requests real repeating short-cycle correctness via author and independent reviewer, unchanged tests and verified main publication. The old single30ms pulse passed despite65.3ms visible duration because250ms absolute tolerance is inadequate;retain prior checks and add stringent checks, never present that PASS as short-phase proof. Preserve d12 pointer candidate/existing run;do not cancel or rerun unchanged.

Product scope is `apps/web/src/electronics/led-temporal-presentation.ts` and `use-electronics-workbench.ts`, existing presenter/mounted-clock specs, prospectively derived integer-front checks only in `contexts/electronics/testing/arduino-execution-clock.spec.ts` (no domain product edits), existing native682 journeys in `e2e/electronics-interactions.spec.ts` and necessary qualification specs. No solver/runtime/physics changes, owner artwork, mass palette preload, dependencies, workflows, public ports or deployment. Keep complete observation horizon25ms and history125000us unchanged. Separate optical fast averaging threshold16667us (one nominal60Hz frame) from the unchanged producer limit;20ms phases remain visible,1ms remains computed mean from actual fronts. A nonmutating wall-aware native resource request must match current complete phase and retain nearest future slow-edge preparation, without cursor/RAF/token/ACK mutation. Pending/generation/native leases/joint publication/Reset/source protections remain;do not remove guards to fabricate timely fronts.

Freeze BEFORE native execution: four real repeated20/30/50/100ms sketches, at least10 complete cycles each, previous30s case budget unchanged. Pre-Start >=30 RAF intervals;median15–18ms,p95<=20ms, otherwise explicit infrastructure failure, never increase bounds from workload stalls. NominalT=1000/60ms fixed;per-edge ready/model-wall to native-witness lateness <=2T+2ms (35.334ms), every HIGH/LOW duration error <=T+2ms (18.667ms), full-period error <=T+2ms, drift range <=2T+2ms across measured cycles. Map each expected electrical front to H0 receipt wall time plus its prospectively derived model offset;native witness must be no more than2ms early or2T+2ms late. Do not re-anchor each edge to its late worker receipt. No skipped/extra/out-of-order fronts. Integrated duty error <=min(5percentagepoints,T/windowDuration+2percentagepoints), retaining all existing stricter bounds. Exact electrical event times derive prospectively from unchanged integer-microsecond instruction semantics, never from AFTER. No250ms per-short-phase allowance.

Record ALL startup and all first-visible phases without posthoc warmup exclusion;Start latency separately preserves existing5s ceiling and first ready-to-native existing50ms ceiling. New phase/edge rules remain strict from first comparable full visible cycle;no resetting clock origin to erase latency/debt. Validate native loaded/mounted/visible state plus following-RAF witness, not physical screen-pixel paint. Every expected front must have evidence;all acquisition/drop/journal loss fails closed. Frozen bounds may be clarified prospectively before first run only through independent review, not widened after failure.

One bounded author freezes focused checks, old-vs-new regression and exactSHA;new independent reviewer checks source, frozen criteria and negative oracle tests. One justified exact-head existing native AFTER plus required gates. Report actual phase errors/duty/missed edges/drift and startup separately;source or overall elapsed-time PASS cannot substitute for visual proof. Continue only within this owner short-cycle result;no unrelated repairs.

## Selected bounded short-cycle receipt-render repair

Actual four short journeys have exact prospective electrical fronts and pre-Start60Hz calibration but fail visible phases. For20ms the first visible HIGH lasts68.2ms;for100ms a model2000ms edge is ready only at2659ms. Do not attribute every failure to assets or stale pending frames. ON assets are reused after their first load. Preserve the failed originals and all existing phase/duty/drift/startup bounds.

One author may reproduce and remove redundant React renders caused by publishing displayed committed-time state on every Worker receipt. Scope remains `use-electronics-workbench.ts` and existing mounted-clock specs. Only the displayed committed-time metric may be coalesced to the existing actual RAF;the canonical latest-committed variable, requested horizons, inputs, complete ready results, physical state and wall origin must remain immediate and unchanged. Stop/Reset/source/unmount cancel queued display work;no stale-generation metric promotion, fabricated RAF or timer substitution. A test may distinguish immediate canonical state from next-real-frame displayed metric under this explicit UI contract, but may not weaken any electrical, phase, cadence, latency or journal assertion. Reproduce receipt-render churn before fixing it;prove identical requests/results/state/input behavior and reduced renders. Do not throttle or discard actual electrical results. If the cause needs scheduler/solver/runtime changes, return for a new canonical selection before editing those files. Independent review and actual native short-cycle evidence remain mandatory;this bounded optimization alone is not acceptance.

## Owner-added repeated long-cycle verification

Preserve the running receipt-render AFTER;do not cancel it to add coverage. One test-only author may extend the existing acknowledged native682 journeys and existing presenter/qualification oracle tests for1000,5000,10000,20000ms. No product, workflow, dependency or installation changes. The existing single1s/20s pulse is not repeated-cycle evidence and remains intact. Reuse the same actual editor, saved project, native loaded/visible LED and durable ACK journal rather than a synthetic clock or duplicate framework.

Freeze before execution: at least3complete cycles for each long period P, seven alternating fronts including the first fullHIGH. Expected firstHIGH2us, HIGH durationPus+2, LOW durationPus+3;cycle2Pus+5, full observed window6Pus+15. Keep all short-case defaults and existing timeouts unchanged. Each NEW long test has a fixed total budget6P+30000ms, allowing the necessary120s real observation forP20000;this budget is measurement length, not timing acceptance. Finish acquisition only after seven real native fronts plus retained following-RAF/ACK evidence, not merely a ready model. No accelerated wall clock, hidden warmup, origin reset, skipped pulse or post-failure budget expansion.

Use the same frozen60Hz calibration and absolute phase/period error<=18.667ms, per-edge early<=2ms/late<=35.334ms, drift range<=35.334ms and duty error<=min(.05,T/window+.02). No proportional or250ms allowance for long periods. Every prospective electrical timestamp must match exactly. Test negative oracle cases for slowed/scaled clocks, cumulative drift, wrong phase/polarity/duty, missing/extra fronts, late first phase and reanchoring. Keep journal loss fail-closed with bounded instrumentation;do not discard original evidence to improve timing. New independent exact review before the combined native run. This coverage addition is not a claim that the current product passes long or short phases.

## Selected empty Serial receipt identity repair

Actual17 short phases still fail after metric coalescing. Complete electrical fronts remain exact, but model availability and native publication both lag. Every short-case Worker response contains an unchanged empty Serial projection;the controller still calls onSerialProjection and the hook allocates a fresh empty mapping and updates React state. The previous mounted receive helper omitted that production callback, so its zero-render proof was incomplete. This is demonstrated redundant work, not proof of the sole cause of all timing debt.

One bounded author may change only `use-electronics-workbench.ts` and existing mounted-clock specs to retain state identity for empty-to-empty Serial projection. Nonempty updates, nonempty-to-empty clearing, RX/TX/begun/baud data, generation/source/Stop/Reset behavior and immediate canonical input/state must remain unchanged;no Serial throttling or expensive history serialization/comparison. Correct the mounted receive fixture to invoke real controller callbacks in production order, including Serial, and reproduce the receipt-render failure before fixing it. Keep all eight native scenarios and their time/phase/duty/drift/journal assertions intact. No solver/profile/pace/physics/origin changes.

If needed solely to retain the unchanged bundle ceiling, an independently AST-equivalent rename of keys inside the presenter's private clock-anchor object is allowed;no public frame/protocol fields, values or behavior may change. No build-budget increase or minifier configuration changes. Freeze focused checks and exactSHA, independent source review, then required exact gates and one justified actual AFTER. Proven unchanged-render reduction alone is not accepted visual timing;remaining compute/dispatch costs must be reported honestly.


## Selected actual-eight-failure repair: H0 host-demand bootstrap

Exact dcf8 actual browser run40026274248 retained all eight failures. At20ms H0 to first dispatch is39.2ms, then25000us computation takes46.2ms; first complete history arrives after the first pulse. Controller pump returns on null pending target before consulting authoritative host horizon. This is a demonstrated idle path, not an oracle excuse. Long-cycle compute and native publication lag remain open.

One author may change only the Arduino simulation controller and its existing targeted tests, plus narrowly necessary mounted-clock regression. After genuine H0 completion, promptly read already elapsed authoritative host time and enqueue only a finite safe integer horizon strictly beyond committed time. A first positive complete observation may be capped at1000us once, preserving the entire requested horizon and all subsequent continuation. If elapsed is still zero, at most one generation-guarded microtask retry is allowed; no busy loop, forced positive time, future work, wall-origin reset, hidden warmup or phase buffer. Retain callback ordering and reentrancy safety, current input/H0/yielded/Reset/Stop/source/dedup behavior and canonical state.

Prove BEFORE delayed/no host read without external timer and AFTER lawful immediate demand, first complete slice and exact continuation; compare full canonical events/state across horizons. Cover zero/invalid host horizons, stale generations, reentrant callbacks, input/yielded/Reset/Stop. All eight frozen browser cases, phase/duty/drift/ACK/loss criteria, existing timeouts, physics and pace stay unchanged. Independently review the frozen source SHA before one justified actual AFTER. No claim this alone repairs continuing runtime or asset latency.

Fresh preflight reports only foreign dirty workflows in D13 and teacher worktrees, no actual selected-path dirty overlap and no execution blockers; those workflows remain untouched under the owner's existing limited separate-tree exception and current direct_main policy. No guard is disabled.


## Selected duplicate owned-request digest repair

Actual998 all eight repeated native cases remain FAIL; initial dispatch is repaired, continuing ready debt remains. Real saved100ms project replay through batched evaluator shows1312 simulationInputDigest calls for656 ready requests; all656 canonical-input pairs byte-identical. Sampling attributes431.990ms inclusive digest CPU of2507.165ms evaluator CPU (17.2percent), not exact wall timing. No claim removing half this work suffices for visual acceptance.

One author may change contexts/electronics/engine.ts, existing immutable owned-request capability and scheduler preparation plus necessary existing tests. Compute the required digest once at its original engine validation location/error priority; carry it only through the existing owned immutable request capability and reuse for scheduler preparation. Preserve direct scheduler API fallback validation, malformed input/error order, disposal, source/input/request isolation. No global or mutable-object cache, hash algorithm change, trusted caller bypass, new public unsafe capability, physics, numerical accuracy, cadence, wall origin or timeout change.

BEFORE prove two identical calls per request; AFTER one validated computation with byte-identical whole ready results, canonical state and events at every saved horizon, including button/input/yielded/Reset/source cases and direct scheduler negatives. Use the same saved fixture and report call counts plus comparative CPU honestly. Freeze one bounded commit with focused checks, independent exact review, then necessary exact CI and unchanged all-eight browser AFTER. Native asset delay remains open; do not edit the concurrently owned ProductionComponentVisual path.


## Selected local native optical publication sink

Actual618 repeated8 remains FAIL despite exact electrical fronts and reduced digest work. Existing optical preparation/publication React state belongs to the entire Workbench hook; each frame requires parent reconciliation before native owner resources and layout ACK. Select one coherent local run-scoped external store/provider and visual subscriber wrapper, preserving the original ProductionComponentVisual implementation and assets.

Allowed: new local optical store/provider modules, use-electronics-workbench.ts transport and lifecycle, pages/SchematicEditor.tsx provider integration, ONE WorkbenchStage.tsx import redirection to a wrapper with identical public props, and existing mounted/native tests plus narrow store tests. Fresh targeted status across all worktrees shows no dirty changes in hook/editor/Stage; historical lane ownership is not an exclusive write permission under direct_main. Recheck before writing; if a real dirty overlap appears preserve it and stop that path. Do not alter Stage geometry/selection/foreign hunks or original visual body.

Keep preparation/proposed/committed/rollback vectors immutable, current generation/project/source/frame ownership, loaded-mounted-visible native leases, atomic whole LED/L vector and existing distinct-frame layout ACK. No ACK until all real nodes are active/current; failed/stale/partial commit restores whole previous vector. Numeric views read committed snapshots; move display-only metric scheduling after optical work to avoid flushSync draining parent updates. No solver, clock origin/debt, timing tolerances, cadence, physical model, new artwork or global DOM mutations/cache.

Regression must use actual mounted native nodes: preparation/publication causes zero extra whole-Workbench renders, one independent numeric metric render remains explicit, incomplete/stale/untrusted/error/href mutation/Suspense/unmount/Stop/Reset/source never falsely ACK. Preserve all existing readiness, independent-port, optical mean and rollback cases. Actual frozen8 AFTER and exact gates plus new independent source review required; local render reduction is not acceptance.


## Owner-approved editor budget revision, 2026-10-24

Owner explicitly answered: allow222000-byte budget and verification of all eight regimes. Exact67270cec native sink independently passed426 focused tests; Code types/build passed but actual editor221556 exceeded218000. Targeted safe reduction could not recover3556 without deleting the implementation/guards.

Select one separate change to only Electronics editor maximum in tools/check-web-bundle-budget.mjs:218000 to222000. All other budgets, matching rules and failure semantics remain unchanged. This authorization does not weaken physical accuracy, timeouts, native ready/ACK requirements, phase/drift/duty limits or any of eight browser scenarios. New independent exact review, actual Code/build measurement and one justified all-eight AFTER required; no owner acceptance or deployment implied.


## Selected local Header clock projection repair

Actual6b53 General PASS but repeated8 still FAIL. Native ready-to-visible improved13-26ms; later producer request starts late. For20s transition80000012us the crossing request begins57.888ms after expected edge; ready95.688ms late, native adds33ms. Raw30ms last HIGH appears after audit and286ms late, not proved permanently lost. Do not extend audit or relax bounds.

Current scalar displayed committed-time React state updates whole Workbench each RAF; Header is its only consumer. Select one bounded local Header clock subscriber through existing run-scoped projection port/new narrow clock projection, plus hook transport and necessary existing mounted tests. Preserve immediate canonical horizon/state refs, host demand and input order, session/source/generation, optical ready-only ACK/rollback, clock values and stopped/reset behavior. No speculative ahead simulation, reset/reanchor/debt discard, numerical/physics/cadence/timeouts/budget changes. No Stage/owner visual edits.

BEFORE real callbacks+four actual RAFs cause four whole Workbench renders; AFTER none from scalar metric while actual Header clock updates each relevant RAF and Reset/Stop/source reject stale updates. Existing optical/native tests and all frozen8 cases remain unchanged. Separate exact independent review and actual gates/AFTER required; root render reduction alone is not acceptance and does not prove all Worker RTT is React cost.


## Direct owner instruction: publish current partial result, 2026-10-24

Owner explicitly instructed publication to main immediately. Reviewed candidate b8591503671fbeab1ec2e6a215ceaa1bc948e0b8 has Code PASS221993/222000 and focused PASS; exact strict40085282383 and General40084822351 were still running at publication preparation. Current actual all-eight visual acceptance is NOT established. Prior6b534da6 all-eight phase/drift failures remain historical evidence; they are not erased by this publication.

Controlled merge preserves remote main2e0d0e981ea48897a550439e6760ddcfdaac77c7 and all unrelated changes without conflict. Product files remain byte-identical to reviewed b859 candidate. Publication is an owner-directed partial delivery, not full acceptance, release-candidate claim or site/deployment update. Continue actual eight-regime verification and remaining timing repair; no timeout, physics or journal weakening.


## Selected test-only active-interval and durable batch observer repair

Actual b859 source run40085282383 retains eight timing FAILs and two COMPLETE/PASS journeys (delays and button/Serial). All prospective electrical fronts are exact; ready results already arrive late. This selects one test-only observer repair, not proof that instrumentation accounts for all timing failures. Historical partial publication on main8cdd and all prior source/evidence remain intact.

Change only e2e/electronics-interactions.spec.ts and tests/electronics/classroom-qualification.spec.ts existing adversarial gate for extracted regressions, plus a narrow new test contract only if necessary; generated metadata only if a validator requires it. Long missing/late-render checks currently include evidence after long-stop-action although native paint already excludes that interval. Apply the same cutoff; retain every original raw row, trusted Stop and final ACK. An identical missing/late native witness inside the active interval must remain FAIL. All measured post-Stop long missing/late errors occur Stop+211..363ms; do not alter acquisition, phase/duty/drift bounds or eight-case coverage.

The current binding flushes each row synchronously. Validate the entire nonempty batch (at most256, contiguous sequences, finite times), serialize byte-identical envelopes with the original per-row Date.now rule, then perform one append/flush before invoking any observer or advancing ACK. Serialization, write or partial-write failure must produce no ACK; preserve all originals and errors for diagnosis and prevent false durable success. Do not discard records, change browser transport or hide incomplete delivery.

Extract deterministic tests for original envelope byte equivalence,256rows/oneflush, observer-after-flush ordering, gap/NaN failure/no ACK and cached-original raw replay. Keep physics, controller, pace, tolerances, timeouts, coverage, labels, dependencies, workflows and222000 cap unchanged. Freeze unpublished implementation with focused checks/self-review; NEW independent exact-SHA review and controller publication precede one justified unchanged all-eight AFTER. Observer repair alone does not establish realtime or owner acceptance.

Audit provenance and separate General failure are recorded in the dated selection receipt. Preserve foreign679/557 completion,548 budget blocker, owner KEEP544/547 OPEN and all546/R27 history; no deployment or acceptance authority is added.


## Selected existing JSONL append mock follow-up

Published471 observer source reached focused40093297609:894PASS/1FAIL, with the existing LED test mock at2609 parsing a whole multi-line append as one JSON value. Browser and benchmark were SKIPPED. All76 classroom checks pass alone; that does not replace the full focused gate. General40093295686 was CANCELLED after a foreign main push, classification E, not product PASS or FAIL. Actual all-eight qualification remains pending.

Authorize exactly apps/web/src/electronics/testing/led-temporal-presentation.spec.ts existing append mock to parse ALL nonempty JSONL lines, preserving4096 durable originals,2048 long retention, ACK and all assertions. No interactions/product edits, skipped checks or timeout changes. Run full165 LED plus76 classroom tests before NEW exact review and one justified unchanged AFTER. Canonical docs review/publication precedes implementation; old receipts and failures remain intact.


## Selected native phase diagnostic only, 2026-10-24

Actual6cad focused40094338480 core934/web895/classroom76 PASS,70 fresh Nx tasks; benchmark PASS and editor221965/222000. General40094337150 Governance/Code/Access PASS; Data category C baseline budget1 timeout. Four actual journeys COMPLETE (delays, button/Serial, short20ms, long5000ms), six FAIL (short30/50/100ms, long1/10/20s). Physical fronts exact across54 criterion errors; failed shorts have no Stop/final ACK. Short50 edge17 ready61.256ms late plus20.4ms native; long1s edge4 ready18.988ms late plus24.4ms native. Existing evidence cannot distinguish compute/channel/publication. Detailed provenance and bounded contract are in [dated diagnostic selection receipt](../evidence/arduino-682-native-phase-diagnostic-selection-20261024.md).

Select ONE opt-in DIAGNOSTIC ONLY Worker performance timeline port and two additional50ms/1s cases. Source paths only simulation.worker.ts, existing electronics-interactions.spec.ts, new e2e/arduino-682-phase-probe.ts and new tests/electronics/arduino-682-phase-probe.spec.ts. Original ten cases retain names/modes/native actions/fixtures/oracle inputs/assertions/all timing bounds and probe disabled; append two diagnostics after them in same group with reused body and no warmup.

Diagnostic constructor Proxy adds only flag/instance to same genuine Worker URL, preserving options/newTarget; no worker.evaluate during timing or async priming. Flag read once startup, disabled zero per-response clocks/marks/buffers. Enabled bounded versioned instance/session/generation/request/epoch mark names cover request-received/response-ready/send-call/send-return, immediately cleared without app buffer. Canonical responses/transfers/ACKs and original post exceptions unchanged; instrumentation failures contained.

Own CDP blink.user_timing ReturnAsStream starts before genuine Start; finally harvest after measured journey and preserved Stop if reached. Failed short Stop NOT_REACHED is retained with trace harvest, no extra input or delayed Stop. Collision never stops foreign trace and yields NOT_OBSERVED; EOF/encoding/base64,16MiB cap, loss/truncation/missing first mark/duplicate/correlation errors likewise fail NOT_OBSERVED. Main receipt at listener entry; transparent Reflect setAttribute/setAttributeNS wrappers cover only LED/L attributes/href. Label NATIVE-ATTRIBUTE-PUBLICATION, never complete optical publication: CSS opacity untrapped, residual style latency UNKNOWN, interference UNKNOWN_NONZERO. Existing whole-vector RAF witness unchanged; trace and parsed artifacts separate, canonical journal untouched.

Require deterministic enabled/disabled response/receiver/throw/transfer equivalence, source/generation separation, disabled zero clocks, epoch alignment, all stream/error/loss coverage and oracle input byte preservation. Local new unit plus existing165 LED and76 classroom checks; General must collect new unit. No physics/evaluator/controller/clock origin/debt/lease/tolerance/timeout/cadence/workflow/script/dependency/cap/asset edits. Freeze unpublished with light checks/self-review, NEW independent exact-SHA review, controller publication then ONE justified existing strict CI. Incomplete capture means STOP diagnosis. No fix, closure, release, deployment or owner acceptance; preserve all foreign lanes and history.

Canonical docs selection lands on main first. Reviewed diagnostic implementation publishes ONLY to a measurement branch for ONE existing strict CI; no product-main diagnostic implementation publication until actual evidence and a separately selected cause-based fix. Require NEW full actual review. Probe evidence is not eight-regime acceptance or a finished user repair. Original ten qualification cases remain probe-off; two diagnostics are additions.


## Selected PRIVATE exhausted-demand test-only probe, 2026-10-24

Measurement93531edc branch-only strict40100814456 has934core/895web/76classroom and70fresh Nx PASS; benchmark221965RAW/222000 PASS; browser197PASS/74FAIL. General40100808744 all four jobs PASS. Original timing20/30/50ms PASS,100/1000/5000/10000/20000ms FAIL (41errors); mixed delays and button/Serial COMPLETE, physical fronts exact. Valid diagnostic capture does not establish realtime acceptance or actual source cause. Member CRC/size/SHA verified for12native+2trace+2report; whole ZIP digest NOT_VERIFIED.

Select ONLY existing live-simulation-worker-controller.spec.ts and external temporary evidence for a private public FakeExecutor probe. Canonical H0 startup AND first positive startup release with bounded microtasks fully settled and public action/request-count proof, then a NON-STARTUP ordinary positive target (e.g. settled1000, ordinary2000, callback legal3000). H0 alone is insufficient because startup has a special fresh pull; no private fields. Independent elapsed/displayed ACK advanced in onResult, ACK<=delivered committed, H=min(elapsed,ACK+50000), existing25000 slice; no external update. One fresh bounded read after saved-target exhaustion is a NEW desired planning criterion, not proof of runtime cause. Preserve every existing test. Held ACK alone permits finite catch-up; no-request negative requires H<=committed. Check null/invalid/unchanged host, one in-flight, bounded flush/no busy loop, Stop/Reset/restart/input invalidation, input/yield order and queued button/Serial identities.

No product paths, clock reanchor/debt discard/future prediction, numerical/cost/clock policy/tolerance/timeout/cadence/cap changes. Canonical docs publish first; author freezes PRIVATE unpublished test/evidence for NEW independent review. PASS => NO_PROVEN_REGRESSION STOP; invalid fixture => INVALID_HYPOTHESIS STOP. Faithful RED stays PRIVATE UNPUBLISHED, never red main/CI or assertion workaround. Any later cause-based product implementation requires separate canonical selection; no automatic repair/browser run. See [dated full contract](../evidence/arduino-682-exhausted-demand-private-probe-selection-20261024.md). Preserve all phase and546/R27 history, blockers and owner pending; no closure/release/deployment.


## Selected PRIVATE epoch-bounded feasibility, 2026-10-24

Private5f1d97PASS/2desiredRED proposes a criterion, not runtime cause. Select ONE private controller/controller.spec experiment with one permit per valid EXTERNAL epoch; internal reads/pump/completions never rearm, old completion cannot consume newer callback updates. Input first, consume before read, generation/epoch fence, one validated snapshot/request-local no-second-read dispatch; invalid/no-host/H<=committed no retry/spin. Startup and timing bounds exact. Preserve original87/private12; test direct moving-clock/reentrant/input/Stop/Reset/heldACK/nonvacuous invalid boundary. ONE all-green private freeze/proxy estimate, NEW source review; conditional measurement branch/composition review/ONE strict CI only. No product main before all8 actual native/full functional/new actual review/full gates/RAW<=222000. Historical35-byte margin not fit proof; no cap raise/blind variants/red main. Unsafe/infeasible/controlsFAIL STOP. [Full dated contract](../evidence/arduino-682-epoch-bounded-feasibility-selection-20261024.md). All history/blockers/owner pending preserved; source not deployment or acceptance.
