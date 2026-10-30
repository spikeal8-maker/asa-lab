---
task_id: TASK-ELECTRONICS-EMERGENCY-TOOLBAR-001
kind: repair
risk: medium
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Save stays reachable with emergency copy at 320 px

Issue [868](https://github.com/spikeal8-maker/asa-lab/issues/868), remaining-plan
points15/18. Execution state lives only in `docs/execution/current.yaml`.

## Proven cause and boundary

Exact source e1be12d19f8669c1145020c756551dd2188ed10f, canonical run41026543811,
E01 denied-local-storage test, error-stop phase: Save occupies x320.203125 to
362.203125 in a 320px viewport and is obstructed. Running simulation, open Code
drawer and visible emergency-copy action exhaust the nonshrinking mobile right
toolbar group. Raw `after-toolbar-error-stop.json`, PNG and trace are preserved
under executor reports/field-boundary-544-proof-41026543811/artifact/reports/
playwright/electronics-simulation-ELE-1610b-claims-a-durable-local-copy.

Earlier truthful durability assertions and emergency JSON export passed. This
is a responsive layout repair, not a persistence/data-loss/server repair. Begin
with the exact raw receipt and actual workbench.css rules; report minimal plan.

## Required behavior and proof

Keep Save, emergency copy, Run/Stop and elapsed time reachable inside the viewport
on one toolbar row. Preserve real click actions, labels/accessibility, focus and
touch targets; no clipping, hiding a required action, overlapping or horizontal
page scroll. Use existing responsive controls before adding a new product flow.
Check 320/390/1024/1440, Code open/closed, running/stopped, emergency present/absent,
and representative desktop browser/Windows125% equivalent viewport. No changes
to source fonts, block appearance, simulation, persistence or protected assets.

Reuse the published BEFORE artifact rather than rerunning full CI to reproduce.
Preserve the precise raw/PNG as durable task evidence before edits. Verify actual
native production toolbar geometry/actions for combinations above; an isolated
fixture proves layout/callbacks, not installed Save. Keep the original E01 oracle
unchanged. Candidate build/all fixed caps, focused checks, one frozen uncached
canonical gate and fresh independent exact-SHA review. No large unrelated suite
rerun just to observe this narrow CSS change. Root owns execution metadata.

Only workbench.css is intended product scope. If another product path is required,
report the concrete reason before editing. No refactor, budget increases, server,
Docker, live DB, local listening ports, deployment or foreign edits.
