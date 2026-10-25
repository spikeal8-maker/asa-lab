# Timed API ownership CI scheduling repair — 25 October 2026

The full parallel Data gate failed the same ownership regression on main523552a1
and editor candidate4cf71f8a: budget1 exceeded the existing5000ms default. Other
7167 cases passed on4cf. The focused Electronics gate (maxWorkers1) and isolated
execution passed. This is a test-runner CPU scheduling concern, not evidence of
a solver/clock/state mismatch. Do not claim a production performance improvement.

An inspector CPU profile of the original isolated case attributed64.4% of samples
to the repeated stateless public-reference API and17.8% to the owned session path.
Profiling adds overhead; unprofiled runs were about2.7seconds. The regression
intentionally verifies every public-resume boundary, not only final variables.
Its reference repeatedly decodes, validates, hashes and solves the circuit.
Full-suite parallel CPU contention removes the margin to the default5second
limit. Preserve this oracle and execution horizon rather than trimming its work.

The sole executable change is vitest.config.ts: exclude this one file from the
parallel project and put it in its own single-worker project at groupOrder2,
after parallel0 and the existing serialized-submission group1. Installed Vitest
4.1.11 groups execution by groupOrder and worker count; this uses the same
existing mechanism without altering the submissions' locks/limits/group.
No production source, test-body, timeout, retry, horizon or assertion is changed.

Verification before final exact-SHA CI:

- Real Vitest discovery before/after:559 files each, every file exactly once;
  only engine-timed-api.spec.ts changes project. All other project assignments
  are identical. No default command or separate gate was introduced.
- Original timed API suite:86/86 PASS in12.75s total; budget1 ownership2737ms,
  budget7 ownership495ms, full transfer budget1 3220ms. Default5000ms retained.
- All four ownership budgets1/7/256/1024,2050us horizon, every boundary and full
  output byte/state comparison, snapshots/descriptors and mutation isolation
  remain in the untouched test file.
- Root-config ESLint and Prettier PASS. Source/domain and engine test diff empty.
- Complete focused gate and General CI must be recorded on the final candidate;
  the above narrow evidence alone does not claim common CI green.

SELF_REVIEW: PASS_WITH_RISK
components: electronics.engine.public-api (test execution only)
scope: one CPU-intensive file's scheduling, metadata and missing test route
unrequested_changes: none
routing_docs: updated
residual_risk: CPU timing still depends on runner resources; actual General CI
  must establish margin. No simulation, release or deployed acceptance claimed.
NEXT_ALLOWED_TASK: STOP after this selected repair's exact-SHA verification
