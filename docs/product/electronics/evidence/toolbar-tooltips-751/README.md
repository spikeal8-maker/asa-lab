# Toolbar tooltips — new requirement 1 / historical 45.9

Candidate `e8c4b6c9b9a4faad925d739efe3a464c04577ba5`, baseline
`0dad68faf80236d81a12ad803aebfe7a5efe4444`. Independent review APPROVE on
that exact candidate. This is scoped source evidence, not installation acceptance.

The real Header, CSS and optical presentation were bundled in memory and loaded
in Chromium without a local listener, account, server or database. Both author
and reviewer executed the final fixture. The independent receipt matched the
author receipt byte-for-byte.

Run: `node apps/web/src/electronics/testing/workbench-tooltips.browser.mjs`.
The `--before` mode loads the pinned baseline Header/CSS via Git.

## Results

- Widths 1440, 1024, 390 and 320; DPR 1.25. This is device scale factor,
  **not an actual Windows or browser 125% zoom acceptance run**.
- Before: native titles present, zero immediate DOM tooltips on hover/focus.
- After: 15 hover checks per width, first frame placement, Tab/Enter/Space,
  Escape followed by movement on the same button, dynamic Run/Stop,
  disabled inert controls, exact callback counts, native CDP touch tap/swipe/cancel,
  horizontally clipped anchor dismissal, existing ARIA token retention and unmount.
- Existing Header command and touch handlers are unchanged. No runtime, solver,
  persistence, dependency or owner asset change.
- Existing Header/presentation tests: 21 PASS. Lint, formatting and diff check PASS.
- `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`: PASS, 2345 tests
  (1257 core + 1088 Web), 71 fresh Nx tasks (1 SDK + 43 types + 27 build).
- First gate: two unchanged 5000ms timeouts in owner asset audit and Worker
  `readUltrasonicCm(n++,4)`. Isolated relevant six tests passed, followed by
  **one** unchanged canonical retry passing all 2345 tests. Classified transient
  runner contention; no test timeout, worker count or unrelated source changed.

| Budget | Before | After | Limit |
| --- | ---: | ---: | ---: |
| Editor module | 163276 | 166663 | 222000 |
| Arduino module | 1999997 | 1999997 | 2000000 |
| Initial JS/CSS | 552023 | 552023 | 600000 |

Fresh baseline build ran seven Nx tasks with cache skipped. Final bundle check
passed all checked budgets. No cap increase or deferred cleanup was used.

## Evidence SHA-256

| Artifact | SHA-256 |
| --- | --- |
| before.json | c076d5ca698e20f258eb7da1d622fdd4c80a08b4280e55d61069708c8cf97c17 |
| after.json (also independent receipt) | 600517c46b66dab4ac3c5ea927ac53304c17e09f0f4f3380e81c80bac0e3489e |
| toolbar-1440.png | d2a68d7d25f9903fe1a1537dc6d895dcc53b86f9095adf04d4560fb80334e726 |
| toolbar-320.png | 431940c6cd5005f7fde5c305ad1e0d17d7a24124ef7ab606a4b28ab810e56adf |
| Final gate log, runner-local | 2d64bcdd9ace329d9ec38cf2bd92f328cee9bb48a1171ed7d48d83402d9d75ce |
| Final bundle log, runner-local | 45e252694517b59968f379f7c36797bbc70932da68f6c05539319838c4da1a6c |
| Independent native log, runner-local | a417109b363c87eb255496253b1de8b0f74900886053e981911ea46ab5dbe95a |

## Boundaries

An extra CDP sequence (Undo tap, cancellation, swipe, then Run tap) omitted the
compatibility click on the exact baseline too. `baseline-cancel-actions.json`
preserves the event evidence. Ordinary Run/Stop and library taps pass before the
cancellation sequence. This baseline/hybrid-input issue remains a separate
requirement-18 investigation; it was not hidden by changing command handlers.

Installation, actual Windows zoom, server Save/reopen and owner acceptance were
not run. Server, Docker and live data were untouched. Final main convergence
adds only unrelated classroom test/document changes from `38c95393`; the five
candidate paths are carried identically. Exact-main CI is tracked separately in
the execution state and GitHub, not inferred from these local results.
