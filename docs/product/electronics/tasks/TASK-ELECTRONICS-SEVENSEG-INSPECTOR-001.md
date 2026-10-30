---
task_id: TASK-ELECTRONICS-SEVENSEG-INSPECTOR-001
kind: repair
risk: high
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Seven-segment inspector follows committed native measurements

Issue [872](https://github.com/spikeal8-maker/asa-lab/issues/872). Owner explicitly
requests this product repair after completing panel checks. Execution state
lives only in current.yaml.

## Confirmed discrepancy

Canonical41026543811, MATH-6E at immutable e1be12d19: five active and three
inactive stage-segment assertions pass, then inspector mask says no lit segments
instead of A,B,D,E,G. Cached trace JPEG visibly shows digit2 while inspector
currents/brightness stay zero at00:05. Source a2e380a26 confirms the stage has a
native subscription, but sidebar reads controller resultByComponent memoized
from a prior root render. This is a stale product readout, not an oracle change.

Reuse original artifact reports/field-boundary-544-proof-41026543811/artifact/
reports/playwright. The trace resource is
page@e3194a992ab17a27838c44aecef0e820-1793350714329.jpeg. Preserve raw failure,
original trace JPEG and source/run provenance before edits; no standalone runtime
PNG was reached. Do not rerun the entire suite to recreate this BEFORE.

## Bounded product behavior

Selected seven-segment inspector must read the same committed native physics
as the stage: lit mask, per-segment currents and brightness. Subscribe at the
smallest existing inspector/readout boundary. A tiny UI leaf is allowed where
necessary for render isolation; do not make the editor/controller or entire
sidebar render per frame. Reuse the actual committed-result selector/pattern.

Do not expose proposed/unaccepted, retired or wrong-generation frames. Preserve
existing stopped/paused/reset and no-result/unsupported behavior, selection
changes, optical commit barriers and immutable documents. No new clock, forced
root update, ACK participant, numerical model or protocol change. Other four
instrument projections found in525 are a separate future bounded repair.

Inspect actual store API and render boundaries, report a concrete minimal plan
before product edits. Intended product concern is WorkbenchSidebars.tsx and a
necessary small UI readout/helper only; justify another path before writing.
No unrelated refactor, old-function/chunk extraction or new UI redesign.

## Proof and delivery

Keep the original MATH-6E oracle unchanged. At1440/390 use actual production
Worker calculations, stage visual and inspector/readout with shared committed
observation. Prove digit2 and additional physical masks, exact finite current/
brightness agreement and selected-component changes. Include proposal-before-
commit, reset/old-generation, pause/Stop and retire behavior with meaningful
focused tests. Synthetic store tests are not physical end-to-end evidence.

Candidate build/all8 fixed caps early; preserve failures. Freeze/push after
focused self-review. Fresh independent source/native review precedes the one
final unchanged-SHA uncached canonical electronics gate, then final review
verdict. No broad unrelated browser rerun or weakened assertion. Root owns
execution metadata. No server, Docker, live DB, ports, deployment, protected
assets, dependency changes or foreign edits. Arduino cleanup remains explicitly
deferred; it is not authorized by this task.
