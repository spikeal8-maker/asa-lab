---
task_id: TASK-ELECTRONICS-VALUE-INPUTS-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Arduino expression sockets and saved-workspace compatibility

Owner-selected bounded repair of `electronics.ui.arduino-editor` (ASA ownership).
Replace literal-only numeric/text/level arguments with genuine Scratch value
connections; retain identifiers, hardware configuration and comment fields.
Numeric and text reporters/sockets are round; Boolean shapes remain hexagonal.
Preserve generated source for literal legacy projects and retain nested reporters,
variable identity, IDs and next/statement connections through save/load.

Read: `../components/ui-assets-persistence.yaml`, README §15.4–15.5,
`../AGENT_GUIDE.md` §§2,5,11–13 and the engineering hygiene contract/baseline.

Production write budget: `apps/web/src/electronics/arduino-blocks.ts` and only
directly required editor integration. Tests: dedicated value-input regression,
existing code-contract and Servo fixture adaptation, plus the browser component
runner (four test files justified by the literal API change and real native drag
and byte-exact old-source comparison). Routing adds the new regressions to the
existing component. No solver, runtime, capabilities, network, deployment,
database, workflow, owner artwork or unrelated UI changes.

The existing arduino-blocks source crosses the 50,000-byte review threshold.
This slice includes its bounded responsibility/size review in the hygiene
baseline and adds its existing top-level symbols to the component route.
Keep definitions, shadows, compatibility migration and generation cohesive;
do not split by line count or reset the full hygiene checkpoint. Independent
review must verify this rationale and the normalized LF byte count.

Acceptance: every converted socket accepts a variable and nested math; text
output accepts text and numeric reporters; literal defaults remain editable;
old field-based projects migrate without losing values; repeat migration is
idempotent; save/reopen preserves code and connections. Run focused regressions,
typecheck/build and `pnpm gate:electronics-m1` without Nx cache. Browser proof
must use genuine Scratch rendering and gestures; do not equate headless
connection tests with browser drag evidence. Independent review is required
before technical acceptance of compatibility changes. Stop after this repair.

## Owner follow-up: pins, mixed numeric/Boolean values and palette usability

Owner explicitly extends the same editor concern: pin selectors must accept
numbers, variables and expressions; numeric and logical reporters must connect
where Arduino can convert their values; retain editable compact pin choices.
Fix vertical access to every data/variable palette item at Full HD 100–110%
and narrow/mobile sizes. Replace support-status hover prose with short Russian
educational descriptions for every block, retaining gray unsupported coloring
and truthful code-check diagnostics. Do not upgrade peripheral capabilities.

Additional justified production paths: ArduinoCodePanel.tsx, workbench.css,
a cohesive arduino-block-ui.ts for workspace presentation/checker setup and
contexts/electronics/domain/arduino-capabilities.ts only for internal pin
reporter registration. Existing registry/persistence compatibility is mandatory.
The sixth production file, arduino-pin-inputs.ts, owns pin option/default metadata
and lazy native Servo dispatch generation; this isolates the new pin concern
instead of growing the existing large block-definition/generator hotspot.
The owner's further clarification explicitly includes A0–A5 after D0–D13 for
digital GPIO. Existing domain pin mapping already supports aliases 14–19;
prove all twenty outputs electrically without widening PWM capabilities.
Computed Servo pins expose a direct prerequisite defect: syntax-only validation
currently attaches/mutates every Servo branch, including branches that will not
execute, and rejects valid computed-pin dispatch as a duplicate pin. Include a
bounded seventh production path, arduino-program-runtime.ts, only to keep Servo
validation side-effect free while retaining argument/type/pin validation and real
execution checks. This is a direct editor-expression prerequisite, not general
function/runtime/clock/peripheral expansion; independent HIGH review is required.
The same prerequisite retains the first numeric declaration after the supported
Servo include. Strip the directive from global declaration scanning, preserving
original line lookup and literal generated source rather than reordering pupils'
program declarations. Add explicit regression coverage for this generated case.
Pin expressions must be sampled at the command's execution point, not frozen
by setup-time pin scanning; preserve literal legacy source where applicable.
Tests cover native Boolean/number/pin connections, dynamic GPIO execution,
legacy pin-field migration, native palette wheel/touch/scrollbar access and
compact pointer menus at 1440/1024/390/320 and Full HD 100–110%.

Computed LCD wiring defers construction until pin values exist, then uses the
library's public init API; it must not transiently configure six dummy GPIO0
pins. Computed NeoPixel wiring uses setPin/updateLength rather than copying an
owning buffer object. Reserve peripheral object names against pupil variables.
These gray peripherals remain code-export features, not newly simulated models.
The existing ultrasonic source-contract test changes only its argument helper
assertion after PIN becomes a value socket; its helper-body oracle is retained.
