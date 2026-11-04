# Final source gate — repair 858

Product source: `1b0bfd3d5b025ba771c44529c526af854db5ce14`.
Base: `dabcfe06968e7a4d8414a96061a320a85286a898`.

`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` passed on the one justified
unchanged retry: **1338 core + 1105 Web = 2443 tests**. Nx ran the SDK stage
and the 43-task type graph and 27-task build graph fresh (71 stage tasks);
the logs explicitly report cache skipped. Local tests do not imply general
repository CI, installed acceptance or owner acceptance.

The first canonical attempt passed all core tests and 1104 Web tests; its only
failure was the unchanged 697-file owner SVG hash loop exceeding its existing
5000 ms deadline (actual test time 10,505 ms). That test imports only Node
crypto/fs/path and Vitest; neither it nor its protected inputs changed.
Parallel transform/import totals were 52.83/84.44 seconds. The exact unchanged
hash case immediately passed alone in **102 ms**, validating all 697 hashes.
This class-D filesystem/parallel-load hypothesis justified one unchanged retry,
explicitly authorized by the controller. No source, timeout, worker count or
test configuration changed. Both attempts and the isolated result are retained.

`pnpm bundle:check`: **all eight caps passed**, unchanged limits.

| Entry | Bytes | Limit |
| --- | ---: | ---: |
| Initial application | 382841 | 570000 |
| Electronics editor | 170581 | 222000 |
| Chess | 244236 | 255000 |
| Checkers | 158901 | 160000 |
| 3D | 2870467 | 2900000 |
| Three.js vendor | 602992 | 620000 |
| Arduino editor | 1999997 | 2000000 |
| Initial JS/CSS graph | 555421 | 600000 |

Focused 44 tests, six exact non-LED/RGB markup comparisons, native SPST and
ordinary LED burnout at 1440/390, Web TypeScript, ESLint, formatting/diff and
task routing passed. Independent review runs separately on this source.
Generated `reports/arduino-seven-segment-matrix/` is untracked output from the
existing baseline report test; it was not staged, deleted or added to ignores.

Before reproduction: place the saved `before-unit.spec.ts.txt` and
`before.config.mts.txt` in `test-results/switch-burnout-858/` as
`before-empty-parent.spec.ts.txt` and `before.config.mts`, respectively, then run
`pnpm exec vitest run --config test-results/switch-burnout-858/before.config.mts apps/web/src/electronics/testing/native-led-diagnostic.spec.ts`.
The plugin loads only the original Stage and the archived empty-parent variant.
The deliberate BEFORE failure is the absent burst after the native body fault
and charred-asset assertions have passed, not a deliberately malformed fixture.
