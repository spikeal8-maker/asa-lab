---
task_id: TASK-ELECTRONICS-RECOVERY-R22-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# R22 — render Serial TX as a text stream

Issue [#1180](https://github.com/spikeal8-maker/asa-lab/issues/1180), programme
[#452](https://github.com/spikeal8-maker/asa-lab/issues/452). The owner authorized
early start of this bounded UI slice on 2026-11-15 while PR #1163 waits on HOLD.
The accepted selection in `docs/execution/current.yaml` authorizes the work.
Formal R10–R12 and AC-04 requirements still apply to programme acceptance.

## Result and scope

Consecutive `Serial.print` and `Serial.println` fragments render on the same line
until the stream contains a newline. The suspected defect is that the monitor
renders each TX entry as a block. Reproduce it in Chromium before editing.
If the defect does not reproduce, report the result and stop.

Components: `electronics.peripheral.serial` and `electronics.ui.workbench`.
Read `contexts/electronics/domain/arduino-serial-runtime.ts` and
`contexts/electronics/testing/arduino-serial-runtime.spec.ts` for the existing
stream contract. Read the monitor, its tests and the existing browser harness
listed below.

Exact author write paths:

- `apps/web/src/electronics/ArduinoSerialMonitor.tsx`
- `apps/web/src/electronics/testing/arduino-serial-monitor.spec.ts`
- `apps/web/src/electronics/testing/arduino-analog-serial.browser.mjs`

Preserve TX order and buffer limits, text escaping, autoscroll, port status,
RX and absence of local echo. Keep Clear, Stop/Start/Reset, monitor reopen,
program changes and board switching under the existing generation contract.
The runtime, Worker, timing, physics, R4 workflows, PR #1163 and production
data are outside the author scope. If proof needs another write path, return
the exact reason to the controller before editing it.

## Evidence and stop

- From fresh accepted main, check all planned paths in scoped preflight and
  inspect active PRs before editing. The controller assigns one author.
- Record native before and after using real Worker-to-monitor output and
  text geometry. Exercise `print(12); println(34); println();` and
  `print("hello"); println("world");` in one sketch, plus trailing partial,
  long and multiline output. Expect `1234`, one blank line and `helloworld`
  without extra line breaks. Check Clear mid-line, generation changes, two
  Uno boards, RX, and project reopen with the sketch bytes intact.
- Exercise viewports 1440/1024/390/320. Capture before/after at least at
  1440/390. Record what infrastructure the evidence actually covers.
- Run targeted tests, formatting and types, uncached `gate:electronics-m1`,
  unchanged `bundle:check`, applicable CI and independent review on the
  frozen SHA. Treat failures outside the slice under AGENTS §2.1.
- Return one reviewed candidate or a proven clean baseline to the controller.
  Report exact SHA, browser evidence and actual status. Integration requires
  the applicable repository checks and owner authorization. Stop at handoff.
