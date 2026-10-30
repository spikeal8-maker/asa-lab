# Issue 865 bounded candidate — NOT_READY

Base: 46aab6bc166b706f643b7e2e850f263b84ec1f25. Source implementation is frozen for controller classification. No AFTER browser proof or release/acceptance claim.

The candidate suppresses initial Blockly load/default/layout events with balanced disable/finally enable, preserves valid empty saved workspace, clears partially loaded corrupt state and uses the existing notice callback without publishing replacement Blink. Only an absence of source/workspace/mode fields initializes and publishes default blocks. Genuine non-UI events publish source/workspace together immediately; the old 180ms generation debounce was removed to avoid stale export/navigation/save. Source-only saved empty/whitespace text remains text. No automatic-wait feature or simulator timing change.

## Blocking size evidence

Both candidate Vite builds succeeded (attempt1 25.58s, attempt2 25.49s). The unchanged fixed Arduino cap fails:

- Baseline: 1,999,925 / 2,000,000 bytes, 75 bytes headroom.
- Attempt1: 2,000,235 / 2,000,000, excess235; other seven caps PASS.
- Attempt2: 2,000,170 / 2,000,000, excess170; other seven caps PASS. Electronics editor 187,873 / 222,000.

Attempt2 compacted only new/changed repair logic: existing notice callback replaces new warning state/JSX; duplicate activity update removed; invalid top-level saved-state keys rejected. No cap increase, old-function extraction, dummy import or unrelated cleanup. Detailed actual build logs and final all-cap receipt are retained here. Attempt1 cap numbers were captured in tool output and controller message; no separate attempt1 cap log was saved.

## Focused evidence and limits

`pnpm exec vitest run apps/web/src/electronics/testing/arduino-program-state.spec.ts --maxWorkers=1`: PASS13 tests, freshly executed,323ms total. Added source-only empty/whitespace/CRLF preservation and explicit empty/corrupt/raw saved-workspace reader cases.

Targeted ESLint on the two production files and reader test PASS; Prettier and git diff --check PASS. No canonical gate, native AFTER browser actions, representative large-workspace latency, queued-inject behavior proof, mode/export/Save/UndoRedo proof or fresh independent final-SHA review was run because the required early cap gate failed. The implementation is unaccepted and may contain unproven behavior; reader tests do not substitute for mount/persistence proof.

Published BEFORE is preserved at 8fd7f251233c359d77935f556197807991d476c8 on codex/block-auto-wait-864: reports/arduino-auto-wait-864/before/README.md,16 oracles and six actual React mounts1440/390. No AFTER copy or weakening of that proof. Unmodified copied BEFORE script was omitted from this candidate.

Preflight child lane confirmed selected865 in_progress, HEAD=origin/main46aab6, control-plane PASS, no applicable blockers. RECOVERY_REQUIRED was classified: sole preserved foreign untracked reports/arduino-seven-segment-matrix plus unrelated dirty-worktree workflow overlaps; no product diff overlap. Exact selected card routing validator PASS. At prewrite GitHub General41025135797 was in_progress, not claimed PASS.

No server, Docker, live database, ports, deployment, protected assets, foreign reports or execution metadata changed. Candidate STOP at size blocker; controller owns next selection.
