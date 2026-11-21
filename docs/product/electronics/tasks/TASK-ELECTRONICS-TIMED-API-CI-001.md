---
task_id: TASK-ELECTRONICS-TIMED-API-CI-001
kind: repair
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: self
---

# Bound CPU contention in the timed API ownership CI regression

Owner explicitly requests repair of the existing engine-timed-api timeout and
normal main integration; foreign changes and all servers remain untouched.

Primary component: `electronics.engine.public-api` (ASA ownership, area HIGH).
This repair changes only test scheduling, not engine/clock/solver/persistence
semantics. Profile the original budget1 regression before changing anything.
Its full stateless reference dominates cost; the isolated/focused run passes
while full parallel CI exceeds5000ms. Run this one heavy test file after the
parallel group and existing shared-lock submissions, with no competing workers.

Read: `../components/engine-worker-clock.yaml`, `../AGENT_GUIDE.md` sections2,5,
11–13 and the existing ownership test. No roadmap or production optimization.

Write budget: root `vitest.config.ts`, this card, `docs/execution/current.yaml`,
the existing component's test route and one evidence report. No production source
or test-body edit; no timeout/retry/skip, reduced horizon/budget or assertion
change. Existing serialized submission scheduling remains intact.

Acceptance: actual Vitest discovery retains every file exactly once, every one
of the86 timed API cases remains present, all four budgets and full2050us
boundary/state/descriptor/mutation comparisons stay byte-identical. Other files
retain their original project. The default5000ms timeout stays unchanged.
Run the original focused file, then the uncached Electronics focused gate and
exact-SHA General CI. The full Vitest/RLS and Access jobs must pass before claiming
the requested common CI is green. No new separate gate/command or local DB/stack.

Self-review follows the nonsemantic/test-only exception in AGENT_GUIDE section13.
No integrated milestone or release/owner acceptance is claimed. Stop after this
bounded CI repair is published and its exact-SHA conclusion is recorded.
