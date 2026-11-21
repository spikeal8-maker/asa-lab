# Arduino void helpers: immutable BEFORE

Baseline `00301affb4a66e2e19ee706cdb25b91294b987be`.
Runtime source SHA-256 `30bcf134226c1f7abdc6c1a068b6822f4f0a0f0bf8231383d5a6141962beda16`.

Twenty legacy programs, full compiler before/after execution, every serialized
advance/state/action/event/diagnostic across instruction budgets 1/2/7 and legacy
millisecond ticks. Includes scalar loops/conditionals/random, numeric macros,
quoted braces/question marks, Servo and the exact generated ultrasonic adapter.
Raw JSON: 467942 bytes, SHA-256
`ce74d3a60b5897782a081a0da2f4b2998d204795dfd899a1dfb3e23d4a2924e2`.
The in-memory wrapper exposes the private compiler without modifying product code.

`builtin-body-before.json.gz` separately captures the existing admission defect:
an arbitrary conflicting readUltrasonicCm body is ignored while the intrinsic
executes. This intentionally repaired admission case is NOT silently removed
from the legacy oracle. It is explicitly separate from valid legacy behavior.

This checkpoint is evidence preservation, not a source candidate or feature PASS.
