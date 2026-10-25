# Arduino value-connection repair — 25 October 2026

Baseline: `91587fe47ee635ef745fca368ab384bf27a6a26d`, clean owner-requested
detached worktree. Foreign Classroom changes and workflow worktrees preserved.

Replaced literal-only runtime arguments with genuine value connections in wait,
repeat/for, digital output levels, Servo angle, tone/note, serial/LCD output,
RGB, LCD cursor, seven-segment values, NeoPixel pixel values, random/map/constrain
bounds and variable change. Identifiers, comments, pin/configuration menus and
NeoPixel allocation count remain fields. This does not add peripheral/runtime
capabilities; unsupported blocks remain unsupported.

Number/text/variable reporters use native round shapes; Boolean reporters remain
hexagonal. Defaults are replaceable shadows. Legacy fields migrate to shadows;
existing expressions, variable identities, IDs, positions and next/statement
connections survive. Empty old conditions/arithmetic inputs are not filled, and
empty/whitespace text remains pupil content. Dynamic note duration is sampled
once for tone and its wait, in an isolated local scope.

## Verification on final source

- `NX_SKIP_NX_CACHE=true NX_DAEMON=false pnpm gate:electronics-m1`: PASS.
  Domain: 45 files / 934 tests. Web Electronics: 57 files / 938 tests, including
  43 new value-input cases and existing nine code-panel persistence cases.
  Nx rebuilt module-sdk (1 task), ran typecheck for 27 projects plus 15 dependency
  tasks, and built 27 projects. Every Nx invocation reports cache skipped.
- `node apps/web/src/electronics/testing/arduino-value-inputs.browser.mjs`: PASS.
  Chromium performed 32 native mouse drags (variable or nested math into wait,
  serial, digital output or variable change), save/reopen and connection/code
  checks at 1440/1024/390/320. No document-level horizontal overflow or page errors.
  Component workspace scrollbars remain available for wide expressions.
- The same browser runner bundles the immutable baseline source in memory,
  creates a genuine old project with 22 statement/expression cases, loads it in
  the repaired editor and saves/reopens it. Generated Arduino source matches
  baseline byte for byte. Covers literal values, empty and escaped text, variable
  identity, default fields, empty conditions and arithmetic operands.
- Targeted Electronics routing validation, focused ESLint and `git diff --check`:
  PASS. `pnpm control-plane:check`: PASS after completing this candidate lane's
  required gate/revision metadata. Existing lanes and blockers retained.

Initial clean Windows gate attempt hit `spawnSync corepack.cmd EINVAL` in the
pre-existing engine-consumer test's dependency bootstrap. Compiling the expected
Electronics package with `pnpm exec tsc -p contexts/electronics/tsconfig.json`
resolved that prerequisite; the unchanged gate then passed. No baseline test,
assertion, timeout or workflow was changed to hide it.

Screenshots and raw receipts: local ignored `test-results/arduino-value-inputs/`.
Gate log: local ignored `.value-inputs-gate-r2.log` (earlier candidate evidence
retained in `.value-inputs-gate-final.log` and `.value-inputs-gate-r1.log`). Browser evidence is an
in-memory component fixture, not full portal/Save-CAS/server evidence.
`gate:electronics-m1:browser`, `gate:repository` and remote exact-commit CI were
not run. No ports, server, Docker, live DB, backups or deployments were used.

## Review boundary

The first independent read-only review of
`9b5e3a5d327144d207bf7aadc32c27e8e32a4420` returned REQUEST_CHANGES: a pupil
variable named `asaNoteDurationMs` could be shadowed by the generated note local.
The bounded repair reserves normalized pupil variable names and for-loop counter
names before choosing a temporary identifier. A regression reserves the base,
first suffix and loop-counter second suffix, and verifies both frequency and
duration keep referring to the pupil variable. The complete uncached focused gate,
22-case legacy oracle and 32 native browser checks were repeated after this fix.
No broader component scope was added.

The second independent read-only review of
`97ea95db67e6563590a8cd0f0ba596b7425c1aed` verified the note repair but returned
REQUEST_CHANGES for `repeatIndex` capture in COUNT and `int i = i` when FROM
contains variable i. The next bounded repair chooses a collision-free repeat
index and snapshots the outer variable binding before a named for-counter is
introduced. FROM/TO/STEP expressions reference that alias, including inside
random/map/constrain and nested arithmetic; their original expression types
remain unchanged. Loop bodies retain their established counter scope. Literal
legacy source remains byte-exact. Four new execution cases verify repeat and all
three for arguments; three nested-argument cases verify binding propagation.
The complete uncached focused gate and both browser oracles were repeated again.
The source is now 52,904 LF bytes.

The existing arduino-blocks source now exceeds 50,000 LF bytes. Definitions,
literal defaults, migration and generation still share one block vocabulary;
retain that boundary for this compatibility repair. The bounded size review
adds a decomposition-candidate entry and mapped real symbols, without resetting
the global hygiene interval or changing any other large-source baseline.

Self-review: requested editor surface only; deterministic source preserved for
legacy projects; no protected assets, solver, persistence API or runtime edits.
Independent review of the final candidate commit is required before technical
acceptance. Main integration, owner acceptance and installation remain separate.
