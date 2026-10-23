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
