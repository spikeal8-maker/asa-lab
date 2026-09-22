# Portable release activation: existing test baseline repair

The owner explicitly requested enabling the portable mechanism and testing an
update. The first general CI run that passed the Electronics code gate exposed
an independent historical migration-test failure (AGENTS category C). This is a
separate selected repair under the activation request, not an expansion of the
Electronics production repair or a new product milestone.

## Bounded scope

- `tests/migration/blocks-forward-upgrade.spec.ts`
- `tests/migration/blocks-forward-upgrade.pg.spec.ts`
- `apps/web/src/electronics/testing/arduino-servo-blocks.spec.ts`

No production code, SQL migrations, migration-engine changes or live database
operations belong to this repair. Existing version 0150 is the historical fixture;
the forward tail must include every current migration after 0150. A synthetic
future version must remain above the current plan instead of colliding with 0155.
The expected list is selected from the input plan, never from the validator's
actual output. Preserve exact pending-list equality, counts, original ledger and
row equality, read-only preflight, checksum, out-of-order, idempotence and RLS tests.

The Servo vertical integration test keeps the same 5,000 microseconds of simulated time,
10,000-iteration bound, serialized state and all result assertions. It receives a
local 30-second wall-clock timeout like other integration tests: the complete CI
run took 6.5 seconds and exceeded the generic 5-second unit-test default. This test
is a correctness check, not the Electronics performance benchmark.

## Verification

Independent review, focused in-memory migration and Servo tests, formatting/lint,
and the normal exact-SHA general CI including real PostgreSQL remain required.
Portable publication still requires green general CI and its own exact-image
backup/restore smoke test. The prior failed run is
[35660288631](https://github.com/spikeal8-maker/asa-lab/actions/runs/35660288631):
2,622 tests passed; eight historical migration expectations and one Servo timeout
failed. No assertion is skipped and no gate is bypassed.

## Exact publication metadata repair

The first real publication succeeded in
[run 35662408770](https://github.com/spikeal8-maker/asa-lab/actions/runs/35662408770).
The client's first read-only `check` rejected it because the observed GitHub run
response uses `Release <revision>` in both `name` and `display_title`, while the
client expected the workflow's static name in `name`. This is a defect of the
portable implementation (category A), discovered before changing live services.

The bounded repair affects `tools/deployment/releases.py` and its contract test.
Accept the two exact name forms while retaining the exact workflow path, release
title, main branch, completed/success publication and exact-SHA green general CI.
Tests use the observed name form and reject an unrelated name/path, an unfinished
or failed run, the wrong branch/title, and a newer failed general run. No override
of publication verification or live data operation is introduced.
