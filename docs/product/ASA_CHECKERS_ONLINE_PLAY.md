# ASA Checkers — Online Play product contract

**Status:** planned after CK-104A / CK-105
**Purpose:** make human-v-human Checkers visible and usable from the main Checkers product, not only from a specific classroom project.

## 1. Online Lobby

`Играть по сети` opens one common lobby with four primary actions:

```text
[ Быстрая игра ]
[ Рейтинговая игра ]
[ Пригласить друга ]
[ Одноклассники ]
```

The lobby also shows:

- current ASA rating and calibration state;
- incoming challenges;
- active online match / reconnect action;
- recent online result and rating delta;
- current matchmaking search with a clear Cancel action.
## 2. Match types

### Quick match

Public, human-v-human, unranked. The player enters a server-side queue and can be matched with any eligible online opponent. Rating may be used only as a soft quality signal; the result does not change rating.

### Rated match

Public, human-v-human and rating-bearing. The player sees the current rating before search. Matchmaking starts in a narrow rating window and gradually expands while the user waits.

### Private friend match

The creator receives a short code and invite URL. The second authenticated user joins the exact match. Private friend results never change public rating.

### Classmate challenge

The lobby aggregates eligible classmates across the user's classes. A learner does not need to open a specific classroom project first. Existing classroom safety policy and safe reactions remain applicable to the match.
## 3. Matchmaking contract

Recommended first implementation:

- one active matchmaking ticket per user;
- ticket modes: `quick` or `rated`;
- states: `searching`, `matched`, `cancelled`, `expired`;
- ticket TTL: 120 seconds, renewable only by explicit continued search;
- a user can never match with themself;
- pairing and match creation are one atomic server operation;
- a ticket that has been matched cannot be reused;
- cancel and match operations must be race-safe;
- when matched, both clients receive `match.found` and the canonical match id.

For rated search, start around ±100 rating points and expand the window while waiting, for example by 75 points every 10 seconds up to a bounded maximum. Exact tuning is configuration, not client logic.
## 4. ASA rating v1

The first version should be explicitly called **ASA Rating**, not an official federation title or sports rank.

Recommended Elo-style baseline:

- initial rating: `1200`;
- first 10 rated games: `Калибровка`;
- K-factor during calibration: `40`;
- K-factor after calibration: `24`;
- win score: `1`, draw: `0.5`, loss: `0`;
- rating is updated only for completed `rated public` human-v-human matches;
- bot, local, classroom and private friend games never change public rating;
- both rating changes and match finalization occur in one server transaction;
- a finished match has an idempotency marker so rating cannot be applied twice.

The user profile shows rating, calibration games remaining, played, wins, draws, losses and current streak. Global leaderboard and formal leagues are separate later work.
## 5. Notifications and presence

Incoming online actions must be visible without opening a specific classroom:

- `Вас вызывает …` for a friend/classmate invite;
- `Соперник найден` for matchmaking;
- `Ваш ход` for an active online match;
- reconnect notice after transport recovery;
- match result and rating delta when applicable.

Presence is deliberately coarse: `online / in game / unavailable`. Do not expose exact classroom activity, lesson state or personal schedule to a public opponent.

An incoming challenge can be accepted or declined from the Checkers lobby. Classroom challenges may additionally appear in the relevant class surface, but that is a second presentation of the same server object rather than a separate match system.
## 6. Safety and privacy

Public matchmaking must not reveal education context. A public opponent may see only the public game identity needed for the match: display alias/avatar, ASA rating and game result history intended for public play.

Never expose through public matchmaking:

- email;
- school name;
- classroom membership;
- teacher identity;
- assignments, mastery or learning evidence;
- age/birth date;
- internal account or learner identifiers.

No free-form chat is required for v1. Safe preset reactions, mute and report can reuse the existing Checkers safety pattern. Public matchmaking eligibility must respect account/organization safety policy rather than bypassing classroom authorization checks.
## 7. Server-authoritative match model

All online variants converge on one match session. Minimum server state:

```text
match id
mode: friend | classroom | quick | rated
status: waiting | active | finished | abandoned
light principal
dark principal
canonical CheckersDocument
version / sequence
created / started / finished timestamps
rating-applied marker where applicable
```

Each move validates participant, turn, expected version and legality through the existing Russian-64 domain engine before the state is committed. Realtime transports confirmed state; it never decides whether a move is legal.

Polling may remain for discovery lists or degraded fallback, but an active online game must use realtime push plus canonical reconnect recovery.
## 8. Acceptance gates

Online play is not complete until browser tests prove:

1. two unrelated accounts enter Quick Match and are paired into exactly one match;
2. two rated accounts are matched, finish a game and each receive exactly one rating update;
3. cancelling search cannot later create a ghost match;
4. a private invite link cannot control both sides;
5. a learner sees classmates from the main Online Lobby and an incoming classmate challenge without opening the classroom first;
6. reconnect restores the canonical board/version after a transport interruption;
7. duplicate move submission and duplicate match-finished delivery remain idempotent;
8. public opponents cannot retrieve classroom/school/learning metadata through online APIs.

## 9. Delivery order

Do not build separate engines for friend, classroom and public play. Delivery order is:

`CK-105 Match Session → CK-106 friend/private → CK-107 realtime → CK-107A matchmaking → CK-107B rating → CK-108 classroom convergence`.

This keeps one authoritative human-v-human runtime and prevents another set of parallel game flows.
