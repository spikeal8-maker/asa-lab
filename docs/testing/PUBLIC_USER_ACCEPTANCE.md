# Bounded public user acceptance

This CLI checks a small, explicitly prepared synthetic user journey at
`https://asa-lab.ru`. It is separate from the hosted loopback N2/N30 fixtures and
the portable installer smoke tests. It does not measure capacity, validate a
release, qualify PostgreSQL/FRP, or authorize a deployment.

**Implementation status:** source and offline unit checks only. Actual public
Account/Seat login, My Learning lists, editor persistence, game notifications
and fault recovery remain **NOT_RUN** until an operator runs this CLI and reviews
its receipts.

## What the operator prepares

Use the ordinary product UI and supported Account/classroom operations to prepare
one dedicated synthetic adult Account, its personal workspace, one classroom
owned by that Account and exactly two synthetic StudentSeats. This script never
registers Accounts, verifies identities, enables an educator capability, creates
classes/Seats, rotates credentials or changes game/access/safety policies.

Choose a unique marker beginning `ASA-PUBLIC-TEST-`, followed by 6–40 ASCII
letters, digits or hyphens. The Account display name must be the marker followed
by ` Account`; the classroom title must equal the marker; the two Seat labels
must be the marker followed by ` Seat 1` and ` Seat 2`. This is an explicit test
data boundary, not a way to authorize an arbitrary classroom.

The Account must already have its personal workspace active and its timezone
set through the normal product flow. Both `/api/auth/me` and
`/api/auth/verification` must actually report `verification.required: false`.
An ordinary verification grace period is accepted only while the server reports
that value. Missing verification evidence or a verification wall stops the run;
the CLI does not manipulate verification providers, dates, sessions or policy.

The classroom must be active, personal, in safe mode, with an active class code
and server-reported `teacherRole: owner`. The exact roster must contain only the
two manifest Seats, each safe and either issued or active. Before creating any
project, each of the three actors must have an empty ordinary projects list.
Existing projects cause a handoff, so a repeated invocation cannot silently add
another batch. The operator keeps existing results and decides how to conduct
any subsequent test; this CLI has no deletion or reset command.

Normal classroom game admission must already allow both synthetic Seats to play
Chess and Checkers in the classroom scope. If it does not, the game step is
BLOCKED; the script does not override the policy or widen it to school/platform.

## Private manifest

Supply a UTF-8 JSON file outside the repository and evidence directories. On
POSIX it must be a regular non-symlink file with no group/other permissions
(normally mode `0600`). On Windows, restrict its ACL to the operator; Node's
POSIX permission bits cannot attest Windows ACLs. The manifest is limited to
16 KiB. Never commit it, paste it into an issue, or attach it to a report.

The JSON object has this exact schema. Unknown keys are rejected; it accepts no
arbitrary URL, project ID, load profile, cookie, storage state or browser handle.

| Field | Required value |
| --- | --- |
| `schemaVersion` | Number `1` |
| `origin` | Exactly `https://asa-lab.ru`, without a trailing slash |
| `expectedRevision` | The expected full 40-character lowercase Git SHA for API and Web |
| `expectedSchemaVersion` | Expected positive integer schema version |
| `testMarker` | The unique synthetic marker described above |
| `account.id` | Exact provisioned Account UUID |
| `account.workspaceId` | Exact personal workspace UUID |
| `account.displayName` | Exact marker plus ` Account` |
| `account.identifier` | Ordinary login identifier for that Account |
| `account.password` | Its ordinary password |
| `classroom.id` | Exact own synthetic classroom UUID |
| `classroom.title` | Exactly the marker |
| `classroom.code` | Current nine-character class code; product spaces are accepted |
| `seats` | Exactly two objects, in Seat 1 / Seat 2 order |
| `seats[0].id`, `seats[1].id` | Two distinct provisioned Seat UUIDs |
| `seats[0].displayLabel`, `seats[1].displayLabel` | Exact corresponding marker labels |
| `seats[0].studentCode`, `seats[1].studentCode` | Current distinct case-sensitive Student Codes, 4–10 letters/digits |
| `allowNativeBotCheckClick` | Optional boolean; absent/false means BLOCKED/HANDOFF at a bot checkbox |

Account, workspace, class and both Seat IDs must all be distinct. No credentials
or IDs in a manifest constitute server authorization: the CLI rechecks actual
identity, verification, class owner role, roster and rollout evidence before
product actions. The server's own access/origin/session guards stay enabled.

### Bot-check handoff

An observed “Я не робот” checkbox is a distinct interaction. Without the
operator's explicit authorization for that interaction, leave
`allowNativeBotCheckClick` absent or false. The script reports
`bot_check_handoff` and closes only its own contexts. This does not ask for a
second approval for already requested synthetic tests.

When that specific native interaction is authorized, set the field to true. The
CLI performs one ordinary checkbox click and waits for the unchanged native
control. If it is not checked within 30 seconds, the run remains BLOCKED/HANDOFF.
It does not simulate motion patterns, solve a challenge itself, call a captcha
solver, construct a bot proof, use an accessibility shortcut, disable protection
or reuse another browser's cookies. A successful checkbox does not prove Account
identity; subsequent independent server checks are mandatory.

## Run modes

Use the repository's pinned Node/pnpm dependencies and installed Playwright
Chromium. The actual run launches its own visible Chromium with TLS verification
enabled and service workers allowed. It neither attaches to a user browser nor
changes its profile. Do not provide test-DB, seed, load, alternate-base-URL or CI
environment variables. `NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected.

Local manifest validation, with no Playwright import, browser or network:

```bash
node tools/capacity/public-user-acceptance.mjs --manifest /secure/asa-public-acceptance.json --report /secure/asa-public-validation-report.json
```

The report has `NOT_RUN` for every operation. This is input validation, not
application acceptance. When the already authorized synthetic test is to run,
select the actual mode explicitly:

```bash
node tools/capacity/public-user-acceptance.mjs --manifest /secure/asa-public-acceptance.json --report /secure/asa-public-run-report.json --run
```

There is no additional approval file. The output must be a new file, different
from the input. The CLI reserves a private report before opening a browser and
checkpoints its allowlisted evidence after each operation. Exit codes are `0`
for local NOT_RUN or complete PASS, `1` for FAIL and `2` for BLOCKED. Always read
the report status; exit code zero alone is not native acceptance.

Do not direct `e2e/classroom-scale.spec.ts`, `e2e/seed.ts`, database fixtures,
`tools/blocks/portable-smoke.mjs` or deployment smoke helpers at this origin. Do
not loosen their loopback, hosted-runner, `_test` database or source fences.

## Fixed journey and limits

There are exactly three owned browser contexts, with sequential actions and two
additional read-only tabs. Five project attempts and two game challenges are the
absolute maximum; ambiguous failures consume their slot and are not replayed.
Resources are learned only from a successful native creation response in this
run. The CLI cannot accept preexisting or externally supplied project IDs.

The five allowed actor/module slots are fixed:

| Actor | New projects | Native entry |
| --- | --- | --- |
| Account | One Electronics project | Ordinary quick-create menu |
| Seat 1 | One Electronics project and one Scratch (`blocks`) project | Ordinary quick-create menu |
| Seat 2 | One Chess save and one Checkers save | Each game's native invitation notification |

Seat 2 does not create duplicate Electronics/Scratch projects. Both Seats still
log in normally, prove exact identity/class membership and reload their own
read-only home tabs. Game saves count towards the same five-project maximum.

1. Read API version, Web build metadata and readiness. All must match the exact
   expected revision/schema. Database readiness must be `up` and credential
   configuration valid. A mismatch stops before login or product changes.
2. Log in through the ordinary Account form, prove exact Account/verification,
   prove the own synthetic classroom/roster, and verify Account continuity after
   reload. Native startup telemetry waits for the same identity/ownership proof.
3. Log in both Seats through the class-code and Student Code forms in separate
   contexts. Read `/api/class-join/me` to prove exact Seat/class identity.
4. On the existing Account and Seat 2 pages, open `#/learning` (“Моё обучение”).
   Require the three overview counts to finish loading without an error, then
   follow the ordinary “Курсы” navigation link and require a loaded course list
   or the genuine empty state. Recheck actor identity. Both pages are temporarily
   read-only under the routing guard, restored in `finally`; no course, lesson,
   task, enrollment, learning start, progress or submission is created/changed.
   This checks list access only and does not claim enrolled course completion.
5. Create the Account Electronics project and Seat 1's two editor projects.
   Electronics uses the catalogue, mouse placement, resistance input and “Сохранить проект”.
   Scratch uses the same-origin `/internal/blocks/` native sprite picker, Apple
   sprite, name/x/y inputs and the genuine upstream minute autosave.
6. Observe a successful real draft PUT containing the selected edit, then perform
   an independent authenticated `GET /api/projects/{id}`. Compare expected and
   actual semantic hashes and revision growth. Reload the editor, inspect native
   controls and independently require unchanged full document hash and a
   nondecreasing revision (an unchanged native autosave may advance the revision).
   Scratch proof includes durable costume references and a decoded sprite image.
7. Return 503 only for that Seat context's actual same-origin analytics/diagnostics
   POST requests while another native Scratch edit saves and reopens. No injected
   request means `telemetry_fault_not_observed`, not PASS. Normal service workers
   remain enabled; the CLI does not unregister or modify them to make routing work.
8. Make only that browser context offline for ten seconds, perform a native
   Scratch edit and restore online while waiting for native autosave/recovery.
   The observed offline interval must be 10–15 seconds; no clocks are accelerated.
9. Open/reload a read-only home tab for each Seat and recheck its identity. These
   tabs cannot issue project/game mutations through the harness's routing guard.
10. For each of Chess and Checkers, Seat 1 resolves Seat 2 from its proved
    authenticated access response and issues one normal classroom challenge.
    Before Seat 2 clicks “Посмотреть приглашения”, reserve its one exact game-save
    slot and arm its ordinary native project creation. Register only the newly
    created game save, then independently read it under Seat 2's identity. The
    native notification opens the network lobby; click “Принять вызов” on the exact
    invitation article. Read the match independently and require exactly those
    two players. Resign that own synthetic match through the normal API and verify
    its finished state and increased version. Read the game save again and require
    an unchanged document hash with nondecreasing revision. No foreign invite or
    match is accepted/changed.
11. Log the Account out and in through native controls, verify identity again,
    require exactly the five project attempts/receipts and two matches, read back
    all five saved documents and recheck rollout evidence.

Editor controls and persistence projections are adapted from the frozen N2
source `e2e/classroom-scale.spec.ts` at blob
`879bb75dc7c931d0bf408b64095c846bd8913cd6`. Its workload, database, service-worker
preparation and registration setup are not imported or run. The public API
contracts are the normal auth, classroom, project, Blocks runtime and game
controllers; the CLI does not invoke React/VM internals or private save methods.

### Native game creation and ownership contract

The contract follows the product source at the pinned expected revision:

1. `apps/web/src/pages/GamesPage.tsx` calls `openGame(game)` before opening the
   invited game's network route. `apps/web/src/games/open-game.ts` reads admission
   and the personal active game list. A fresh entry calls `api.createProject` with
   the catalogue title, `scope: personal`, and `games-entry-v1-chess` or
   `games-entry-v1-checkers` as its normal idempotency key.
2. `apps/web/src/api.ts` serializes the native body as exactly `scope`,
   `classroomId: null`, `module` and `title` (“Шахматы” / “Шашки”). The harness
   observes and checks this body and header unchanged; it does not replace the
   key, add an owner/class, inject a game save or call a private UI method.
3. `apps/api/src/projects.controller.ts` derives the actor from the authenticated
   session. A present Seat cookie selects that Seat and cannot fall back to Account
   authority. `contexts/projects/application/project.usecases.ts` rejects a
   non-null classroom for a personal project and passes `classroomId: null` to
   the repository.
4. `contexts/projects/infrastructure/pg-project.repository.ts` inserts that null
   unchanged and derives `owner_principal_id` from the server actor. Its
   `toProject` returns the stored classroom value unchanged. The personal-project
   constraint in `migrations/0004_personal_teacher_projects.sql` requires null;
   the game transaction guard in `apps/api/src/games-project-guard.ts` checks the
   current Seat/class/session admission without converting this personal save
   into a classroom-scoped project. These are source checks, not a database run.

Consequently, each game receipt must be HTTP 201 with `created: true`, a fresh
UUID, the exact reserved Seat 2/module, personal scope, **null** classroom, active
status and exact catalogue title. It must match the one observed native request
for that actor/module slot. The receipt DTO contains no public owner ID: ownership
is established by the proved Seat context, its creation response and subsequent
independent authenticated read, not by trusting a supplied owner field. Extra
owner fields or foreign classroom/module/ID receipts are rejected. The existing
Electronics/Scratch classroom checks remain unchanged.

The admitted POST disarms immediately and its request receipt remains consumed
even if transport or response validation fails. The pending creation barrier
registers the new project before dependent project GET/PUT requests proceed. A
preexisting save returned by native resume, an idempotent HTTP 200/`created: false`
response, a duplicate ID or a second creation attempt cannot enter the registry.
An ambiguous failure stops the run; the slot is never refunded or retried. Seat 1
only sends the challenge/resign requests and does not open a native game card, so
exactly two game-save slots are required.

## Evidence, failure and cleanup

Each operation is `NOT_RUN`, `BLOCKED`, `FAIL` or `PASS`. An unproved identity,
foreign resource, unsupported request or missing prerequisite stops further
steps. Later operations remain NOT_RUN. HTTP errors outside the actual injected
503 window, unexpected network failures, page errors or browser crashes prevent
a final PASS. Console error counts are recorded without interpreting their text.

The report contains only selected revisions/schema, timestamps, fixed operation
names/codes, normalized route templates, HTTP status, UUID-shaped request IDs,
fault bounds and semantic hashes/revisions. Actor/class/project/match IDs are
hashed with the run ID. Arbitrary URLs, queries, fragments, response/request
bodies, source documents/code, cookies, storage state, credentials and raw
exception/console text are not recorded. No HAR, trace, video or screenshot is
collected. The default Playwright assertion errors are replaced by fixed codes.

HTTP records are bounded at 1,200; any overflow is counted. The report does not
equate a successful UI acknowledgement with durable saved content. Full-document
hash agreement and revision checks are independent from the native request.
Overflow blocks complete acceptance because the omitted HTTP evidence cannot be
reviewed. Ordinary navigation aborts and failures inside the owned offline window
are distinguished from unexpected network failures.

`finally` restores online, removes the exact injected telemetry handler and
closes every owned context, even after a failure; it never closes someone else's
context. Closing the context removes its remaining guard routes. No project,
Seat, Account, classroom or game row is deleted. Results remain with the owner.

Server process restarts and the deployed Scratch image's source revision are not
provable from these public contracts and remain `NOT_OBSERVABLE`. The report
does not claim N30/3000 capacity, server-wide outage recovery, concurrent edits of
one document, provider recovery, database restore or release acceptance. A
BLOCKED native run is a real limit to resolve, not permission to weaken a guard.

## Focused author verification

```bash
node --check tools/capacity/public-user-acceptance.mjs
NX_SKIP_NX_CACHE=true pnpm exec vitest run tests/capacity/public-user-acceptance.spec.ts
pnpm exec tsc --noEmit --allowJs --checkJs false --skipLibCheck --module nodenext --moduleResolution nodenext --target es2022 --esModuleInterop --types node --lib es2022,dom --strict tests/capacity/public-user-acceptance.spec.ts
NX_SKIP_NX_CACHE=true pnpm exec eslint tools/capacity/public-user-acceptance.mjs tests/capacity/public-user-acceptance.spec.ts
pnpm exec prettier --check tools/capacity/public-user-acceptance.mjs tests/capacity/public-user-acceptance.spec.ts docs/testing/PUBLIC_USER_ACCEPTANCE.md
```

The unit suite uses synthetic in-memory objects and local temporary files only.
Its game-entry witness executes the unchanged product `openGame`, game catalogue
and API serializer, with only HTTP/access readiness stubbed, against the actual
harness guards/receipt capture. It requires exactly two game creates after three
editor slots, checks registration before dependent GET/PUT, and rejects wrong
actor/module/class/owner fields, duplicate/preexisting saves, changed native
requests and ambiguous attempts. Other cases cover identity/ownership, finite
writes, My Learning read-only boundaries, redaction, readback and fault-finally
behavior. It cannot prove actual public UI compatibility,
bot-check completion, network routing, native save/autosave or policy readiness.
Independent review and an actual bounded run remain separate evidence.
