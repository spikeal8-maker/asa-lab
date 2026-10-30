# Issue 864 BEFORE compatibility evidence

Baseline: `e323f35c6e287c97e4bd40d1e768f3eeb4c6db05`.
No production code was changed for this proof. No server, database, Docker,
ports or runtime clocks were used or changed.

Command: `node apps/web/src/electronics/testing/arduino-auto-wait-before.browser.mjs`.
The native Chromium fixture bundles the actual React ArduinoCodePanel and
scratch-blocks. HTTP requests are fulfilled in memory; the fixture supplies the
same parent sizing variables as the existing editor evidence scripts.

Result: 16 Blockly before oracles; 6 actual editor mounts (1440/390).
Every mount changed the saved source and workspace without a user edit.
All 6 had no page errors, and the policy remained absent.

`oracles.json` preserves original generated source, serialized workspace and XML
for setup/loop, free stacks, detached wait, forever, while, for, repeat,
conditional wait, all three wait units, explicit zero, play-note, tone,
ultrasonic and empty workspace. Repeated generation was identical in all cases.
`legacy-mount-receipts.json` preserves complete before/after properties and exact
source/workspace comparisons for valid saved hats, empty and corrupt workspace.
The stored source has an owner comment and CRLF before valid generated C++.
Removing that comment on open is a source-preservation failure even though its
execution timing is unchanged. Empty/corrupt stored workspaces additionally
become default Blink. Screenshots show the actual native editor for each mount.

Cause: ScratchWorkspace calls publish unconditionally on mount, which invokes
generateArduinoCode and the real panel persistence callback. The loaded check
also treats an empty valid workspace as not loaded. Layout adjustment and
number-field normalization change serialized valid workspace bytes on open.

This independently confirms the task card's existing source-overwrite dependency.
The automatic wait implementation has not started. A bounded compatibility
repair must preserve saved source/raw workspace and absent policy on no-edit
open, including code-pane/mode reopen, before automatic waiting can be accepted.
Corrupt state should not silently become a persisted replacement sketch.

Proposed automatic policy (reported to controller before product edits):
optional arduinoAutoWaitMs=10 or 0, absent legacy stays absent/off, new board
creation explicitly seeds 10; never infer new from missing metadata or dates.
Each connected executable cyclic body gets a real delay(10) suffix only when
that body has no user asa_wait or asa_play_note in its descendants. A conditional
or nested user wait counts statically, including zero. Automatically produced
waits never count as user waits, so parent and inner eligible bodies both get a
suffix. Nested forever/while/for/repeat are independently evaluated. Setup itself
has no suffix; setup waits and inactive detached stacks cannot suppress loop
compensation. Free-stack fallback remains the existing active graph behavior.
Synthetic for/repeat conditions must receive a suffix only in the successful
iteration body, preserving input evaluation and increment/refresh order.
The Blocks control must regenerate/persist the actual local source and policy
atomically, including pending debounce, Save and mode switching. Text C++ stays
untouched. A candidate build and all eight existing caps precede broad gates.

Validation: native proof PASS as a baseline reproduction; targeted script ESLint
and Prettier PASS. Initial ESLint found only a missing node:process import in this
new test script; fixed before publication. The first native screenshot inspection
showed incomplete fixture parent geometry; corrected fixture sizing and repeated
the same baseline proof, again 16 oracles/6 overwrites. No product workaround.
Worker/time equivalence is NOT_RUN; automatic policy candidate is NOT_STARTED.
