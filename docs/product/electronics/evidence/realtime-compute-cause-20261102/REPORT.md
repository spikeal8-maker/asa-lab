# Bounded real-time compute cause replay

Source a5157af1265ac02965bb5f8a6711a305ceb8332f; selected task validation PASS.
No repository source/test/state changes, new dependencies, server or browser.

Actual saved seven-component no-delay and independent-millis circuits, exact
source, generation, request IDs, full previous returned states and horizons
0/1000/26000/51000us were replayed twice through the original batched evaluator.
The millis before.draft document is default code and was rejected by source
validation before any evaluator ran; saved.draft.document contains the actual
618-character programme and matches its request source and continuation digest.

Transport limitation: original projectSessionId was not logged; the saved actual
project.id was used consistently as a reconstructed transport envelope field.
No original session/browser transport parity is claimed.

All16 actual evaluations were ready at the unchanged requested horizons. All16
complete resulting state bytes match the corresponding original saved states.
Every complete response matches its identical-input repeat after deleting only
the top-level metrics.computeMs property; original responses remain retained.
All input documents/state graphs were unchanged. All8 input/source identity and
continuation digest checks pass. Total measured compute was765.877ms.

One V8 CPU profile with precise coverage was collected on the first8 evaluations;
second8 were unprofiled. Coverage confirms8 owned runtime constructions,8 prepared
quality layout owners and8 prepared quality traversals; passive continuation
admission is active, not broken by the already fixed historical eventQueue issue.

Sampled inclusive time: evaluator432.189ms, scheduler369.084ms, runtime advance
wrapper186.842ms, advanceRuntime168.743ms; advanceRuntime self73.992ms. Solver
base totals55.173ms. Session creation1.774ms, so duplicate request cloning is not
a measured dominant target in this small profile. Inclusive totals overlap and
must not be summed as independent percentages.

Unprofiled requested25ms chunks require no-delay56.710/36.990ms compute and
millis95.792/79.567ms compute. Default bounded host yields add wall time: no-delay
97.601/72.208ms and millis160.288/145.069ms. This is an existing-interpreter cost
and yield policy observation on short real continuations, not realtime acceptance
or proof that all20 failures share one cause. Profile coverage itself adds cost;
its numbers identify functions rather than establish performance thresholds.

Smallest separately selectable repair experiment: the existing owned interpreter
hot loop in arduino-program-runtime.ts, retaining complete instruction costs,
GPIO/event ordering, dynamic binding checks, scopes, state serialization and
clock boundaries. First measure a concrete change there against these same full
requests and complete response equality; do not remove ownership clones based
on this profile or change horizons/budgets/yield policy to disguise lag. Require
an independent semantic review, full partition/continuation/peripheral parity,
and actual unchanged native no-delay/millis plus remaining timing qualification.
No optimization or acceptance is claimed by this report. STOP.
