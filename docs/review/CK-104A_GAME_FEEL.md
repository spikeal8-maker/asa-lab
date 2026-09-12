# CK-104A — Game Feel & Rule Clarity

**Status:** implemented, owner visual acceptance pending
**Date:** 2026-09-12
**Base:** `b6f0812003f6066ee7de30a9b7a310885d8f86af`

## Why this stage exists

CK-104 made Board V2 technically correct, but owner testing showed that a correct renderer was not enough: pieces still felt like pills, ordinary movement was visually weak, multi-captures were hard to read, and mandatory backward capture looked like the game was arbitrarily blocking a normal forward move.

CK-104A treats those as product defects, not cosmetic preferences.

## Implemented

- pieces now use a warmer physical checker treatment with visible rim, thickness and contact shadow;
- the stable piece slot follows every square in `lastMovePath` using Web Animations API;
- the piece face performs a lift/landing motion on every movement segment;
- multi-capture choices render the complete path before the move;
- each landing in a capture sequence is numbered `1, 2, 3...`;
- captured pieces are removed with staged ghost/fade timing matching `capturedIds` order;
- forced capture has a visible rule callout instead of silently hiding quiet moves;
- the callout explicitly states that capture is mandatory and a man may capture both forward and backward in Russian draughts;
- selected multi-capture help tells the player how many opponent pieces must be removed in the turn;
- reduced-motion preference disables the JS route animation as well as CSS movement effects while keeping route/rule information visible.

## Real browser proof

The existing learner E2E now opens the canonical starter task `capture-series`:

`c3 → e5 → g7`

Before the move it verifies two route segments and numbered landing markers. After the move it verifies `data-motion-steps=2` and two capture ghosts with distinct animation delays.

Evidence screenshot:

`e2e/artifacts/checkers/checkers-capture-series-game-feel.png`

The screenshot shows the exact numbered capture route and the rule explanation in the live product UI.
## Verification

- `pnpm gate:checkers-m1` with Nx cache disabled — PASS after the game-feel changes;
- 22 focused test files / 92 tests — PASS;
- web typecheck — PASS;
- production web build — PASS;
- isolated PostgreSQL `asa_checkers_gamefeel_test` — 105 migrations applied;
- `pnpm e2e:checkers` — 4/4 Playwright tests PASS;
- the temporary PostgreSQL container was removed after each browser run.

No Russian-64 rule code was changed in CK-104A. The renderer consumes the canonical legal move path and captured-id sequence produced by the existing domain engine.

## Remaining acceptance

The implementation is technically accepted by tests, but visual/game-feel acceptance remains with the owner. If the physical checker treatment still does not feel right, the next iteration should change only the piece skin/easing/effects while keeping the same tested movement and rule semantics.
