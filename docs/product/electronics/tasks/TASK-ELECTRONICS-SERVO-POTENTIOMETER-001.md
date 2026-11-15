---
task_id: TASK-ELECTRONICS-SERVO-POTENTIOMETER-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Live potentiometer controls a servo through the real Arduino runtime

Consolidated11, issue784, parent703/452. One TEST-ONLY missing end-to-end scenario.
Reuse accepted fixed angles, expressions, pulses544..2400, power negatives,
Stop/Run/Reset and horn clipping proofs0a51/ef7. Do not repeat those matrices.

Extend existing servo-runtime.browser.mjs with --potentiometer-only mode and
preserve all historical/default modes. One canonical powered Uno, potentiometer
and servo circuit; all wiring modeled, no fake ADC/angle/projection. Use supported
Servo library plus analogRead(A0) and computed0..180 mapping. Use one textual
program and equivalent real Blockly-generated program where supported. Three
live wiper positions (endpoints and midpoint), at1440/390. Keep program fixed
while operating actual Stage knob/control, not injecting a different source or
setting Servo angle directly. Check measured ADC, correct integer mapping,
actual PWM pulse width, servo model angle and actual rendered horn transform.
Keep physical supply/current/KCL/finite quality checks; expected midpoint derives
from actual ADC integer semantics rather than forcing90 by rounding.

Use mounted actual workbench hook/Stage and real production Worker as existing
fixture. Static/API routes are fixture ports, not installed or SaveCAS proof.
Record modeltime and walltime separately. Preserve old project/source and input
semantics; no source edits per wiper position. No new broad lifecycle matrix.

Scope ONLY existing native fixture and new evidence servo-potentiometer-784.json;
canonical generated coverage only if necessary. No product/runtime/solver/model/
UI change, no scripts/dependencies/workflows, art/protected assets/refactoring,
server/Docker/DB/ports. On reproduced defect STOP with source/timing/input/result
receipt for separate bounded repair; do not mask it by weakening assertions or
injecting model state. If Blockly lacks a required compatible connection, report
that precise gap rather than fake generated source.

Product unchanged: carry accepted source/type/build/bundle gate evidence. Run
new mode once plus formatting/lint/selected routing. Independent exact-SHA reviewer
runs unmodified new mode once, no duplicate full71task gate/build or old matrix.
One coherent candidate then STOP. This sub-slice alone does not close whole11;
multiple physical servos and long-loop acceptance remain separate if unproven.
Controller alone owns currentyaml and programme progression.
