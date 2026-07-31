# ASA Chess — целевая шахматная платформа

**Статус:** implementation candidate, основанный на Module Registry candidate PR №45.  
**Issue:** №65.  
**Правило:** не merge в `main` до принятия R0 и общей Module Registry / Editor Host baseline.

## 1. Цель

ASA Chess — самостоятельная шахматная образовательная среда внутри ASA Lab. Она должна обеспечивать сопоставимый класс пользовательских возможностей с ведущими шахматными платформами, включая Chess.com-подобные сценарии:

```text
играть
→ сохранять партии
→ анализировать
→ решать задачи
→ учиться
→ участвовать в классах и турнирах
→ получать проверяемый прогресс
```

При этом используются:

- собственный код ASA Lab;
- оригинальные названия, тексты, интерфейсы и визуальная система;
- общие `Project`, `ProjectDraft`, `ProjectVersion`, Classroom и Assessment contracts;
- открытые шахматные форматы FEN, SAN и PGN;
- отдельная fair-play политика.

Не копируются чужие исходники, логотипы, trademark, закрытые тексты, proprietary scoring formulas, anti-cheat thresholds или assets.

## 2. Уже реализовано в candidate

### Rules engine

- стандартная доска 8×8;
- полностью легальные ходы;
- шах, мат и пат;
- рокировка с проверкой атакованных полей;
- взятие на проходе;
- превращение во все четыре фигуры;
- правило 50 ходов;
- троекратное повторение;
- недостаточный материал;
- FEN parse/serialize;
- UCI и SAN;
- PGN import/export;
- reference `perft` tests;
- immutable move records.

### Project lifecycle

- module key `chess`;
- registry-driven project creation;
- generic Editor Host;
- autosave;
- reload;
- immutable checkpoints;
- module validation and preview;
- rejection of malformed and over-posted documents.

### Play modes

- analysis board;
- local two-player;
- ASA Bot levels 1–3;
- configurable time controls;
- increment;
- resign;
- agreed draw;
- timeout;
- undo/reset according to project mode;
- board orientation.

### Interface

- responsive original ASA board;
- click and drag/drop moves;
- keyboard-focusable squares;
- legal move and capture indicators;
- selected, last-move and king-in-check states;
- clocks;
- move list;
- evaluation bar;
- analysis summary;
- PGN/FEN dialog;
- promotion dialog;
- desktop and mobile layout contract.

## 3. Следующие product milestones

### CH-C2 — Expanded analysis and review

- analysis tree with side variations;
- comments, arrows and square highlights through UI;
- local worker adapter for a separately reviewed open-source engine;
- configurable depth/time/multi-PV;
- evaluation and time graph;
- original ASA move classifications;
- game review summary;
- continue against bot;
- opening explorer adapter;
- save reviewed annotations into exact ProjectVersion.

Классификация ходов ASA — это не Chess.com Accuracy/CAPS: чужая формула не
копируется и не заявляется.

### CH-C3 — Puzzles and learning

- puzzle document based on exact FEN and accepted solution tree;
- correct / incorrect / retry / hint / explanation states;
- rated puzzle progression using an ASA-owned formula;
- puzzle streak;
- timed puzzle rush;
- mate/endgame/coordinates/vision drills;
- lesson steps;
- opening courses;
- badges through the common ASA Lab evidence model.

### CH-C4 — Realtime play

- server-authoritative game aggregate;
- server-authoritative legal moves and clocks;
- WebSocket protocol;
- reconnect and resume;
- premoves;
- challenge links;
- matchmaking by rating and time control;
- spectators with policy-controlled delay;
- correspondence/daily games;
- immutable finished-game version.

### CH-C5 — Ratings, tournaments and clubs

- separate ratings by time control;
- rating history;
- leaderboard;
- direct challenge;
- Arena;
- Swiss;
- round-robin classroom event;
- team match;
- club and school team;
- tournament result exports.

Rating calculations and tie-break rules must be explicitly documented and independently implemented.

### CH-C6 — Classroom

- teacher creates game/position/puzzle/lesson activity;
- individual or paired learners;
- class tournament;
- teacher read-only live boards;
- explicit shared analysis room;
- exact-move comments;
- immutable submission;
- rubric/grade/badge;
- StudentSeat and Safe Mode;
- no direct child messaging.

### CH-C7 — Fair play and moderation

- analysis and engine capability denied inside protected rated session;
- client cannot authoritatively submit clock or result;
- server revalidates every move;
- reconnect and lag policy;
- report and moderation case;
- appeal state;
- privacy-safe technical telemetry;
- no public disclosure of detection thresholds;
- classroom/private unrated policy separated from public rated play.

## 4. Domain boundaries

Chess owns:

```text
board
pieces
moves
position
FEN
SAN
PGN
clock rules
result
analysis annotations
puzzle solution trees
rating and tournament chess rules
```

Shared ASA Lab owns:

```text
Account / Principal / Workspace
Project / Draft / Version
Classroom / StudentSeat
Activity / Assignment / Submission
Review / Grade / Badge
Publication / Remix
Audit / authorization / moderation
```

Chess-specific data must not introduce subject switches into Project or Classroom Core.

## 5. Fair-play capability model

```text
analysis_project             engine allowed
post_game_review             engine allowed
puzzle_explanation           engine allowed when policy permits
private_unrated_local_game   configurable
classroom_training_game      teacher policy
protected_live_rated_game    engine and analysis denied
spectator_of_live_rated      delayed/no analysis according to policy
```

The server issues capabilities. The browser cannot turn analysis on by changing UI state.

## 6. Visual direction

ASA Chess uses:

- original dark-blue/cyan/green ASA visual system;
- an original knight module icon;
- high-contrast green board;
- Unicode pieces in the foundation, replaceable by an original ASA vector set;
- no Chess.com logo, pawn mark, green palette copy, wording or proprietary illustrations.

Required states:

```text
loading
empty/new game
human turn
bot thinking
check
promotion
checkmate
stalemate
draw
timeout
offline/reconnecting
save error
malformed import
authorization denied
```

## 7. Current candidate limitations

The first candidate does **not** claim:

- production realtime multiplayer;
- ratings or matchmaking;
- tournaments, clubs or chat;
- Stockfish-depth review;
- proprietary accuracy parity;
- puzzle or lesson content library;
- classroom assignment integration;
- anti-cheat parity;
- production load or recovery proof.

## 8. Verification commands

```text
pnpm install --lockfile-only
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:chess
pnpm test
pnpm e2e:chess
```

Canonical ports remain:

```text
web 4610
api 4611
e2e 4612
```

Ports `3000`, `3100` and `5173` are not used.

## 9. Candidate Definition of Done

The foundation candidate may be accepted for later transfer only when:

- package lock is synchronized;
- perft and legal-rule tests pass;
- FEN/SAN/PGN tests pass;
- document security negatives pass;
- module registry and generic project APIs pass;
- local and ASA Bot browser flows pass;
- reload and ProjectVersion pass;
- desktop/mobile screenshots exist;
- accessibility and console gates pass;
- fair-play limitations are visible;
- owner accepts the live interface;
- no claim of full Chess.com parity is made.
