---
task_id: TASK-ELECTRONICS-ZERO-HORIZON-STARTUP-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Independent acceptance of TASK-ELECTRONICS-E2-STARTUP-DIAGNOSIS-001
acceptance_boundary: slice
review: independent
---

# Publish a complete canonical zero-horizon startup observation

Program [#452](https://github.com/spikeal8-maker/asa-lab/issues/452); bounded repair [#513](https://github.com/spikeal8-maker/asa-lab/issues/513). The accepted [#512 diagnosis](../evidence/e2-startup-512-20261007.md) reproduced startup starvation: delayed preflight lets the host timer replace the zero target with a later horizon, and the UI waits for long catch-up before its first result. This repair includes the preserved one-line strict E2 assertion from [#509](https://github.com/spikeal8-maker/asa-lab/issues/509) as its browser regression. [PR #506](https://github.com/spikeal8-maker/asa-lab/pull/506) and Arduino cadence [#510](https://github.com/spikeal8-maker/asa-lab/issues/510) remain separate.

## One user result

Start reaches a genuine `running` state after a complete canonical observation at time zero even when preflight crosses a host timer tick. Later horizons continue processing. No incomplete future result is displayed and physical accuracy is preserved.

## Entry and bounded implementation

Recover actual GitHub main, current.yaml, #513, #509 candidate `a02e3292193ffbb0d3fec5f510c9a3e7f229df64` and unchanged #506 before writes. Read the accepted diagnosis and controller/input/generation contracts. Run `pnpm agent:preflight --scope electronics --check` and `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ZERO-HORIZON-STARTUP-001`.

Preserve the complete canonical zero-horizon initial advance before pursuing newer host horizons. Implement the smallest controller change. Keep pending runtime and serial input events ordered and retained, preserve cancellation and stale-generation rejection, and continue subsequent horizon progression. Check delayed preflight, inputs arriving during startup, structural restart, Stop/new Start, and errors. Use meaningful focused regression tests against these behaviors; update the old coalescing expectation only where the new startup boundary requires it.

Carry only the existing #509 `toHaveAttribute('data-simulation-status', 'running')` line into E2 before its unchanged strict computed-style assertions. Do not increase its standard five-second timeout, add sleeps, weaken status/CSS checks, lower scheduler precision, change Arduino cadence/physics, or edit the rigid-board candidate #506. If another component needs repair, report a separate dependency.

First run directed isolated built-browser E2 under the delayed-preflight/load trigger that proved the mechanism, preserving the same fixture and assertions. Temporary probes/workflow routes must be restored before the final candidate. Then run exact-final-head focused, full Electronics browser and repository gates. No local second stack, working DB, installation update or deployment.

The implementer reports one exact final SHA, focused evidence and self-review, then STOP. The controller checks actual diff and GitHub state and assigns a new independent reviewer of that SHA. Confirmed findings receive a separate bounded repair/review cycle. Integration and closeout of #513/#509 happen only after required evidence and independent approval; #505 resumes afterwards with its own exact-head verification.
