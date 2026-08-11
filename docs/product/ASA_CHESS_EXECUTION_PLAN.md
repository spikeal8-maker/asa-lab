# ASA Chess — executable delivery plan

**Programme Issue:** [#65](https://github.com/spikeal8-maker/asa-lab/issues/65)  
**P0 Issue:** [#97](https://github.com/spikeal8-maker/asa-lab/issues/97)  
**Status:** plan-only candidate; product execution remains blocked until an explicit owner transition from the active task.

## 1. Product outcome

ASA Chess targets independently implemented functional parity with the major play,
review, bot, puzzle, learning, online, classroom and competition journeys of modern
chess platforms. It does not copy Chess.com source code, branding, protected text,
artwork, bot identities, private scoring formulae, protocols or fair-play thresholds.

The first accepted vertical release is deliberately smaller than the total programme:

```text
play a calibrated ASA bot
→ receive a verified game review
→ retry the key mistake
→ train the generated position
→ receive a relevant lesson recommendation
```

## 2. Parallel-work rule

Chess planning and later implementation use a dedicated checkout and branch. They
must not touch the active 3D checkout, its uncommitted files, its PR or its execution
lease. A future Checkers module is a separate subject module and must not be hidden
inside Chess.

Parallel work is safe only when all of the following remain true:

- each writer has a distinct Git worktree and branch;
- file ownership and required scope do not overlap;
- `docs/execution/current.yaml` continues to name exactly one executable product task;
- plan-only work does not claim product activation or test evidence;
- no task edits another module's subject document, route state, database tables or assets;
- integration occurs through a reviewed PR after focused and repository gates.

## 3. Module ownership

Chess owns:

```text
standard chess rules and notation
chess game documents and annotations
engine-analysis orchestration
bot profiles and calibration evidence
chess puzzle and practice documents
chess learning progress
live chess events, clocks and ratings
chess competition rules
chess-specific fair-play policy
```

Shared ASA Lab owns:

```text
Account / Principal / Workspace
Project / Draft / Version
Classroom / StudentSeat
Assignment / Submission / Grade / Badge
Moderation / Audit / authorization
shared editor chrome and accessibility tokens
```

Electronics, 3D and future Checkers keep independent domain packages, UI state,
routes, migrations and focused gates. Shared contracts contain no subject switches.

## 4. Release sequence

| Release | Complete user outcome | Depends on |
| --- | --- | --- |
| P0 | Dated parity ledger, isolated delivery map and shared-header contract are reviewable | owner planning approval |
| R1 Learning Beta | Bot game → review → retry → generated training → lesson recommendation | P0 |
| R2 Puzzles and Learning | Rated/custom/daily/rush puzzles, learning path, courses, Practice and Explorer | R1 |
| R3 Online Beta | WebSocket game, reconnect, clocks, rating, archive and fair-play baseline | R1 |
| R4 Classroom | Teacher assigns and reviews games, positions, puzzles and lessons | R2, R3 |
| R5 Competition | Puzzle Battle, Arena, Swiss, seasons and leaderboards | R2, R3 |
| R6 Community | Friends, clubs, school teams and moderated age-aware communication | R3, safety proof |
| R7 Variants | Chess960 first; later variants each carry their own rules and gate | R3 |
| R8 Parity proof | Dated matrix closure, load/recovery/security/licence and owner acceptance | R1–R7 |

No later release activates automatically.

## 5. P0 — activation package

P0 is governance and evidence scope. It does not change product behaviour.

### Deliverables

1. A dated Chess.com-to-ASA scenario ledger with `required`, `extended` and
   `deferred` priorities.
2. Exact R1 task IDs, dependencies, source ownership and test ownership.
3. A shared ASA editor-header contract characterized against Electronics.
4. Additive tenant/RLS data ownership and rollback requirements.
5. Focused, browser and repository gate definitions.
6. Desktop, tablet and mobile owner-evidence requirements.
7. Feature-flag and rollback rules for every R1 surface.

### P0 definition of done

- the plan and ledger are published in GitHub and linked from #65 and #97;
- Electronics and 3D behaviour remain unchanged;
- the current 3D checkout remains untouched;
- planned tests are clearly labelled `PLANNED`, not reported as executed;
- the owner separately transitions execution state before R1 code starts;
- `pnpm control-plane:check` passes on that future transition SHA.

## 6. R1 — Chess Learning Beta task graph

### CH-101 — shared editor chrome characterization

Characterize the existing Electronics header before extracting any shared component.
The shared contract covers geometry and information hierarchy, not subject actions.

Required slots/contracts:

- ASA Lab mark and home/back action;
- editable project title;
- saved/saving/error status with full actionable error text;
- named module modes;
- account avatar;
- optional module toolbar;
- module-owned primary and secondary actions.

The primary row is 48 px and the optional toolbar row is 48 px, matching the
Electronics editor-family baseline. Chess keeps original controls and visual identity.

Acceptance: Electronics screenshots, keyboard behaviour, save-state behaviour and
responsive layout remain unchanged before and after extraction.

### CH-102 — Engine Platform

- reviewed Stockfish-compatible adapter in a Web Worker;
- server analysis job contract;
- bounded depth/time/Multi-PV;
- deterministic cache key including engine version and settings;
- cancellation, timeout and resource quotas;
- fair-play capability check before every analysis request;
- legal-PV and engine-version evidence.

### CH-103 — Game Review v2

- quick post-game summary and deeper review;
- evaluation and time graphs;
- original ASA move classifications and versioned quality algorithm;
- key moments, verified best line and retry flow;
- explanation pipeline based on engine facts and motif detection;
- saved immutable reviewed version.

An LLM may improve wording but cannot create evaluations, legal moves or tactical facts.

### CH-104 — Bot Profiles v1

Start with 12 original calibrated profiles rather than a large low-quality catalogue.
Each profile defines strength band, style, opening repertoire, mistake model, move-time
model, assistance policy and original dialogue. Real-person likeness requires permission.

Acceptance uses automated reference matches plus blind human review. Bot quantity alone
is not a release criterion.

### CH-105 — mistakes-to-training

- create a private training item from an exact reviewed position;
- store accepted solution tree, motif, hint and verified explanation;
- preserve a link to the source game/version;
- record attempts without mutating the original game;
- recommend a lesson through explicit motif-to-content mapping.

### R1 release gate

R1 is accepted only when the complete learning loop works on desktop, tablet and mobile
with keyboard access, tenant isolation, save/reload, feature-flag rollback and no
unexpected console errors, page errors, request failures or HTTP 5xx responses.

## 7. Cross-cutting requirements

Fair play, child safety, localization, accessibility, observability, content provenance,
migration rollback and responsive behaviour are per-task gates. They are never deferred
as a final cleanup phase.

Every implementation task provides:

```text
TASK / ISSUE / branch / required scope
user flow and visible result
focused tests and browser journey
data migration and rollback notes
screenshots and exact tested SHA
working-tree status
owner acceptance and next allowed task
```

## 8. Current blocker

At publication time the canonical execution state still names `TASK-3D-M0-001`, PR #95
and execution lease holder `codex-three-d-m0`. R1 product code must not begin until the
owner completes or pauses that task and records a separate transition. This plan branch
therefore contains documentation only.
