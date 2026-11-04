# Arduino check messages: bounded copy evidence

Baseline: `34df8d8163ba62fe3301ddb65f97b1741fe9e944`.
The BEFORE artifact was pushed in
`766912728c7e5928f69dbfeb39c8d07050eccf05` before either production file changed.
This report describes candidate content; the controller records final exact-SHA
CI and independent review separately. No installed update or owner acceptance.

## Product boundary

Only `ArduinoCodePanel.tsx` and `arduino-capabilities.ts` change production
content. Check reports blocking errors or nonblocking notes. Notes retain their
count, complete list, collapse control and original-source navigation. Supported
commands no longer appear as broken merely because their registry status is
`limited`. Unsupported commands and syntax errors remain blocked.

Command descriptions now explain loops, Servo, tone, Serial, time and increment
in plain Russian. Averaged PWM and absent AVR timer/UART bit reproduction remain
specific notes. No feature, status, parser, runtime, numeric/physical behavior,
generator, block definition, font, layout, bundle cap or execution state changes.

`after/source-copy-proof.json` enumerates all 58 intentional public copy deltas
(string/template literals and JSX text), including fallback messages. Its AST
comparison retains every other node and leaf and is byte-equal for both
production files. Consumers were inspected: command reference displays summaries;
completion/block colouring uses status; solver/scheduler admission uses status
and codes, with messages only forwarded as diagnostic text.

## Structured and native evidence

`before/structures.json` and `after/structures.json` contain actual diagnostic,
syntax, admission and runtime outputs for supported source, loops, Servo,
tone/PWM, Serial, millis/micros and increments, unsupported calls and syntax
errors, with Unicode before source ranges. They also snapshot all three
registries. Removing only `message` and `summary` produces byte-equal JSON.
`after/message-deltas.json` enumerates the public text changes in those outputs.

The production panel was bundled and operated in Chromium at 1440×900 and
390×900 using an intercepted fixture origin, the production workbench CSS and
normal host sizing variables. No listening server, Docker, database or installed
application was used. All 16 cases passed Check, expand/collapse, selection of
every diagnostic's exact source range, editing, unchanged fixture input, actual
`.ino` download and fixture reopen. Generated block C++ was captured on both
widths and stayed identical. Runtime outputs confirm six runnable cases without
runtime diagnostics and two blocked cases with runtime diagnostics.

Native receipts and screenshots are in `before/` and `after/`. Manual visual
inspection covered desktop time/increment notes, mobile Servo notes and mobile
unsupported errors. The panel fits; mobile retains counts and explanatory body
while its existing CSS hides the long summary. Source remains literal textarea
text and diagnostics render as React text, with no injected image nodes.

Harness development failures are retained here as limitations of earlier test
attempts, not product failures: a wrong Check accessible-name selector; missing
fixture host height causing mobile pointer interception; an AFTER assertion
expecting the intentionally CSS-hidden mobile summary in visible text. Each was
corrected with a specific fixture/assertion hypothesis, without production edits.

## Verification before freeze

- First candidate `pnpm nx run web:build --skip-nx-cache`: PASS, 7 fresh tasks.
- All eight `pnpm bundle:check` caps: PASS. Raw Arduino 1,999,925 / 2,000,000
  bytes (75 headroom); Electronics editor 187,873 / 222,000, unchanged.
  Initial app 382,841 / 570,000; chess 244,236 / 255,000; checkers
  158,901 / 160,000; 3D 2,870,467 / 2,900,000; Three vendor
  602,992 / 620,000; initial JS/CSS graph 555,421 / 600,000.
- Focused capability, position, copy invariance, UI contract and command
  reference tests: 108 PASS (5 files).
- `pnpm nx run web:typecheck`: PASS, 7 fresh tasks, cache 0/7.
- Scoped ESLint, Prettier and `git diff --check`: PASS.
- New native BEFORE and AFTER harness: 16/16 each, invariance assertions PASS.
- Existing native diagnostic-position harness: PASS at both widths, including
  shifted Unicode ranges after edits and mode switches, scroll and legacy input
  preservation. Receipts/screenshots are in `after/positions-existing/`.
- Electronics routing validation: PASS, all 114 validator regression tests PASS.
- All 72 actual worktrees inspected immediately before freeze: no candidate-path
  overlaps. Foreign untracked matrix reports and dirty workflows are preserved.

The broad uncached canonical gate belongs to the controller after source freeze.
No broad local gate was substituted for that run.
