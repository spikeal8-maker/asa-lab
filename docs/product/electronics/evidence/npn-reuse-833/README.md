# NPN algebra reuse candidate — NOT READY

This is preserved experimental source, not an accepted speed fix. Do not
integrate solely because one pinned response is byte-identical.

The two-file draft adds an original-module NPN model/profile definition guard,
conservative canonical NPN metadata admission, previous BJT region cache keys,
and retention/restoration of finished region plus Early conductance. NPN circuits
cannot create the old electrical template; observations and thermal/quality paths
remain ordinary. No physical equations, values or scheduler timing were changed.

## Result

Both instrumented variants execute the same four-display scalar-helper counter,
25000 us horizon, 256-event quantum, and real raw-display optical collector.
Complete response/state/events/diagnostics/optical payload is byte-identical:
84612 bytes, SHA256 `4eb3758a71405065b0bdf6eea0f1d2c32c3a9f22e3f0cf87d11eaf31f0aee2cd`.
The candidate obtains 218 algebra hits from 1383 lookups (15.8%).

One same-process ABBA comparison followed one warm-up of each bundled variant:

| Variant | Sample wall times | Mean |
| --- | --- | --- |
| A: baseline | 1413.2071, 1128.2491 ms | 1270.7281 ms |
| B: draft | 1408.3393, 1326.3201 ms | 1367.3297 ms |

The draft is approximately **7.6% slower** in this bounded comparison. There is
no demonstrated improvement, so further full gates/builds/native matrices are
not justified for this source. These local timings are not Worker or realtime
acceptance and are not a statistically broad performance claim.

One cheap private-instrumentation pass found 1383 guard/lookup calls, 33 distinct
keys and 33 absent-slot misses; the 32-slot limit therefore did not cause extra
eviction misses in this trace. Only 218 found slots contained retained points.
The exact reason the other found slots remain empty is not yet classified.
NPN model/profile guards cost 22.27 ms and slot search 3.13 ms in a 1298.64 ms
cold instrumented pass; this does not establish the cost of all validation or
identify a complete bottleneck. Do not enlarge the cache or weaken guards based
on key cardinality alone. Full reconstruction and low retained-point coverage
remain hypotheses for the limited benefit.

## Verification boundary

The esbuild probe compiles and the pinned complete oracle matches. Formatting
and diff checks are run for preservation. Focused transition/mutation/failure
tests, full type/lint checks, canonical electronics gate, bundle budgets and
independent execution review are **NOT_RUN** for this draft. The independent
reviewer inspected the limited diff only and has not approved product readiness.
In particular, before-import model/profile protection is captured in the defining
module, while solver metadata capture still needs adversarial qualification.
There is no all-input or historical regression claim from one oracle.

The baseline checkpoint is `58e17d65`; original BEFORE files remain unchanged.
`abba.mjs.txt` and `profile.mjs.txt` are private instrumentation scripts using
the before/after bundles produced by the preserved probe. No production counters
or protocol fields were added. Server, Docker, database and foreign changes were
not touched. The candidate is preserved for later bounded investigation; STOP.
