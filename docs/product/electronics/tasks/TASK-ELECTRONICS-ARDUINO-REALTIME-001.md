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
