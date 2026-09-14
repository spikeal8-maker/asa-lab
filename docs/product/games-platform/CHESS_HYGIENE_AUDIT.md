# ASA Games Platform — Chess Hygiene & R4 Readiness Audit

**Status:** supporting current-state audit  
**Observed main:** `16dea36ea023a7f1ffff5441cf1f739c5ef68de6`  
**Applies with:** `ENGINEERING_HYGIENE.md`  
**Correctness risks:** `CHESS_R4_CORRECTNESS_RISKS.md`

## 1. Scope and rule

Audited surfaces:

- `apps/web/src/chess/**`;
- `contexts/chess/**`;
- `contexts/chess-live/**`;
- `apps/api/src/chess-live.controller.ts`;
- focused Chess unit/E2E coverage.

This audit does **not** authorize an immediate Chess rewrite. R1–R3 remain Checkers/Games Core value stages. Chess refactoring is allowed earlier only for an actual Chess defect or when a touched review/hard-threshold hotspot would otherwise become worse.

## 2. Frontend hotspots

| File | Size | Verdict |
| --- | ---: | --- |
| `ChessEditor.tsx` | 29,428 B | Above source target. Mixes setup, bot picker, PGN/FEN dialog, player bars, move list and editor shell. Do not add another responsibility. |
| `ChessOnlineLobby.tsx` | 23,514 B | Near target. Owns challenge, matchmaking, polling/reconnect state and game rendering. R4 should extract session/sync orchestration before shared Games growth. |
| `chess.css` | 23,722 B | Near style target. Preserve the existing home/online/review/training stylesheet split. |
| `use-chess-project.ts` | 19,614 B | Within budget. Keep local-project state separate from generic online Games state. |

Recommended R4 seams, only when touched:

- extract new-game/bot setup and PGN/FEN exchange from `ChessEditor.tsx`;
- extract a `useChessLiveSession`-style orchestration seam from `ChessOnlineLobby.tsx`, keeping rendering game-owned;
- keep online styles in dedicated surface stylesheets.

Do not perform these extractions as an isolated cleanup campaign before R4.

## 3. Chess domain and analysis

`contexts/chess/application/chess-analysis-job-service.ts` is 40,591 B: above the source review threshold. It combines strict input/output validation, authorization/capability checks, job transitions and workflow orchestration. The next feature that touches this service should extract a bounded validator/codec or workflow seam instead of extending the file.

These files exceed the 24 KB target but are **not automatic refactor targets**:

- `contexts/chess/domain/chess.ts` — 28,452 B;
- `contexts/chess/domain/document.ts` — 28,596 B;
- `contexts/chess/domain/bot-profiles.ts` — 27,846 B.

`chess.ts` is the mature rules engine; `document.ts` owns persisted Chess document validation; bot profiles form a cohesive profile/policy catalog. Split them only if a future change adds unrelated responsibility, repeated regressions expose an unsafe boundary, or growth crosses the review/hard gate. Never rewrite chess rules merely to satisfy a byte target.

The largest inspected Chess test files (`training-library.spec.ts` ≈28.9 KB and `chess-analysis-job.spec.ts` ≈27.1 KB) remain below the 32 KB test target.

## 4. Chess Live boundary

`contexts/chess-live/application/service.ts` is 30,486 B and already coordinates challenges, command idempotency, authoritative commands/versioning, reconnect/spectator events, matchmaking and rating. R4 must **not** turn it into the generic Games service or add more platform responsibilities. Treat it as a mature Chess compatibility boundary and migrate common capabilities through Games adapters/shadow mapping.

`PgChessLiveRepository` is ~22.2 KB and `chess-live.controller.ts` ~14.4 KB, both within source budget. Their transaction/idempotency patterns are donors, not files to rename into generic Games infrastructure.

The 30-byte `application/chess-live.service.ts` is a re-export compatibility shim. Delete it only after repository/package references prove it unnecessary.

## 5. Correctness and contract risks

Detailed risks are split into `CHESS_R4_CORRECTNESS_RISKS.md` so this audit remains bounded. The current mandatory set is:

- `CHESS-CORR-001`: finished rated match and rating projection are not in one recoverable atomic/finalizer boundary; R4B cutover is blocked until this is resolved and fault-tested;
- `CHESS-CORR-002`: web Chess manually mirrors server DTOs; Games Core must use a dedicated contract boundary instead of copying this pattern into global `api.ts`;
- `CHESS-CORR-003`: the idempotent matchmaking retry-body cache has no explicit terminal eviction; preserve exact-body semantics while bounding its lifecycle.

These are correctness/contract items, not excuses for a broad cleanup rewrite.

## 6. Existing online behavior R4 must preserve

Current browser E2E already provides parity anchors:

- two independent browser contexts create/accept a challenge code;
- server-authoritative moves become visible to both players;
- reconnect returns snapshot plus ordered events;
- forged tenant/user/result/FEN/clock fields are rejected;
- rated matchmaking pairs players;
- resignation writes expected rating/ledger on the normal path.

R4 is not accepted until these behaviors pass on the shared Games path and the `CHESS-CORR-001` failure/recovery case is proven.

## 7. Garbage/generated-content verdict

No Chess-specific tracked artifact directory exists under `e2e/artifacts/chess`; current Chess E2E writes screenshots under generic `e2e/artifacts/`. Normal local output stays governed by `.gitignore` and `ENGINEERING_HYGIENE.md`.

Do not classify tiny re-export files, contract-marker comments or historical evidence as garbage without reference checks. New local traces/videos/screenshots/debug dumps are not committed unless an acceptance receipt explicitly requires them.

## 8. Optimization schedule

- **R0:** audit only; no runtime refactor.
- **R1–R3:** no Chess cleanup campaign if Chess is untouched. If a real Chess defect is fixed, apply changed-file hygiene and do not worsen hotspots.
- **Before R4:** run `GP-HYG-005` against fresh `main`; re-measure hotspots and review all `CHESS-CORR-*` risks.
- **R4A:** compatibility/shadow mapping plus only bounded extractions needed for understandable seams.
- **R4B:** cut new Chess matches to Games Core only after parity, fault/retry and hygiene evidence pass.
- **R4 exit:** full Chess/Games hygiene audit; no new hard-threshold files, duplicated generic matchmaking/rating/history implementation or ownerless temporary cutover paths.

The optimization objective is not minimum file size. A small Chess change must remain a small, predictable change while mature rules, analysis, learning and online behavior remain protected.