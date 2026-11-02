# Learning origin list: isolated capacity diagnosis, 2026-11-02

Programme909 / Draft child PR925. This slice does not change application SQL,
migrations, statement timeouts, permissions, row locking or production state.
No migration number is reserved by this document.

## Original failure

Learning E1 run41355966339 at9304ae0767a48fc740e4598eaacbcbb537faf484 failed
the second partition: eight browser cases passed and seven failed. The first
failure was the mobile-shell case at22:24:39 UTC,
before opening the shell: its learner assignment row was missing. PostgreSQL
subsequently recorded15-second statement cancellations through
learning_origin_learner_list → learning_origin_work_context_for_project →
project_context_for_principal → learning_linked_project_access. Earlier unit
contention-test timeouts were intentional and are separate evidence.

The old logs establish a timeout, not its planning/JIT/locking/execution cause.
The relevant Learning SQL and list code were unchanged between that source and
the diagnostic baseline908751ed215ebec5822a72c4133e481a9b2360ab.

## Actual measured source and evidence

[Run41360377621](https://github.com/spikeal8-maker/asa-lab/actions/runs/41360377621)
explicitly checked out **1ce76c1705021521d96a96d8ecaa82d52adac449** in both
jobs. First partition job125009581877 passed all31 original browser cases;
second job125009582083 passed all15, including the previously failing mobile
case and the approved Account exact-Run journey. Each job also passed1175 unit
tests with one existing skip. This is original E1 coverage, not100 simultaneous
users or a whole release acceptance.

The diagnostic runs **after** the unmodified second browser partition, so its
queries cannot contaminate that reproduction. Artifact13104969388,
`learning-e1-1ce76c1705021521d96a96d8ecaa82d52adac449-second`, contains
`reports/learning-origin-capacity/after-browser.json` with complete JSON EXPLAIN
ANALYZE/BUFFERS/SETTINGS plans. PostgreSQL16.15, jit=on,
jit_above_cost=100000, statement_timeout=15s. Counts at measurement:

| Relation | Rows |
|---|---:|
| classroom_student_seats |281|
| principals |344|
| learner_identities |187|
| learner_identity_links |234|
| learning_project_origins |54|
| activity_participations |310|
| activity_runs |302|
| projects |126|

| Query | Planning ms | Execution ms | Observed result |
|---|---:|---:|---|
| Seat list |0.011|293.634|one origin row|
| Account list |0.013|3.764|empty list; not positive linked-Account proof|
| newest Seat list |0.012|3.384|empty list|
| linked-access SQL body |27.598|0.269|materialized origin_scope one row/one loop|
| exact work-context SQL body |268.869|8.415|completed|

No sampled wait event was observed at250ms intervals. That does not exclude
shorter waits. Plans have no JIT section despite server jit=on, and show no
temporary I/O. An outer Function Scan hides nested-function planning detail;
extracted SQL bodies are separate measurements under the function owner's CI
role, not a replacement for restricted runtime authorization tests. The Account
diagnostic's empty result must not be described as a measured positive linked
read; the real browser journey provides separate functional Account evidence.

The original artifact's `revision` is GITHUB_SHA **978a97cb2c30cebf1fec6e6a51862df6923bacee**,
the PR event merge SHA. Immutable workflow headSha and explicit checkout logs
pin the actual measured source1ce76c17 above. A subsequent metadata-only source
correction records `checkoutRevision` and `githubEventSha` separately. It changes
neither SQL/query strings nor database runtime settings. Heavy results belong
to1ce76c17, not that later metadata/documentation commit.

## Conclusion and limits

**NOT_REPRODUCED on this isolated run.** No safe measured product repair was
selected; no migration, authorization change, timeout increase, JIT override,
deletion or production action was performed. This result does not prove the old
failure was infrastructure-only, nor permanently rule out data/statistics/plan
or contention-sensitive Learning behavior. Do not call the old issue fixed by
this diagnostic change.

The canonical combined candidate must run its own exact-SHA gates. If the same
timeout reproduces there or under the separate100-pupil acceptance, capture the
actual failing list parameters' synthetic cohort/cardinality, nested plans and
waits, compare repeated positive Seat/Account cases, and only then select a
bounded SQL repair. Preserve current RLS/identity checks, exact immutable-origin
authorization and all five FOR SHARE locks, including concurrent revocation
regressions. Existing deployment blockers remain in force.
