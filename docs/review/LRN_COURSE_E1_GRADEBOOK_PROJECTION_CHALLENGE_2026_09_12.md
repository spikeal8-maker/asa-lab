# LRN-COURSE E1 — Selected Result / Gradebook Projection Challenge

Date: 2026-09-12
Scope: E1 stabilization blocker `Selected Result ↔ Gradebook projection consistency`.

## Contract

`learning_selected_result_internal(participation_id)` remains academic truth.
`gradebook_entries` is only a compatibility projection and stable audit anchor.
A gradebook pointer must never outlive or contradict the canonical selected Result.

## Change

- Added migration `0134_learning_gradebook_projection_sync.sql`.
- `gradebook_entries.accepted_attempt_id` and `assessment_result_id` are nullable.
- Existing canonical rows are reconciled through the selected-result resolver.
- Added internal `learning_gradebook_projection_sync_internal(...)`.
- Canonical review corrections and explicit teacher selection use the same sync helper.
- When selection becomes null, the row remains but both compatibility pointers become null.
## Negative / historical checks

- `latest_accepted`: accepted → correction `incomplete` → resolver null → pointers cleared.
- Later accepted correction restores the same audit-anchor row with the new canonical Result.
- `teacher_selected` updates compatibility pointers to the exact explicitly selected Result.
- Seat→learner link may be inactive: historical projection still resolves by stable identity lineage.
- Runtime role cannot call the internal sync helper directly.
- `grade_change_events` remains immutable history and keeps the stable `gradebook_entry_id`.

## Upgrade evidence

A database at 0133 with a deliberately stale canonical gradebook pointer was upgraded with only 0134.
The same gradebook row survived, both pointers became null, and prior audit history remained addressable.

Fresh install applied 133 migrations successfully.
## Test evidence

- focused canonical runtime + upgrade: 16/16 PASS on fresh `asa-gradebook-sync-v2` database.
- adjacent legacy/manual assessment + quiz: 2/2 PASS.
- workspace build: 25/25 projects built successfully while producing the test images.
- `db:migrate --check`: PASS with migrations through 0134.

## Review verdict

POST_STEP_REVIEW: PASS
CHALLENGE_REVIEW: PASS

Not covered by this checkpoint: DB/API rollout compatibility, batch StudentSeat, learner preview, draft-from-version, teacher-home attention, archive/restore acceptance, final E1 gate or production deployment.
