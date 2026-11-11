# CI #1093 — temporary PostgreSQL JIT screening

This is one bounded diagnostic continuation of `TASK-LRN-COURSE-001` / [#1093](https://github.com/spikeal8-maker/asa-lab/issues/1093), from accepted main `92377daf6db834a8fb4670598c55bf41b4fe8d2b`. It does not select another product task or change `current.yaml`.

**Branch only:** `work/ci1093-pg-jit-probe-20261112`. Do not merge these temporary diagnostic files into main. Publication and the first CI execution follow independent review of the exact source. A result is evidence for the controller's next bounded decision, not automatic permission to change production functions.

## Question and limits

Do the seven current read boundaries run repeatedly faster with session JIT disabled while returning exactly the same meaningful payload? They share the current canonical learning projection, directly or through participant rating. The historical safe probe in `b9300284b0735b078a333889ca9d934bdc50d563` supplies the isolation, read-only transaction, hashing and numeric EXPLAIN design; its old roster/profile/teacher-account measurements are not evidence for these readers.

The experiment does not reproduce the full Data suite or establish the historical cause of its five-second test deadlines. Those deadlines cover setup, pool acquisition, SQL and JavaScript scheduling. This experiment uses dedicated `pg.Client` connections and a host Node 22 runner on Ubuntu 24.04, whereas General Data runs its tests in Docker. PostgreSQL uses exactly General Data's current pinned image from `docs/product/projects/evidence/ci-node-transport-429-receipt.json`. Absolute times must not be called measurements of the General container.

No production SQL, migrations, existing specs or deadlines, Vitest, Compose, General workflow, required gates or deployment settings are changed. No live database or server is contacted. Successful screening does not unblock PR #1091 or replace required integration evidence.

## Three synthetic states

The new seeder executes real existing SQL commands against a fresh `asa_ci1093_test` database. Each state has one class and one active Seat; the two learning cases have verified links to separate Accounts. Setup handles remain only in memory. Semantics are asserted before measurement and on every ordinary measured result.

| State | Existing source | Required evidence |
| --- | --- | --- |
| AI rating | `tests/admin/ai-student-access.contract.ts`, “uses current canonical rating…” | Canonical Seat identity; no assignments; class policy `rating`, minimum `0`, inherited override; numeric score `0`, rank `1`, zero source counts; admission allowed at equality |
| Quiz before closing | `tests/courses/quiz-complete-course.pg.spec.ts`, “enforces after_close feedback…” | One published question, correct saved answer, submitted attempt, assignment still open and policy `after_close`; Seat/Account points and feedback hidden; teacher result `1/1`; no answer-key leakage |
| File history after closing | `tests/courses/learning-essay-course-runtime.pg.spec.ts`, `directFileFixture` and “retains exact direct File history…” | Submitted file, `changes_requested` review, newer unsubmitted rework draft, then closed assignment; verified Account link; both canonical views still select the original submitted history |

These are selected states, not copies of all transitions in the original tests. AI measures the initial numeric/equality branch, not the later minimum-100, disabled-factor or Seat-override transitions. Quiz measures the before-close privacy phase, not its later released feedback. File has one Seat, compared with two in the original fixture. No course population, unrelated accounts or parallel test load is synthesized.

`fixture-timings.jsonl` records the actual wall time of each new setup/validation phase. Those values are not the setup time of the original full tests. Real SQL counts must equal three classes/seats, two assignments/runs/participations/submissions/results/file versions/linked Accounts and three attempts. Empty, null, foreign or incorrectly exposed results fail the experiment rather than becoming a fast sample. The semantic validation reads also warm shared database buffers; there is no claim of cold-start timing.

## Measurement protocol

| Label | Role | Boundary |
| --- | --- | --- |
| `ai_metrics` | admin | `classroom_participant_metrics(class)` |
| `ai_access` | restricted `asalab_app` | `ai_access_status(principal)` |
| `quiz_seat` | restricted `asalab_app` | `learning_canonical_evidence_for_seat(seat)` |
| `quiz_account` | restricted `asalab_app` | `learning_canonical_evidence_for_account(account)` |
| `quiz_teacher` | restricted `asalab_app` | `learning_canonical_evidence_for_teacher(teacher, class)` |
| `file_seat` | restricted `asalab_app` | `learning_canonical_evidence_for_seat(seat)` |
| `file_account` | restricted `asalab_app` | `learning_canonical_evidence_for_account(account)` |

After all fixture writes and semantic checks, setup connections close. A fresh direct connection for each role begins `REPEATABLE READ READ ONLY`. It keeps the same credentials, role, physical backend PID, arguments, snapshot and transaction timestamp throughout the comparison. The two roles have their own transactions; no claim is made that their transaction timestamps match each other.

The sequence is **ON → OFF → ON → OFF**: seven reads per round, **28 ordinary samples**. Then every read gets ON and OFF `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF)`: **14 plans**. Metadata/guard/setup queries are additional and are not miscounted as ordinary samples. Effective session JIT is checked after every `SET LOCAL`; thresholds and snapshot/connection identity must remain stable. `pg_jit_available() = false` fails with `jit_unavailable`, so OFF/OFF cannot pass as an informative JIT comparison.

Ordinary samples record `client_wall_ms`, row/item counts, canonical SHA-256 and equality with that reader's first result. SQL row order is ignored; duplicates and JSON array order remain significant. A mismatch stops measurement. UUIDs, payloads, arguments, SQL text and credentials are not exported. Node `process.cpuUsage` deltas describe only the client process, not PostgreSQL CPU; client wall time includes server work/wait, transport and client scheduling, and excludes pool acquisition because there is no pool.

The receipt captures actual Node/libuv/pg versions, PostgreSQL version, JIT availability/settings/cost thresholds, and `pg_proc` security-definer/volatility/allowlisted `proconfig` for the relevant function chain. Unknown function settings are redacted. Node CPU/memory visibility and available cgroup-v2 facts are recorded, along with selected actual Docker HostConfig limits for the owned PostgreSQL container. Missing facts remain null; zero/empty Docker limits do not prove unrestricted effective CPU/RAM, contention or oversubscription. PostgreSQL's effective cgroup budget is explicitly unobserved in this screening.

External `EXPLAIN SELECT function(...)` may hide nested statements and nested JIT. The numeric allowlist keeps available planning/execution/JIT/buffer values, but absence of an outer JIT section does not prove absence of nested JIT. Function `proconfig` can override the session setting; interpret it alongside the measurements. Only two ordinary samples per setting are collected, so this is screening, not a statistical latency benchmark.

## Workflow and evidence

The only trigger is a push to the exact diagnostic branch. It checks the exact event SHA and clean source, installs the frozen dependency set, runs offline self-tests, generates and masks separate temporary passwords, then creates one loopback-only disposable PostgreSQL container. The full container ID is recorded before starting it, so a start/health failure still permits exact cleanup. The existing `tools/provision-test-db.mjs` applies the unchanged migrations and provisions the existing restricted runtime role. Before seeding, the probe verifies full container identity, running state, exact configured and effective `127.0.0.1:5432` binding, image and owner labels. Cleanup accepts only the recorded full container ID with matching source/run/attempt/purpose labels and image; it has no name or global-container fallback.

The workflow always attempts cleanup and artifact upload. Artifact name: `ci1093-pg-jit-<exact-source-sha>-<run-attempt>`, retained for 14 days.

| File | Contents |
| --- | --- |
| `receipt.json` | Exact source SHA/tree, isolated target identity, versions, observed settings/resources, function metadata, actual fixture counts and semantic checks |
| `fixture-timings.jsonl` | Actual setup/validation phase wall times and success flags |
| `samples.jsonl` | 28 ordinary observations when complete; partial observations retained on failure |
| `plans.json` | 14 sanitized numeric plans when complete; partial plans retained on failure |
| `summary.json` | Expected/actual counts, payload equality, stable-session checks, completion/errors, cleanup and workflow outcomes |

A compact sanitized summary is printed in the job log. Database errors expose only a fixed stage/reason and valid SQLSTATE, never raw messages/stacks/rows. Unexpected provisioning output stays private to the disposable runner and is not uploaded. Generated fixtures and credentials disappear with the owned container and its anonymous volume.

## Local verification and decision boundary

Run the same quick offline checks used by the workflow:

```bash
corepack pnpm exec prettier --check tools/testing/ci1093-pg-latency-fixtures.mjs tools/testing/learning-e1-pg-plan-probe.mjs tools/testing/learning-e1-pg-plan-probe.test.mjs
corepack pnpm exec eslint tools/testing/ci1093-pg-latency-fixtures.mjs tools/testing/learning-e1-pg-plan-probe.mjs tools/testing/learning-e1-pg-plan-probe.test.mjs
node --test tools/testing/learning-e1-pg-plan-probe.test.mjs
```

Offline PASS verifies guards, protocol, redaction and semantic-validator failure cases. It is not PostgreSQL execution evidence. Real PostgreSQL execution belongs only to the reviewed isolated workflow.

Keep three conclusions separate:

1. **Measurement complete:** the exact-source job produced 28 samples and 14 plans with meaningful, equal payloads and stable sessions.
2. **Acceleration supported:** independent review finds repeatable OFF improvement for a specific reader under the recorded settings and limitations. Completion alone does not imply this conclusion.
3. **Original failure repaired:** a separately authorized production change passes the unchanged focused and required integration gates. Screening alone establishes neither a repair nor historical timeout causality.

If the result is negative or ambiguous, leave production JIT/timeouts/parallelism unchanged. Any next experiment or function-local repair is another bounded assignment. This file records the experiment contract, not an experiment result.
