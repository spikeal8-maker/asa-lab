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
Measurement starts at the simultaneous-login barrier after page preparation.
Requests started before that barrier remain observer traffic even if they
finish later, so request counts, concurrency and elapsed time share one boundary.

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
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\tools\capacity\request-storm-windows.ps1 -ExpectedRevision $stormRevision -ExpectedComputerName $env:COMPUTERNAME
```

`RemoteSigned` applies only to that new PowerShell process and the reviewed
Git checkout. It does not change persistent execution policies or profiles;
machine/user Group Policy continues to take precedence.

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
pending chunk delivery uses the existing loading fallback. A failed chunk
offers a usable home exit and reload action.
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

## P0-E: sequential full-editor capacity qualification

`Classroom Full Editor Scale` is a separate test-only PR workflow. Its paths
trigger `pull_request`, so the first version does not depend on a dispatch-only
workflow already existing on main. It has one GitHub-hosted Ubuntu 24 job, one
owned Compose stack and one Playwright worker. No production URL, existing
database, remote Docker socket or self-hosted machine is accepted. The source
guard requires the official repository, clean exact selected SHA and a unique
run token. Generated test credentials and secrets are not report data.

The unchanged server's guarded internal origin requires `NODE_ENV=test` and
the database name `/asalab_test`. That database exists only in a new,
run-labelled PostgreSQL volume in this workflow's own Compose project; the
controller refuses existing project resources. The runtime role remains
`asalab_app`, with the actual RLS, session authentication, rate limits and
admission rules. All browser clients enter through the same Web proxy peer/NAT;
there is no trusted-source-wide or address-budget bypass. Teacher registration
uses a genuinely completed native bot challenge and ordinary credentials.
Nevertheless, test mode does not enforce the production-only botProof or
Secure-cookie settings. This explicit profile measures isolated Docker
ingress capacity; it is not production authentication equivalence or an
unqualified production capacity ceiling.

The committed `SCALE_PROFILE` and its SHA256 fix the workload, SLO and resource
floors before the first run. The controller first executes a two-StudentSeat
calibration using the same native UI actions and both two-player game controls.
Its result is `VALID_FIXTURE`, `INVALID_FIXTURE` or `BLOCKED_BY_RUNNER`; it is
never evidence of a passing capacity level. Locator, setup or content-proof
failure at calibration cannot establish that the server supports fewer than 30
learners. Only a valid calibration permits this ladder:

| Level | Classes and Seat distribution | Condition before it can start |
| --- | --- | --- |
| 30 | 1 class: 30 | Two-person full-editor calibration is valid. |
| 60 | 2 classes: 30 + 30 | 30 has a complete, sealed PASS receipt. |
| 100 | 4 classes: 30 + 30 + 30 + 10 | 30 and 60 both have complete PASS receipts. |
| 150 | 5 classes of 30 | 30, 60 and 100 all pass. |
| 200 | 7 classes: six of 30, one of 20 | Every preceding level passes. |

The two-person calibration uses one actual classroom. Each measured Seat has
its own class-specific join code and class ID in the identity proof. Game
policy is enabled through the actual API for every classroom; the two game
control players both belong to the first classroom. The receipt validates
distinct classroom hashes and every client-to-cohort assignment, as well as
the fixed class count and Seat distribution. No hidden peers are added.
The workflow starts with a fresh owned database. Earlier-level synthetic rows
remain for the later levels, while their browser contexts are closed; this
retained-state choice is part of the profile, not an unreported cleanup step.

Receipts must have the same source SHA, run ID/attempt/token, profile hash,
environment hash and runtime image manifest hash. The first FAIL, INVALID or
BLOCKED result stops the ladder; higher levels remain `NOT_RUN`. A report
states the largest confirmed tested level for this profile. It does not infer
absolute product capacity or extrapolate a Windows or public-FRP result.

### Actual UI, persistence and operation denominators

Every level provisions synthetic teacher/class/StudentSeats through actual
application interfaces and gives every learner an independent cookie-backed
browser context. A separate ordinary-account login is a control, outside the
StudentSeat denominator. Teacher setup can retry a real 429 only with the same
idempotency key and valid Retry-After, before the measurement barrier. Such
responses remain recorded as setup observations. The fixed total wait budget
is 120 seconds, at most three retries per setup operation, within the 12-minute
level limit. No measured login or save receives a harness retry.

All N learners use Electronics concurrently, then all N use Scratch
concurrently. This is the real built Web application and embedded Scratch GUI
served by the API/Web/Scratch production images, backed by migrated PostgreSQL
and MinIO. The harness does not submit a substitute editor document, replace
save code, advance a virtual clock or manufacture a telemetry success.
Electronics starts with a blank project, places one `resistor-axial` and sets
its resistance to `1000 + 10 * client + step` ohms for steps 1, 2 and 3. It does
not add wires or run a simulation. Scratch adds an Apple sprite from the native
library to the default project, renames it to `Scale-{client}-{step}`, changes
its position to `x=(client%80)+step, y=0`, persists its costume through object
storage and waits for the native minute autosave. No script blocks are added.
These concrete small documents qualify this full-editor workload; they do not
represent every circuit complexity or Scratch program. The separate lightweight
fixture described above remains a transport diagnostic, not full-editor load.

Each learner has 14 planned ledger entries: login, portal, and six operations per
editor (open, save, reload, save during telemetry503, offline edit, recovery).
Every entry exists before execution. STARTED, ACKNOWLEDGED, VERIFIED, FAILED and
TIMED_OUT states are appended as complete snapshots to `operations.jsonl`.
Failures and never-started users remain in the success denominator; HTTP200 or
a saved indicator alone cannot become VERIFIED. Saves/reloads must read the
document independently through the authenticated API, match the expected UI
content and identity, and prove the appropriate revision change. The report
retains content hashes and revisions instead of pupil content or credentials.
Both games require a real invitation and accepted match. A final readback or
observer failure still fails the workload even if all earlier ledger entries
were complete.

Telemetry503 is injected only on actual diagnostics/analytics requests. Before
the outage edit, a native reload of the already saved editor must produce a
real refused telemetry request for every learner. That preparation is outside
the save timer. The normal reload proof remains a healthy operation. Each
editor also includes 10 seconds offline and recovery. Expected offline errors
and narrowly identified GET/HEAD navigation aborts remain explicit; a healthy
timeout, aborted write or other network failure is not exempted.

### Fixed SLO and runtime budget

Every capacity level requires 100% authenticated learners and 100% verified save
operations, no unexpected 5xx or 429 in measured traffic, and portal p95 no more
than 2000 ms. Portal latency means the native Projects navigation until the
usable list is visible, after login. Per-operation ratios and p50/p95/p99 are
reported independently. HTTP summaries separately identify healthy successful
product requests, the whole non-injected population, injected telemetry
responses, incomplete requests and phase counts. No overall latency can erase
an individual operation failure.
The healthy product HTTP filter is completed 2xx/3xx under `/api/`, excluding
analytics/diagnostics and phases containing `offline`, `recovery` or
`telemetry-outage`. Whole non-injected latency and total browser RPS also
retain static resources; API/static/inbox/diagnostic counts are separate.

The hosted job has a 120-minute ceiling. The sequential Docker build has a
30-minute budget and one BuildKit worker limited to 8 GiB and 3 CPUs. Build and
browser workloads do not overlap. Each calibration/capacity attempt has a
12-minute deadline, and the narrow latency experiment below has a 10-minute
budget. The workflow's run step also has its own 105-minute outer deadline;
therefore a slow build or setup can leave higher levels untested. Missing or
partial evidence is not accepted as capacity success.

Runtime container limits are PostgreSQL 1 GiB, API 1 GiB, Web 256 MiB,
Scratch 512 MiB, MinIO 512 MiB, and the browser generator 8 GiB with 1 GiB shared
memory. The controller stops when host MemAvailable falls below the larger of
2 GiB or 15% of total memory, free disk falls below 10 GiB, a container reaches 85%
of its memory limit, or an owned container OOM/restart occurs. These resource
limits cannot be overridden after seeing a result. Measured exhaustion is
`BLOCKED_BY_RUNNER`, not a claim that the server's capacity is below that level.
An actual content/identity integrity failure is not hidden by a coincident
resource limit.

The API keeps its ordinary 10-connection pool, 5-second connection timeout and
15-second statement/query timeouts, separate single-connection analytics and
acquisition pools, and 8 libuv threads. `runtime-profile.json` captures the
resolved API settings and actual PostgreSQL version, `max_connections`,
`shared_buffers`, `work_mem`, and runtime role attributes before calibration.
The role must not be superuser or bypass RLS. No pool/admission setting is
raised to make a particular level pass.

Resource artifacts retain host interval CPU/MemAvailable/disk, container
CPU/memory/PIDs/OOM/restarts, Chromium process/RSS samples and available
PostgreSQL pool/activity observations. Missing, dropped, zero-Chromium or
non-monotonic resource observations invalidate acceptance. Chromium summed RSS
can count shared memory more than once; the stop rule uses host available and
container-accounted memory. The generator and server share one hosted runner,
so measured capacity is constrained by this combined topology. No load reaches
the production server, Windows desktop or public tunnel.
The browser HTTP observer is bounded at 200000 records and control/verification
observations at 50000 per level. Exceeding a bound retains the loss/failure
evidence and prevents PASS; observations are not silently discarded.

The controller verifies API/Web/Scratch image IDs and exact revision labels.
It hashes JavaScript from the built Web/Scratch images; the browser must prove
the actual loaded entry/runtime bytes against that manifest. Revision labels
alone cannot validate served source. Reports preserve partial operations,
resource-stop reasons and cleanup status even after failure. Cleanup is
restricted to the run-labelled Compose project and its own BuildKit builder;
it never prunes Docker or deletes another database/volume.

### Narrow login/save latency diagnosis

The previous lightweight comparison observed higher candidate login/save p95
in some samples. A later exact-source 30-user login sample changed direction;
the 60-user increase persisted. Fixed baseline-first order, burst timing and
browser/post-response work are therefore competing explanations. Login POST
and draft PUT do not use the selected portal GET queue. No source evidence yet
proves that telemetry refusal causes those latency differences.

After full-editor 30 passes, the controller pauses only its idle API/Web/Scratch
services and runs one short 30-client **A-B / B-A** experiment. A is the pinned
6a baseline, B is the exact candidate. Both use the same current measurement
harness, the selected revision's actual client modules/API build, and fresh
owned test databases. The controller verifies source-module provenance for
each sample and then restores the unchanged full-editor images before 60.
It does not replay the old long reload/offline/slow-notification matrix.

The diagnostic measures login, a healthy save/readback and an equally sized
changed document during observed real telemetry503. Bounded observation records
the operation start, native fetch dispatch, response headers, JSON start/end,
API result and readback completion, plus proxy receive/dispatch/headers/finish.
Only synthetic client/operation/request integers join those records; no
credentials, cookies or document contents are captured. Timing fields are
enabled only for this explicit diagnostic scenario. Browser-local and
proxy-local durations are computed separately; clock-origin differences are
never labelled network latency. Missing JSON/readback boundaries, dropped
observations or ambiguous joins invalidate the diagnostic.

The four raw samples and segment p50/p95/p99 allow a reviewer to distinguish
before-send work, upstream response time, body/JSON work, work after the API
result and burst arrival spread. One AB/BA experiment is a causal aid, not a
statistical regression verdict. It does not authorize a product change or
prove an absolute capacity. Any subsequent fix needs a specific reproduced
cause and its own bounded regression.

Focused author checks, without starting Docker or browser load locally:

```bash
node tools/capacity/classroom-scale.mjs check
```

The runtime entry point is restricted to the isolated official CI fixture:

```bash
node tools/capacity/classroom-scale.mjs run
```

The artifact is `classroom-full-editor-scale-<exact SHA>-<attempt>` and contains
`plan.json`, `image-manifest.json`, calibration and level receipts/raw ledgers,
resource observations, the latency samples, final ladder summary, and any
failure/cleanup report. Published results must link the exact workflow run and
artifact; author unit/type/lint checks alone do not establish capacity 30 or 60.
