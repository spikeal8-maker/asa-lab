---
task_id: TASK-ELECTRONICS-BLOCK-AUTO-WAIT-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Explicit automatic 10 ms wait for new Blockly programs

Issue [864](https://github.com/spikeal8-maker/asa-lab/issues/864), remaining-plan
point 7, old point 22. The owner answered the product question on 30 October:
**10 ms for new programs/projects; old projects retain their code and timings
until explicit enable.** Execution selection and status belong only in
`docs/execution/current.yaml`.

## Behavior

Automatic waiting is a visible code-generation policy, not an engine timing
shortcut. New Blockly programs enable 10 ms by default. Existing saved programs
without the policy remain legacy/off; loading, opening the code pane, changing
views or reopening must not silently activate it or add waits. An explicit
program-scoped control enables it for an existing program and can disable it.
Policy choice persists consistently with its generated source.

For an affected executable cyclic body with no active user-authored wait, emit
one real `delay(10)` at the repetition boundary. Include the ordinary `loop`
body and supported forever/while/for/repeat bodies; an outer-loop-only suffix
does not cover an inner `while(true)`. Preserve statement ordering and existing
control-flow semantics. Repeated edits/generation must not accumulate delays.

Use the actual active execution graph: setup-only waits and detached inactive
stacks must not suppress loop compensation; free stacks remain the existing
fallback loop when both hats are absent. An active user `asa_wait` in any of its
three units, including a conditional branch or an explicit zero, suppresses the
automatic wait for the containing body. `asa_play_note` also supplies an explicit
blocking wait. A nonblocking tone and internal ultrasonic helper 2/10us waits do
not. Automatically produced waits are not user waits. Do not change unrelated
disabled/grey-block behavior. Define and report the concrete nested-body rule
before implementation; do not infer waiting by searching the whole C++ string.

Show a short, plain indication in Blocks mode that the 10 ms policy is active.
Displayed C++, downloaded `.ino`, saved source and executed source must agree.
Text-only user C++ is not transformed. SourceLine/Code mode controls and existing
editing behavior remain available. Do not create an invisible host/runtime delay
or multiply clocks; ordinary `delay`, `millis`, PWM and physical event ordering
continue to follow the actual generated C++.

## Compatibility and source boundary

The current workspace mount calls `publish()` immediately and regenerates source.
A blanket new default would silently retime old projects. Establish explicit
legacy/new policy provenance rather than guessing from the current date or
silently applying a new factory default during old-document normalization.
Preserve old-program before/after source/XML/behavior and absent policy on a
no-edit load. If an existing source-overwrite defect is independently reproduced,
report that cause and a bounded dependency instead of concealing it.

Inspect actual program persistence, creation and workspace callbacks, then
report a concrete small implementation plan before product edits. New cohesive
logic is allowed; moving old functions or adding dummy imports merely to change
chunk placement is not. A controller-only source patch is invalid because local
display/download uses `program.source`. Keep this Arduino `scratch-blocks` editor
separate from the portal's standalone Scratch product.

Candidate-build and all fixed caps first: observed Arduino entry is
1,999,925/2,000,000 raw bytes and editor 187,873/222,000. A cap failure is a real
constraint, not permission for unrelated cleanup, size-budget changes or hidden
semantic shortcuts. No server, Docker, working database, deployment, protected
asset edits or foreign changes.

## Evidence

Publish BEFORE fixtures/oracles before code edits. Include old saved Blockly
programs, source and XML, hats/free stacks, setup versus loop, nested forever,
while/for/repeat, conditional wait, all units, zero, play-note and ultrasonic.
Legacy/off source and behavior must remain exact. New policy source must contain
the intended waits; compare actual execution to the same explicit C++ reference.
Add/remove user waits, enable/disable, Undo/Redo, edit, mode switch, export,
save/reopen and repeated generation must remain consistent and nonduplicating.

Use genuine native Blockly actions and production Worker/LED/Serial at 1440/390;
measure logical time and actual source, not only a label. Preserve responsiveness
through existing execution budgets; do not mask the separate slow-engine problem.
Then freeze, run one uncached canonical electronics gate, all fixed caps and a
new independent exact-SHA review. Preserve every failed attempt and candidate.
