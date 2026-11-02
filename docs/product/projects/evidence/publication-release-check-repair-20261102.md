# Publication release-check repair

Owner requested fixing the reported release blockers after reviewing failed CI.
Bounded test/evidence changes only. No product UI/runtime/permissions, migrations,
installer, production configuration, deployment or working data changed.

## Causes and corrections

1. `contracts:lint` correctly rejected a subject-module dependency in the new 3D
   contract test. The complete 29-case compatibility/security suite now lives in
   `contexts/three-d/testing/public-artifact.spec.ts`. It still checks every canonical
   primitive, private-field/getter rejection, limits and readonly capabilities via
   public contract exports. No boundary exception or disabled lint rule was added.
2. Gallery cutover still expected the removed heading `Проекты`. The test now checks
   the real community heading, canonical redirect, search and absence of legacy UI.
3. Public Arduino playback expected generated C++ when the published program was
   written in blocks. It now checks the real SVG workspace, rendered block paths
   and the original published root block identities, rather than accepting a blank
   panel or substitute text. Text programs still require the exact generated code.
   Existing native LED/electrical phase, Worker lifecycle, fullscreen, immutable
   source and no-mutation checks remain intact.
4. Viewer width checks used a removed `has-description` class and an obsolete
   viewport formula. They now require the viewer to fill its actual grid slot and
   verify sidebar separation at the current 1100px breakpoint across seven widths.
   Overflow checks and public script dependency checks remain unchanged.
5. Account CI additionally exposed an outdated Course upgrade fixture. Both explicit
   migration-prefix arrays now include 0289–0293. No migration SQL/checksum or
   historical-data equality assertion changed. The test applies the full upgrade,
   rechecks idempotency, and strictly compares saved drafts, versions, runs and media.

## POST_STEP_REVIEW

- CHANGE_CLASS: test-only repair, no product behavior change.
- LAYOUT_IMPACT: none; assertions reflect the already implemented UI.
- LOCAL CHECKS: contracts and 3D project lint passed; changed E2E/migration source
  lint and E2E TypeScript compilation passed; 29 3D public-artifact cases passed;
  real isolated Course upgrade passed; four built-browser scenarios passed:
  Gallery cutover, responsive immutable Electronics viewer, native text blink and
  native block blink. Only the failed scenario was rerun after correcting its
  new assertion to compare serialized block identities rather than numeric labels.
- BROWSER BASELINE: built product `2452b855`; all subsequent product changes before
  this repair concern 3D snapshots only. These Electronics/Gallery behavior checks
  used actual built API/Web with isolated `*_test` data, not mocked responses or
  the owner's browser. Exact new-commit full CI is separate and must be observed.
- NEGATIVE CHECKS: original immutable source/private draft assertions, no project
  writes, no authoring/runtime script leakage, no toolbox and no raw-code substitute
  for block mode remain enforced.
- UNVERIFIED: exact new-commit GitHub checks until they finish; production rollout.
- VERDICT: focused local repair PASS, not a successful release/deployment claim.

Logs remain outside Git in the local operations report directory under
`release-repair-*`. Existing untracked screenshots/reports were preserved.

## One final Main convergence

Parallel Main commit `519d7cf2` retained this repair but cancelled the exact
`51b09ccd` workflows and introduced migration 0294. Cancelled jobs are not product
failures or successful gates. Course and AI-prefix upgrade fixtures now explicitly
admit that accepted additive migration; SQL and strict history comparisons remain
unchanged. Only those upgrade suites need a repeat after this integration delta.
No Chess product code, game behavior or permissions were edited by this repair.
