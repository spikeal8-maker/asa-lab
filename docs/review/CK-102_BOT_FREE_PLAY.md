# CK-102 — Bot Free Play

Date: 2026-09-12
Scope: ASA Checkers bot free-play vertical

## Outcome

CK-102 separates ordinary bot play from the educational ASA Bot ladder.
A learner can now choose any of the six bots without unlocking earlier rungs,
choose light, dark or random side, start a game, see an explicit result,
request a rematch, choose another opponent, or open review.

The educational ladder remains available as a separate campaign and is the
only bot mode that changes ladder progression.

## Persisted compatibility

`education.activeBotMode` is persisted as `free | campaign` so reload/resume
does not infer match semantics from the current UI surface.
New documents default to `free`. Documents created before CK-102 are accepted
without the field and migrate in memory to `campaign`, preserving the meaning
of the pre-CK-102 bot ladder.

This marker is intentionally additive and temporary infrastructure until the
explicit Match Session convergence planned for CK-105.
## Behaviour protected

- free play ignores `unlockedBotRung` for bot availability and bot turns;
- campaign still enforces rung locks;
- teacher `bot-milestone` override keeps its pre-existing ability to open the assigned rung;
- free-play wins do not change campaign progress;
- campaign victory is evaluated relative to the human side, so `0-1` is a human win when playing dark;
- resignation records the opponent as winner;
- random side is resolved once at game start and the resolved side is persisted for safe resume;
- completed bot games are read-only and show explicit win/loss/draw actions.

## UI contract

The free-play setup exposes every ASA Bot immediately and presents three side choices:
`light`, `dark`, and `random`. The educational ladder remains reachable through an explicit
“Лестница ASA Bot” action instead of being the only route to a bot game.

The finished-game surface contains:

- explicit result;
- `Реванш`;
- `Другой соперник`;
- `Разобрать партию`.

The E2E journey was updated to assert that the strongest bot is enabled in free play and
that the free-play side controls are visible before starting the existing bot smoke game.
## Verification

Executed from a clean CK-102 worktree with `NX_SKIP_NX_CACHE=true`:

- `pnpm test:checkers` — PASS: 20 test files, 81 tests;
- `pnpm typecheck:checkers` — PASS;
- `pnpm nx run web:typecheck` — PASS;
- `pnpm gate:checkers-m1` — PASS, exit 0;
- repository-wide typecheck — PASS for 26 projects;
- repository-wide production build — PASS for 26 projects.

The first isolated test attempt before prerequisite workspace builds failed only because
local package `dist` entries were not built in the fresh worktree. After executing the
same prerequisite builds encoded by `gate:checkers-m1`, all focused tests passed.

## Browser evidence status

`e2e/checkers-module.spec.ts` is updated for the CK-102 free-play flow. A fresh browser
run was not claimed: neither `APP_TEST_DATABASE_URL` nor `DATABASE_URL` is configured
on this clean machine. The existing E2E harness requires an isolated `*_test` database.
No production/shared database, Docker service, or deployment was changed to manufacture
a browser PASS.
