# LRN-COURSE E1 — Attempt lifecycle challenge review

Date: 2026-09-12
Status: PASS for this stabilization slice; E1 remains IN_PROGRESS.

## Scope

This review closes one L3-critical blocker only:
`Attempt lifecycle != pedagogical decision`.

Normative invariants used:
- `LRN-ATT-001` — Attempt stores lifecycle only.
- `LRN-ATT-002` — resubmission creates a new linked Attempt.
- `LRN-ASM-001` — published assessment corrections are append-only.
- `LRN-SEL-001` — result selection is server-derived.
- `LRN-GRD-001` — Gradebook is a projection, not academic authority.

The targeted context was resolved through `CTRL-GRADEBOOK-REVIEW`; whole Learning master documents were not loaded as implementation context.

## Result

Allowed `learning_attempts.state` values after migration 0133 are:
`in_progress`, `submitted`, `evaluating`, `closed`, `invalidated`, `expired`.

`accepted`, `changes_requested`, `incomplete`, and `excused` now live in Result revision semantics rather than Attempt lifecycle.
## Implementation changes

- Added migration `0133_learning_attempt_lifecycle_convergence.sql`.
- Canonical resolver now maps `closed + reviewDecision=changes_requested` to workflow `changes_requested`.
- Review commands close Attempts with `state='closed'` while Result revisions retain the pedagogical decision.
- Auto-graded quiz Attempts close as lifecycle `closed` with an accepted Result decision.
- `teacher_selected` validation now requires a closed Attempt with a valid latest Result revision.
- Reminder sweep derives revision-needed state from the latest Result decision.
- Legacy project resubmission checks Result decision instead of old Attempt decision-state.
- Legacy SHA-256 compatibility search path is preserved after redefining its writer.
- Web review history treats Attempt terminality as lifecycle `closed`; pedagogical labels come from Result revisions.

## Upgrade behavior

Migration 0133 does not mutate an existing immutable `assessment_results` row.
For an old Result without `review_decision`, it appends a new compatibility revision with `supersedes_result_id`.
For an old `changes_requested` Attempt with no Result, it creates one compatibility Result before converting the Attempt to `closed`.
The old state CHECK is dropped inside the migration transaction before lifecycle conversion and replaced by the lifecycle-only CHECK afterward.

The upgrade regression explicitly verifies that Result revision #1 remains unchanged and revision #2 supersedes it.
## Evidence

- `pnpm db:migrate:check` — PASS, 132 migrations including final 0133.
- Focused domain/API tests — 25/25 PASS.
- PostgreSQL runtime tests — 14/14 PASS for manual assessment, canonical project attempts and quiz engine.
- Mixed-data/upgrade tests — 2/2 PASS on final v5 test image.
- Combined final PostgreSQL evidence — 16/16 PASS.
- All 25 workspace projects built successfully while building the final test image.
- Source search in final 0133 found zero writes of decision values into Attempt state.
- Source search in `apps/` and `contexts/` found zero remaining `state='accepted'` / `state='changes_requested'` Attempt assumptions.
- New lifecycle CHECK rejects an attempted write of `state='accepted'`.

Recovery snapshot before the final convergence edits:
`C:\Users\spike\AppData\Local\asa-lab-recovery-learning-course-01-20260912-1530.zip`
SHA-256: `be36eb88838cfe2b8acbef08684ad55df5b5102464ade0183dddc6fd9cf388e2`.

## Defects found by the review itself

The first implementation was not accepted. Review/testing found and corrected:
- accidental loss of the legacy SHA-256 function search path;
- two malformed regression SQL placeholders;
- `teacher_selected` still depending on old decision-state;
- an illegal in-place update of immutable Result rows during upgrade;
- lifecycle conversion running before the old state CHECK was removed.
## Explicitly not closed by this step

This receipt does not claim E1 completion and does not close the remaining blockers:
- stale `gradebook_entries` pointer when selected Result becomes null/changes;
- DB/API rollout compatibility for submit and Account join;
- authoritative/idempotent batch StudentSeat with one-time printable credentials;
- real zero-write Preview-as-Learner;
- draft-from-published-version recovery;
- Teacher Home `Требует внимания`;
- archive/restore integration proof;
- final convergence with current `main` and final repository/browser candidate gates.

## Verdict

`POST_STEP_REVIEW: PASS`
`CHALLENGE_REVIEW: PASS`

The Attempt lifecycle / pedagogical decision separation is ready to be treated as a closed E1 stabilization sub-step.
The next stabilization blocker should be selected Result / Gradebook projection consistency, not further lifecycle expansion.
