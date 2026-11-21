---
task_id: TASK-ELECTRONICS-20LED-SUSTAINED-001
kind: implementation
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Sustained twenty-LED Uno qualification

Consolidated25, issue783, parent703/452. TEST ONLY missing long-run acceptance.
Accepted bd726a0e already proves twenty real1kOhm resistor/LED loads, all pins,
24 one-hot/mixed patterns, currents, direct/Worker/JSON parity and native1440/390
at20000us. Carry that unchanged-source evidence; do not repeat its broad matrix.

Extend existing uno-digital-pins.browser.mjs with separate --sustained-only mode,
using the same canonical fixture and actual production Worker. Preserve existing
modes. Target10000000us (10s MODEL time), multiple periodic complementary20pin
patterns (250ms half-period is sufficient), exact state/current/quality/finite
checks at each checkpoint, continuation after JSON copy, repeatability and safe
Stop/Reset. Existing generatedCpp path can be reused; do not invent weaker
handmade electrical topology. Record walltime separately; no realtime claim.
Do not keep large repetitive receipts; hash full results and retain representative
checkpoints/complete terminal states and summary counts sufficient to audit.

First bounded timing checkpoint (not a full broad BEFORE repeat) must establish
whether the target fits existing Worker deadlines. Do not raise30s request limits,
whole-run test timeouts or skip electrothermal steps. At a demonstrated runtime
blocker STOP with actual model/wall progress; no physics or performance repair in
this slice. Avoid a second huge run without a new hypothesis.

Write scope only existing native fixture and new evidence20led-sustained-783.json.
Generated component coverage only if canonical generator explicitly requires it.
No product/runtime/solver/clock/scheduler/thermal code, new dependency/workflow,
refactoring, cap increase, protected assets, server/Docker/DB/listening ports.
Product/source is unchanged: carry prior71task gate/type/build/bundle evidence,
run targeted fixture, formatting and routing checks only; no duplicate full gate
or build. Independent exact-SHA reviewer validates fixture assertions and actual
production Worker sustained mode once. Distinguish10s scope from indefinite or
hardware qualification. Old digital and analog behaviors must remain unchanged.

Executor publishes one test-only candidate and stops. Controller owns currentyaml
and source-status decision after independent review. Installed/SaveCAS/owner and
whole-repository CI acceptance are separate. No source patch to hide a test fail.
