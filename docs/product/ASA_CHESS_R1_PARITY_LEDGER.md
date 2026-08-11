# ASA Chess R1 — dated functional-parity ledger

**Reference cut:** 2026-08-11
**Programme:** [Issue #65](https://github.com/spikeal8-maker/asa-lab/issues/65)
**Activation package:** [Issue #97](https://github.com/spikeal8-maker/asa-lab/issues/97)

Parity in this ledger means an independently implemented equivalent user outcome. It
does not mean copied design, wording, formulae, branding, source code or assets.

## Status vocabulary

```text
not_started
foundation
functional
production_proven
owner_accepted
```

`MUST P0` blocks R1 implementation. `MUST R1` blocks the Learning Beta release.
`DEFER` records a visible gap without expanding R1.

## P0 contracts

| ID | Scenario or contract | Priority | Acceptance | Current status |
| --- | --- | --- | --- | --- |
| P0-01 | Dated feature ledger | MUST P0 | Every row has source, release, issue, test, evidence and status | functional |
| P0-02 | Parallel agent work | MUST P0, ASA | Separate worktree/branch/scope per writer; one integration lease; no overlapping file ownership | production_proven |
| P0-03 | Chess isolation | MUST P0, ASA | `moduleKey=chess`; no imports from Electronics, 3D or Checkers; shared core imports no Chess | functional |
| P0-04 | Checkers isolation | MUST P0, ASA | `moduleKey=checkers`; no Checkers types or mode switches in Chess documents/APIs | functional |
| P0-05 | Electronics-family header | MUST P0, ASA | 48 px header + optional 48 px toolbar; ASA mark, title, save state, named modes and avatar | functional |
| P0-06 | Electronics preservation | MUST P0, ASA | Characterization first; post-extraction DOM, keyboard flow and shell geometry remain equivalent | functional |
| P0-07 | Shared-core and data safety | MUST P0, ASA | No Chess fields in shared core; cross-tenant access denied; sibling smoke journeys pass | foundation |
| P0-08 | One R1 focused gate | MUST P0 | Same command locally, in CI and owner evidence; evidence uses `NX_SKIP_NX_CACHE=true` | functional |

The former Chess `min-height: 64px` gap is closed in PR #103: Chess now uses the
neutral 48 px ASA editor header. Electronics retains its existing 48 px primary row
and separate 48 px toolbar without product-file changes in this slice.

## R1 engine

| ID | User outcome | Priority | Acceptance | Source | Status |
| --- | --- | --- | --- | --- | --- |
| ENG-01 | Quick and deep post-game analysis | MUST R1 | Benchmark for 60 plies fixes quick/deep p95 budgets before coding | Game Review | not_started |
| ENG-02 | Responsive local analysis and durable server analysis job | MUST R1 | Worker keeps UI responsive; job supports progress/cancel/retry and idempotent recovery | Engine docs | foundation |
| ENG-03 | Evaluation and Multi-PV | MUST R1 | All moves legal; at least three Self Analysis lines; mate and centipawn scores distinct | Analysis | foundation |
| ENG-04 | Reproducible evidence | MUST R1 | Engine/NNUE hashes and parameters recorded; deterministic mode repeats exactly | ASA | foundation |
| ENG-05 | Version-safe cache | MUST R1 | Key includes FEN, engine, NNUE, settings and Multi-PV | ASA | functional |
| ENG-06 | Tablebase and complete Explorer | DEFER R2 | Gap remains visible | Analysis | not_started |

## R1 bot play

| ID | User outcome | Priority | Acceptance | Source | Status |
| --- | --- | --- | --- | --- | --- |
| BOT-01 | Choose bot, White/Black/Random and timed/untimed play | MUST R1 | Every combination starts a legal unrated game and persists settings | Bots | foundation |
| BOT-02 | Twelve original profiles | MUST R1 | 4 beginner, 4 intermediate, 3 advanced, 1 adaptive; profile records style, repertoire, error and time model | Bots | not_started |
| BOT-03 | Calibrated strength | MUST R1 | At least 1,000 reference games/profile; 95% CI inside declared band; median target error ≤75 Elo | ASA | not_started |
| BOT-04 | Distinguishable style | MUST R1 | Two measurable style signals/profile; blind expert identification ≥70% | ASA | not_started |
| BOT-05 | Assisted and challenge policies | MUST R1 | Evaluation, arrows, hint, feedback and undo follow policy; used assistance is stored | Bots | foundation |
| BOT-06 | Save game and open exact Review | MUST R1 | Refresh preserves result, assistance, clocks and moves; Review reads exact version | Bots/Review | foundation |
| BOT-07 | Crowns, 100+ profiles and seasonal/celebrity bots | DEFER | R1 never claims catalogue parity | Bots | not_started |

## R1 Game Review

| ID | User outcome | Priority | Acceptance | Source | Status |
| --- | --- | --- | --- | --- | --- |
| REV-01 | Open Review after game or from archive | MUST R1 | Both routes return one versioned review; reopening does not re-run silently | Game Review | foundation |
| REV-02 | Evaluation/time graphs and factual summary | MUST R1 | One point per ply; selecting a point selects the same position | Game Review | not_started |
| REV-03 | ASA Quality 0–100 | MUST R1 | Original formula documented and versioned; golden corpus; never named CAPS/Accuracy | Accuracy | foundation |
| REV-04 | Move classifications | MUST R1 | Original deterministic ASA labels cover book, error, missed chance and strong move; every line legal | Classification | foundation |
| REV-05 | Navigate all moves and key moments | MUST R1 | Mouse, touch and keyboard select identical positions; Next skips no marked moment | Game Review | foundation |
| REV-06 | Show line, best move, Retry and Hint | MUST R1 | Retry uses exact pre-error FEN; incorrect move never passes | Game Review | not_started |
| REV-07 | Understand the mistake | MUST R1 | Explanation cites verified engine line and formal motif; zero unsupported claims in corpus and 100 manual samples | Game Review | not_started |
| REV-08 | Review White, Black or Both and persist settings | MUST R1 | Settings affect presentation without mutating stored analysis | Game Review | not_started |
| REV-09 | Self Analysis and continue against bot | MUST R1 | Exact FEN/turn/castling/en-passant transferred; original game immutable | Analysis | not_started |
| REV-10 | Save comments and variations | MUST R1 | New exact ProjectVersion created; source version immutable | Analysis | not_started |
| REV-11 | Coach audio, multiple coaches, proprietary performance rating, manual cloud controls | DEFER | No fake or disabled parity claim | Game Review | not_started |

## R1 mistake-to-training

| ID | User outcome | Priority | Acceptance | Source | Status |
| --- | --- | --- | --- | --- | --- |
| TRN-01 | Train this mistake | MUST R1, ASA | Private drill uses exact pre-error FEN and links game/version/move | ASA differentiator | not_started |
| TRN-02 | Solve against automatic defence | MUST R1 | Same engine version validates accepted tree; equivalent solutions accepted | Puzzles | foundation |
| TRN-03 | Progressive hints | MUST R1 | Motif → candidate piece/square → move; attempts and hints recorded | Puzzles | foundation |
| TRN-04 | Relevant starter lesson | MUST R1 | Every supported motif maps to a published original ASA lesson | Lessons | not_started |
| TRN-05 | Rated puzzle database, streak, Daily, Rush, Battle and Custom | DEFER R2+ | Three current static tasks are not called parity | Puzzles | not_started |
| TRN-06 | Publish user position to shared corpus | DEFER | Requires consent, provenance, moderation and quality pipeline | ASA | not_started |

The personal mistake drill is an ASA workflow. It may be described as an original
extension, not as proven exact Chess.com parity.

## R1 evidence gate

| ID | Required evidence |
| --- | --- |
| R1-E2E-01 | Desktop 1440×900: bot → game over → Review → Retry → drill → lesson |
| R1-E2E-02 | Mobile 360×800: same journey without inaccessible controls or horizontal overflow |
| R1-E2E-03 | Keyboard-only: start, moves, Review navigation, Retry and drill with visible focus |
| R1-E2E-04 | Zero unexpected console errors, HTTP 5xx and illegal engine moves |
| R1-E2E-05 | Reload at every transition restores the exact saved version |
| R1-E2E-06 | Electronics, 3D and generic Project smoke gates remain green |
| R1-E2E-07 | Licence manifest covers engine, NNUE and all bot/lesson art and content |
| R1-E2E-08 | Release wording is only “R1 learning-loop functional parity” after owner acceptance |

## Parallel streams after P0 activation

| Stream | Owns | Must not touch |
| --- | --- | --- |
| A — shell/isolation | shared editor shell, Chess header adapter, characterization tests | engine, bots, Review rules |
| B — engine | `chess-analysis`, worker/server adapters, cache/job tests | React shell, bot personalities |
| C — bots | bot profiles and calibration harness | Review UI, shared core |
| D — review/training | review model/UI, generated drills and starter lesson mapping | Electronics, engine internals |

Shared exports, router, workspace configuration, execution documents and final wiring
remain integration-owner files.

## Official references

- [Play against Chess.com bots](https://support.chess.com/en/articles/8614091-how-can-i-play-against-the-chess-com-bots)
- [Game Review](https://support.chess.com/en/articles/8584089-how-does-game-review-work)
- [Self Analysis](https://support.chess.com/en/articles/8583757-how-do-i-use-game-analysis)
- [Game Review on mobile](https://support.chess.com/en/articles/10328363-how-do-i-use-game-review-on-the-app)
- [Chess engines](https://support.chess.com/en/articles/9462780-chess-engines-on-chess-com-how-do-they-work)
- [Move classifications](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc)
- [Accuracy/CAPS2](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined)
- [Puzzle provenance](https://support.chess.com/en/articles/8709004-where-do-chess-com-puzzles-come-from)
- [Puzzle modes](https://support.chess.com/en/articles/8608686-how-do-puzzles-work-on-chess-com)
