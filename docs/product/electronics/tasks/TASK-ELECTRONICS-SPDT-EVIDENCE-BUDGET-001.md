---
task_id: TASK-ELECTRONICS-SPDT-EVIDENCE-BUDGET-001
kind: repair
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Separate SPDT diagnostic collection from the browser assertions

The 1024 px dark scenario completed the switch states, explicit save,
and clean-context reopen in the traced run. Serializing the full original
browser probe in the test body crossed the 30 second deadline before
the final diagnostic read.

Write the full probe, document receipt, and final screenshot in the
test's teardown hook. Reuse the last verified server read when available
and keep the original error if diagnostic collection also fails.
Keep all existing assertions, evidence fields, and test timeouts.
Verify the 1024 px dark and light scenarios in Chromium.
