# HTTP runtime warnings

## Scope and acceptance boundary

The API emits process-local `runtime_http_alert` records for a sustained request
burst, an elevated share of completed 5xx responses, and repeated 429 responses.
These are initial operator thresholds, not measured capacity, a service-level
objective, a diagnosis of a particular route, or a promise of alert delivery.

The records use the existing `emitApplicationLog` writer and retained-log reader.
They are available through the existing authorized log interface and its normal
refresh/search flow. This change does not add push notifications, a metrics
endpoint, an automatic restart, scaling, pool changes, or a remote action.
Production `/health/metrics` remains subject to its existing access policy.

Source tests and a synthetic retained-log readback establish local behavior only.
Deployment, exact-revision CI, native runtime checks, real traffic observation,
capacity qualification, and production monitoring acceptance are separate gates.
Do not mark those gates passed from this document or from unit tests.

## What is counted

The existing request-start hook increments arrivals. The existing once-only
terminal observer records completed responses by their actual status. Only
integer HTTP statuses 100–599 enter the response denominator; 500–599 increment
`serverErrors`, and exactly 429 increments `rateLimited`. A terminal observation
without a valid response status increments `aborted` separately. Pending requests
can therefore trigger a burst even before they complete, while cancellations do
not dilute the error percentage or become invented successful responses.

All routes handled by these hooks contribute, including health checks and
unsuccessful requests. Counts describe one API process, without route or actor
dimensions. Arrivals and completions are counted at their own observation times;
they need not be equal in a given minute. Existing public runtime snapshot
counters and the last-1024 duration percentiles retain their previous meaning.

## Windows and initial thresholds

One unreferenced timer evaluates every 10 seconds. Each evaluation reads the last
six **completed** 10-second buckets (60 seconds), excluding the current partial
bucket. The burst baseline is the preceding 30 completed buckets (300 seconds),
disjoint from the current minute. The ring contains exactly 37 buckets including
the current partial bucket; it never retains request objects or an event history.

An opening condition must hold at two consecutive evaluations. An active warning
resolves only after three consecutive sufficiently observed evaluations below
its recovery thresholds. These are overlapping rolling windows, not independent
samples or a requirement for newly arrived work at every evaluation.

| Code                 | Observation required                                                                                | Open condition                                                                                       | Recovery condition                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `http_request_burst` | Complete 60-second current window and 300-second preceding baseline; at least 100 baseline arrivals | At least 300 current arrivals, and current requests/second at least 3 times baseline requests/second | At least 20 current arrivals, with valid baseline; current rate below 2 times baseline **or** current arrivals below 150 |
| `http_5xx_rate`      | Complete current window and at least 20 completed responses                                         | At least 5 completed 5xx responses **and** 5xx share at least 5%                                     | Fewer than 3 completed 5xx responses **and** 5xx share below 2.5%                                                        |
| `http_429_rate`      | Complete current window and at least 20 completed responses                                         | At least 10 completed 429 responses **and** 429 share at least 5%                                    | Fewer than 5 completed 429 responses **and** 429 share below 2.5%                                                        |

Mass-error observation first becomes eligible after 60 seconds of continuous
coverage; burst observation after 360 seconds. Opening needs a second qualifying
evaluation. Threshold comparisons use integer counts before rounded display
gauges. A zero or undersampled baseline cannot authorize a burst decision.
Unspecified values between the opening and recovery thresholds preserve the
active state and reset the recovery streak.

Each code has its own incident state and reminder clock. While it remains active
and has sufficient observation, a `reminder` can be emitted at most once per 300
seconds. An active warning awaiting its third recovery evaluation may still
produce a due reminder. `opened` and `resolved` transitions are not suppressed
by this reminder interval; a subsequent incident can open within 300 seconds.
At most three fixed-code records can be emitted by one evaluation.

## Missing observation, restart and cleanup

Elapsed windows and reminder intervals use the monotonic process clock; UTC is
added only when writing the event. A wall-clock correction does not advance the
incident state. A non-finite or backward monotonic sample, or at least 20 seconds
without a request/timer observation, invalidates the ring and debounce streaks.
The next finite observation starts fresh coverage. Missed evaluations are not
replayed, and a skipped evaluation breaks a consecutive streak.
A backward or non-finite clock also starts a new 300-second reminder interval;
this cannot suppress a valid opening or recovery transition.

An already open incident stays open across missing observation. It cannot resolve
until fresh complete windows and the relevant sample floor are available. Idle
traffic, fewer than 20 responses, fewer than 20 arrivals for burst recovery, or
an invalid burst baseline does not mean healthy; no recovery or reminder is
emitted from such a sample. The warning stream is event-based and is not a
heartbeat or a complete coverage report. Silence does not prove recovery.

State lives only in the process. Restart clears state and starts a new warm-up;
it does not emit a synthetic resolution for the previous process. The timer is
`unref()`'d and cleared by the existing `metrics.stop()` lifecycle, including API
construction failure and normal close. Calls after stop cannot emit warnings.

## Record contract and bounded work

The only new event kind is `runtime_http_alert`. The field set is closed:

| Field                            | Content                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`, `revision`               | UTC timestamp; runtime revision limited to 7–40 hexadecimal characters or `development`, otherwise `unknown`                                                                          |
| `kind`, `code`, `phase`, `level` | Fixed kind, one of the three codes, `opened` / `reminder` / `resolved`, and `warn` / `info`                                                                                           |
| `counters`                       | Numeric `arrivals`, `responses`, `aborted`, `serverErrors`, `rateLimited`, `baselineArrivals`                                                                                         |
| `gauges`                         | Numeric `requestsPerSecond`; `baselineRequestsPerSecond` only with complete baseline coverage; `serverErrorPercent` and `rateLimitedPercent` only with a nonzero response denominator |
| `coverage`                       | Fixed `bucketSeconds: 10`, `windowSeconds: 60`, `baselineSeconds: 300`, and boolean `windowComplete`, `baselineComplete`                                                              |

Coverage booleans describe time coverage, not sufficient sample counts. For
example, an early 5xx warning can have `baselineComplete: false`; its current
error window is valid and it makes no burst claim. During warm-up an incomplete
baseline count is not a comparable five-minute rate, so its rate gauge is absent.

No URL, route, request identifier, account/seat/project identifier, header, body,
address, credential, or free-form error is copied into the warning. The fixed
cardinality records, including bounded revision metadata, fit below 2 KiB. The
unchanged application writer already accepts these fields, and the unchanged
reader displays their structured message; no collector whitelist or log format
migration is required.

Request hooks increment fixed counters; the timer scans at most 37 slots and
three states. Allocation/storage does not grow with request count. The existing
1024 duration samples remain separate and unchanged. A callback/writer exception
is swallowed at this diagnostic boundary, without recursive error logging, HTTP
response changes, or interference with cleanup. Delivery can still be lost to
the existing writer's queue, disk, retention or shutdown limits.

## Operator use

1. In the existing authorized logs view, select the API source and search for
   `runtime_http_alert` or a specific fixed code. Include informational events
   when looking for `resolved`; warning-only filters intentionally omit them.
2. Match UTC time, process revision, code and phase. Read current counts and
   coverage before interpreting a percentage. A burst is an arrival-rate signal;
   it does not identify the bottleneck or prove overload.
3. Correlate with existing resource, pool, event-loop and server diagnostics.
   Confirm retained-source coverage separately. A missing resolution after idle,
   a sampling gap, shutdown, or restart is not proof that the condition persists
   or has recovered.
4. Validate these initial thresholds against an approved representative workload
   before changing them. Adjusting thresholds or claiming supported capacity
   requires a separate reviewed change and its evidence.

## Local regression evidence

`packages/observability/src/runtime-metrics.spec.ts` checks warm-up, absolute and
relative thresholds, distinct response/abort accounting, debounce, recovery,
reminders, ring wrap against an event-time oracle, missing clock samples, timer
cleanup, bounded record shape, and existing snapshot semantics.

`apps/api/src/app.factory.spec.ts` exercises the real request/terminal hooks with
local injected HTTP responses, an actual emitted warning through the unchanged
application writer and retained reader in a temporary store, logger exceptions,
and cleanup after rejected Nest construction. Existing terminal-race tests in
`http-observation.spec.ts` remain part of the focused gate. These fixtures use no
database, running deployment, traffic generator, or remote host.
