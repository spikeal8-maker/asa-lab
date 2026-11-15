---
task_id: TASK-ELECTRONICS-SERVO-MULTI-SUSTAINED-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Two physical servo models in sustained complementary cycles

Consolidated11 remaining acceptance, issue786, parent703/452. TEST ONLY.
Reuse fixed angles/power/pulses/expressions/lifecycle/clip and accepted784 live
potentiometer text/Blockly proofs; do not repeat previous matrices.

Add isolated --multi-servo-sustained-only mode to existing servo-runtime.browser.mjs.
Two physical servo-motor components with unique IDs and two Servo objects on
D9/D10; existing5V rail/commonGND to both. Complementary0/180 commands swap every
250ms in supported C++ control flow. Target10000000us MODEL via checkpoint/JSON
continuation, settled phases between edges. Verify both independent objects/pins,
50Hz/20000us PWM periods and544/2400us pulse widths, powered decoder state,
physical model/projection angles, BOTH native horn transforms with exact same
committed generation/digest/frame as784. All finite source/signal/node values,
quality/KCL/source residuals. Native1440/390; preserve old/default modes.

First100ms/1s bounded timing, existing30s request deadline unchanged. No thermal
step/scheduler shortcuts or timeout increases; if blocked STOP with actual progress.
One short replay full-state equality, Reset and pending Stop; not a second full
10s repeat or old broad matrix. Record walltime separately, no realtime claim.
Servo model covers supply/signal decoding/angle, not mechanical load/stall current:
never invent motor-current assertions or claim physical safety of powering two
real servos from an Uno. Existing canonical simulated topology only.

Scope ONLY native fixture and compact new evidence servo-multi-sustained-786.json;
canonical generated coverage only if necessary. No product/runtime/solver/thermal/
clock/schema/protocol/UI/refactoring/dependency/workflow/art/server/Docker/DB/ports.
On product defect STOP with causal receipt for separate repair, no weakened tests.
Product unchanged so carry prior full source gate/type/build/bundle proof; run
new mode once, formatting/lint/selected routing and independent exact-SHA replay
once. No full71task gate/build duplication. Executor publishes one candidate and
stops; controller selects next slice and decides whole11 source closure only
after independent acceptance. No installed/SaveCAS/owner/hardware claim.
