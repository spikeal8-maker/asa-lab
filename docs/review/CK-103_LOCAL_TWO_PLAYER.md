# CK-103 — Local Two Player evidence

Status: IMPLEMENTED, focused and repository gates green
Base SHA: `2e8275df37a6c21620c27ef5bc47092bfda90763`
Scope: ASA Checkers only; no Chess, Electronics, 3D, classroom transport, or rules-engine rewrite.

## Product behavior

- Lobby `Играть вдвоём` is now a real enabled mode.
- A dedicated local setup explains Player 1/light and Player 2/dark.
- No second account, classroom, room, or server-side opponent is required.
- The optional auto-flip setting rotates the board to the side to move.
- Manual board flip remains available while auto-flip is enabled.
- Both players use the same Russian-64 rules engine and persisted game document.
- Local games provide restart/rematch, resign, draw, review, and return-to-lobby flows.
- An unfinished local game appears as a contextual resume card after reload.
## Persistence and non-regression

`CheckersProjectDocument` now persists an `activeMatch` discriminator with `mode=bot|local` and `localAutoFlip`.

Legacy CK-102 project documents that do not contain `activeMatch` are upgraded in memory to `mode=bot`, preserving their saved board and education state.

The bot turn effect checks `activeMatch.mode === 'bot'`. A persisted local game therefore cannot accidentally trigger a bot move even when a previous bot side or campaign selection still exists in browser/project state.

Bot campaign progression also requires `activeMatch.mode === 'bot'`, so local wins do not create learning evidence or unlock bot rungs.

## Verification

With `NX_SKIP_NX_CACHE=true`:

- `pnpm test:checkers` — PASS: 21 files / 85 tests.
- `pnpm nx run web:typecheck --skip-nx-cache` — PASS.
- `pnpm gate:checkers-m1` — PASS, exit 0.
- repository-wide typecheck — PASS for 26 projects.
- repository-wide production build — PASS for 26 projects.
## Browser acceptance contract

`e2e/checkers-module.spec.ts` now contains a local two-player journey that covers:

1. Lobby -> local setup -> start.
2. Light move followed by orientation switching to dark.
3. Persist/save, page reload, and `Локальная партия` resume.
4. Dark move followed by orientation switching back to light.
5. Local draw result and rematch back to light-to-move.

Playwright discovery sees 4 Checkers tests in the file, including this CK-103 journey.

Fresh browser execution is not claimed on this clean worktree because neither `APP_TEST_DATABASE_URL` nor `DATABASE_URL` is configured. The E2E harness requires an isolated test database; no shared or production database was substituted.

## CK-103 boundary

This checkpoint deliberately does not implement Friend invite, realtime multiplayer, Board V2, or the unified Match Session refactor. Those remain CK-104+ work. The current addition is the smallest persisted discriminator needed to distinguish bot and same-device local play safely until CK-105 performs the broader session convergence.
