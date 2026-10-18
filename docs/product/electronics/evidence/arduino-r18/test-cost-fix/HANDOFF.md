# R18: thermal boundary test-fixture cost correction

Frozen one-file delta to `10298adebf11d61636465bfe4b8691b36fc23913`. Root may publish this reviewed test change; no product source, E2E, gate, timeout, assertion, GitHub ref, HEAD or index changed here.

## Exact file

- Path: `apps/web/src/electronics/testing/led-temporal-presentation.spec.ts`
- Git blob: `8bea33ab8de18627622f99d3d877a52886d5338b`
- SHA-256: `8e21e809b165b6a8dec41288b89cb66e9f5a8f54182935569173b4e548a6e6de`
- Patch: `/workspace/scratch/927b9b969e63/r18-evidence/test-cost-fix/candidate.patch`
- Manifest: `/workspace/scratch/927b9b969e63/r18-evidence/test-cost-fix/manifest.json`

## Cause and minimal correction

Directed CI 39106177040 failed only this case at 5561 ms against the unchanged default 5000 ms. The previous fixture switched its protected LED every millisecond for the entire four-second thermal warmup. The changed synthetic sketch performs a real `delay(3990)` in setup before entering that same real 1 ms HIGH/LOW loop. The unprotected LED remains connected directly to the actual 5 V source from simulated time zero. The real engine still advances the entire thermal interval and continues its actual returned state through 3,999,999, 4,000,000 and 4,000,001 microseconds. No clock, GPIO, electrical result or thermal state is fabricated. This added setup wait belongs solely to the synthetic regression fixture.

An exact byte comparison proves the complete file is the prior file plus only that source-string edit and its three explanatory comment lines. All original assertions, topology, state continuation, boundary horizons, other 27 cases and default 5000 ms timeout are preserved.

## Bounded validation

The identical one-case Vitest command was run once before and once after this correction. Both passed all existing assertions: baseline 1767 ms; candidate 544 ms (69.21% less local case time, approximately 3.25x). Both reported 1 passed / 27 skipped. These paired local timings diagnose redundant fixture work; they do not assert a future CI timing. No broad suite was rerun. Raw logs are `baseline.log` and `candidate-case.log` in this directory.

## Actual physical and optical observations

The accompanying `actual-boundary-proof.json` records the current fixture through the existing compiled real engine and the actual temporal projector source, including every retained optical sample, quality result, complete overdriven component result and request continuation. The first request completed after 16 bounded batches; each later 1 microsecond continuation completed in one batch. All three electrical quality results passed.

| Actual horizon, µs | Overdriven current, A | Brightness | Health / damage / presentation | Protected projected brightness |
| --- | --- | --- | --- | --- |
| 3,999,999 | 0.397368421053 | 100 | overheated / none / destructive | 34.99253865336658 |
| 4,000,000 | 0 | 0 | failed_open / failed / failed | 34.99253865336658 |
| 4,000,001 | 0 | 0 | failed_open / failed / failed | 34.99253865336658 |

Before the first boundary, the protected LED produced 10 actual alternating edges at 3,990,003; 3,991,005; 3,992,008; 3,993,010; 3,994,013; 3,995,015; 3,996,018; 3,997,020; 3,998,023; and 3,999,025 microseconds. The retained trace contains four complete measured cycles. Actual peak brightness is 70.02; the projected cycle mean is 34.99253865336658 (mean/peak 0.4997506234413965). That actual mean persists through the neighbour's physical failure at the next two horizons. The fixture retains real `digitalWrite` instruction costs: HIGH intervals are 1002 µs and LOW intervals are 1003 µs.

## Next action

Independent reviewer receives the frozen file hash, this patch, paired logs and actual trace. Root publishes the one-file delta and runs its already-planned exact directed CI gate. No further local suite or product edit is needed for this bounded correction.
