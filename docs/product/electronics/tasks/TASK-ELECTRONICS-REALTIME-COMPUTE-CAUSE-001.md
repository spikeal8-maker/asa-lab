---
task_id: TASK-ELECTRONICS-REALTIME-COMPUTE-CAUSE-001
kind: analysis/inventory
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: self
---

# Measure the remaining real-time compute cause

Owner programme452: diagnose remaining timing failures without changing runtime.
Execution state is only in current.yaml. This does not resume the selected682
private harness or historical539 repair. No product implementation is authorized.

## Component and minimal entry

Primary: `electronics.worker.protocol` in `components/engine-worker-clock.yaml`.
One justified lookup to `electronics.engine.public-api` and its clock dependency:

- apps/web/src/electronics/simulation-worker-evaluator.ts
- apps/web/src/electronics/simulation-worker-protocol.ts
- contexts/electronics/engine.ts
- contexts/electronics/domain/arduino-circuit-scheduler.ts
- contexts/electronics/domain/arduino-program-runtime.ts only if attribution requires it

Read canonical-clock authority/physics-barrier and engine ownership contracts only
for the particular replay; maintain all request/result/state ownership semantics.
Use existing simulation-worker and engine-timed-api tests as reference, without edits.

## Measured question and exact input

Existing paired no-delay/millis receipts show worker computation dominates slow
completed model progress. They do not identify a present inner-function hotspot or
prove one cause for all20 failures. Current passive eventQueue continuation support
already exists: do not resurrect the historical R27 patch.

Use saved actual no-delay and independent-millis circuit documents and complete
worker states under the original41334492559 intake. Freeze their source/input hashes,
requested/committed horizons and exact continuation inputs. No invented smaller
circuit, changed event budget, time precision, instruction cost or default speed.

## One bounded read-only experiment

After selected-task validation, run at most two minutes of actual evaluator replay
using temporary scripts/output and the existing frozen installed dependencies.
Measure cold H0 and a few actual continued requests. Establish actual owned-runtime
and prepared-quality-path activation before attributing cost. One CPU profile may
locate the dominant functions; unmeasured cloning remains only a hypothesis.
Retain complete response/state/event/quality/optical outputs and their SHA256 hashes.
A repeated identical request can compare complete serialized responses excluding
only nondeterministic computeMs, with original unmodified responses retained.

No repository source/test/state edits, new dependencies, browser/server/Docker/DB,
full-suite rerun, changed deadlines/assertions, fake time or acceptance claims.
Missing real inputs or ownership proof means report the gap and STOP. Report exact
source/input identity, measured functions and cost, observations versus hypotheses,
and the smallest separately selectable repair scope. Then STOP; a new author and
independent review are required for a later semantic change.
