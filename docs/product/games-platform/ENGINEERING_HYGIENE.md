# ASA Games Platform — Engineering Hygiene & File Budget

**Status:** canonical cross-stage process contract  
**Applies to:** Games work from R0 onward  
**Purpose:** keep Games development cheap to change, easy for agents to understand and free of accumulated generated/debug garbage without turning refactoring into a project of its own.

## 1. Core rule

User value remains the delivery driver. Hygiene exists to prevent the next result from becoming harder and more expensive.

- Do not create new monolithic files when a bounded component/service/adapter can own the responsibility.
- Do not run open-ended cleanup outside the active Games scope.
- Existing large files are **grandfathered debt**, not a reason to stop delivery and rewrite everything first.
- A grandfathered file above the hard threshold must not receive a new responsibility. New behavior is added through an extracted seam/module and the legacy file remains orchestration only.
- Generated/transient output is not source code and must not become repository state unless it is explicit acceptance evidence.

## 2. Size budgets

Budgets are measured as UTF-8 file bytes because they are cheap to inspect consistently in GitHub/CI. Size is a trigger for review, not a substitute for architecture review.

| File class | Target | Review threshold | Hard threshold | Rule |
| --- | ---: | ---: | ---: | --- |
| runtime/source (`ts/tsx/js/mjs/py`) | ≤24 KB | >32 KB | >48 KB | New files must stay below hard; hard legacy files may not gain new responsibility. |
| styles (`css/scss`) | ≤24 KB | >36 KB | >48 KB | Split by surface/component instead of appending unrelated styles. |
| test source | ≤32 KB | >48 KB | >64 KB | Split by behavior/failure mode; do not create one mega-suite. |
| compact agent/router docs | ≤4 KB | >6 KB | >8 KB | Split details into escalation/supporting docs. |
| decision/audit/task docs | ≤8 KB | >10 KB | >12 KB | One bounded decision/result per file. |
| master/escalation docs | ≤12 KB | >16 KB | >24 KB | Split by stable topic and keep a short index/router. |

SQL migrations are judged primarily by atomic responsibility. A migration above 32 KB requires review, but an already published migration is never split/re-written merely to satisfy size.

Generated machine files, lockfiles and deterministic fixtures may exceed these limits only when their path and ownership make generated status explicit. They are not manually edited to chase a byte target.

A file below the byte threshold still requires decomposition if it owns multiple unrelated state machines, UI surfaces or domain responsibilities.

## 3. Existing Games hotspots

Initial current-main baseline already contains debt that must be managed rather than ignored:

- `apps/web/src/checkers/CheckersModuleExperience.tsx` ≈64 KB — above runtime hard threshold;
- `apps/web/src/checkers/checkers.css` ≈62 KB — above style hard threshold;
- `apps/web/src/checkers/CheckersWorkspace.tsx` ≈25 KB — above target, below review threshold;
- `apps/web/src/chess/ChessEditor.tsx` ≈29 KB — near runtime review threshold;
- `apps/web/src/chess/ChessOnlineLobby.tsx` ≈23.5 KB — near target.

R1 must not implement online Checkers by growing `CheckersModuleExperience.tsx` or `checkers.css`. If those surfaces must change, extract only the seam required for the R1 user journey; do not rewrite unrelated learning/classroom/bot behavior.

## 4. Audit cadence

### GP-HYG-001 — every bounded slice

Before a slice is reported complete, inspect only the changed Games files for:

- size and size delta;
- new responsibility added to a hard-threshold legacy file;
- debug/temporary code;
- accidentally committed generated output;
- duplicated implementation created instead of using an existing adapter/port;
- new TODO/FIXME without a requirement/task ID.

This is a delta check, not a full repository audit.

### GP-HYG-002 — stage entry baseline

At the start of every implementation stage (`R1+`), record a lightweight Games-scope baseline: largest relevant files, known hard-threshold files and tracked/generated artifact hotspots. The baseline is evidence, not an automatic refactor backlog.

### GP-HYG-003 — interim mini-audit

If a stage remains active, run a mini-audit after **three completed implementation slices or 14 calendar days, whichever comes first**. Re-run earlier when one of the trigger conditions in §5 occurs.

The default cost-control rule is one bounded hygiene slice at most per three value slices. More cleanup requires a concrete blocker/risk or owner authorization.

### GP-HYG-004 — stage exit

Every `R1+` exit gate includes a full audit of the Games-owned/touched scope. A stage cannot close with:

- a newly created hard-threshold violation;
- unreviewed growth of a grandfathered hard-threshold file;
- committed transient/debug garbage;
- an unowned duplicate implementation created during the stage;
- stale temporary feature flags or migration compatibility paths whose removal was part of that stage.

Existing unrelated debt may remain, but it must not become worse silently.

### GP-HYG-005 — structural checkpoints

Run a deliberate structural audit before stages that widen the architecture:

- before **R4 Chess convergence** — verify Checkers/XO genericization did not overfit shared code;
- before **R6 realtime** — verify command-game code is not being reused as a realtime room abstraction;
- before **R7 creator platform** — verify trusted first-party assumptions are not leaking into untrusted creator execution.

These audits are bounded to Games and do not authorize repository-wide cleanup.

## 5. Immediate audit triggers

Do not wait for the normal cadence when any of these occurs:

- a file crosses a hard threshold;
- a touched file grows by more than 25% during one stage;
- the same oversized file is modified in three consecutive slices;
- repeated regressions originate from the same orchestration file;
- a second copy of similar invite/match/session/rating logic appears;
- generated/test output starts appearing in source/document directories;
- an agent needs to read a very large file repeatedly to make small edits safely.

The result is a bounded decomposition task, not an automatic rewrite.

## 6. Garbage and generated-content policy

The repository already ignores normal transient output such as `dist/`, `build/`, `out-tsc/`, `tmp/`, `coverage/`, `playwright-report/`, `test-results/` and `reports/games/`. Games tooling must use ignored locations for transient reports.

Do not commit by default:

- debug logs, `console.log` diagnostics or `debugger` statements;
- `.bak`, `.old`, `.orig`, conflict/copy files;
- local DB dumps, ad-hoc exported JSON, temporary migration snapshots;
- Playwright traces/videos/reports generated only for local diagnosis;
- build output or dependency caches;
- commented-out superseded implementation;
- unreferenced screenshots or repeated variants of the same acceptance evidence.

Commit generated/binary evidence only when a review/acceptance receipt explicitly references it. Existing protected/owner evidence is never auto-deleted by a hygiene task; mark questionable historical evidence for owner review instead.

## 7. Automated hygiene gate

The first R1 implementation slice must introduce a lightweight read-only command, planned as:

```text
pnpm games:hygiene --changed <base>
pnpm games:hygiene --full
```

It must report, not auto-delete/refactor. Minimum checks:

- file size and growth against the budgets above;
- forbidden transient filenames/paths;
- obvious debug markers;
- new files above hard limits;
- hard-limit legacy files that grew or gained suspicious large additions.

Transient report output goes under ignored `reports/games/`. The focused Games gate should run `--changed`; stage exit runs `--full`. Semantic dead-code/dependency cleanup remains review work and is not faked by a simplistic text scanner.

## 8. Optimization decision rule

An audit finding becomes an optimization task only when at least one is true:

1. it blocks or materially raises risk of the current/next user-visible stage;
2. the active slice would otherwise make a hard-threshold hotspot larger/more coupled;
3. the duplication would create two sources of truth;
4. generated/debug garbage affects repository correctness, CI, security or agent context;
5. stage-exit requirements explicitly require removal of the temporary path.

Otherwise record the finding and continue value delivery. “Clean code” alone is not permission to expand scope.

## 9. Required hygiene evidence

A stage/slice hygiene note stays compact and records only:

```text
BASE_SHA
FILES_SCANNED
NEW_HARD_VIOLATIONS
LEGACY_HOTSPOTS_TOUCHED
GARBAGE_FOUND/REMOVED
EXTRACTIONS_DONE
OPEN_DEBT_WITH_REASON
VERDICT: PASS | NEEDS_FIX | BLOCKED
```

Do not commit bulky generated reports. The compact receipt points to the exact source/test evidence when needed.
