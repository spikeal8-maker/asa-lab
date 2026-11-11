---
task_id: TASK-ELECTRONICS-STRICT-RUNTIME-THROUGHPUT-001
kind: repair
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Restore Arduino model-time throughput for stable loops

The strict browser run recorded about 1.85 s of wall/model drift in the
no-delay and Reset scenarios and timed out waiting for model time in the
1 ms and independent millis scenarios. Repair the calculation path behind
electronics.arduino.runtime. Keep visual phase delivery and Blockly native
controls as separate concerns.

Inspect the two private Worker stable-loop changes in PR #1072. Admit only
already-latched literal writes and proven unchanged iterations within the
same absolute millisecond. Preserve all existing physical and input
boundaries, partial instruction execution, explicit budgets, runtime
continuation, GPIO and Serial order, and validation thresholds. Review
the exact source-size evidence for any required hygiene baseline update.

Require full-result and continuation parity across the touched scheduler and
engine paths, adversarial input and explicit-budget tests, and independent
final-SHA review. In Chromium compare the no-delay, 1 ms, independent millis
and Reset journeys against their original wall/model thresholds. Check the
50 and 100 ms scenarios for regression. Run the focused and required
repository checks before integration and report the actual full strict
result separately.
