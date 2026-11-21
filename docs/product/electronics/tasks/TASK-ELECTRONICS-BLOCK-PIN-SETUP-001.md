---
task_id: TASK-ELECTRONICS-BLOCK-PIN-SETUP-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Generated Arduino pin initialization belongs in setup

Issue [944](https://github.com/spikeal8-maker/asa-lab/issues/944). The owner
urgently prioritises this defect over the remaining timing programme. State lives
only in current.yaml. Existing toolbar qualification may finish independently.

## Actual owner reproduction

Public project 7ad29bb5-d39c-437e-b38d-d0a06ff6ef9a, immutable revision
dc6cd288-1334-429e-95be-d9edd952b86a. The public electronics artifact contains
Arduino stateProperties.arduinoBlocks and arduinoSource. Preserve the owner
project; read-only intake is retained in OS-temp asa-public-pinmode-7ad29bb5.
The actual nested loops write x, x-1, 11-x and 12-x, reset variables and run
multiple effects. The reached output union is 0..11, not merely wired LEDs1..10.
Do not silently correct the owner's algorithm or infer GPIO solely from wiring.

outputPinStatement currently emits an asaOutputPin temporary and pinMode before
each computed write; setup's digitalPins scan admits literals only. RGB and the
explicit ultrasonic helper modes also require inspection.

## Bounded repair

Owner explicitly chose the dynamic-pin policy: initialise all available board GPIO
as OUTPUT, except pins configured/used as inputs for buttons and sensors. This
supersedes the earlier pending-policy analysis: no full range/control-flow
analyser is needed. Apply that setup-only policy to generated block programs,
using the canonical board pin catalogue and activeArduinoGraph including fallback
and excluding inactive blocks. Preserve input-only ports, analog inputs, UART
requirements where applicable and numeric conversion/single evaluation of pin
expressions. Emit deduplicated explicit modes in setup and simple commands such
as digitalWrite(x, HIGH) without repetitive asaOutputPin braces or loop pinMode.

Do not set every output HIGH: OUTPUT configures direction, and each block still
controls its voltage. Do not move a runtime pin expression before its assignments.
Inspect RGB/PWM/tone and explicit ultrasonic helper modes too. Preserve the actual
owner algorithm, saved blocks/wires and user-authored text verbatim. The guarantee
concerns explicitly generated pinMode, not Arduino library internals. If an input
role cannot be resolved safely, report that specific gap before inventing a mode.

Paths: arduino-blocks.ts, one optional narrowly scoped arduino-output-pins.ts role helper,
existing arduino-pin-inputs.spec.ts and focused arduino-output-pins.spec.ts plus
an owner-derived block fixture under electronics/testing/fixtures. Paths are under
apps/web/src/electronics. Update only relevant subsystem source/test mapping and
canonical generated coverage fields when required. Root owns execution metadata.
No general refactor, interpreter/scheduler/clock changes, library internals,
dependencies/workflows, server, Docker, live DB, protected assets or foreign edits.

## Evidence

Exact owner blocks regenerate simple source with setup output modes for all
canonical GPIO (except inputs), no explicit pinMode in loop and unchanged effects. Verify literal and computed ports, A0-A5, RGB/PWM, branch and loop
unions, variable reassignment, numeric truncation, input-only roles, inactive and
fallback graphs, side-effecting reporters and runtime-dependent ports under the owner policy. Old block
save/load remains lossless; user text stays verbatim. Use focused unit/runtime
checks first, then one exact-source focused gate and actual browser fixture in
isolated CI. Independent source and actual-evidence review before integration.
Do not claim all programme completion or deployment.

## Owner-approved explicit input list

The owner subsequently approved an explicit list of input ports in Arduino
settings for cases such as digitalRead(x). Add a persisted per-board
arduinoInputPins string array, using the existing ProductionStateValue contract.
The generator accepts that list alongside inferred unambiguous input roles;
unknown computed input reads rely on the declared list without inventing modes
or adding a new generation rejection. Keep inferred and manually selected roles
clear in the UI. Input priority preserves buttons and analog sensors.

Additional causal paths: ArduinoCodePanel.tsx, arduino-program-state.ts,
workbench.css only for scoped settings presentation, testing/arduino-program-state.spec.ts,
testing/arduino-inactive-blocks.spec.ts and a focused native settings fixture
under electronics/testing. Root may later select a separate full browser journey.
No domain/schema migration or controller change is needed for this string array.
Keep the existing top toolbar and Code controls fitted on desktop/mobile.
Settings, generated source and block document persist atomically; changing ports
must not reload/reset the live workspace. Board switching, undo/redo and old
projects preserve their data, while user-authored text stays byte-for-byte intact.
Adapt only the obsolete inactive-test assumption that empty generated setup has
no default pin directions; retain every actual inactive-block exclusion assertion.

## Selected full browser acceptance

The source candidate now requires the planned actual isolated-CI journey, not
another local app deployment. A new bounded test author may add
 e2e/electronics-block-pin-setup.spec.ts and the relevant subsystem test mapping
with canonical generated output only if required. Use existing real login/seed,
project API, editor, simulation and Save/reopen helpers/patterns; no route mocks
for product behavior. Desktop1536x864 and mobile390x844 cover the exact owner
blocks, setup-only modes, per-board explicit inputs, Apply/Cancel/Escape, literal
and calculated ports, real generated source, immediate Save/reopen and whole
blocks/source/config equality, undo/redo, text byte preservation, keyboard/native
hit/scrolling and no lost controls. Keep the source candidate byte-exact; test
author reports a product defect instead of changing it. Reuse the existing owner
fixture; do not repeatedly download it or change owner data. No retries, added
product deadlines, server, Docker Desktop or foreign changes. Temporary scoped
CI transport/runner stays outside main and receives its own review.
