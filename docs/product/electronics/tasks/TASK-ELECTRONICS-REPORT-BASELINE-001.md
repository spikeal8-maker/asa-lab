---
task_id: TASK-ELECTRONICS-REPORT-BASELINE-001
kind: maintenance
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Writable diagnostic reports in the isolated test runner

Selected canonical child lane `electronics-report-baseline`; independent
integration prerequisite of the owner-authorized Public Projects programme.
See `../../projects/tasks/PROJ-ELECTRONICS-REPORT-BASELINE.md` for the original
failure evidence. This card resolves the router selection mismatch without
weakening its validator or changing the active Electronics product task.

Preserve accepted Main Arduino helpers and all current matrix assertions.
The isolated read-only container exposes writable `/workspace/reports`, not
`/workspace/test-results`; an existing-image isolated probe reproduced the
exact ENOENT. Move matrix diagnostic JSON output to a suite-owned reports
directory, preserve all cases and diagnostics, and limit any setup cleanup
to that test-owned directory. No solver/runtime changes, skipped tests,
swallowed errors, dependency installation or working-server actions.

One author, focused local verification, independent exact-source review and
actual successful General gate before ordinary Main integration. Report and
STOP; controller resumes the pending publication programme.
