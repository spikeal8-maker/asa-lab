# ASA Checkers — market and product analysis

Date: 2026-08-11  
Task: `TASK-CHECKERS-M1-001`  
Issue: https://github.com/spikeal8-maker/asa-lab/issues/98

## 1. Executive decision

ASA Checkers must not be a thin board editor or a reskinned Chess page. It is a
first-party educational system for Russian draughts-64 with four connected
experiences:

1. a correct and pleasant game;
2. a guided self-learning path;
3. teacher-authored class work with move-level evidence;
4. safe class play and cooperation without free-form child communication.

The market has strong play products and strong child chess learning products,
but the reviewed products do not combine Russian draughts, classroom assignment,
mastery evidence, explainable bots and child-safe social play in one coherent
experience. ASA should own that intersection.

The first supported ruleset is official Russian draughts on 64 squares. The
architecture remains ruleset-aware, but adding international, Brazilian,
English or giveaway variants is outside M1. Shipping many variants before one
complete learning path would weaken both pedagogy and rule confidence.

## 2. Research method

The review compared products along eight dimensions:

- rules and variants;
- quality and calibration of computer opponents;
- lessons, puzzles and mistake review;
- motivation and progression;
- multiplayer and community;
- teacher/classroom workflow;
- child safety and communication;
- accessibility and device coverage.

Product claims below come from current official product, help, store and rules
pages inspected on 2026-08-11. Store descriptions are treated as vendor claims,
not independent performance proof.

## 3. Competitive landscape

### Lidraughts

Source: https://lidraughts.org/features

Strengths:

- Russian draughts and several other variants;
- computer analysis, mistake review, studies and tactical puzzles;
- online, offline, tournament and correspondence play;
- board editor, game search, PDN import/export;
- mobile support, no advertising and no tracking.

Weakness for ASA's audience:

- designed primarily as a broad player community, not as a structured school
  curriculum;
- its rich feature surface can overwhelm a first-time child;
- public community functions are incompatible with ASA's default child-safety
  boundary;
- teacher assignment and mastery reporting are not the core product model.

Lesson for ASA: match the seriousness of game records, analysis and puzzles, but
present them through a progressive student home rather than a global game site.

### Checkersland

Sources:

- https://checkersland.com/download/pc.html
- https://play.google.com/store/apps/details?id=com.checkersland

Strengths:

- more than 20/30 regional variants depending on platform;
- a strong computer opponent;
- local play and extensive rule configuration;
- compact, purpose-built draughts experience.

Weakness for ASA's audience:

- breadth of variants takes priority over guided learning;
- no native ASA classroom, assignment or evidence model;
- difficulty labels alone do not explain what a child has mastered;
- the experience is game-centric rather than teacher/student-centric.

Lesson for ASA: correctness and AI depth matter, but the student should see a
meaningful skill ladder rather than a raw level number.

### PlayOK

Source: https://www.playok.com/en/checkers/?l=1

Strengths:

- very low-friction live play;
- multiple draughts variants including Russian draughts;
- rooms, tournaments, rankings, statistics and game records;
- mobile browser support.

Weakness for ASA's audience:

- private messaging and an open player network introduce avoidable child-safety
  risk;
- rankings measure match outcomes, not curriculum mastery;
- no guided lesson or teacher assignment model.

Lesson for ASA: matchmaking should feel quick, but discovery must be restricted
to authorised classmates and teacher-created events.

### Board Game Arena

Sources:

- https://en.boardgamearena.com/gamepanel?game=checkers
- https://en.boardgamearena.com/faq
- https://aldo.boardgamearena.com/tutorialfaq

Strengths:

- browser-first real-time and turn-based play;
- optional seasonal leagues and visible progression;
- replay-based interactive tutorials that require the learner to make moves;
- strong cross-device reach.

Weakness for ASA's audience:

- a general board-game portal cannot provide deep draughts pedagogy;
- competitive progression is not linked to school learning objectives;
- global social and ranking systems are broader than ASA should expose to
  children.

Lesson for ASA: tutorials should be short, replay-based and interactive; rated
competition should be optional and separate from friendly/class learning play.

### Shashki — Russian checkers

Source: https://play.google.com/store/apps/details?id=mkisly.checkers

Strengths:

- Russian rules are the primary experience;
- twelve claimed AI levels with opening variation;
- online rating, history, leaderboards and achievements;
- a large established mobile audience.

Weakness for ASA's audience:

- the product is primarily a game, not a school learning environment;
- chat and public online profiles require moderation and blocking;
- level progression is based on wins rather than diagnosed skill mastery.

Lesson for ASA: provide genuine strength steps and opening diversity, but keep
social interaction class-scoped and make every unlock explainable.

### Dama World and puzzle-led mobile products

Sources:

- https://apps.apple.com/us/app/dama-world-online-checkers/id593133187
- https://apps.apple.com/us/app/checkers/id321026028

Strengths:

- finite puzzle collections with visible levels;
- multiple AI difficulty levels;
- game replay, statistics and historical games;
- immediate, understandable goals.

Weakness for ASA's audience:

- puzzle quantity is not the same as a curriculum;
- static levels rarely adapt to a learner's recurring mistakes;
- no class assignment lifecycle or teacher evidence drill-down.

Lesson for ASA: every puzzle needs a concept tag, prerequisite, expected line,
hint ladder, explanation and mastery effect. Incorrect attempts must feed a
review queue rather than disappear.

### ChessKid as the educational benchmark

Sources:

- https://www.chesskid.com/learn/articles/chesskidcoms-curriculum
- https://www.chesskid.com/learn/articles/chess-coaching-for-kids
- https://www.chesskid.com/learn/articles/new-chesskid-feature-release-levels
- https://support.chesskid.com/en/articles/8864339-coach-school-what-are-the-special-features-available-to-schools-groups
- https://support.chesskid.com/en/articles/8863301-how-can-i-see-my-kid-s-progress

Strengths:

- guided levels containing instruction, tests and practice;
- custom assignments, groups, report cards and detailed activity;
- bot progression and child-friendly motivation;
- teacher views that connect weak areas to follow-up practice;
- no free chat for children; communication is limited to predefined text and
  smileys.

Weakness relative to ASA:

- it teaches chess, not Russian draughts;
- some communication and classroom features are designed around its own account
  and club model rather than ASA classes and capabilities.

Lesson for ASA: this is the closest benchmark for the student/teacher product
loop. ASA should reproduce the loop, not its visuals or content: diagnose,
assign, practise, play, review and verify mastery.

### Lichess Classes and Kid Mode as the safety benchmark

Sources:

- https://lichess.org/class
- https://lichess.org/page/kid-mode

Strengths:

- teacher-managed student accounts and classes;
- progress tracking across games and puzzles;
- strong restrictions on communications and public content in Kid Mode;
- no advertising or trackers.

Observed safety gap to avoid:

- class-scoped direct messages can still be too permissive for schools that want
  no child-to-child free text at all.

Lesson for ASA: do not implement a hidden exception for class messaging. Child
players may send only server-defined reactions; teacher feedback belongs to the
assignment/review record and follows ASA authorization.

## 4. Market gap ASA should own

The product opportunity is not “another checkers app.” It is:

> a safe Russian-draughts learning environment where gameplay, assignments,
> bot progression and teacher evidence are the same system.

The differentiating loop is:

```text
teacher goal or self-learning goal
→ interactive explanation
→ deliberate practice position
→ game or bot challenge
→ move-level review
→ mastery update
→ next assignment or spaced review
```

Most game products stop after the match. Most classroom products cannot explain
a draughts move. ASA must join the two.

## 5. Product information architecture

### Student Checkers Home

When a student opens Checkers, the module loads one coherent aggregate rather
than a generic project list:

1. **Continue** — unfinished lesson, puzzle, game or review;
2. **My assignments** — due, completed and teacher-returned work;
3. **Learning path** — current unit, mastery and recommended next step;
4. **Bot ladder** — current opponent, unlocked opponents and evidence needed for
   the next rung;
5. **Class play** — allowed class challenges and teacher-created events;
6. **Review queue** — recent recurring mistakes and spaced practice;
7. **Progress** — activity, concept mastery and personal milestones.

The first screen must answer three child questions immediately: “What should I
do now?”, “Why is this my next task?” and “How close am I to finishing it?”

### Game workspace

The game workspace uses the common ASA project header pattern already proven by
Electronics:

- ASA navigation and context;
- project/game title;
- saved/saving/offline state where persistence applies;
- current mode and opponent;
- contextual actions;
- no unrelated portal controls inside the board surface.

Below the header, the board remains the visual centre. Supporting panels are
mode-aware: lesson instruction, assignment requirements, bot ladder, move list,
review or safe reactions. They do not all appear at once.

### Teacher Checkers workspace

Teachers receive:

- class overview with recent Checkers activity;
- assignment builder for lessons, positions, puzzle sets, bot milestones and
  games;
- differentiation by class, group and student;
- due dates, attempts, hint policy and completion criteria;
- concept mastery heatmap;
- inactivity and repeated-error signals;
- student evidence view down to game, position and move;
- position composer and expected-line editor;
- teacher feedback attached to an assignment attempt, never a child chat.

## 6. Pedagogical model

### Curriculum spine

The initial curriculum is arranged by concepts rather than by an arbitrary
puzzle number:

1. board, coordinates, goal and turn;
2. movement of a man;
3. mandatory capture;
4. backward capture and multi-capture;
5. promotion and the flying king;
6. safe pieces, exchange and tempo;
7. elementary combinations;
8. opposition, breakthrough and promotion races;
9. king endgames and draw awareness;
10. opening principles and full-game planning;
11. match preparation, clocks and fair play.

Each lesson follows the same compact rhythm:

```text
explain → demonstrate → learner move → immediate feedback → short check → play
```

### Mastery, not consumption

Watching or opening content is not completion. Evidence types include:

- correct first-attempt move;
- correct move after a hint;
- successful repeated attempt;
- transfer to a new position with the same theme;
- demonstrated use in a game;
- teacher-reviewed evidence.

Mastery is concept-specific. A student can be strong in captures and still need
work on king endgames.

### Hints and explanations

Hints use a ladder:

1. remind the rule or goal;
2. highlight candidate pieces;
3. show the tactical motif;
4. show the first move;
5. reveal the line with explanation.

The attempt records the deepest hint used. The product never labels a child as
“bad”; it describes the observable pattern, for example: “You often miss a
backward capture after the first jump.”

### Spaced review

Incorrect or heavily hinted concepts enter a review queue. Review timing is
deterministic and auditable. A teacher can see why an item returned and can
override the recommendation.

## 7. Bot ladder

Bots are opponents with known behavioural envelopes, not cosmetic names placed
over one strength setting.

Suggested ladder:

1. **Искра** — always legal, captures when required, intentionally broad move
   choice and no search;
2. **Следопыт** — protects pieces and prefers material gain;
3. **Тактик** — sees short combinations and promotion races;
4. **Комбинатор** — deeper capture sequencing and traps;
5. **Стратег** — balances centre, tempo, structure and endgames;
6. **Мастер** — iterative deepening with opening variety and endgame knowledge.

Calibration requirements:

- every bot always obeys the complete rules;
- lower levels weaken move selection, not legality;
- search has a hard time budget and cancellation;
- tests use seeded tie-breaking for reproducibility;
- production play retains controlled variety;
- a bot rung unlock is based on a transparent condition such as wins plus
  concept evidence, with teacher override;
- the review can explain material, promotion, forced capture and tactical
  consequences without exposing raw engine jargon to young learners.

The engine begins with deterministic move generation and alpha-beta search in a
Web Worker boundary. Machine-learning training is not required for M1: it would
make calibration and explanation harder without solving the primary product
problem.

## 8. Safe cooperation

### Allowed interaction

- challenge a member of the same authorised class;
- accept/decline a challenge;
- participate in a teacher-created friendly or team event;
- spectate only when the teacher enables the event;
- send a small allowlist of reactions such as “Удачи”, “Хороший ход”, “Спасибо
  за игру”, applause, thinking and a friendly smile;
- mute reactions locally;
- send a non-text “report to teacher” signal tied to the game record.

### Forbidden interaction

- free-form child-to-child text;
- user-created reaction labels;
- links, images, files, voice or video;
- public child profiles or global opponent search;
- reactions designed to taunt, shame, threaten or pressure;
- repeated reaction spam.

Reactions are server-authoritative enum values, rate-limited, auditable and
disabled after the game except for one closing sportsmanship reaction. Teacher
feedback is a separate authorised educational record.

### Cooperation without chat

Useful cooperation does not require messaging. ASA can support:

- class goals based on collective lesson completion;
- paired puzzle relays where each learner makes one move;
- team-versus-bot positions created by a teacher;
- class tournaments with automatic pairings and no chat;
- shared analysis controlled by the teacher, using board arrows/markers and
  predefined prompts rather than arbitrary text from children.

## 9. Data and evidence model

The module owns subject data and exposes only stable public contracts.

Core records:

- `CheckersDocumentV1` — versioned project/game/position document;
- `CheckersGame` and immutable move events;
- `CheckersLesson` and curriculum concept references;
- `CheckersPuzzle` with expected lines, themes and hint ladder;
- `CheckersAssignment` targeting a class/group/student;
- `CheckersAttempt` with move and hint evidence;
- `CheckersProgress` per learner and concept;
- `CheckersBotMilestone`;
- `CheckersClassEvent` and authorised participants;
- `CheckersReactionEvent` using a closed enum and audit metadata.

The Checkers Home API returns a read model assembled from these records. It does
not place Checkers conditionals in Project Core or Classroom Core.

Minimum teacher metrics:

- active students over 7 and 30 days;
- assignments started/completed/overdue;
- lesson and puzzle accuracy;
- first-attempt accuracy and hint depth;
- concept mastery and recurring mistake themes;
- games played/completed/abandoned;
- bot rung and recent progression evidence;
- exact drill-down links to attempts and games.

Metrics must never claim learning from page views alone.

## 10. Rules authority and engine requirements

Rules authority:

- official FMJD/IDF draughts-64 rules:
  https://www.fmjd.org/downloads/64cb/Official_Rules_of_the_game_in_64_classic_draughts.pdf
- IDF rules index: https://idf64.org/rulesregulations/

The first engine must cover at least:

- play on the dark squares of an 8×8 board;
- men moving one diagonal step forward;
- men capturing forward and backward;
- mandatory capture;
- free choice among legal capture continuations under Russian rules;
- multi-capture by the same piece;
- flying kings moving and capturing along diagonals;
- promotion on reaching the last rank, including continuation as a king during a
  capture sequence;
- no recapturing the same piece in one sequence;
- captured pieces remaining blockers until the sequence is complete where the
  official rule requires it;
- win by eliminating or immobilising the opponent;
- official repetition and material/endgame draw conditions;
- clocks as a separate game policy, not a move rule;
- deterministic replay from a canonical initial state and move list.

Rule fixtures must cite the authority and include edge cases that distinguish
Russian draughts from English and international draughts.

## 11. Accessibility and child usability

Required:

- full keyboard board navigation and move execution;
- visible focus and current selection;
- colour is never the only indicator of side, legal move or status;
- high-contrast and colour-safe board themes;
- accessible names for squares and pieces;
- optional coordinates;
- reduced-motion mode and no essential animation;
- touch targets suitable for tablets;
- reversible drag and click-to-move interaction;
- clear mandatory-capture feedback;
- no timer pressure in learning modes;
- concise language suitable for children without baby talk.

## 12. Delivery slices

### Checkpoint 1 — market and product contract

- this analysis;
- active Issue, branch, control plane and test contract;
- approved rules authority and scope boundary.

### Checkpoint 2 — rules and project vertical slice

- independent module provider;
- complete Russian rules engine;
- create/open/play/save/reload/replay;
- shared ASA project header and responsive board;
- rule, schema, integration and accessibility tests.

### Checkpoint 3 — curriculum, assignments and progress

- Checkers Home;
- initial curriculum and puzzle model;
- teacher assignment builder;
- evidence and mastery read models.

### Checkpoint 4 — bots and review

- calibrated bot ladder;
- worker search boundary;
- hints, post-game review and mistake queue.

### Checkpoint 5 — safe class play

- class-scoped challenges and games;
- predefined reactions, mute, rate limits and audit;
- teacher-created friendly/team events.

### Checkpoint 6 — hardening and owner acceptance

- desktop/tablet/mobile journeys;
- performance, offline/reconnect and failure states;
- full focused and repository gates;
- owner-visible student and teacher evidence.

## 13. Success criteria

The module is successful when:

- a new learner can begin without teacher explanation;
- a teacher can assign meaningful work in minutes;
- the system can prove what a student attempted and learned;
- every bot move and student move is legal under one cited ruleset;
- a child can play a classmate without receiving arbitrary content;
- returning users immediately see their real Checkers state;
- Chess, Electronics, 3D and Project Core behaviour remain unchanged;
- mobile and keyboard users can complete the same learning journey;
- tests and evidence support the claims on the exact reviewed SHA.

