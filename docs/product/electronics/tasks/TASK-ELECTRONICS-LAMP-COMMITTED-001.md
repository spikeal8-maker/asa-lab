---
task_id: TASK-ELECTRONICS-LAMP-COMMITTED-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner-directed Electronics programme #452/#703 and existing #549 R6 cause evidence
acceptance_boundary: slice
review: independent
---

# TASK-ELECTRONICS-LAMP-COMMITTED-001 — confirmed optical lamp presentation

**Programme:** #452; **existing issue:** #549; **registry:** #703. New bounded product slice selected by the owner-directed Electronics controller; historical E11 R5/R6 diagnostic evidence is unchanged. Not an acceptance or deployment record.

## User-visible outcome

When a complete Worker result has been accepted by the native optical frame barrier, the incandescent-lamp body reflects its accepted brightness: off (0), dim (>0 and <45), on (45–89.999...), max (>=90). The actual production lamp SVG is the oracle, not a mocked text label. No speculative SVG is displayed before the optical vector ACK; if the vector is rolled back, the previous asset remains visible. Stop/Reset/project swap/generation change clears old running output. LED and Arduino Uno must retain their existing prepared-asset, ACK, rollback and layout behavior.

## Evidence and cause

R6 synthetic Chromium trace (one run, budget exhausted): Worker seq29=lit/98.08 and seq66/96/133=lit/99.56 while DOM stayed lamp/off.svg. Current `NativeOpticalComponentVisual.tsx` subscribes only LED/Arduino. Stage intentionally does not reconcile every frame. `ProductionComponentVisual.tsx` already maps accepted lamp brightness to proper SVG thresholds. Crucially, `native-optical-presentation.ts` distinguishes `observation` (may be speculative) from `committed` (ACK-accepted). The existing LED/Uno subscriber uses the speculative path with protected LED lease; directly adding lamp to that predicate is unsafe.

## Source budget

- Product: `apps/web/src/electronics/NativeOpticalComponentVisual.tsx` only.
- New mounted DOM regressions: `apps/web/src/electronics/testing/native-optical-lamp-presentation.spec.ts`.
- This task card and exact canonical selection in `docs/execution/current.yaml`.
- No edits to R6 Draft PR #729, E11 browser source, `ProductionComponentVisual.tsx`, Stage, solver, Arduino/Worker, SVG assets, generated coverage, optical store semantics, Save/CAS, authentication, or deployment.
- One writer only. No co-author writes to the same paths. Scope extension requires a new explicit selected slice.

## Test-first and acceptance

1. Capture **BEFORE** with the new immutable mounted DOM regressions and confirm genuine failing lamp cases; keep LED/Uno guards.
2. Route lamp-only updates to **committed**, never `observation`. Do not add lamp to `rendered()` / asset-lease ACK dependencies. Preserve nil/stopped rendering and subscriptions cleanup.
3. Assert committed off/dim/on/max, speculative no-change, rollback, Stop, start/new generation, multi-lamp independence and no workbench-wide re-render. Negative guard: LED/Uno existing behavior and native store ACK cases remain unchanged.
4. Focused Vitest + unchanged `pnpm gate:electronics-m1`, Typescript/format and exact-SHA General. No timeout, skip or relaxed assertion.
5. Native built Chromium BEFORE/AFTER at 1440, 390 and 320 px with real lamp SVG, contrast with delivered Worker and accepted frame, Stop/Reset and retained LED. Use separate synthetic project / isolated stack. Historical R6 post-final hang remains UNKNOWN; don't rerun R6 without independent authorization.
6. Independent source + real visual reviewer on final SHA; full General and original browser obligations remain strict. No merge, release, school install or owner acceptance on partial gates.

**Baseline main at selection:** `26f1de30cd25bbbc5c21dfaaf27f19eb2d365d49`. Recheck actual HEAD before product writes.