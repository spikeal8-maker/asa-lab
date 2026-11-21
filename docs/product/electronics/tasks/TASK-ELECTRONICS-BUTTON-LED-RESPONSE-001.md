---
task_id: TASK-ELECTRONICS-BUTTON-LED-RESPONSE-001
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Avoid rendering the editor for an unchanged idle Serial projection

Select one original timing failure: `button-serial: strict real time and acknowledged native evidence` in `e2e/electronics-interactions.spec.ts`. Run 41345471963 at 6a23c93e records a HIGH ready result at 4948.2 ms and a dark witness at 5013.4 ms, above the original 50 ms limit. The exact SVG loads at 5020.8 ms and the first HIGH witness is at 5027.0 ms. This does not establish a single cause for the full delay.

Five consecutive original Worker replies (4733.2, 4800.5, 4853.1, 4948.2 and 5029.6 ms) carry the same nonempty Serial projection: one board, begun at 9600 baud, empty TX and no RX bytes. The workbench currently rebuilds state on every such receipt. Demonstrate this redundant update with the actual mounted consumer and remove only the repeated update for an identical idle projection. Preserve board, generation/stream identity, baud, begun, RX, first publication, clearing, and all TX publications. No debounce, altered clock, asset, controller, protocol, physical model, threshold, test timeout or refactor.

Primary component: `electronics.ui.workbench` in `components/ui-assets-persistence.yaml`. Product path only `apps/web/src/electronics/use-electronics-workbench.ts`. One focused regression may be added to `apps/web/src/electronics/testing/use-electronics-workbench-clock.spec.ts`. The original E2E test and all its oracles are read-only. Require a focused before/after, independent review, and actual browser success for the original case before integration. If the change is insufficient, preserve the failure and diagnose the remaining delay. Never count an avoided render as closure by itself.

Preserve the 256-event quantum. The previous 1024 experiment was rejected after its mixed-circuit cancellation delay grew from 253.7 ms to 1571.9 ms. No server, installation, live DB, protected assets or foreign WIP changes.
