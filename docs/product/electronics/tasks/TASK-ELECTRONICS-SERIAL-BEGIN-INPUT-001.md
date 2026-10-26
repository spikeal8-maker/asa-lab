---
task_id: TASK-ELECTRONICS-SERIAL-BEGIN-INPUT-001
kind: implementation
risk: medium
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Preserve input until the Arduino serial port is ready

Consolidated19, issue782, parent703/452. One bounded UI repair only.
Read-only cause: monitor permits Send/Enter with running=true before begin and
clears input, while scheduler/runtime correctly reject RX until Serial.begin.
First actual BEFORE with real Worker/controller/monitor must reproduce lost A.

Modify only ArduinoSerialMonitor.tsx plus existing arduino-serial-monitor.spec.ts
and arduino-analog-serial.browser.mjs evidence. Send button AND submit handler
must require running AND serial.begun; input text must survive unavailable sends.
Keep status accurate, no local echo, existing board routing, clear generation,
Stop/Run/Reset semantics. After begin, submit A exactly once and show actual65
from Serial.read. Test undefined serial, waiting, stopped and connected, button
and Enter, both1440/390. Do not disable typing unnecessarily while waiting.
No queue/clock/runtime/scheduler/controller semantics, broad refactoring or
unrelated corrections. If BEFORE does not reproduce, report evidence and STOP.

Use narrow existing focused tests first, actual native BEFORE/AFTER, then ONE
final pnpm gate:electronics-m1 with NX_SKIP_NX_CACHE=true and bundle:check.
Fixed editor222000 and Arduino2000000 byte caps cannot change. Reuse a single
local connected predicate where needed within this small UI repair; no cleanup
elsewhere. No repeated microbuild loop; if over cap report exact measure for
controller decision. Format changed files before publication, avoiding777 CI
format omission. Independent reviewer verifies exact final SHA with targeted
unit/native checks, not a duplicate full gate. Record fresh Nx task count.

Source integration does not close whole19; no installed/SaveCAS/owner/release
claim. No server/Docker/DB/listening ports or foreign changes. Executor stops
after one published coherent candidate; controller continues programme.
