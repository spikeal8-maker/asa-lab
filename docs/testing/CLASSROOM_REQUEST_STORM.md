# Classroom request storm: bounded repair and reproducible evidence

## Scope and baseline

The owner requested this P0 repair after the 5 November 2026 classroom incident. The
source baseline is `6a876a942985780297cf346a9a85077be7479d0b`. The incident counts
in the task describe the production observation; they are not a load-test
baseline and do not establish that FRP or analytics was the first failing layer.
The repair branch is `fix/p0-classroom-request-storm`.

The baseline's existing relevant six suites passed 128 tests before any edits.
The baseline API and its 17 dependency tasks were also built with the Nx cache
disabled. Neither observation proves 60-user capacity.

## Confirmed source defects

| Source | Defect | Repair boundary |
| --- | --- | --- |
| `apps/web/src/games/game-notifications.ts` | Resolved network/429/503 errors did not reach the poller's error handler; both inboxes were joined before delivery; activity changes did not immediately cancel transport. | Independent, single-flight channels, activity lifetime, bounded jittered backoff. |
| `apps/web/src/api-call.ts`, `session-fetch.ts`, `App.tsx` | Identical portal GETs had no shared in-flight operation; refresh failure could be retriggered by the next 401; counts depended on object identity. | Identity-fenced in-flight coalescing, bounded prioritized transport, refresh generation/cooldown and stable effect dependencies. |
| `apps/web/src/analytics-delivery.ts` | Repeated `pause(false)`/retry triggers could discard an existing failure delay. | Preserve a pending cooldown across repeated context/online events. |
| `apps/web/src/client-diagnostics.ts` | A different attempt UUID prevented semantic deduplication of the same network failure. | Bounded repetition aggregates and reserved admission for critical diagnostics. |
| `apps/web/src/telemetry-quality.ts` | Unchanged gauges dirtied the snapshot, and external flush triggers could bypass retry timing. | Change-aware gauges and bounded report/retry cadence. |

`startLivePoll` already waited for completion. The repair does not claim that
ordinary interval callbacks were accumulating. Healthy foreground notification
cadence remains 5 seconds. Hidden/offline tabs stop their requests. A visible but
unfocused window uses 30 seconds; the server invitation lifetime is 30 minutes and
presence expires after 45 seconds. Returning to a focused window catches up while
respecting a pending server/backoff delay. Inbox data is not broadcast between
tabs; this is a conservative independent-tab strategy, not cross-tab result
caching or a claim of one HTTP request across all windows.

The backend already isolates analytics in a separate pool and bounded queue.
`telemetry_unavailable` can mean an unavailable pool, queue shutdown/deadline,
or a failed analytics write/receipt. Source inspection cannot select which of
these happened in the incident. No analytics refusal is converted into a false
successful delivery or a fabricated learning result.

## Evidence commands

Install the exact committed dependencies and build the API before the focused
gate:

```bash
corepack pnpm install --frozen-lockfile
NX_SKIP_NX_CACHE=true corepack pnpm exec nx build api --skip-nx-cache
node tools/capacity/request-storm.mjs unit
NX_SKIP_NX_CACHE=true corepack pnpm exec nx run web:typecheck --skip-nx-cache
```

The `Classroom Request Storm` workflow runs the same focused command. Its two
workload jobs select 30 and 60 synthetic learners. Each job checks out the pinned
baseline and exact PR HEAD, installs both frozen lockfiles, builds both APIs,
and creates separate fresh PostgreSQL test databases. Both variants run on the
same job host using the same client harness and workload. The browser bundle
imports the selected revision's real API client, diagnostics, analytics and
notification hook; the algorithm is not copied into the workload.

The fixture accepts only loopback API origins and the explicitly named
`asa_request_storm_baseline_test` / `asa_request_storm_candidate_test` databases.
It has no option for a production site URL. It verifies the exact source commit
and rejects modified tracked source before measuring. Credentials are generated
only for synthetic teachers and StudentSeats. Reports contain anonymous client
integers, route families, counters and timings; cookies, passwords and pupil
identifiers are not exported.

The measure entry point is:

```bash
node tools/capacity/request-storm.mjs measure
```

Its explicit environment and fresh-database setup are fully specified in
`.github/workflows/classroom-request-storm.yml`. This command deliberately fails
without that fixture configuration. The public production instance, installed
student databases and public FRP are never targets of this workload.

## Executed workload and report interpretation

The workload measures simultaneous StudentSeat login; repeated identical portal
bootstrap reads; electronics document create/save/readback; healthy chess and
checkers polling; semantic route changes; a network-error diagnostic burst;
simultaneous page reload; 10 seconds offline and recovery; one slow notification
channel; temporary 503s; saving while telemetry refuses requests; multiple tabs;
real directed invitations, match acceptance/resignation in both games; and
final document readback. It also checks a foreign student's project-read denial.

Each learner has a separate Chromium context and actual cookie-backed API
session. Focus emulation represents separate foreground classroom computers.
Three additional tabs share only their own learner's context. The lightweight
React fixture exercises the actual transport and notification hooks; it is not
the full editor UI. Existing real UI journeys remain separate evidence.

Artifacts include per-variant JSON, comparison JSON and the job's PostgreSQL
Docker resource samples. Reports separate deliberate injected errors from
unexpected 5xx/429, and include p50/p95/p99, request rates and per-client counts,
per-phase counts/durations, observed parallel requests, JavaScript errors,
identity and save checks, API/analytics pool pressure, PostgreSQL lock waiters,
Node CPU/RSS and event-loop latency. Node CPU includes the test controller and
API; it must not be described as total host or Chromium CPU. Additional samples
record host interval CPU utilization/free memory and Chromium process RSS/CPU.
The Chromium RSS sum can count shared pages more than once, and its `ps` CPU is
a lifetime average. Aggregate latency includes the deliberately slow phase;
healthy-only latency must be derived from the corresponding phase records.
Aggregate request
rates cover the full measured journey; compare phase durations as well as
counts when interpreting them.

The before/after comparison refuses incomplete workload reports. Successful
unit tests, a source build or an uploaded report alone are not 60-user runtime
acceptance. Actual workflow links, exact final SHA and Windows Docker Desktop
evidence must be included in the PR report after they run.

## Production images and browser journeys

The separate `runtime-browser` job builds the committed production API and Web
Dockerfiles, checks both revision labels, migrates a fresh disposable database,
and runs the same browser entry point used by the Windows proof:

```bash
node tools/capacity/request-storm.mjs browser
```

This entry point is restricted to the Compose test runner. It executes the
complete existing chess-network and checkers-network suites, followed by the
explicit electronics save/recovery subset in `electronics-simulation.spec.ts`.
The selected electronics titles cover the saving indicator, project refresh,
`ELECTRONICS-E01` recovery/isolation cases, and the automatic save retry. It is
not a claim to run the entire unrelated simulation qualification suite.

On a Windows test machine with Docker Desktop in Linux-container mode, use a
fresh clone and the committed PowerShell orchestrator:

```powershell
git clone --single-branch --branch fix/p0-classroom-request-storm https://github.com/spikeal8-maker/asa-lab.git asa-lab-request-storm-proof
Set-Location asa-lab-request-storm-proof
$stormRevision = (git rev-parse HEAD).Trim()
powershell.exe -NoProfile -File .\tools\capacity\request-storm-windows.ps1 -ExpectedRevision $stormRevision -ExpectedComputerName $env:COMPUTERNAME
```

The orchestrator verifies a clean official checkout and the explicitly named
local test computer. It uses the local `desktop-linux` context, its own random
Compose project, an isolated BuildKit builder, and images with a run-specific
tag and exact source revision labels. Resource settings are generated by the
committed script: a single build worker with a 2560 MiB/2 CPU limit, then
384 MiB PostgreSQL, 512 MiB API, 128 MiB Web and a 1536 MiB browser runner.
Build and runtime phases do not overlap. An occupied port 4612 or insufficient
free memory stops this fixture without changing another workload.

The script records native command exit codes, image IDs, resource limits and
browser output under its run directory. It stops only its own containers and
builder; database volumes and build state are retained. The production computer
named in the incident is explicitly excluded. No production deployment or
public-tunnel configuration is part of this proof.

## Startup budget

The first integrated repair exceeded the unchanged 600000-byte initial JS/CSS
budget: 611591 bytes versus 598366 bytes for the source baseline. Login,
registration and organization-login forms now use the existing lazy page
delivery boundary, so authenticated classroom reloads do not eagerly load
those destinations. Normal page controls and authorization are unchanged;
pending or failed chunk delivery retains a usable home exit and reload action.
The subsequent fresh local build measured 594839 bytes. The same bundle gate
remains mandatory in CI; its limit was not raised.

## Deployment and compatibility boundaries

All production changes are source-controlled. There are no installed-machine
edits, new service endpoints, schema changes or network-specific product
configuration. Identity/authorization remains server-owned. Coalescing is
limited to in-flight identical reads and is invalidated across relevant
identity, workspace, permission and mutation boundaries. Ordinary successful
identity reads are not turned into a persistent cache. Non-idempotent writes
are not automatically replayed.

Diagnostic repetition metadata is an additive server contract. Old clients
remain accepted by the new server. A strict old server rejects a new aggregate
with 400; the client records permanent rejection without retrying forever.
Deploy API support before the new Web client when services are switched
separately. This affects optional diagnostics, never the result of a project
save, authentication or credited learning activity.

Production deployment and FRP configuration are outside this PR. Exact GitHub
CI success, clean-image startup on the supported Docker hosts and the reported
user journeys are separate checks; none implies that the public FRP service
has been load-qualified.
