---
task_id: TASK-ELECTRONICS-UNO-DIGITAL-PINS-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Owner23 item18: A0-A5 as digital Uno outputs

Owner explicitly selects18. Queue defines18/22 as one capability; verify all six
analog-header pins as digital outputs, plus20 independent outputs together. Main
already has A0-A5 dropdown entries and numeric14-19 mapping: establish actual
causal BEFORE before any production change. Do not redo existing support or import
historical candidates. If no defect, publish verified evidence honestly.

Allowed production only for demonstrated defects: arduino-program-runtime.ts,
arduino-model.ts, arduino-capabilities.ts in contexts/electronics/domain; existing
arduino-blocks.ts, arduino-pin-inputs.ts and production-manifest-adapter.ts in web
electronics. Supporting focused runtime/solver/Blockly tests and one actual native
Worker/browser fixture, minimal existing component-map test routing if needed.
Return cause/proposal before production edits; no refactoring or file moves.

Verify A0..A5 aliases equal numeric14..19, static dropdowns and computed variables/
expressions, pinMode OUTPUT + digitalWrite HIGH/LOW, actual physical a0..a5
terminals, independent states and no D0-D5 alias collisions. Preserve analogRead
input behavior, existing numeric and scope semantics, diagnostics and old projects.
Do not claim PWM on A0-A5; preserve correct rejection/limitations. Check invalid
pins fail closed. Respect existing Serial D0/D1 shared-pin and current constraints;
no new invented UART physics or simulated-current guarantees.

Use actual Uno+20 resistor-limited LEDs (D0-D13 and A0-A5), safe low-current loads,
golden per-pin one-hot and mixed/all-output patterns and actual solver quality.
Never invent brightness or bypass canonical solver/unsupported guards. Compare
direct and actual Worker complete states/results, sliced/serialized continuation;
Run/Stop/Reset/source changes remain safe. Desktop1440/mobile390 native Blockly
dropdown and expression insertion/generation plus saved legacy roundtrip required.
Existing diagnostics5, loops1 and inactive20 must remain intact.

Required fresh focused tests, actual Worker/native browser receipts/screenshots,
type/build/bundle and gate:electronics-m1 with NX_SKIP_NX_CACHE=true; caps remain
222000/2000000. NEW independent exact-final-SHA review. If no production changed,
source identity can support reuse of old source proof, but validate all new tests
and native fixture; do not label source-only proof full installed/SaveCAS acceptance.
Classify Windows corepack.cmd EINVAL as infrastructure; canonical Linux focused CI
if necessary, no foreign CI/test repairs. General/release/installed/owner acceptance
separate; no full C++ or full electrical UART emulation claim.

One bounded candidate, final convergence and independent review then STOP. No
solver physics changes, dependencies/workflows, owner assets, schema changes,
server/Docker/liveDB/deployment or foreign edits. User defers refactoring/hygiene;
respect fixed bundle budgets and preserve all previous candidates.
