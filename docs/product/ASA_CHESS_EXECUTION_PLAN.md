# ASA Chess — executable delivery plan

**Programme Issue:** [#65](https://github.com/spikeal8-maker/asa-lab/issues/65)
**P0 Issue:** [#97](https://github.com/spikeal8-maker/asa-lab/issues/97)
**Status:** active R1 foundation in Draft PR
[#103](https://github.com/spikeal8-maker/asa-lab/pull/103); scoped parallel execution
was activated by merged governance PR
[#104](https://github.com/spikeal8-maker/asa-lab/pull/104).

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

Chess planning and implementation use a dedicated checkout, branch and schema 1.1
lane. Checkers remains the primary lane and shared integration owner. Chess must not
touch the Checkers, Electronics or 3D product paths, their uncommitted files or their
execution leases.

Parallel work is safe only when all of the following remain true:

- each writer has a distinct Git worktree and branch;
- file ownership and required scope do not overlap;
- `docs/execution/current.yaml` names every executable lane, its lease and its exact
  non-overlapping path scope;
- product branches cannot edit `current.yaml`, even when their lane owns shared
  integration;
- no task edits another module's subject document, route state, database tables or assets;
- integration occurs through reviewed PRs after each lane's focused gates.

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
- governance PR #104 records the Chess lane without displacing Checkers;
- `pnpm control-plane:check` passes with both PR heads and all path scopes verified.

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

Implemented checkpoint: the neutral `EditorHeader` and Chess adapter are present in
PR #103, the primary row is 48 px, Enter/Escape title behaviour is tested, the final
Chess header has one navigation source rather than duplicate tabs, and Electronics
product files remain unchanged.

### CH-102 — Engine Platform

- reviewed Stockfish-compatible adapter in a Web Worker;
- server analysis job contract;
- bounded depth/time/Multi-PV;
- deterministic cache key including engine version and settings;
- cancellation, timeout and resource quotas;
- fair-play capability check before every analysis request;
- legal-PV and engine-version evidence.

Implemented foundation: typed engine/settings/result contracts, fair-play capability
authorization before cache or adapter access, canonical FEN and versioned cache keys,
partitioned cache, quotas, cancellation/timeout and legal PV/Multi-PV validation are
covered by tests. The public Chess API now includes an honest ASA Lite adapter for
deterministic depth 1-3, one principal root move and a single variation. It keeps mate
separate from centipawns without inventing a mate distance. A production Stockfish
worker/server adapter is not yet present and is not claimed; it remains gated on a
pinned GPL artifact manifest and corresponding source evidence.

A transport-neutral job foundation now models queued, running, succeeded, failed and
cancelled analysis, including progress, optimistic concurrency, atomic tenant-scoped
idempotency, cancellation, bounded retry and re-authorization before repository access.
Its repository and queue adapters are deterministic in-memory evidence only. Process-
durable storage, dequeue leasing, heartbeat/recovery and actual engine execution in a
worker remain open.

### CH-103 — Game Review v2

- quick post-game summary and deeper review;
- evaluation and time graphs;
- original ASA move classifications and versioned quality algorithm;
- key moments, verified best line and retry flow;
- explanation pipeline based on engine facts and motif detection;
- saved immutable reviewed version.

An LLM may improve wording but cannot create evaluations, legal moves or tactical facts.

Implemented foundation: every reviewed ply now records canonical positions before and
after the move plus a verified legal best root move. The Review UI has one evaluation
point per ply, selects the exact board position from the move list or timeline, and can
retry a mistake from the exact pre-error position. Only the verified best root is
accepted; three progressive hints and reset are available. Deep engine lines, time
graph and persisted review jobs remain open. A fact-only explanation panel now derives
evaluation loss, immediate captures, checks, castling and promotion directly from the
canonical reviewed root. It deliberately makes no unsupported motif or strategy claim;
verified motif explanations remain open.

### CH-104 — Bot Profiles v1

Start with 12 original calibrated profiles rather than a large low-quality catalogue.
Each profile defines strength band, style, opening repertoire, mistake model, move-time
model, assistance policy and original dialogue. Real-person likeness requires permission.

Acceptance uses automated reference matches plus blind human review. Bot quantity alone
is not a release criterion.

Implemented foundation: 12 original, immutable profiles are defined as four beginner,
four intermediate, three advanced and one adaptive profile. Each profile has explicit
style signals, repertoire, mistake and move-time models, assistance policy and original
dialogue, with deterministic seeded helpers and strict schema tests. Strength bands are
explicitly marked not calibrated; reference matches and blind human validation remain
required before release claims. All 12 profiles are now selectable in the new-game UI;
the stable profile id and matching engine level persist in the Chess document, survive
reload, and drive the current legal move mapping. Legacy documents retain a truthful
generic bot label with a deterministic level-matched fallback. Assistance, takeback,
mistake and move-time policies are still descriptive metadata rather than enforced game
behaviour.

### CH-105 — mistakes-to-training

- create a private training item from an exact reviewed position;
- store accepted solution tree, motif, hint and verified explanation;
- preserve a link to the source game/version;
- record attempts without mutating the original game;
- recommend a lesson through explicit motif-to-content mapping.

Implemented foundation: Review can create a private in-memory training item linked to
the source project and ply, preserving the exact pre-error FEN, played move and verified
best root. A separate strict library model requires tenant, owner and project-version
provenance and stores an append-only, immutable history of legal attempts and hints.
Retry attempts never mutate the source game. The current repository is intentionally
in-memory; database/API wiring, project-version authorization, automatic defence, motif
evidence and lesson mapping remain open.

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

## 8. Current execution state

Schema 1.1 keeps Checkers as the primary lane and shared integration owner while Chess
runs independently as `TASK-CHESS-R1-001` on `agent/chess-r1-foundation`, Draft PR #103.
The Chess lane owns only its contexts, UI, tests, plan documents and neutral
`editor-chrome` directory. The first published checkpoint contains the shared-header
adapter and Engine Platform foundation. Complete R1 learning-loop parity remains open
and must progress through CH-103, CH-104 and CH-105 without expanding into sibling
module paths.
