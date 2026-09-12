# CK-104 — Board V2 evidence

**Date:** 2026-09-12
**Base SHA:** `b7922edfac3db96da726324c95a77ac3e605cf87`
**Scope:** renderer/game feel only; Russian-64 rules were not changed.

## Result

`CheckersWorkspace` now uses `CheckersBoardV2` as the active board renderer. The old `CheckersBoard` remains in the codebase only as a parity reference and is covered by an explicit V1/V2 contract test.

Board V2 separates the board into independent visual/interaction layers:

- grid layer;
- move/selection/last-move hint layer;
- animated piece layer;
- coordinate layer;
- transparent interaction layer with the original 64 keyboard/ARIA cells.

The canonical position is still the existing `CheckersDocument`; Board V2 owns no rule state.

## Implemented behavior

- Pieces are no longer DOM children of board cells. A stable piece element moves by CSS `transform`, so a normal move is animated instead of teleporting between buttons.
- Captured pieces receive a short fade/scale ghost using their previous square.
- Promotion from man to king receives a separate pulse and the king marker is inline SVG, not a text glyph.
- The last move highlights its start/end path without changing legal-move state.
- Mandatory captures are surfaced on the movable piece and capture destination.
- Three board themes are available: `classic`, `light`, `dark`.
- Board frame/shadows were reduced and the default `classic` palette is game-like brown/beige rather than the old teal educational card.
- Keyboard navigation, click, drag/drop, ARIA grid semantics and orientation are retained.
- `prefers-reduced-motion` disables Board V2 movement/capture/promotion animations.

CK-104 also fixed a CK-103 integration defect exposed by the first real browser run: entering Local Two Player from an initial bot state incorrectly inherited `localAutoFlip=false`. A new local setup now defaults auto-flip to enabled while preserving an already configured local preference.

## Verification

Focused/code verification on the CK-104 working tree:

- `pnpm test:checkers` — PASS: 22 test files / 90 tests.
- V1/V2 interaction parity test — PASS for 64 cells, selected piece, legal destination and movable-piece state.
- `pnpm gate:checkers-m1` with `NX_SKIP_NX_CACHE=true` — PASS, exit 0.
- repository-wide typecheck — PASS for 26 projects.
- repository-wide production build — PASS for 26 projects.

Real browser proof used an ephemeral PostgreSQL container on an isolated database named `asa_ck104_test`. The database was reset, all 105 migrations were applied, the runtime role was provisioned, and `pnpm e2e:checkers` completed **4/4 PASS**. The temporary database container was removed after the run.
The browser journey directly verifies `data-renderer=v2`, all three themes, forced-capture marker, CSS transform movement, stable piece identity across `c3 → e5`, last-move highlighting, local auto-flip/reload/rematch, classroom keyboard control and existing safety flows.

Fresh evidence images are tracked at:

- `e2e/artifacts/checkers/checkers-student-desktop.png`
- `e2e/artifacts/checkers/checkers-student-tablet.png`
- `e2e/artifacts/checkers/checkers-student-mobile.png`
- `e2e/artifacts/checkers/checkers-class-safe-play.png`

## Acceptance

CK-104 acceptance is satisfied: Board V2 preserves V1 interaction state for the same input, desktop/tablet/mobile browser scenarios pass, and an ordinary move is rendered by transform animation instead of DOM teleportation.
