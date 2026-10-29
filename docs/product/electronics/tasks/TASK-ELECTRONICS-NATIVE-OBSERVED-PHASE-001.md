---
task_id: TASK-ELECTRONICS-NATIVE-OBSERVED-PHASE-001
kind: maintenance
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Credit the phase actually photographed

Issue840, separate baseline dependency of native qualification for issue836 /
PR839. One new bounded test author; no piezo/runtime source repair in this slice.
Controller composes the independently reviewed baseline with the piezo candidate
and obtains exact combined General/native evidence before Main. Do not dispatch
another full standalone native run; controller coordinates final qualification.

## Proven incorrect rejection

At exact068, e2e/electronics-classroom-timing.spec.ts2048 credits a capture only
when pixels.observedPhase equals requestedPhase, then reports missingLOW.
Existing verified artifact66ad8c1a1ac2465059410852d051f89ef83ba76ddc74800569377656f74c15ed
contains matrix-300-high-0-native with exact canonicalLOW at all9 LED and9 UnoL
pixels; high-1 is exactHIGH. All three LOW-requested images show validHIGH.
Canonical hashes and fixed geometry match.214 successful ready frames remain
sameworker/generation/session, no observer errors; stable matchingLOW/HIGH
witnesses exist within each capture interval. Screenshots232-310ms span phase
changes; requested phase is scheduling intent, not a guarantee of capture time.

## Required outcome

Collect validated observed HIGH/LOW across the capture set and require both.
Keep requested and observed phase separately in evidence. Native pixels decide
observed phase; DOM/runtime witnesses must agree with that observed phase within
the coherent capture interval and same run. Never substitute witnesses for a
photographed phase. Preserve canonical asset hashes, pixel thresholds, geometry,
source identity, stable witnesses and rejection of UNKNOWN/MISMATCH as proof.
Do not change owner assets, runtime rendering, solver, screenshot timing,
attempt budgets, timeouts, classifier tolerances or gate requirements.

Use the existing qualification seam where possible; a small pure helper and
focused adversarial test are allowed if necessary. Regression must reproduce
validLOW photographed during a HIGH-requested attempt and validHIGH across set,
while rejecting absent observed-phase witnesses, unknown/mismatched pixels,
stale run/source or geometry/reference violations. No blanket sample acceptance
or weaker native-image requirement. Keep strict old evidence fields where useful.

Local narrow regression/types/format once; heavy native/builds in GitHub after
controller composition. Independent Code/evidence-integrity review of exact SHA.
No dependencies, product source, working-server/DB or current.yaml changes by
the author. Preserve all prior work and diagnostic files. Report then STOP.

This is one evidence-accounting defect, not proof all89 old failures are flaky.
Exact compositor timestamp is unavailable; do not claim a native image maps to
one particular worker response. Match it to its bounded same-run capture interval.
