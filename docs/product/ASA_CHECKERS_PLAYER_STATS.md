# ASA Checkers — Player Stats, Ratings and Leaderboards

**Status:** product contract for CK-107B/CK-107C
**Purpose:** make player progress visible across rated online play, quick games, friends/classmates and bots without mixing incompatible result pools.

## 1. Product principle

ASA Rating is one public competitive strength number. Player Stats is the broader game profile.

Do not mix these concepts:

- rated public human-v-human matches change ASA Rating;
- Quick Play contributes to unranked human statistics but not rating;
- friend/classmate games contribute to their own social/head-to-head statistics;
- bot games contribute only to bot-performance statistics;
- local games do not affect public competitive statistics.

Every completed server match remains the source of truth. Aggregate statistics must be rebuildable from canonical match results and immutable rating events.
## 2. My Checkers Profile

Primary summary card:

- current ASA Rating and calibration state;
- peak ASA Rating;
- season position and percentile when eligible;
- total completed games;
- wins / draws / losses;
- win rate;
- current and best winning streak;
- recent form, e.g. last 10 results;
- performance as light vs dark.

The page must have filters: `All`, `Rated`, `Quick`, `Friends`, `Classmates`, `Bots`.

The summary must never imply that bot wins or classroom wins contributed to ASA Rating.
## 3. Rated analytics

For rated human-v-human play show:

- rating history graph: 7 days / 30 days / season / all time;
- rating change from each completed rated match;
- highest rating and date achieved;
- wins, draws, losses and win rate;
- performance against lower / similar / higher-rated opponents;
- average opponent rating;
- win rate as light and dark;
- current season record;
- last 10 rated results with rating deltas.

A rating event must reference exactly one finished match and be idempotent. Replaying `match.finished` cannot create a second rating event.
## 4. Bot analytics

Bot performance is a separate dashboard and never changes ASA Rating.

For every bot show:

- bot name and fixed difficulty rung;
- games played;
- wins / draws / losses;
- win rate;
- results as light and dark;
- current and best win streak against that bot;
- last result and last played date;
- whether the player has ever beaten that bot;
- strongest bot beaten by the player.

Persist `botId` and a `botStrengthVersion`/engine version with each completed bot game so historical statistics remain interpretable after bot tuning.

Do not present an invented Elo number for bots until bot strength has been independently calibrated. UI may say `Уровень 4 из 6`, not a fake federation-like rating.
## 5. Social comparison

### Classmates

For each class where Checkers competition is enabled, show a class leaderboard with:

- place in class;
- public game alias/avatar;
- ASA Rating and calibration state;
- rated games count;
- win rate;
- optional class-only head-to-head record.

Also show `Моё место в классе` even when the user is outside the currently visible top rows.

Class membership itself must never leak into the global public profile. Class leaderboards are visible only to eligible members/teachers under the existing classroom authorization model.
### Friends / familiar opponents

Where ASA has an approved friend/contact relationship, show a friends leaderboard by ASA Rating and recent form.

Until a general friend graph exists, Checkers must not invent a hidden social graph. The same UI may fall back to `Приглашённые и недавние соперники`.

For a specific opponent show head-to-head:

- total meetings;
- wins / draws / losses;
- score percentage;
- rated vs friendly split;
- last five meetings;
- current head-to-head streak;
- `Сыграть ещё` when inviting that opponent is allowed.
## 6. Public profile and leaderboard

Public Checkers profile may expose only game-facing data:

- alias and avatar;
- ASA Rating and calibration state;
- peak rating;
- rated games count;
- wins / draws / losses and win rate;
- recent form;
- current season placement when eligible.

A public ASA leaderboard should support at minimum `Top`, `Around me` and current season filters. Use game aliases; do not publish school, classroom, age, email, teacher, assignments or learning evidence.

For child/school accounts, public visibility must respect organization/account safety policy. Class-only statistics remain class-scoped even if the player's rating itself is public.
## 7. Useful game analytics

Keep analytics understandable rather than turning the profile into telemetry noise. Recommended v1 metrics:

- average game length in moves;
- win rate by side;
- percentage of games where the player reached a king;
- wins by `no pieces` vs `no legal moves` where available;
- performance trend over last 10 / 30 games;
- rated performance grouped by opponent-strength band;
- bot performance matrix by difficulty rung.

Advanced opening statistics, engine accuracy scores and tactical-error classification are later features and require a trustworthy analysis engine rather than heuristics presented as fact.
## 8. Data model principles

Canonical completed matches are the source of truth. Derived aggregates may be cached/materialized but must be rebuildable.

Minimum persistent records:

- completed Checkers match with mode, participants, sides, result and timestamps;
- for bot games: `botId` and bot strength/engine version;
- immutable rating event with before/after/delta and source match id;
- current rating snapshot with peak and calibration count;
- optional rebuildable aggregates by mode/opponent/bot/class scope.

Never store win percentage as the only truth. Store counts/results and derive percentages so corrections remain possible.
## 9. Acceptance

Player Stats is accepted only when browser tests prove:

1. a rated match updates both rating and rated aggregates exactly once;
2. a Quick Play match updates unranked human stats but not ASA Rating;
3. a bot win updates only the correct bot row and never public rating;
4. light/dark counters agree with canonical match sides;
5. head-to-head totals equal the underlying completed matches;
6. a class leaderboard contains only authorized class members and exposes no extra education metadata;
7. the public profile omits school/class/learning information;
8. rebuilding aggregates from match/rating events yields the same visible totals;
9. percentages handle zero games without NaN/Infinity;
10. deleted/invalidated competitive results follow one explicit correction policy rather than silently drifting aggregates.
