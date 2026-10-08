---
task_id: TASK-ELECTRONICS-OBSERVATION-CADENCE-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Independent acceptance of TASK-ELECTRONICS-ARDUINO-CADENCE-DIAGNOSIS-001
  - Technical acceptance of TASK-ELECTRONICS-ZERO-HORIZON-STARTUP-001
acceptance_boundary: slice
review: independent
---

# Complete canonical observations during slow catch-up

Program [#452](https://github.com/spikeal8-maker/asa-lab/issues/452); separate bounded product repair [#516](https://github.com/spikeal8-maker/asa-lab/issues/516). Read the accepted [#510 measurements](../evidence/arduino-observation-cadence-510-20261007.md) before implementation. Preserve accepted #513/#509 and the suspended [#505 / PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506).

## One user result

While slow calculation catches up, the pupil sees regularly completed canonical electrical observations and their actual model time. A lit LED does not remain on an older full result merely because the next coalesced host horizon has grown into a long batch. This does not promise real-time calculation on every device or establish classroom frequency.

## Entry and mapped boundary

Restore fresh GitHub/main/current.yaml/exact-head CI and other agents' work. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-OBSERVATION-CADENCE-001` after canonical selection on main. The primary component is `electronics.worker.live-controller` in [engine-worker-clock.yaml](../components/engine-worker-clock.yaml); Worker protocol and canonical clock are its direct dependencies.

Read [canonical clock §§2–6 and §§8–10](../contracts/CANONICAL_CLOCK_CONTRACT.md), [fault/publication semantics](../contracts/SIMULATION_FAULT_STATE_CONTRACT.md), controller/executor request flow and the mapped tests. Expected production scope is the live controller; minimal directly necessary request/metrics plumbing is allowed within the existing Worker boundary. No engine, scheduler, model or solver semantic repair is hidden in this task.

The hygiene checkpoint rule remains applicable. This bounded repair addresses the reproduced failure of an existing registered browser-gate scenario (#505 run 37506449432, reproduced by #510 controlled run 37579060724), using the gate-restoration exception in AGENT_GUIDE §4.1. It authorizes no cleanup, decomposition, asset work or general reinventory; other hygiene debt remains separately tracked.

## Bounded investigation and implementation

- Evaluate limited/adaptive canonical horizon chunking. Keep later accumulated host demand pending while selecting finite complete observation targets. Explain the chosen initial bound/adaptation, behaviour under yielded work and measured limits; wall-clock metrics guide request presentation only.
- Continue the same canonical state through chunks: Arduino program/runtime, capacitor charge, thermal checkpoints, damage, motor and every other supported runtime state. No hidden reset, skipped model time, changed physical barrier, reduced tolerance or alternate model.
- Preserve ordered runtime/serial inputs, future input retention, ready(0) startup, yielded continuation, generation cancellation, stale-response rejection and fault handling. Adaptive selection must not become another physical clock or replay authority.
- Publish only a genuine `ready` result with committed horizon equal to the actual requested chunk horizon. Never publish `yielded`/incomplete work as a ready electrical frame. Show confirmed model time even when it trails host time.
- At equal document/versions/initial state/event trace/final horizon, different request chunks and work partitions must converge to byte-equivalent normalized canonical state/result. Do not normalize away physical values, damage or diagnostics to make parity pass.
- Keep existing browser assertions, sixty-second LOW poll and all other timeouts. Preserve #505/#506, owner artwork, student documents, storage schema, authorization and physical accuracy. Solver optimization, new peripherals and neighbouring cleanup require separate selection.

Default write budget: at most five directly justified production files in the mapped Worker/controller boundary and two focused test files. Any required engine/model change or inability to preserve canonical partition semantics is a separately reported dependency, not permission to expand this slice.

## Evidence and acceptance

1. Meaningful controller regressions demonstrate repeated complete observations during slow catch-up, bounded/adaptive demand handling and no publication on yielded responses. Cover input retention/order, startup, reset, cancellation/stale response and faults.
2. Prove request-partition/state equivalence through the actual timed engine for Arduino and physical state. Use the existing `engine-timed-api.spec.ts`, `engine-trace-replay.spec.ts`, capacitor/thermal/motor fixtures and direct/Worker parity as the bounded reference set; add only directly necessary regressions.
3. Run the same existing Arduino HIGH → LOW / Reset scenario in an isolated built CI editor, under ordinary and the recorded finite CPU-contention conditions. Original assertions and timeouts stay intact. Capture requested/committed horizons, ready/yielded, compute elapsed time and UI/LED publication. Demonstrate improved complete-observation cadence with quantified limits; do not equate synthetic load with school-device acceptance.
4. Restore temporary probes/workflow routes before the final candidate. Run exact-final-head `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser` and `pnpm gate:repository`; require a new independent reviewer of that SHA. After integration, obtain exact-main Electronics browser evidence before resuming #505 acceptance.

No local second stack, working-installation update, live database/network operation, protected-asset change or classroom load is authorized. Isolated disposable CI resources are permitted for the required evidence.

The implementer handles only this slice, self-reviews, reports exact SHA/evidence and STOP. Confirmed review findings receive a separate bounded repair and new review. The controller performs integration/closeout and dependency selection under AGENTS.md §2.1; owner acceptance and deployment remain separate.

## Selected preserved-result acceptance after dependency repair

Separate #517 is technically accepted at normally published exact main `29da6bfb151907b8c6835ed79299e54b11edfd68`, with required General `37729828726`, full Electronics `37729984165` and NEW independent product/published reviews APPROVE. Earlier Settings defects were separately repaired. Preserve all three cadence source/test blobs from `ba05381` / integrated `4bad8a7f`; no product change is selected.

This bounded cycle restores fresh canonical main/CI, verifies the selected card and preserved actual source/evidence, obtains required exact-main gates and a NEW independent review of the cadence result, then reports and STOP. Use saved normal/CPU-load measurements; do not rerun those probes or alter timeout/physics without a specific new defect. #505/PR506 and T3 remain pending their own acceptance boundaries. Controller alone records closeout and canonical next selection.
