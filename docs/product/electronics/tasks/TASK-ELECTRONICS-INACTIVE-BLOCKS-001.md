---
task_id: TASK-ELECTRONICS-INACTIVE-BLOCKS-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Owner23 item20: disconnected Blockly trees are inactive

Implement the requested behavior, without refactoring, moving existing functions
or decomposing files. Existing variable/expression/pin sockets and legacy saves
from4cf remain intact. No new architecture or unrelated cleanup.

Production scope: arduino-blocks.ts, arduino-pin-inputs.ts, ArduinoCodePanel.tsx
under apps/web/src/electronics. Supporting scope: focused generator/pin/panel
tests, one actual Blockly native fixture and component test routing. Add only
feature-essential logic to existing files; no generic utility framework.

With setup/loop roots, only selected existing roots and connected statement,
next and value descendants affect generated statements AND globals, pinMode,
Servo/LCD/I2C/Serial/NeoPixel helpers, variable/helper naming. Keep current
first-root selection deterministic. Without roots, the queue's agreed fallback
emits top-level statement chains in loop; unused standalone reporters stay unused.
Adding/moving/renaming a detached tree must leave active code byte-identical.
Shared variable renames actually referenced by active code remain meaningful.

Dim inactive blocks with transient presentation only. Do not delete or disable
persisted blocks, mutate variables/IDs, add Undo entries or autosave noise.
Reconnect restores normal presentation/code; preserve complete workspace data.
Do not use appearance as generation authority. Source inventory found global
scans also in workspaceIdentifier, dynamicLcd and fixedArduinoServoPins: cover
those dependencies consistently, not just generateArduinoCode.allBlocks.

Preserve source701 message initialization already in main, all foreign changes,
timing/solver/Worker behavior and all budgets (editor222000, Arduino2000000).
Keep changes inside the existing lazy Arduino graph. No other product, API,
schema/dependency/workflow/asset/server/Docker/live DB change; no refactoring.

Verify roots both/one/neither; detached statements/reporters/nesting and globals;
pins/Servo/LCD/I2C/naming conflicts; numeric+Boolean sockets. Native actual
Blockly1440/390/320 detach/reconnect, root changes, Undo/Redo, mode switch,
legacy save/reopen with complete IDs/data. Fixture save is not server SaveCAS.
Scoped tests plus fresh uncached gate:electronics-m1, actual bundle checks and
NEW independent exact-SHA source/UI review are required. Whole General/release,
installed and owner acceptance stay separate; classify foreign failures, never
repair other modules or chase their CI in this task.

One bounded implementation/candidate/self-review then STOP. Controller handles
source integration and selects the next item. Unknown behavior/real overlap stops
only the affected action; report concrete evidence rather than inventing output.
