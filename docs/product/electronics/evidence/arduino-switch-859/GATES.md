# Exact source verification — 859

Final product source: `f74194ea85c6a70214c0cb7848d2e37a5ed1e331`.

`NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` passed after the bounded repair:

- Core: **1383/1383** tests.
- Web: **1106/1106** tests; total **2489**.
- **71 fresh Nx tasks**: one SDK build, 43 typechecks, 27 builds.
- Cache skipped, not cache-hit evidence.
- `pnpm bundle:check`: **all eight limits PASS**. Arduino 1,999,981/2,000,000;
  electronics 170,581/222,000; initial JS/CSS graph 555,421/600,000.
- Runtime source: 149,171/153,189 bytes. No source or bundle limit raised.

The first canonical run at `0b79cc42901fa8cad890509d6f6f12558f1cd7bb` stopped
with five old switch-unsupported fixture assumptions (1373 tests passed).
These contracts were repaired without weakening their assertions: known
unsupported goto replaces switch, with positive actual switch scheduler/solver
witnesses added. Early review additionally found and repaired the newly exposed
`int switch` admission; only the exact lowercase reserved identifier was added
to the existing guard. It did not trigger unrelated keyword or ALU cleanup.

A requested resource precheck of the unchanged 697-asset hash case timed out at
5000ms (file duration 6.32s). **That precheck is FAIL**, not verification of all
hashes or a gate PASS. There was no timeout, concurrency, asset or configuration
change. One planned canonical rerun followed the actual code/test repair;
the final complete Web suite, including that hash test, passed. Both logs are
retained. No unchanged broad retry loop was performed.

The candidate-first Web build (seven fresh Nx tasks) and all limits had passed
before the seven-byte reserved-word repair. The final canonical build and
budget run above verify the repaired source. Independent final-source review is
separate; these logs do not claim repository-wide CI, deployment, installed
Save/reopen, arbitrary C++ support, realtime performance or owner acceptance.
