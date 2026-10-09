---
task_id: TASK-ELECTRONICS-INTEGER-TIME-DISPLAY-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner programme452 comment6084548550 and approved E08 integer seconds
acceptance_boundary: slice
review: independent
---

# Display whole elapsed seconds without changing canonical time

Existing programme452 / [541](https://github.com/spikeal8-maker/asa-lab/issues/541), owner E08. Primary electronics.ui.workbench in ../components/ui-assets-persistence.yaml; one justified lookup contracts/CANONICAL_CLOCK_CONTRACT.md sections1,6,9. No new programme/audit, future engine capability or physics change. E01/526 remains integration priority; this independent source may proceed after canonical selection before the third accepted-slice checkpoint becomes due, but integration waits for526 and that compact checkpoint.

## Cause and exact result

WorkbenchHeader.formatSimulationTime uses totalSeconds%60 without floor, so committed fractional seconds become a long textual suffix. Render HH:MM:SS with whole elapsed seconds, floor rather than rounding future time; preserve minute/hour rollover and long durations. Canonical committed/requested microseconds, Worker observations, physical state and run/stop semantics are unchanged. Owner already approved this behavior; do not ask again.

## Author boundary

NEW author from actual canonical main in a clean isolated checkout, fresh preflight electronics-time, exact task validation, actual all-worktree dirty overlap check. Root Header advisory ownership remains because of its E01 candidate; advisory hints are not permissions. E01 author stopped and reviewer is read-only. No simultaneous writer may edit Header or supporting shared files. Preserve all E01/539/537/538/525 branches and accepted changes; do not import them secretly to claim baseline acceptance.

Only production apps/web/src/electronics/WorkbenchHeader.tsx, formatting function only. Test write paths: new apps/web/src/electronics/testing/workbench-header-time.spec.ts and e2e/electronics-simulation-time.spec.ts. Supporting registration only existing two package browser commands, existing focused workflow path filter and matching component tests in ui-assets-persistence.yaml. No CSS/hooks/controller/engine/runtime/solver/physics/persistence/auth/schema/lockfile edits, generated manual output, test weakening, timeout increase or fake clock authority. Any other required path goes to controller before edits.

## Real pupil evidence and invariants

Meaningful production-mounted Header checks use actual committed times at fractional seconds,59.999/60/3599.999/3600 boundaries and long duration; verify displayed floor while input stays exact. Do not replace these by testing copied formatting code or source strings. Existing presentation assertions remain intact.

One dedicated real production browser pupil case: real auth/project/DC circuit, normal Run and fractional committed model time observed through actual Worker, UI HH:MM:SS=floor(committed), no decimal suffix; Stop/Run reset consistent with canonical semantics; save full supported DC schema (preserve any existing full Arduino sketch without adding an artificial UNO/cadence dependency), fresh cookies-only context reopen with strict full-document/revision equality and actual mounted controls, Run again. Desktop1440/compact1024/mobile390/320 accessibility and no page overflow/primary CTA clipping. Keep existing original case/observation budgets, no forced clicks, no blank/fake editor, no truncated document/program. Record real requested/committed horizons, ready/yielded, clock DOM and action timestamps. Display never implies a ready result when only yielded exists.

Controller will first create one diagnostic-only BEFORE run with candidate test/harness but restored old Header bytes, then AFTER unchanged pupil scenario on new product. Existing raw fractional clock evidence may inform the test; do not rerun other accepted measurements. New scenario must be registered in real browser gate, not merely a file on disk. Preserve frozen dependencies and literal NX_SKIP_NX_CACHE=true; focused pnpm gate:electronics-m1 with fresh Nx counts, self-review including UI impact/consumers. Then one final convergence with accepted E01/main and new exact-source focused/general/browser evidence plus a NEW independent reviewer; old source tests/review do not accept the new composition.

## Delivery and stop

One unpublished candidate SHA/tree/sourceproof/report, then author STOP. No author push/workflow dispatch/current.yaml/card/Issue closure. Controller checks actual diff/evidence, owns publication/CI/integration and continues452. No next-task activation. School version/backups K0, pupil-device T3 and class/owner acceptance separately pending; no school installation, database, Docker/network or backup action.

## R1 retained successful evidence

[NEW independent exact89 review](../evidence/integer-time-541-independent-review-89ebdf34.md) REQUEST_CHANGES: all8 jobs SUCCESS/139browser, but successful raw JSON and12running phase PNG were not retained; only4final StopPNG remain. Repair ONLY e2e/electronics-simulation-time.spec.ts: explicitly write four complete raw receipts and three running PNG per width using testInfo.outputPath, then attach paths. Preserve product/Header, full assertion bodies, timeouts, dependencies, workflow and mounted tests. Root owns digest if actually required through canonical generator, no manual generated edits. The old genuine BEFORE722fc882 is preserved and not rerun. One changed-cause new exact source/browser gate plus General and NEW independent review required. On1440/1024 clock is visible; at390/320 unchanged baseline CSS hides it, so report DOM-only integer formatting/native accessible controls/no overflow, not a visible mobile clock repair. CSS is a separate selected product concern. School/owner/deployment remain pending.
