# R3-C1 Project Lifecycle Convergence Evidence

**Status:** PASS after bounded regression fix  
**Purpose:** prove that the R3B Project Lifecycle implementation is already present in current `main` and must not be merged again from stale PR #112.

## Baseline

- Product test baseline: `5f5ee6aab8e2981300ff25c698ac6e4f1e4987ce`
- Fresh-main delta checked through: `55ea4df254786fd5067b31da78e70a8ae8f99250`
- R3B delivery commit: `731140dcc0855f728def15932e59710a2a75648a`
- GitHub history shows current `main` is ahead of the R3B delivery commit; R3B is not a missing branch-only implementation.

## Verified product capabilities

Current `main` contains and exercises:

- `active / archived / trashed` lifecycle;
- archive, trash and restore without deleting the draft;
- duplicate with idempotency;
- search, sort and pagination in My Projects;
- immutable `project_versions` checkpoints;
- project snapshot lifecycle;
- personal-project ownership and tenant isolation.

## Focused Project tests

Executed against a fresh isolated PostgreSQL database `asalab_r3c1_test` after all current migrations were applied.
Command:

```text
pnpm test:project-slice
```

Result:

```text
4 test files passed
75 tests passed
0 failed
```

The suite includes real PostgreSQL transaction/API coverage, including lifecycle transitions, duplicate, pagination, immutable checkpoints and stale-write protection.

## Browser Project Hub journey

Current `e2e/project-hub.spec.ts` was run against the same isolated database and a temporary API on port `4623`.

Result:

```text
1 passed
```

The journey proves desktop and mobile Project Hub behavior for duplicate, archive, restore, trash and no horizontal page overflow at the checked viewports.
## Regression found during R3-C1

The first current-main browser run exposed two integration drifts rather than a missing R3 implementation:

1. the E2E still targeted the removed `entry-sign-up` test id;
2. the portal header had five visible desktop grid items but a four-column workspace grid, producing a 31 px horizontal overflow at 1440 px.

The fix is intentionally bounded:

- update the E2E entry locator to the current public landing action;
- declare the fifth header grid column explicitly on desktop;
- keep the responsive header grid explicit on mobile/tablet as well.

No Project domain, API, database, Gallery or publication behavior is changed.

## Fresh-main delta

After testing, `origin/main` advanced to `55ea4df...`. The bounded diff from the tested baseline changed only `docs/execution/current.yaml` in the inspected Projects-related path set; production Project/header/E2E paths did not change.

## R3-C1 conclusion

R3B product behavior is already integrated and testable in `main`. PR #112 must therefore be treated as stale/superseded, not merged.

The remaining blocker is governance state: `docs/execution/current.yaml` still records R3B as in progress. That correction belongs to the next bounded step, **R3-C2 Control-plane convergence**, after this regression fix is accepted.

**NEXT:** STOP after this PR; do not start R7 automatically.
