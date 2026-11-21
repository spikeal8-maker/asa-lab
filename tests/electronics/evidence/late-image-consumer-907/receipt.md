# Late image consumer failure delivery — bounded author receipt

2026-11-01. Issue #907, selected task `TASK-ELECTRONICS-LATE-IMAGE-CONSUMER-907`.
Repair / medium risk / no electrical semantic change. Component: `electronics.ui.workbench`.

## Source and scope

- Reviewed source baseline: `0d489e5e9b0305b33932eae124e267d6bfa00312`.
- Canonical selection: main `8d885a5d87fd8677b29789dcbad149111e3ea9b6`.
- Normal merge baseline: `21a4db7b8ef2033110ab749bd21bd0a9e3c04ea7`.
- Worktree: `C:/Users/spike/.codex/worktrees/late-image-consumer-907/ASA-lab`.
- Production blob: `fab6f133ed3987fa3a24701c792c9a16295cea01`.
- Asset test blob: `c4349e0f599bb9964dd85341bc6c43c832aeb899`.

Only the private `useOwnerImageHref` hook and its existing asset test file change.
The hook observes an existing recovery rejection or completed failed cache, without
starting requests, changing href, or changing shared recovery bookkeeping. Active
effect, cycle identity and own native events fence stale delivery. A subsequent
native load clears only observer-owned failure; a subsequent native error retains
the original finite recovery behavior. Existing listeners retain their order.

The single existing expectation changed from no badge before a late native error
to an immediate failed badge from the completed failed cache. The later native
error, every existing retry count, permanent-404 check and timing assertion remain.

Preservation proof: all Visual bytes outside this hook match reviewed baseline
(normalizing checkout line endings); Electronics source diff is exactly the hook
file and asset tests. Protected owner assets, package manifest, lockfile, workflows,
clock, Worker, solver, waveforms and all other reviewed product source are unchanged.
Final Visual size is 93,416 bytes against hygiene baseline 89,698 (below +20%).
Preflight control plane passed, zero execution blockers. Controller explicitly
acknowledged and excluded foreign shared workflow/package worktree dirt.

## Causal and local verification

- RED: unchanged hook failed both pending-recovery late mount and completed-failure
  late mount badge assertions. Guard cases passed.
- RED: later native load retained an observer badge; later own native error
  incorrectly issued zero rather than one initial recovery request. Both fixed.
- `pnpm exec vitest run apps/web/src/electronics/testing/asset-recovery.spec.ts --maxWorkers=1`:
  **51 PASS**. Covers no late synthetic error, exactly three shared Images, existing
  image identity/href, cache mount, pre-passive and later native success, unmount,
  asset change, successful recovery, own-error recovery and existing finite budgets.
  These induced lifecycle tests establish the consumer mechanism, not browser-native frequency.
- `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-LATE-IMAGE-CONSUMER-907`:
  **114 guards PASS**, selected task PASS. Direct validator also passed final source.
- Final Prettier, ESLint and `git diff --check`: PASS.
- Valid full Web command `pnpm exec vitest run apps/web/src --maxWorkers=1`:
  **FAIL: 250/251 files PASS; 2979/2980 tests PASS**, 395.64 seconds.
  Sole failure: unchanged owner-asset-manifest hash test at line 243 exceeded its
  unchanged 5000 ms limit (7231 ms). No missing-import failures remained.
- Same exact hash case isolated once with `-t 'keeps every imported review asset byte-identical to its archive hash'`:
  **PASS 110 ms**, one test passed/eight skipped. Classified infrastructure D;
  no asset, timeout or test change and no full-run retry.
- `pnpm nx run web:typecheck`: PASS, 56.8 seconds, seven fresh tasks.
- `pnpm nx run web:build`: PASS, 37.7 seconds, seven fresh tasks.
- Six local workspace prerequisite builds: PASS, 14.5 seconds, six fresh tasks.
  All final 20 Nx tasks used literal `NX_SKIP_NX_CACHE=true`; cache skipped.
  One earlier preliminary SDK task also ran fresh before local dependency setup.
- `pnpm bundle:check`: **all eight unchanged caps PASS**. Electronics editor
  175676/222000 bytes; Arduino editor 1998988/2000000 bytes; initial graph
  561313/600000 bytes. No budget configuration changed.

Dependency setup: initial junction-based attempts were interrupted/unqualified due
to missing per-workspace resolution and Vite rejecting an external asset path.
Own junctions were verified and removed nonrecursively, without changing targets.
Controller approved proper local `pnpm install --offline --frozen-lockfile --ignore-scripts`:
851 packages reused, zero downloaded, lock resolution skipped; no tracked dependency
change. All eight required exports then resolved within this worktree and six
workspace exports were built locally. Local all-Web collection was bounded and
stopped without JSON/error; it is NOT qualification. The one subsequent complete
local Web run and its actual failure are reported above.

## Boundary

Self-review: PASS_WITH_RISK for the documented unrelated local timing failure.
No JSX, geometry, CSS, labels, artwork, network, port, server, database or deployment
change. Browser/native qualification, viewport evidence, independent review and
owner acceptance remain pending; this receipt does not close #836 or claim a release.
Next action: STOP / fresh independent review of the final author commit.
