# Preview-as-Learner — POST_STEP_REVIEW

- STEP: complete the already-open E1 author preview against exact saved draft and immutable published activity version.
- CHANGE_CLASS: L3_CRITICAL (read-only authorization and migration boundary).
- CHANGED: existing author endpoint/AssignmentView integration, explicit OpenAPI preview contract, additive read-only session resolver (0137), HTTP and browser regressions. A pre-existing unreachable `Attempt.state === accepted` branch in ClassroomGradebook was removed to restore typecheck after lifecycle convergence; pedagogical acceptance stays in Result.
- USER_RESULT: author can read the exact saved draft or published version, sees source revision/version, and cannot execute or submit through Preview. A late response cannot replace the newer selected preview. Expired-session preview does not silently refresh credentials.
- INVARIANTS_TOUCHED: LRN-PRV-001, LRN-AUTH-001, LRN-VER-001, identity session validity, lifecycle/result separation.
- TESTS: see exact commands below. Final HTTP suite 8/8; focused unit suites 43/43; browser 1/1. API/Web builds, Web typecheck, contracts, migration checks and governance passed locally. No Nx cache was used.
- NEGATIVE_CHECKS: foreign author, actual foreign version, missing version, absent session, stale revision, mixed source parameters, integer overflow/scientific revision syntax, revoked/expired session, suspended account, revoked workspace membership; stale browser response; no automatic refresh write.
- DOC_DRIFT: new normative targets are in docs/product-spec-v1.4 (Draft PR 208). This recovery-based E1 branch is deliberately not converged with current main; full E1 semantic integration remains a later blocker.
- UNVERIFIED: full E1 browser journey, final mixed-data upgrade, full repository gate and owner acceptance. These focused results are not a release candidate.
- VERDICT: PASS for bounded Preview implementation; E1 remains unfinished and not owner-accepted.

## Evidence commands

Executed from the physical Windows/MSIX path for this worktree, with `NX_SKIP_NX_CACHE=true` and `NX_DAEMON=false` for Nx:

```text
pnpm nx run api:build                    # 15 tasks rerun, cache skipped
pnpm nx run web:build                    # 6 tasks rerun, cache skipped
pnpm nx run web:typecheck                # 6 tasks rerun, cache skipped
pnpm vitest run contexts/identity/testing apps/api/src/learning-activities.controller.spec.ts apps/web/src/session-fetch.spec.ts
pnpm vitest run tests/account/access-a.pg.spec.ts -t "Result A"
pnpm playwright test e2e/learning-author-preview.spec.ts --workers=1
pnpm contracts:check
pnpm db:migrate:check
pnpm gate:governance
git diff --check
```

ESLint also passed on the changed controller, author page, session-fetch source/test, identity port/usecase/store, HTTP regression and browser test. The HTTP suite used `asa_e1_preview_final_20260913_test`, freshly created with all 136 migration files through 0137. No working database, Docker service or protected asset was changed. The browser runner used only `127.0.0.1:4612` and exited after the test.

Snapshots: `e2e/artifacts/learning/author-preview/published-v1.png` and `saved-draft-r2.png`. Registration, author activation, material creation/publication/edit/save and Preview were performed through the real UI/API; only a response's delivery was delayed to test concurrency.

## Failed attempts retained in the stabilization receipt

- The initial Nx command selected no tasks because its projects argument was not quoted for PowerShell; it was not counted as validation.
- First Web/Vitest runs used an AppData alias that Vite resolved inconsistently through MSIX. API build succeeded; Web failed and Vitest ran no tests. Using the physical worktree path resolved both.
- The first all-table write guard exposed `session_v2_context` updating `sessions_v2.last_seen_at`. Migration 0137 and the existing resolver's optional read-only mode fixed that; ordinary requests retain old behavior.
- An initial session timestamp test assumed the local time zone; its fixture now uses explicit UTC.
- First browser launcher omitted ASA_WEB_PORT=4612 and correctly failed the origin check. The final run used matching E2E port/origin.
- Web typecheck exposed the inherited obsolete accepted lifecycle comparison noted above. It passes after its bounded removal.
- GitHub run 34753263859 passed governance but stopped the code gate at Prettier: 11 files, including the changed session store. The session store formatting was fixed and all changed Preview code files pass Prettier. The other 10 formatting failures are inherited from the E1 recovery snapshot; downstream CI PostgreSQL/RLS and Access A browser jobs were skipped. No repository PASS or release candidate is claimed.

Stop here: do not start draft-from-old-version, Teacher Home, archive/restore, mixed-data reminders, E2/E3, programming runner, or deployment without further scope.
