# Diode active-set phase 1 — WIP, NOT READY

Historical preservation of the first bounded attempt for issue 819. Baseline
`c0b673b7e39c5fab3beaede55bfba6ad4565b87f`; branch
`codex/diode-active-set-819`. This is not accepted product code and must not be
integrated as a completed repair. Live selection remains in `current.yaml`.

## Changes preserved

- `solver.ts`: activate a diode companion at its actual knee, removing the
  previous 20 mV below-knee activation that stamped negative forward current.
- `arduino-seven-segment-matrix.spec.ts`: require ready/quality for NPN circuits
  with 1, 2, 3 and 4 displays. These four assertions remain **FAIL**, correctly
  exposing the separate issue below. No assertions were weakened to obtain PASS.

No NPN model, convergence limit, numerical tolerance, thermal rule, runtime,
optical presentation or protected asset was changed.

## Results and stop boundary

The six existing BEFORE diagnostic tests reproduced the original failure.
For the preserved held one-display state, the first correction changes KCL
residual from about 3.060306 mA to `2.5e-11 A`. Inactive display branch currents
become zero, collector current is `0.00261378999 A` and VCE is
`0.201306894995 V`.

All **18 raw seven-segment/golden tests PASS**, including complete pre-repair
engine-result and saved-state byte equivalence. Goldens were not regenerated.
The combined focused run is **22 PASS / 4 FAIL**, because the four NPN clock
cases still fail. No canonical full gate, build, bundle check, native acceptance,
independent final source review, release or installed acceptance is claimed.

## Second causal failure: NPN base cutoff

The corrected clock reaches **2.022 ms** for one display and **2.028 ms** for
four displays. After D10 switches LOW, the RC solver returns `solved: true`,
two iterations, but KCL residual is **0.00068627451 A**. This is a stamp/report
consistency problem, not a convergence timeout:

- VBE is `0.693137254895 V` and the region stays `saturation` because the NPN
  cutoff classifier permits VBE down to `0.7 - 0.02 V`.
- The base companion stamps a negative current of `-0.00068627451 A`.
- The base resistor reports that signed current, while NPN observation clamps
  base current to zero. The mismatch is the KCL residual.

Per the selected task boundary, execution stopped before changing the NPN model.
The controller must select any coupled NPN base-region repair separately.

## Archive

`manifest.json` records exact uncompressed and deterministic gzip SHA-256 values
and sizes. Every compressed artifact uses gzip `mtime=0`.

- `npn-{1,4}-before.json.gz`: original committed 817 causal receipts, decoded
  and recompressed losslessly.
- `npn-{1,4}-after-held.json.gz`: first-attempt circuit, source, held state,
  held result/quality and still-failing clock result.
- `rc-fault-{1,4}.json.gz`: exact first four arguments to the original RC solver,
  its original result and independently computed public quality result. Maps
  are encoded as entry arrays. The spy called and returned the unmodified
  original function; it did not supply simulated results.
- `before.log.gz`, `first.log.gz`, `probe.log.gz`: bounded execution logs.
- `diode-active-set-819-probe.spec.ts.txt`: the author's temporary diagnostic
  probe moved here without byte changes. The `.txt` suffix prevents test
  discovery; no probe source was deleted.

The function, optical-multiplex and performance failures from 817 remain separate.
Server, Docker, live data and foreign changes were untouched.
