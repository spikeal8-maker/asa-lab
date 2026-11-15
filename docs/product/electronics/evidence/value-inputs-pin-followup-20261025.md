# Arduino pin/value editor follow-up — 25 October 2026

This follows the independently approved local value-input candidate 7cd0efdc.
The earlier value-inputs-20261025.md describes that historical scope. The owner
now explicitly includes replaceable pin dropdowns, A0–A5 digital GPIO, mixed
numeric/Boolean connections, palette access, mobile sizing and educational help.

Digital pin shadows list D0–D13 followed by A0–A5. Analog input and hardware PWM
menus retain their actual restrictions. Removing a replacement expression restores
the chosen dropdown value. Old scalar pin fields migrate idempotently; variable
identity and existing connections survive serialization. Computed output pins are
sampled when the command executes. Native Servo dispatch shares fixed/dynamic pin
objects and reserves names against pupil variables. Gray LCD/NeoPixel blocks export
computed wiring without claiming new simulation support.

Production changes are limited to the seven justified editor/runtime prerequisite
paths in the task card. Servo syntax validation no longer mutates attachment state;
actual execution still rejects duplicate attachment. Global scanning retains the
first scalar after a supported include. No solver equation, physical clock,
network, database, deployment, artwork or foreign worktree change was made.

Source-frozen component evidence:

- Pin/value regression: 35 tests passed, including all twenty digital outputs
  driving separate resistor/LED branches, computed variable pins, Servo alias
  sharing, loop reevaluation, saved A5 shadow restoration and peripheral names.
- Legacy Chromium runner: 22 old-project cases retain byte-exact generated code;
  32 native reporter drags and save/reopen checks passed at 1440/1024/390/320.
- Real React ScratchWorkspace Chromium runner: 52 checks passed at Full HD
  100/110%, 1440/1024/390/320. Native wheel/touch and arrow scrolling reach the
  final items in all categories. Native pin menus expose all 20 options, use
  compact desktop rows and larger touch targets, accept round/Boolean native
  drags and restore A5 after removing the replacement. No server, ports or DB.
- Scoped ESLint, control-plane and Electronics source routing validation passed.

The complete focused gate and independent review are recorded against the final
converged SHA in the local final report; this evidence file alone is not a release
or owner acceptance claim. Full deployed browser journey, PostgreSQL repository
gate, actual AVR/library compilation and deployment were not run or requested.

SELF_REVIEW: PASS_WITH_RISK
components: ui-assets-persistence, arduino-peripherals
scope: owner-requested expression/pin connections and editor presentation
acceptance: component regressions above; final gate/review required
unrequested_changes: none
routing_docs: updated; arduino-blocks normalized LF size reviewed at 65021 bytes
residual_risk: gray peripheral code has no new virtual model; AVR build not run;
  no deployed save journey or owner acceptance claimed
NEXT_ALLOWED_TASK: STOP

The first independent review of a773d036 returned FAIL for a reserved Servo
read reference, missing prepared bindings in Serial/LCD/RGB output and eager
computed Servo reads in repeat/for bounds. The bounded repair reserves fixed
read references consistently, propagates prepared bindings and evaluates FROM
once, TO/COUNT before each body and STEP after the body. Seven added regression
cases cover these defects; the earlier 43 expression tests remain green. Literal
loop source is retained. A new exact-SHA gate and independent review are required.
