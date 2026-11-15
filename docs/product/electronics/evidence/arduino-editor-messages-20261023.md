# Point 4 — Arduino workspace message initialization

Task: `TASK-ELECTRONICS-ARDUINO-LOG-ERROR-001`. Bounded repair; no deployment.

## Requirement and cause

Prevent the repeated native Arduino block-editor menu exception without changing
workspace intent, generated Arduino code, persistence or simulation semantics.

The installed release `6e80e3f3e87a8f815ac6b254fd0b3ffa942db2d3` reported 30
TypeErrors at `ArduinoCodePanel-BLDbiImP.js:2325:53490` during 23 October
09:00–16:00 Moscow time. Exact private release symbols identify
`scratch-blocks@2.1.19/dist/main.mjs:1:849700`:
`workspaceDelete.displayText -> Msg.DELETE_X_BLOCKS.replace(...)`.
Asset SHA-256: `4c2c7db8ba3989e8294ff172fbca3e929319300ebf13c6532fb10bb204401778`.
Private maps and user logs are not committed.

The package exports translations but does not activate its initial English locale.
Before this repair, Arduino never selected any locale; `DELETE_X_BLOCKS` was
undefined. Opening the workspace menu with multiple deletable blocks therefore
threw before rendering its options. Repeated opening could repeat the exception.

## Implementation

Select the package's bundled Russian locale before block registration/injection,
including repeated registration calls after definitions already exist. No patch
to vendor files, network translation fetch, swallowed exception or fallback writer.
All built-in menu/variable messages come from the pinned vendor translation set.

## Focused author evidence

- Three actual-vendor regression tests PASS: reproduce the exact TypeError with
  the missing message, restore it via production registration, render the real
  delete label repeatedly, preserve serialization/generated code through reload,
  and cancel native variable creation without creating a variable.
- Existing 12 Arduino contract tests and nine panel persistence tests PASS.
- `nx run web:typecheck` PASS, including its dependency builds.
- Playwright discovery lists exactly four targeted cases: 1440/1024/390/320 px.
- Electronics task routing validator PASS; no production browser run locally.

The explicit `arduino-editor-error` profile of the existing focused workflow
builds the web application and runs the four native-menu cases against an
intercepted API fixture. It captures screenshots and checks repeated right-click,
close/reopen, unchanged workspace/source and page/menu bounds. It is not the
full electrical or classroom qualification. Independent review and exact-SHA
GitHub browser evidence remain controller acceptance requirements.

## Self-review

CHANGE_CLASS: L1_UI_BEHAVIOR; high-risk module, independent review required.
LAYOUT_IMPACT: built-in Russian vendor menu/prompt text only; no JSX/CSS change.
VIEWPORTS / VISUAL_EVIDENCE: four GitHub browser cases authored; pending CI.
NEGATIVE_CHECKS: old missing-message throw is reproduced, cancelled variable
creation does not mutate the variable map, menu labels do not mutate the program.
No simulation, authorization, database or deployment behavior is changed.

## Limits and stop

The other 11 exception reports in that bundle include nine gesture-start errors,
one invalid-colour error and one menu-content error. Some may follow an aborted
menu gesture, but that causal chain is not proven; this slice does not claim
all 41 reports repaired. No 5000-user capacity or post-deployment claim is made.

NEXT_ALLOWED_TASK: STOP / OWNER REVIEW.
