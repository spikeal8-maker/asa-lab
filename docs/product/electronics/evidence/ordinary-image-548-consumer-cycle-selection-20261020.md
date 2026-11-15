# Ordinary image consumer cycle hypothesis — 20 October 2026

Selection baseline: `b3672ff7e83c7e284d758354c871b0c8edf06b08`. The current #666 strict run `39475449280` is already running; this diagnostic does not dispatch another workflow or infer its result. All historical #548 receipts remain immutable.

Independent inspection of the saved failed catalog trace found these relative timestamps:

| Observation | Trace time (ms) |
| --- | ---: |
| Cycle 1 retry observations | 651386, 651992, 652521 |
| Catalog assertion begins | 653255 |
| Unchanged assertion deadline | 658255 |
| Late plain-image HTTP 404 | 655256 |
| Quiet cycle 2 begins | 657507 |
| Cycle 2 retry 1 | 657853 |

Cycle 2 begins 748 ms before the catalog deadline; its first retry appears 402 ms before that deadline. This order motivates a multi-consumer/recovery-cycle lifecycle experiment. It does not prove native error ingress, consumer ownership, shared promise settlement order or the historical failure's cause. HTTP 404 alone does not prove the mounted consumer rendered failure. The old R2 same-node observer run passed naturally and remains `NO_PROVEN_CAUSE`; its passing observation is not a repair.

Select exactly two deterministic mounted cases using existing `ProbeImage` and fake timers in `testing/asset-recovery.spec.ts`: A fails cycle 1, then B mounts before quiet retry and receives its own error; separately B mounts during pending cycle 2 and receives its own error before shared settlement. Check actual DOM failure and badge for both consumers, exact asset/href/cycle provenance, bounded request counts and no extra cycle. Preserve all existing assertions and deadlines, without product edits or a timing-budget workaround.

If both pass, the experiment stops with no proven cause or fix. Any passive provenance or production repair requires a new bounded canonical selection and independent review. Existing acceptance blockers remain scoped and unchanged; this receipt grants no #548/#544/#547 closure, owner acceptance, release or deployment claim.
