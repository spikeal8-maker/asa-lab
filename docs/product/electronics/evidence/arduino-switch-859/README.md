# Arduino switch/case — bounded language slice 859

Baseline: `7d5f6d93fb8555a6064e01c89a3e54538aa68911`.

## Behavior

Integral switch selectors are evaluated once, dispatched to constant case labels
or default, and fall through sequentially until break. Switch owns a shared
scope; braced case bodies may own locals. Break targets the nearest loop/switch,
while continue targets only the nearest loop. Functions, early return and JSON
continuation retain their existing semantics. New dispatch uses the public
interpreter fallback; owned optimization explicitly rejects it.

Case constants retain actual preceding integral-const initializer provenance,
including existing numeric macros, rather than validation placeholders. Range
checks reject C++11 narrowing before duplicate detection. Floating selectors,
nonconstant labels and duplicate labels/defaults fail before GPIO.

Explicit bounded restrictions: declarations crossed by a later case label need
their own braces (including otherwise legal trivial uninitialized declarations).
Labels embedded under arbitrary unbraced if/loop statements are rejected.
Existing unsupported casts, enums, goto, pointers and general preprocessing are
not introduced. This is not arbitrary C++ emulation. The existing switch command
card now has accurate limits and a directly executable example.

## Proof

- Before production edits, captured and pushed the complete 25-program oracle:
  20 legacy programmes and five actual scalar-helper programmes, compilation
  before/after plus every advance/state/action/event/diagnostic under budgets
  1/2/7 and the legacy profile. AFTER is byte-identical: **1,295,122 bytes**,
  SHA256 `0afe4c1dd4c051d41d98eca513f8feb7b124277b82b3076fca229ff6103a643d`.
- A separate retrospectively reconstructed exact baseline runtime reproduces
  switch rejection before GPIO. Its receipt explicitly distinguishes this
  reconstruction from the oracle captured before editing.
- **43 new switch tests** cover grouped/default/fallthrough/nesting, for/while/
  do…while break versus continue, shared/braced scopes, functions and return,
  uint32/promotions/narrowing/constant provenance, duplicate and rejected forms,
  exact error ranges and JSON resume. ADC, Serial, increment and random before
  blocked pulse selectors are captured and resumed at budgets 1/2/7; states
  match the unpartitioned result and side effects execute once.
- Together with existing helper/capability/command tests: **154 focused PASS**;
  core TypeScript, ESLint, routing and diff checks passed before freezing.
- Real Chromium production Worker/hook/Stage and physical one-display NPN
  circuit passed at **1440 and 390**. Genuine switch dispatch in a helper paints
  **8 → 9 → 0**, with actual Serial output and source/session/input-digest/
  committed-frame correlation. No glyph/result injection. Actual sketch and
  complete native receipts/screenshots are retained here.
- Candidate-first uncached Web build passed: **seven fresh Nx tasks**.
  All eight existing budgets passed: Arduino **1,999,981/2,000,000**, electronics
  **170,581/222,000**, initial graph **555,421/600,000**. Final runtime **149,171 bytes**
  remains below the unchanged 153,189 source guard. No unrelated cleanup.

Native execution still has model/wall lag. This slice does not claim realtime,
full display qualification, installed Save/reopen, deployment or owner acceptance.
Canonical full gate and independent frozen-SHA acceptance are recorded separately.
No server, Docker, live database, solver equations, cadence, old parser relocation,
foreign changes, source guards or bundle limits changed.

## Bounded repair after the first freeze

The initial full gate stopped with five obsolete switch-unsupported expectations
in scheduler, loop and solver tests. Their isolation, last-good and unsupported
status assertions remain unchanged; their inputs now use valid but unsupported
goto/defined-label programmes. Positive switch witnesses were added for independent
boards and actual solver output. The four-file repair check passed 378 tests;
the later legal case-sensitive identifier witness adds one more case.

Early review also found that removing the old broad switch capability rejection
exposed `int switch=1` without dispatch. Exact initial-candidate reconstruction
proves it drove GPIO. The final compiler rejects only this newly exposed reserved
keyword; legal `Switch` and `SWITCH` remain accepted. Old unrelated keyword
admission is not rewritten. All 25 historical programme oracles still match.

After that actual guard change, native 1440/390 was repeated successfully.
The earlier candidate build preceded this seven-byte runtime guard repair; the
repair canonical gate provides the final complete build/budget evidence.
One requested cold-resource precheck of the unchanged 697-file hash test timed
out at five seconds (file duration 6.32s). It is recorded as FAIL, not a hash or
gate PASS. No timeout, worker count, assets or gate command changed. Exactly one
canonical repair run is allowed after the new code/test freeze.
