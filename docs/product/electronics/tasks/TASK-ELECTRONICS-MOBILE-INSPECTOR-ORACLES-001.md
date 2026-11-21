---
task_id: TASK-ELECTRONICS-MOBILE-INSPECTOR-ORACLES-001
kind: repair
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Check the mobile inspector in its visible state

The compact inspector geometry test counts the hidden touch disclosure as
an overflowing control when a mouse is used at a narrow viewport. Measure
every rendered control. Keep the inspector size, input usability, and
Escape assertions.

The touch mirror matrix selects the generator and then reads its hidden
fields. Assert that selection leaves the touch inspector collapsed, tap
the disclosure, and verify the existing field edits, readouts, save and
reopen. Keep the original mirror checks, native actions and save ledger.
The scope covers the existing browser tests and their generated evidence
digest. Check the actual inspector with Chromium mouse and touch inputs.
