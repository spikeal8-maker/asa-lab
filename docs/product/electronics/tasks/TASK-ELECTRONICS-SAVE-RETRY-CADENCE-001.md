---
task_id: TASK-ELECTRONICS-SAVE-RETRY-CADENCE-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve accepted 60000-ms ordinary autosave and per-edit local readback
  - Preserve published point2 and suspended 569/566 with all unrelated work
acceptance_boundary: slice
review: independent
---

# Owner point 4 — minute-spaced automatic save retries

Programme #452; Issue #571. Component `electronics.persistence.project`, ownership
cross_boundary. Owner approved this bounded point after points2/3. No new programme.

## Goal and proved cause

Current transient failure backoff retries after5/10/20/40 seconds before reaching
60000 ms. Replace that initial burst with a60000-ms delay after each transient
failure. Ordinary first-dirty autosave remains60000 ms. Later edits must neither
postpone nor accelerate the pending retry; send the latest document serially.

## Read and write boundary

Read `components/ui-assets-persistence.yaml` persistence entry and `README.md` §5.
Production writes: `apps/web/src/electronics/workbench-autosave.ts` and
`apps/web/src/electronics/use-workbench-project-state.ts` only for the retry helper
and its now-unneeded attempt counter. Focused tests: existing
`apps/web/src/electronics/testing/workbench-project-state.spec.ts` and
`e2e/electronics-simulation.spec.ts`; generated browser digest may be refreshed.
No source/test ownership change, so routing is unchanged. This is one component,
two production files and two focused test files. Both production files remain
below the large-source threshold and the hook shrinks. Hygiene006 is accepted;
canonical counted accepted production slices since it remain1 (#553); unaccepted
569/570 are preserved, not falsely counted as accepted. No due checkpoint.

## Acceptance

- Network/408/5xx and thrown transport failures wait60000 ms before each automatic
  retry; no5/10/20/40-second burst. A long request still cannot overlap another PUT.
- An edit during the delay updates immediate verified local recovery and the
  eventual retry payload, without resetting its deadline.
- A user-requested manual retry remains immediate. Existing departure safety
  rules remain unchanged, including their existing failure guard.
- Success stops retries; hard auth/permanent/conflict failures remain fail-closed.
  Identity verification, CAS409 merge, no-overwrite queue and local draft remain.
- Causal BEFORE/AFTER mounted test, one actual built-browser503/quiet-recovery
  scenario and manual exception, frozen inputs, exact checkout/build metadata.
- Canonical `pnpm gate:electronics-m1` with literal `NX_SKIP_NX_CACHE=true`, actual
  exact-SHA general CI and new independent review. One browser case is not a full
  `gate:electronics-m1:browser` result. Red unrelated CI prevents acceptance and
  release, without permission to repair a foreign module.

## Forbidden and stop

No ordinary autosave delay change, timeout/assertion weakening, auth/API semantics,
polling, local-protection regression, solver/Arduino, artwork/CSS, other modules,
installation/deployment, working DB, school, Docker or network actions. Preserve
570/569/566 and every foreign lane/blocker. No next task. Report exact source,
actual gates, independent review and residual risks, then STOP.
