---
task_id: TASK-ELECTRONICS-PROJECT-POLLING-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve accepted minute autosave and immediate local recovery protection
  - Preserve suspended candidates 569 and 566 and all other lanes
acceptance_boundary: slice
review: independent
---

# Owner point 2 — stop blind project polling

Programme #452; Issue #570. Primary component: `electronics.persistence.project`.
The owner selected this point explicitly and authorized main publication after checks.

## Scope

Remove the unconditional 3000-ms project GET timer from
`apps/web/src/electronics/use-workbench-project-state.ts`. Keep initial load,
clean/ready/stopped focus refresh, the in-flight guard, dirty/save/error guards,
late-response protection and CAS409 reconciliation. Existing focus is the user
return signal; no new background timer or teacher monitoring mode is introduced.
Write focused mounted cases in the existing project-state test and one real
production-browser case in `e2e/electronics-simulation.spec.ts`.

## Acceptance

- A clean idle editor makes no periodic project GET, demonstrated BEFORE/AFTER.
- One clean focus refresh can receive a newer remote revision.
- Dirty focus makes no GET; edits made after a GET begins survive its late reply.
- Initial open and CAS409 three-way recovery retain their existing coverage.
- The 60000-ms autosave deadline, local immediate readback, manual/exit saves,
  authentication, retries, physics and API behavior remain unchanged.
- Canonical `pnpm gate:electronics-m1` with `NX_SKIP_NX_CACHE=true`, actual directed
  built-browser evidence on frozen dependencies, applicable repository gate and
  independent review of the exact final SHA. A directed case is not the full
  browser gate. Preserve all suspended work; integrate only after required checks.

## Forbidden and stop

No API/server analysis removal, auth, telemetry, solver/Arduino, artwork, CSS,
other modules, school installation, working DB, Docker or network changes.
Do not increase timeouts, weaken assertions or change local protection/retry.
No point3/4. Report exact candidate/evidence and STOP for independent review.

Hygiene006 is accepted; canonical counted production count since it is1 (#553),
so no due hygiene checkpoint precedes this narrow reduction. No new production
source or large-file growth is introduced.
