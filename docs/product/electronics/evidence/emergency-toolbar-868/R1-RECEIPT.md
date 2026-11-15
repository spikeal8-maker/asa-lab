# Pausing label — bounded R1 evidence

Independent review rejected candidate66146712f: the supported pausing phase at
320px left only16.515625px for the tool strip. The exact rejected reviewer receipt
is preserved verbatim inside `r1-before/reviewer-pausing-geometry.json.gz`, raw
SHA256 e72058d0e9d71e59a9e719356ad5b981d736dbf7fdee2037b92056116d164b24.
No reviewer PNG was available. This evidence was pushed in b2aadfa29 before the
R1 product edit. All original evidence and published history remain preserved.

The only R1 product change is the toolbar-only pausing text in
`SimulationSpeedControl.tsx`: `Пауза…`. The full dialog still says `Приостановка…`.
Accessible names, callbacks, state transitions, rate values, timing and CSS are
unchanged. Canonical selection369d7c907 was merged once before implementation;
unrelated AI changes were preserved.

The native fixture now uses the actual production SimulationPacing adapter.
It verifies the actual phase/rate returned by that adapter, the actual production
Header and SpeedControl, and the complete production CSS. The original80-state
matrix remains, with64 additional narrow states covering pausing0, paused0,
running0.1 and running10 at320/390, both Code states, emergency presence/absence,
and DPR1/1.25. The wider matrix also retains1152 CSS pixels as a1440-at125%
viewport equivalent. No system display settings were changed.

All144 states and1448 native keyboard/touch actions PASS. At320 with Code open
and emergency present, both pausing and paused retain47.953125px for tools;
the speed control is50.046875px wide and Save occupies276 to318. The unchanged
full pausing explanation is explicitly checked after opening the real dialog.
Required controls remain reachable, nonoverlapping and inside one toolbar row;
the full left Copy target is exercised. The320 pausing PNG was visually reviewed.

The first expanded harness attempt timed out on its full-dialog text assertion
because a PowerShell/Python string insertion encoded the Cyrillic expectation as
question marks. `r1-harness-attempt/geometry.json.gz` preserves its partial raw
receipt. The assertion was repaired with Unicode escapes, then the unchanged
product candidate passed the complete144-state run. This was a harness encoding
failure, not a product layout failure; no assertion was weakened.

Validation: selected-task routing114 tests PASS; focused workbench presentation,
clock and speed-control22 tests PASS; targeted ESLint, Prettier and diff checks
PASS. Uncached web build executed7 fresh tasks, cache skipped. All8 fixed bundle
caps PASS: Electronics187859/222000; Arduino1999925/2000000. Original6614 canonical
checks remain historical and are not claimed as final-R1 evidence.

SELF_REVIEW: PASS. One additional display string only; no pacing semantics,
persistence, engine, protected assets, font sources or foreign files changed.
The native fixture proves component layout and callback reachability, not an
installed owner Save journey. Final exact-SHA canonical gate and fresh independent
review belong to the programme controller. No release, deployment or owner
acceptance is claimed. NEXT_ALLOWED_TASK: STOP / OWNER REVIEW.
