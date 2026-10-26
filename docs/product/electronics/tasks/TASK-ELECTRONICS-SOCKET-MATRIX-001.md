---
task_id: TASK-ELECTRONICS-SOCKET-MATRIX-001
kind: repair
risk: low
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Complete socket compatibility and legacy matrix

Consolidated4/5 and narrow42. Existing67Number sockets already dynamically
accept Boolean reporters; no reimplementation. Fill real gaps: every8Boolean
socket receives numeric reporter, rejects text, and preserves expression after
save/reopen; legacy NeoPixel COUNT conversion; computed pin number/variable/math/
Boolean replacement roundtrips with IDs and restored shadow.

Expected supporting-only paths existing arduino-pin-inputs.spec.ts,
arduino-value-inputs.browser.mjs or pin-input browser fixture. Actual native
representative Boolean→TIME/FREQUENCY/ANGLE/display-value and Number→logic/while
drags on desktop/mobile; generated source and all connections/IDs preserved.
LCD/7segment size/address remain intentional dropdowns, not numeric socketbugs.
No claim unsupported random runtime is a connection defect.

Product edits require reproduced cause and controller decision first. No Arduino
runtime/compiler/capability/reference/CSS changes; no intersection with773.
Author may prepare test code while773 owns heavyCPU, but unit/native/build waits
explicit CPU handoff; never run simultaneous timing probes/gates. Focused tests,
actual actions and independent finalSHA review; no unnecessary fullgate for pure
test-only candidate. Preserve assets/deps/foreign work/server/Docker/DB and fixed
caps. One bounded candidate then STOP.
