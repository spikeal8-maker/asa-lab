---
task_id: TASK-ELECTRONICS-HOST-YIELD-DIAGNOSIS-001
kind: analysis/inventory
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Measure browser Worker host-yield overhead

Issue934, owner programme452. Current.yaml selects execution; this card authorizes
measurement only, not repository runtime changes or realtime acceptance.

## Primary route and question

Primary `electronics.worker.protocol` in components/engine-worker-clock.yaml:
`simulation.worker.ts`, `simulation-worker-evaluator.ts` and protocol declarations.
One engine/clock dependency lookup only for ownership and complete-state parity.
Read canonical-clock authority and execution/failure ownership sections needed
for this experiment. No whole engine inventory or instruction-loop refactor.

Actual saved requests and the completed Node diagnosis are retained under the
realtime-compute-cause-20261102 evidence and its original OS-temp manifest.
Node timers account for much wall-minus-compute time, but this does not establish
browser behavior; interpreter computation is also substantial.

## Exact bounded experiment

Use actual saved no-delay/millis inputs from the previous TEMP inputs.json,
including original physical documents, sources, continuation states and horizons.
Millis actual source is saved.draft.document, not its default-code before document.
Record source/input hashes and reconstructed projectSessionId limitation again.

Launch fresh isolated Chromium through the existing test library, no server or
listening port. Bundle the real production Worker entrypoint with frozen existing
dependencies; record bundler flags and source/bundle identity. Preserve one actual
unmodified Worker control. TEMP-only timer instrumentation and a separate
MessageChannel-yield callback prototype may measure alternate host scheduling.
They are experimental variants, not production code or acceptance evidence.

Run at most8 real requests per pass, at most2 passes per variant, at most3 variants
and90seconds total execution. Keep request horizons, physical models, instructions,
8ms cooperative compute slice, event budgets and all protocol guards unchanged.
Collect real wall/compute/wait durations and yield counts. Compare complete
responses and state/events/quality/optical output; remove only nondeterministic
metrics.computeMs for equality. Retain complete original outputs and caller input
immutability proof. Match instrumented control to unmodified control before
attributing overhead; distinguish instrumentation, transport and cold-JIT cost.

A short real cancellation message during an actual continued request may verify
that the experimental macrotask still processes generation cancellation and
suppresses stale responses. Label any new transport envelope fields explicitly;
do not fabricate physical circuits or claim original browser transport parity.

## Report and STOP

Report per-request medians/ranges, full response equality, observed waits versus
compute, cancellation results and exact limits of Blob/rebundled-Worker probes.
Do not infer that one optimization fixes all20 failures or proves classroom/native
app realtime. If yields are not material, report that instead of implementing a
speculative scheduler. New independent actual review precedes a separately
selected product repair; original native no-delay/millis and other timing cases
remain required after any later implementation.

No repository product/test edits, new dependencies, altered deadlines/assertions,
new physical timer, fake time/physics, server, Docker Desktop, live DB, owner assets
or foreign work. All scripts and experimental bundles stay in OS-temp. STOP after
one concise measured report; no automatic runtime implementation.
