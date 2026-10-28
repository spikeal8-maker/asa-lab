# Arduino scalar void helper execution and display counters

Feature baseline: `00301affb4a66e2e19ee706cdb25b91294b987be`.
This slice adds real nonrecursive void calls with scalar value parameters,
callee-local scopes, shared globals, nested calls, compatible prototypes,
forward definitions, early return and suspension/JSON restoration. It does not
substitute macros or paste function bodies beneath caller-local scopes.

Only three production files change: runtime, a cohesive function-signature parser,
and capability admission. Calls and returns use ordinary clock instructions.
Helpers use the existing public interpreter fallback; optimized admission rejects
them explicitly. No new clock, synthetic delay, physical model or continuation
version is introduced. Optional frame fields appear only during helper execution;
suspended caller scopes omit shared globals.

## Compatibility and admission

`BEFORE.md` and deterministic archives preserve the complete pre-edit compiler,
every state/action/event/diagnostic at budgets 1/2/7 plus legacy millisecond ticks.
AFTER is byte-identical: **20 programs, 467942 raw bytes**, SHA-256
`ce74d3a60b5897782a081a0da2f4b2998d204795dfd899a1dfb3e23d4a2924e2`.
The canonical generated ultrasonic adapter, direct legacy intrinsics, Servo,
and quoted braces/question marks remain covered. The #define PIN case preserves
a compile rejection; it does not establish support for preprocessor constants.
A separate retrospective baseline oracle covers actual min/max/abs/constrain
(including side effects): 5 programs, 53008 bytes, SHA-256
`61cee0b30726309bfacc5bd8f7b26101a37309c156456c97ad059e6fde0cb7ae`.
Its baseline source was reconstructed after implementation from immutable Git
00301, bundled in memory; it is not described as a pre-edit capture. Both runtime
source hashes match the original baseline and frozen candidate receipts.

An arbitrary builtin-named definition previously had its body ignored while the
intrinsic executed. `builtin-body-before.json.gz` records this separate admission
defect. Such conflicting bodies are now rejected before GPIO; it is an intentional
correctness repair, not a silently removed legacy-oracle case. Keywords and board
constant aliases are not admitted as helper or parameter names. The new parser
does not confuse declarations inside strings/comments with real functions.

## Focused proof

- 33 helper tests: lexical global/caller shadowing and restoration, parameter
  conversion/const, nested/forward calls, compatible unnamed prototypes, local
  loop control and return, typed waits, JSON continuation, multiple boards,
  malformed/sparse/unknown frames and coherent fault re-advance.
- All call arguments participate in replay when blocked: analogRead, Serial.read
  and increments before a later pulseIn argument are each observed once.
- Exact former 817 `showDigit(int)` failure is now a positive regression.
- Four domain cases execute actual 1/2/3/4 NPN scans for 20ms with finite passing
  electrical quality, and check interpreter counter carry at 25/65/105ms. Longer
  physical counter/display operation is checked by the native matrix below.
- Targeted lint, source types and formatting are checked separately. Canonical
  gate/build/budget and independent final-SHA results are supplied to the
  controller; this evidence does not itself claim an unrun broader gate.

## Real native counter matrix

**24 cases = 1/2/3/4 indicators × linear text / helper text / genuine Blockly ×
1440 / 390.** Each runs on one Uno, with real NPN drivers and current-limiting
resistors, the production Worker/hook/Stage and physical optical histories.

Every case shows three successive visible values: 8/98/998/9998, all nines, then
all zeroes after carry/wrap. That is **72 visible counter states**. Each verifies
eight segment opacities per indicator and causal source/project/session/generation/
input-digest/committed-horizon correlation. Glyphs and brightness are not injected.
The Blockly programmes are real connected workspaces of 239/472/711/956 blocks;
their generated source and complete block-type/count receipts are retained.

| Form | Final optical model cursor | Wall time to final carry sample |
| --- | --- | --- |
| Linear text | 100.1–125.2ms | 1813–6260ms |
| Helper text | 100.1–125.2ms | 2192–6622ms |
| Genuine Blockly | 100.1–125.3ms | 1552–3239ms |

These timings are **NOT realtime acceptance**. Significant model/wall lag remains
open under requirement 3. The full native matrix was recorded before formatting
and a compile-only excessive-helper-scope rejection; accepted fixture instructions
and execution are unchanged. Final independent replay uses the frozen candidate.

`manifest.json` binds full native and AFTER-oracle compressed/raw hashes. Actual
sketches and representative screenshots are in
`../../examples/arduino-helper-display-counters/`.

## Explicit boundary

Numeric-return functions, calls as value expressions, arrays, references/pointers,
overloading, default arguments, templates and recursion are not supported by this
slice. Unsupported forms fail before GPIO. This is not arbitrary C++ emulation.
Native fixture routes are local in-memory test ports, not installed Save/reopen,
user import, school deployment or owner acceptance. Server, Docker, database,
foreign work, physics, thermal cadence, timeouts and fixed budgets were untouched.

## Independent review and final composition

Independent review approved product SHA `4c50c4e20dc177efa40f6fe2c2fff6fae99ac0de`:
45 focused tests passed (33 function semantics, four physical helper counters,
eight matrix cases). A separate real Worker/Stage replay confirmed one display
`8 → 9 → 0` and four displays `9998 → 9999 → 0000`, with passing electrical
quality. Both legacy archives and the supplemental numeric-macro comparison
were independently checked. No remaining actionable source finding was reported.

Evidence-only follow-up `7da57bd8016b70aa08633825373b89b7976020e7` does not alter
the reviewed product. Final composition `a3ecf1e8815fc2e0cc11f208170ee6c94bfa7325`
merges main `7133a66f2b08eddc896ef3e996c0f3ea3f52b9b4` without conflicts;
all three production blobs are identical to the reviewed source. Unrelated AI
changes, including their contracts and migration files, are preserved.
This composition passed a fresh Web build (seven Nx tasks, cache skipped) and
all eight bundle budgets. This supplemental build is not another complete gate.
The complete 2441-test, 71-fresh-task canonical gate belongs to the reviewed
source; its first asset-hash timeout and the justified unchanged retry remain
recorded above. Model/wall lag remains open; no installed or owner acceptance.
