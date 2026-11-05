---
task_id: TASK-ELECTRONICS-WORKER-WORK-QUANTUM-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Measure the existing supported Worker cooperative quantum

Owner resumes remaining20 timing failures and plan points3/7/9. Production CPU
evidence identified substantial per-public-step validation overhead. Three
small code optimizations showed no gain; unsafe cached guard batches were
rejected. Do not resume any of those patches.

Primary: `electronics.worker.protocol`, `components/engine-worker-clock.yaml`.
Only product path: `apps/web/src/electronics/simulation-worker-evaluator.ts`.
Pass the already supported `maxEvents: 1024` request option to the private
createElectronicsAdvanceSession call. Public engine/scheduler defaults remain256
and the supported range remains1–1024. No core source, guard, capability,
ownership or API change; every ordinary step retains its fresh model check.

This explicitly changes Worker cooperative granularity, not the total execution
limit: the evaluator already loops private continuations until the same requested
horizon is complete. All instructions, physical barriers, quality checks, event
history and final state must still execute. Exhaustion yields continuation, not
permission to accept a partial horizon. No deadline, tolerance, horizon, model
time, instruction cost, speed setting, fault limit or cap is increased.

## Risk and bounded evidence

Larger steps may overshoot the unchanged8ms cooperative check farther and harm
Stop, inputs or generation supersession. Initial source feasibility review found
this experiment viable but did not approve activation. Measure that risk.

1. First run ONE bounded paired unchanged production Vite Worker workload with
   the same8 frozen actual no-delay/millis requests,320 responses maximum120s.
   Full response/state/quality/optical parity against originals excludes only
   metrics.computeMs; caller input immutable. No new CPU profiler or variants.
   No gain or changed output means withdraw and preserve evidence without CI.
2. If gain is credible, measure individual step duration and longest cooperative
   pause on large and mixed circuits as well as the frozen workload. Disclose
   any secondary TEMP-only timing instrumentation and its overhead separately
   from primary untouched performance/output evidence; publish no such probe.
3. Run unchanged simulation-worker cancellation/fault/ownership tests and
   existing core partition/peripheral regressions at supported budgets. At most
   one focused Worker test file may change for a genuine uncovered risk; never
   edit occupied engine-timed-api source or weaken existing assertions.
4. Require unchanged-cap pnpm gate:electronics-m1, exact General CI and new
   independent exact-source/evidence review. Native original Stop/Reset/input/
   supersession and large-circuit scenarios must retain their existing budgets
   before activation. Reject a material responsiveness regression.
5. Qualify the remaining native timing cases unchanged. Compute improvement
   alone closes none of20 and does not establish real-time or full acceptance.

Evidence: `evidence/worker-work-quantum-20261103/`. All prior source/fixtures and
unsupported behavior stay intact. No workflow, dependency, broader refactor,
server, Docker, live DB, school data or protected asset change. The previous
card's fixed-quantum experiments remain historical; this card explicitly selects
a supported private quantum experiment with full parity and responsiveness gates.
