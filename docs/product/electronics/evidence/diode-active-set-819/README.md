# Coupled diode/NPN forward-current cutoff repair

Reviewed candidate: `9c265e32d1548e98507a75cb83840c52fda938de`.
Independent verdict: **APPROVE**. This is electrical correctness evidence, not
complete Arduino display, optical or realtime acceptance.

Two production files, three admission conditions: a diode cannot remain active
below its piecewise-linear knee; NPN base classification and saturation-latch
eligibility require positive base current. Exact base knee is cutoff, preventing
zero-base-current collector conduction. VCE saturation latch, model versions,
profiles, observed-current clamps, quality thresholds and clock cadence remain
unchanged. No golden was regenerated.

## Before and after

The original NPN/display source, document and held runtime are identical across
the comparison. Incorrect negative companion current was hidden by the reported
zero-current clamp, causing independent KCL failure. The first diode-only repair
exposed the analogous base-admission fault at shutdown; its immutable partial
receipts remain in `candidates/diode-active-set-819-phase1`.

| Check | Before | After |
| --- | --- | --- |
| Initial held KCL residual | 0.00306030601 A | 2.5e-11 A |
| Falling-edge base fault | -686.27451 microamps stamped, zero reported | base and collector cutoff currents zero |
| 1/2/3/4 NPN display clock | physical quality fault | READY, quality passed |
| Maximum final KCL residual | failed 1e-6 A threshold | 4.8e-11 A |
| Source residual | — | 0 V |
| Active display segment current | — | about 1.307 mA |

## Validation

- 38 author-focused cases: 18 immutable complete raw-display/golden results,
  eight matrix/diagnostic cases and 12 new cutoff/profile/physical-load tests.
- New tests include configured 0.5/0.7/1 V base knees, below/exact/above knee,
  actual zero collector current at zero base current, saturated falling edge,
  ordinary DO35 cutoff, device order and JSON continuation byte equivalence.
- First canonical `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`: **PASS**,
  2381 tests (1293 core + 1088 Web), 71 fresh Nx tasks
  (1 SDK + 43 types + 27 build), cache skipped. No retry.
- All budgets PASS and unchanged: Editor 166663/222000,
  Arduino 1999997/2000000, initial JS/CSS 552023/600000.
- Independent 199-case run PASS: 38 above + 155 solver + six NPN tests;
  before/after inputs and all nine phase-one archive hashes independently checked.

Canonical gate log SHA-256:
`8a9ead96453862b15b890a1b945428448886dbce0b6330cdc0670c8aa6b762e7`.
Bundle log:
`78eee1020343bab06121c8a717f226b5ef5a60ce16a28c1f1e6350807698bff6`.
Independent test log:
`e951dd07ce60f5cf603ac1edd9110d7682b3ff55c4afa35798f6e39fd5df19ca`.
`manifest.json` binds deterministic gzip and raw AFTER/review receipts.

## Remaining work

These short 20ms electrical runs are not realtime: recorded wall durations are
hundreds of milliseconds. User functions remain unsupported, and instantaneous
raw-display rendering still fails to show all multiplexed digits. Those failures
remain recorded in the 817 BEFORE checkpoint; this repair closes only its
electrical companion-current defect. Server, Docker, installed Save/reopen and
owner acceptance were not run. Exact-main CI is separate from local source gates.
