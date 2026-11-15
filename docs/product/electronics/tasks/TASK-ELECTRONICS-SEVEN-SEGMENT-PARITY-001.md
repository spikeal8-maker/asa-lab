---
task_id: TASK-ELECTRONICS-SEVEN-SEGMENT-PARITY-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Real Blockly/text parity for supported seven-segment common modes

Consolidated13, issue788, parent703/452. TEST ONLY one missing native parity slice.
Already accepted domain tests cover0-9 CA/CC, all8segments/DP/bothcommonlegs,
current/finite/quality, oldthermal/runtimegoldens and real overcurrent/reverse/
resistor-open negatives. Existing native covers text CC bc/all8 only. Carry old
proof; do not rerun it or replace original owner cases.

Add isolated --seven-segment-parity-only in existing servo-runtime.browser.mjs.
Twelve patterns0-9, DP-only and all-off, both supported commonMode values, actual
Blockly-generated eight digitalWrite chains and equivalent text,1440/390. Use
canonical seven-segment/single-digit-seven-segment-10pin/v2 and rawDisplayCircuit
explicit resistanceOhm1000 option (physical current limitation), leaving default
330Ohm/no-delay owner fixture/goldens untouched. No invented variant or model.
Actual pin map a:top4 b:top5 c:bottom4 d:bottom2 e:bottom1 f:top2 g:top1 dp:bottom5;
commons top3/bottom3 internallyjoined, correct poweredrail/polarity percommonmode.

Mounted real hook/Worker/Stage, no direct model result or brightness injection.
All eight expected on/off flags, real currents/brightness/DOM, finitequality/KCL/
source residual and physicalresistorbounds. Causally match activeprojectsession,
generation/inputDigest/committedframe, not previoussource result. Real Blockly
Workspace blocks/connections/generator, not handwritten source labeledblocks.
Assert source stays fixed within each run and report code hashes. Logical glyph
parity, with meaningful physical tolerances; do not force byte equality between
different source execution timelines. Representative screenshots only, not96.

First two samples establish bounded timing; no deadline/timeout increases or
physics/thermal shortcuts. Preserve all old/default/native modes byte-equivalent.
If realdefect STOP with causalreceipt for separate repair; no productionedits or
weakened tests. This does not close13counter/button scenario or fix14time lag.

Scope only existing native fixture plus compact evidence seven-segment-parity-788.json.
Canonicalgeneratedcoverage onlyif necessary. No product/model/runtime/solver/
thermal/cadence/refactoring/dependencies/workflows/art/server/Docker/DB/ports.
Product unchanged: carry prior2345test71freshNx/source/type/build/bundleproof,
newmodeonce plusformat/lint/selectedrouting andindependentexactSHAreplayonce.
No fullgate/build or old broadmatrix repetition. Executor publishes onecandidate
andstops; controller owns currentyaml and nextselection. No installed/SaveCAS/
owner/release/whole13claim from this slice alone.
