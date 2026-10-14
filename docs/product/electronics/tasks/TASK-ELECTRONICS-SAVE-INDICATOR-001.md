---
task_id: TASK-ELECTRONICS-SAVE-INDICATOR-001
kind: repair
risk: low
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve accepted 60-second autosave and immediate local recovery protection
  - Preserve blocked cross-tab candidate 566 without integration or repair
acceptance_boundary: slice
review: independent
---

# Owner point 1 — truthful saving feedback

Programme #452; Issue #569. Primary component: `electronics.persistence.project`.
This is presentation only: pending edits must not pretend a network save is active.

## Scope

Change `apps/web/src/components/editor-chrome/EditorPersistenceIndicator.tsx`, its
mounted tests and one directed case in `e2e/electronics-simulation.spec.ts`.
The only runtime consumer is Electronics `WorkbenchHeader`; retain its status
and current-document `localCopySaved` source of truth. Add the source/test mapping
to `components/ui-assets-persistence.yaml`; regenerate only the canonical source
coverage digest if needed.

## Acceptance

- Dirty means waiting for server upload. Explain a local browser copy only when
  the current document has confirmed readback; otherwise promise no durability.
- Saving is shown only during an actual request; success only after current
  document acknowledgement. Preserve error, offline, auth and conflict honesty.
- Mounted transitions cover immediate status changes and stale success removal.
- One actual built-browser scenario records no PUT before the existing minute
  deadline, the waiting label, a held real request, then acknowledgement feedback.
- Check 1440/1024/390/320 layout and screenshots 1440/390; no page overflow.
- Focused component/project-state tests, Electronics focused gate, applicable
  repository gate and new independent review on the exact final SHA. Built-browser
  evidence uses the existing isolated CI recipe and frozen dependencies with
  literal `NX_SKIP_NX_CACHE=true`; a directed diagnostic is not a whole-gate PASS.

## Forbidden and stop

Do not change autosave interval, scheduler, polling, retries, local draft storage,
API/auth, physics, Arduino, assets, other modules or #566. No Docker installation,
school, working database or network action. Existing checks/timeouts stay intact.
Preserve all candidates and all other lanes. Report point 1 and STOP; no point 2.
