# TASK-R3B-PROJECT-LIFECYCLE-001 evidence

## Result

| Field | Value |
| --- | --- |
| TASK | `TASK-R3B-PROJECT-LIFECYCLE-001` |
| ISSUE | `#37` |
| STATUS | Implemented on `agent/r3-project-lifecycle`; Draft PR `#112` remains Draft |
| VISIBLE_RESULT | Tinkercad-inspired two-level portal shell, persistent sidebar, Project Hub gallery, search/filter/sort/layout controls, archive, recoverable trash and duplicate actions |
| USER_FLOW | Register/sign in → My projects → duplicate → archive → restore → trash → view mobile layout |
| PORTS | Persistent `4610/4611` untouched; preview `4613` used temporarily and stopped; temporary PostgreSQL containers removed |
| DEMO_URLS | No preview is intentionally left running |
| MAP_NODES_CHANGED | None |
| WORKING_TREE | Intended R3B product changes only; verify again at review head |
| NEXT_ALLOWED_TASK | Review Draft PR `#112`; do not mark ready or merge without owner decision |

## Screenshots

- `e2e/artifacts/project-hub/r3b-project-lifecycle/01-project-hub-desktop.png`
- `e2e/artifacts/project-hub/r3b-project-lifecycle/02-project-hub-mobile.png`

## Tests run

- `python tools/validate_control_plane.py` — PASS.
- Clean isolated `asalab_test` migration — PASS, 12 migrations applied.
- `pnpm test:project-slice` — PASS, 27 tests (13 domain + 14 real API/RLS).
- Exact `test:creator-portal` file set, run directly with the pinned project pnpm and isolated database — PASS, 17 tests.
- `playwright test e2e/project-hub.spec.ts` with installed Chrome and the evidence config — PASS, one complete desktop/mobile journey.
- `NX_SKIP_NX_CACHE=true pnpm typecheck` — PASS, all 23 projects and 11 dependent tasks executed without Nx cache.
- `NX_SKIP_NX_CACHE=true pnpm lint` — PASS, all 23 projects executed without Nx cache.
- `pnpm boundaries:check` — PASS.
- `pnpm contracts:check` — PASS, OpenAPI 3.1 with 12 paths.
- `pnpm compose:check` — PASS.
- `pnpm security:secrets` — PASS.
- `pnpm security:dependencies` — PASS, 0 critical/high, 1 moderate advisory.
- `NX_SKIP_NX_CACHE=true pnpm build` — PASS, all 23 projects executed without Nx cache.

## Honest gate status

`pnpm gate:code` is not reported as PASS. Its first `prettier --check .` step scans
unrelated `.codex-worktrees/**` directories and fails on 55 files owned by other
lanes. Those files were not modified. Every remaining `gate:code` step was run
separately and passed, and every R3B changed text file passes Prettier.

On this Windows host, `tools/run-creator-portal-tests.mjs` also resolves an
external Codex pnpm instead of the repository-pinned pnpm 9.15.9. The wrapper
stops before tests with a frozen-lockfile configuration mismatch. Its exact test
file set was therefore run directly with the pinned pnpm and passed on the same
isolated database.
