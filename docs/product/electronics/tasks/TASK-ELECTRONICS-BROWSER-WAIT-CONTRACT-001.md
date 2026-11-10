---
task_id: TASK-ELECTRONICS-BROWSER-WAIT-CONTRACT-001
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Wait for the observed editor state in Electronics browser tests

Repair two browser waits identified in the strict run 42791042545.

- E11 at 320 px, related to #549. On reopen wait for the editor
  navigation to commit and the existing exact project response to
  resolve. Keep the pre-app storage witness and the draft, revision,
  pointer, and editor assertions. External SDK load is independent of
  project reopen.
- Long Arduino delays, related to #682. Wait for the first acknowledged
  ready horizon crossing and the corresponding visible final LOW
  within the existing 22-second budget. Keep the original electrical
  edge, timing, persistence, and witness assertions.

Only change `e2e/electronics-selection-outline.spec.ts` and
`e2e/electronics-interactions.spec.ts`. Keep product code, deadlines,
timing tolerances, and runner configuration intact. Verify both cases
in Chromium and review the final source before integration.
