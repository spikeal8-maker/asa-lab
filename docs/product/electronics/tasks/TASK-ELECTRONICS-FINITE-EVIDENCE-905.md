---
task_id: TASK-ELECTRONICS-FINITE-EVIDENCE-905
kind: maintenance
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Complete finite-number evidence without per-number trace overhead

Issue905 is a test-only dependency of the owner's full836 qualification.
Exact0d489e5e, strict41334492559, completes156PASS/19FAIL of175 tests before
the50-minute limit. E11running1440 finishes its native journey, cookies-only
reopen and final snapshot, then spends18min20s on129276 individually traced
numeric assertions:342 ready results times378 numeric leaves. The verified
trace proves this cause; a later API timeout does not prove a long API request.

## Selected repair

Only `e2e/electronics-selection-outline.spec.ts` finite-result validation and a
small shared pure test helper with meaningful tests under `tests/electronics/`.
Inspect every numeric leaf in every original result. Keep hard rejection of
NaN and both infinities, with useful paths. Emit one aggregate hard assertion
per complete result instead of a Playwright assertion per numeric value.
No sample, key, ready result, quality/horizon assertion or original native action
may be removed. Do not short-circuit successful traversal or deduplicate valid
shared subtrees in a way that drops old coverage.

Test nested objects/arrays, mixed nonnumeric fields, all finite edge values,
nonfinite leaves and complete large-tree counts matching129276. Verify the
actual E11 callsite uses the shared scanner and retains one hard result check.
Keep the original failed logs/trace; establish bounded assertion-count/runtime
evidence without adding brittle wall-time thresholds to CI.

## Boundaries

Preserve all source0d489e5e product blobs,901/902 geometry thresholds and525
frozen browser spec. No product, clock, solver, worker, workflow, dependencies,
caps, retries, timeouts, owner assets, server or database changes. Existing
no-delay/millis performance failures before836 remain separately diagnosed;
this repair does not waive them or declare836 accepted.

One clean writer inherits the reviewed0d candidate and current canonical state;
focused tests, source preservation proof, fresh independent review and final
combined strict run are required. Report exact source/evidence and STOP.
