---
task_id: TASK-ELECTRONICS-ARDUINO-CHECK-MESSAGES-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Concrete Arduino check results and command notes

Issue [863](https://github.com/spikeal8-maker/asa-lab/issues/863), a bounded
follow-up to remaining-plan point 5 and the owner's explicit request for clear
descriptions without educational or vague model-limit language. Execution
selection and status belong only in `docs/execution/current.yaml`.

`ArduinoCodePanel.checkProgram()` still reports that code executes with N model
limitations. Its diagnostic header/body also announce simplified execution or
generic restrictions. These aggregate statements do not explain the command and
can make a working loop or Servo program appear broken.

## Scope

Replace vague aggregate wording with clear check results, blocking diagnostics
and nonblocking notes. Keep unsupported operations decisively blocked and retain
the detailed per-command list and source-line navigation. Do not advertise a
full Arduino C++ compiler or promise execution of unsupported commands.

Review the user-facing strings in `arduino-capabilities.ts` that feed this list
and command help. Correct stale or technical copy about the already verified
loop, Servo, tone and Serial behavior with brief plain Russian descriptions.
Keep genuine, concrete distinctions understandable, such as averaged PWM or
unsupported UART bit signals. Do not silently hide a real unsupported feature.

This is a text/presentation change. Preserve every support status, diagnostic
code, severity, start/length/line/column, admission rule, runtime capability,
generated C++, numerical result and physical timing. Do not change feature
classification, activate grey blocks, implement additional language features or
resume the paused generic CI-repair task. Do not add a blanket claim that all
C++ syntax works. A real constraint may remain specific; a generic phrase about
model limitations must not substitute for an explanation.

Expected production boundary: `ArduinoCodePanel.tsx` and the relevant message
strings in `arduino-capabilities.ts`, plus their focused tests and native harness.
No extraction, unrelated cleanup, font/layout redesign, cap increase, server,
Docker, live database, deployment or foreign changes.

## Evidence

Publish a before artifact for representative diagnostic structures and concrete
UI results before edits: supported code, valid nonblocking notes, unsupported
calls, syntax errors and line-navigation cases. Include loops, Servo, tone/PWM,
Serial, time queries and increment expressions. Afterward all non-message fields
must match exactly; any public diagnostic-text changes must be enumerated.

Actual native desktop/mobile actions: click Check, open/collapse notes, select
an item and verify the correct source range; distinguish a runnable program from
a blocked one. Confirm editing, generated/downloaded code and source text remain
unchanged. Check that the panel fits and messages are literal safe text.

The raw Arduino entry has only 19 bytes of headroom on the observed baseline.
Check the candidate build and all fixed caps before the broad gate; preserve
meaning rather than introducing unrelated size cleanup. Then freeze, one
uncached canonical electronics gate and a new independent exact-SHA review.
Retain original failures and evidence, with no installed/owner acceptance claim.
