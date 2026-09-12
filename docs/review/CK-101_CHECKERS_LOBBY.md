# CK-101 — Checkers game-first Lobby

**Date:** 2026-09-12
**Base:** `a46e7868e32a94bb12800ab0573a6a251efc1772`
**Status:** IMPLEMENTED; focused gate PASS; browser evidence pending isolated `*_test` database.

## 1. Product result

The previous student aggregate is replaced by a game-first Checkers Lobby.
The first decision is now how to play, not which educational recommendation to continue.

Visible modes:

- `Играть с ботом` — active and primary;
- `Играть вдвоём` — visible but disabled until CK-103;
- `Играть с другом` — visible but disabled until CK-106;
- `Играть в классе` — active only for classroom-backed projects;
- `Задачи и обучение` — active but secondary to play;
- `Мои партии` — visible but disabled until match-session/history work.

No unavailable mode pretends to work.
## 2. Resume contract

The generic `Продолжить` action is removed from the Lobby.
`Продолжить партию` is rendered only when there is an identifiable unfinished match.

Classroom resume is derived from an active server game and includes opponent, player side and turn state.
Bot resume additionally requires a known human side.

For bot games started after CK-101, the selected human side is stored in local browser storage under the project id.
On reload it is restored before bot automation can run.

A legacy unfinished bot game without a trustworthy stored side is fail-closed:

- no Resume Card is shown for it;
- the bot worker does not automatically move;
- the user can explicitly start a new bot game and establish the side again.

This prevents a reload from making a bot act for a human who had originally selected dark.
## 3. Scope deliberately not changed

CK-101 does not change:

- Russian-64 rules or move generation;
- bot strength/progression policy;
- bot-win progression semantics;
- Board renderer or piece animation;
- classroom API or persistence schema;
- 2.5 second classroom polling;
- realtime gateway;
- puzzle engine or learning evidence.

Those remain owned by later Checkers tasks.

## 4. Automated contracts

Presentation tests now require the six target Lobby modes and reject a generic `>Продолжить<` button.
A separate presentation case proves that `Продолжить партию` appears only with explicit match context.

Bot-side storage has a focused unit contract: missing or invalid values resolve to unknown; a valid stored `dark` side is restored as `dark`.
The existing domain winner-side regression remains unchanged.
## 5. Browser contract and evidence status

`e2e/checkers-module.spec.ts` is updated to enter the learning flow from the new Lobby and to enter the bot ladder through `Выбрать бота`.
The rest of the existing puzzle → save → reload → bot move → bot reply → review journey remains in place.

A fresh browser run is not claimed in CK-101 because the clean evidence checkout has no explicit `APP_TEST_DATABASE_URL` pointing at an isolated `*_test` database.
The production/working database is not used as a substitute.

Existing CK-000 screenshots remain the before-state comparison evidence.
New visual evidence must be generated only through the isolated browser gate.

## 6. Next boundary

CK-101 ends at navigation clarity.
CK-102 owns true Bot Free Play: unrestricted free-play bot selection, light/dark/random setup, campaign separation, dark-side progression fix, result flow and rematch.
CK-103 owns the first real Local two-player implementation.
## 7. Final focused evidence

Executed after all CK-101 code, tests and documentation were present:

```text
NX_SKIP_NX_CACHE=true
corepack pnpm gate:checkers-m1
```

Result:

```text
gate:checkers-m1: PASS, exit 0
test:checkers: 19 test files, 74 tests PASS
typecheck:checkers: PASS
repository-wide typecheck: PASS
full production build: PASS
Nx cache: skipped
```

No database, migration, Docker runtime or deployment action was performed.
