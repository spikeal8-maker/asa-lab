# Scratch activity acceptance bundle repair

Owner requested completing the remaining Main check failures without deployment.
Baseline `73bf5b77`: hosted Publication, Chess and AI focused workflows succeeded;
Scratch ZIP first-start/persistence also succeeded. Scratch standalone acceptance
failed before running its activity/minute-save assertions.

## Exact cause

Completed job `125208121050` failed in `product-bundle.mjs`: its independent Vite
build did not load the web config's pure 3D subpath aliases. Rollup interpreted
workspace CommonJS output as ESM and could not import `parseThreeDDocument`.
The shared preview also made the fixture build split into multiple modules, while
the HTTP fixture served only the entry script. Fixing just the alias therefore
still left the real editor unable to mount.

## Change

- Resolve contracts and the existing pure 3D document/operations subpaths to their
  canonical sources, consistently with the application build.
- Serve all emitted chunks/assets through the fixture's existing in-memory file
  map, with JS/CSS content types, alongside its existing entry and CSS URLs.
- Keep real shipping components, pinned Scratch runtime, analytics observation,
  virtual minute clock, persistence assertions, failure handling and artifact
  requirements unchanged. No stubs for the editor or activity receipts.

## POST_STEP_REVIEW

- CHANGE_CLASS: test-infrastructure-only compatibility repair.
- LAYOUT_IMPACT: none; no user interface or production bundle config changed.
- TESTS: real pinned Scratch activity/minute-save regression PASS; shipping host
  avatar/runtime-failure regression PASS; newest-edit minute checkpoint PASS;
  failed asset PUT blocks draft PUT PASS. Four browser scenarios total.
- NEGATIVE_CHECKS: idle/heartbeat/synthetic input do not fabricate activity;
  genuine user input creates bounded sessions; autosaved document contains the
  edited sprite; failed assets do not produce a successful draft write.
- SOURCE_CHECKS: focused ESLint, Prettier and diff whitespace checks pass.
- UNVERIFIED: final-commit hosted workflows until completed. Local browser uses
  the existing pinned standalone service, without restarting/updating it.
- VERDICT: local focused checks PASS; no claim of deployment or completed new CI.

Local proof: operations reports `scratch-final-activity-proof.json` and
`scratch-final-shared-proof.json`. Working database, Docker installation, user
projects and previously generated owner screenshots were preserved.
