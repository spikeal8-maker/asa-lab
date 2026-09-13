# CK-105 — Match Session foundation

**Status:** first GitHub-only implementation slice
**Base:** `982f637709898c9751e81e75f44d2b63f34516e4`

## What this slice changes

CK-105 does not create a second Checkers engine. The repository already has `CheckersGameService`, so this slice makes that existing service the forward-compatible session contract.

The application service now supports:

- `bot`;
- `local`;
- `class`;
- `lesson`;
- `friend`;
- `quick`;
- `rated`.

A service session has an explicit `active | finished` status derived from the canonical `CheckersDocument`. Finished sessions reject additional moves, and `friend / quick / rated` sessions are human-v-human and deliberately carry no classroom id.

## Unified presentation contract

`apps/web/src/checkers/checkers-match-session.ts` introduces one projection for:

- current personal bot play;
- current local two-player play;
- current classroom server games;
- future `CheckersGameService` sessions, including friend/quick/rated.

The projection centralizes mode label, opponent label, viewer side, orientation, read-only state, resume data, result data and history data.

This is intentionally additive. The large React experience is not rewritten in this slice; switching it to the adapter is the next bounded CK-105 slice after CI accepts this foundation.

## Non-regression and safety

- Russian-64 rules are unchanged.
- Current persisted `activeMatch` project format is unchanged in this slice.
- Legacy bot play stays fail-closed when the human side is unknown.
- Classroom authority remains on the classroom server object; the adapter is presentation-only.
- Public/private online modes reject classroom ids so public matchmaking cannot accidentally inherit education scope.

## Acceptance for this slice

The focused tests must prove:

1. existing bot sessions still use the shared legal-move engine;
2. `friend`, `quick` and `rated` sessions accept two human players;
3. bot players cannot enter rated play;
4. online friend/quick/rated sessions cannot carry classroom scope;
5. finished sessions reject further moves;
6. bot/local/classroom/future rated sessions project through one presentation contract;
7. result/resume/history views derive from that contract rather than separate mode-specific logic.
