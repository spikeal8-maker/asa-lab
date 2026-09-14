# ASA Games Platform — Chess Hygiene & R4 Readiness Audit

**Status:** supporting current-state audit  
**Observed main:** `16dea36ea023a7f1ffff5441cf1f739c5ef68de6`  
**Applies with:** `ENGINEERING_HYGIENE.md`  
**Purpose:** keep current Chess behavior stable while preventing R4 Games Core convergence from growing existing hotspots or preserving avoidable consistency debt.

## 1. Scope and rule

Audited surfaces:

- `apps/web/src/chess/**`;
- `contexts/chess/**`;
- `contexts/chess-live/**`;
- `apps/api/src/chess-live.controller.ts`;
- focused Chess unit/E2E coverage.

This audit does **not** authorize an immediate Chess rewrite. R1–R3 remain Checkers/Games Core value stages. Chess refactoring is allowed earlier only for an actual Chess defect or when a touched hard/review-threshold hotspot would otherwise become worse.

## 2. Frontend hotspots

| File | Size | Verdict |
| --- | ---: | --- |
| `ChessEditor.tsx` | 29,428 B | Above source target. Mixes game setup, bot picker, PGN/FEN dialog, player bars, move list and editor shell. Do not add another surface/responsibility. |
| `ChessOnlineLobby.tsx` | 23,514 B | Near target. Owns challenge, matchmaking, polling/reconnect state and game rendering. R4 must extract session/sync orchestration before adding shared Games features. |
| `chess.css` | 23,722 B | Near style target, but Chess already has separate home/online/review/training CSS. Preserve that split; R4 styles must not be appended indiscriminately here. |
| `use-chess-project.ts` | 19,614 B | Within budget. Keep as local-project controller; do not mix shared online Games state into it. |

Recommended R4 seams, only when touched:

- extract new-game/bot setup from `ChessEditor.tsx`;
- extract PGN/FEN exchange dialog from `ChessEditor.tsx`;
- extract `useChessLiveSession`-style orchestration from `ChessOnlineLobby.tsx` while keeping rendering game-owned;
- keep online styles in the existing dedicated online stylesheet or smaller surface styles.

Do not perform these extractions as an isolated cleanup project before R4.

## 3. Chess domain and analysis

`contexts/chess/application/chess-analysis-job-service.ts` is 40,591 B: above the source review threshold and close enough to the hard threshold that new responsibilities require decomposition first. It currently combines strict input/output validation, authorization/capability checks, job transitions and service orchestration. The next analysis-platform feature touching it should extract a bounded validator/codec or workflow seam instead of extending the file.

The following files exceed the 24 KB target but are **not automatic refactor targets**:

- `contexts/chess/domain/chess.ts` — 28,452 B;
- `contexts/chess/domain/document.ts` — 28,596 B;
- `contexts/chess/domain/bot-profiles.ts` — 27,846 B.

`chess.ts` is the mature rules engine; `document.ts` owns the persisted Chess document/schema validation; bot profiles are a cohesive profile/policy catalog. Split them only if a future change adds unrelated responsibility, repeated regressions show an unsafe boundary, or growth crosses the review/hard gate. Never rewrite chess rules merely to satisfy a byte target.

Current Chess tests are below the test-source target of 32 KB; the largest inspected suites (`training-library.spec.ts` ≈28.9 KB and `chess-analysis-job.spec.ts` ≈27.1 KB) require no size-only action.

## 4. Chess Live application boundary

`contexts/chess-live/application/service.ts` is 30,486 B. It is below the 32 KB review threshold but already coordinates multiple capabilities:

- challenge lifecycle and public code acceptance;
- command idempotency/fingerprints;
- authoritative game commands and optimistic versioning;
- reconnect/spectator event delivery;
- matchmaking pairing;
- rating reads/finalization.

R4 must **not** turn this class into the generic Games service or keep adding platform responsibilities to it. Treat it as a mature Chess compatibility boundary. General capabilities move into Games Core through adapters/shadow mapping; Chess rules remain Chess-owned.

`PgChessLiveRepository` is ~22.2 KB and the API controller ~14.4 KB, both within source budget. Their transaction/idempotency patterns are donors, not files to rename into generic Games infrastructure.

The 30-byte `application/chess-live.service.ts` is a re-export compatibility shim. It is a cleanup candidate only after repository/package import references are proven absent; do not delete it by guesswork.

## 5. Correctness finding — rated finalization atomicity

**CHESS-CORR-001 — rating finalization can diverge from completed match state.**

Current command flow persists the finished game/events/command receipt first. If the game became finished and rated, `applyRatingUpdate()` runs afterward as a separate repository write. The returned `saveRatingUpdate()` result is not used to change the command result.

Failure window:

1. resignation/terminal command successfully saves finished game + receipt;
2. process/DB failure occurs before or during rating update;
3. caller retries the same command;
4. command receipt makes the retry a replay;
5. replay returns the saved game and does not re-run rating finalization.

The existing happy-path E2E proves normal rated resignation writes both ratings/ledger, but it does not close this failure window.

**R4 gate:** before Chess cutover to Games Core, terminal match + rating/stat projection must use an atomic/outbox/idempotent-finalizer design, and a fault-injection test must prove recovery after failure between match completion and rating projection. If current production Chess rating is relied on before R4, fix this as a separate bounded Chess correctness task rather than hiding it inside hygiene work.

## 6. Client/API contract debt

`apps/web/src/chess/chess-live-api.ts` manually defines challenge/game/ticket/rating DTOs that mirror server/domain views. This is workable for current Chess but is a contract-drift risk if copied into Games Core.

R4 rule:

- do not add generic Games DTOs to the already-large global `apps/web/src/api.ts`;
- use a dedicated Games contract/OpenAPI/generated/shared DTO boundary;
- preserve Chess compatibility through an adapter until parity is proven.

The module-level `matchmakingBodies` map intentionally preserves the exact request body for idempotent polling with one command ID, but it has no eviction. Treat it as bounded-lifecycle debt: preserve exact-body retry semantics while removing entries when a ticket reaches terminal state/game starts, or replace it with an explicit session-owned retry payload. Do not replace it with recomputed payloads that can cause idempotency fingerprint conflicts.

## 7. Current online behavior that R4 must preserve

Existing browser E2E already proves useful parity anchors:

- two independent browser contexts create/accept a challenge code;
- server-authoritative moves become visible to both players;
- reconnect returns snapshot plus ordered events;
- forged tenant/user/result/FEN/clock fields are rejected;
- rated matchmaking pairs players;
- resignation writes expected rating/ledger on the normal path.

R4 is not accepted until these behaviors are preserved on the shared Games path plus the `CHESS-CORR-001` failure case.

## 8. Garbage/generated-content verdict

No Chess-specific tracked artifact directory was found under `e2e/artifacts/chess`; current E2E writes diagnostic screenshots under generic `e2e/artifacts/`. Normal local outputs remain governed by `.gitignore` and `ENGINEERING_HYGIENE.md`.

Do not treat tiny re-export files, contract-marker comments or historical evidence as garbage without a reference check. Conversely, new local traces/videos/screenshots/debug dumps must not be committed unless an acceptance receipt explicitly requires them.

## 9. Optimization schedule

- **R0:** record this audit only; no runtime refactor.
- **R1–R3:** if Chess is untouched, no Chess cleanup campaign. If touched for a defect, apply changed-file hygiene and do not worsen hotspots.
- **Before R4:** run `GP-HYG-005` structural audit against fresh `main`; re-measure the table above and verify `CHESS-CORR-001` status.
- **R4A:** create compatibility/shadow mapping and only the bounded extractions needed to keep Chess UI/application seams understandable.
- **R4B:** cut new Chess matches to Games Core only after parity, fault/retry and hygiene evidence pass.
- **R4 exit:** full Chess/Games hygiene audit; no new hard-threshold files, no duplicated generic matchmaking/rating/history implementation, no temporary cutover paths left without an explicit owner/removal stage.

The optimization objective is not minimum file size. It is to make a small Chess change remain a small, predictable change while preserving the mature rules, analysis, learning and online behavior.