# Durable local image queue

Programme: [asa-lab#909](https://github.com/spikeal8-maker/asa-lab/issues/909).
This candidate changes source and forward migration only. Installation, live data,
real GPU quality, network portability and a complete 100-pupil browser/load run
remain separate evidence; an admission test is not that workload.

## Behaviour

Migration `0289_ai_image_durable_queue.sql` separates persisted admission from
single-GPU execution. The persisted `admitted` state means **waiting in the queue**;
the UI says so and permits cancellation. A job may start immediately when its
owner is next and the GPU is free. Queued jobs survive API/worker restart.

- At most 200 unfinished receipts globally and two per canonical owner, including
  admitted, submitting, unknown, running and storing. Terminal history does not
  consume queue capacity. Existing UTC daily quotas still count every accepted
  receipt, including cancellation and deletion; queue rejection creates no receipt.
- Execution is one job at a time. A historical two-slot setting is narrowed to one
  with a configuration revision increment during the forward migration. Enabled,
  recipe, sizes, endpoint, quotas, private data and historical receipts survive.
- Free-GPU dispatch takes priority over terminal object-cleanup tombstones.
  Cleanup can run while active GPU observation is leased, while the queue head is
  leased, or when there is no eligible dispatch. Recurring uncertain-PUT cleanup
  retains its tombstone/fence and cannot indefinitely postpone an accepted job.
- SQL serializes dispatch decisions across API processes/workers. Owners rotate
  by their last persisted image start, then FIFO within each owner. A direct API
  fast-path cannot bypass an older queue head. There is no process-local queue.
- A pre-dispatch worker lease can expire and be reclaimed. A committed dispatch
  CAS authorizes exactly one provider POST; losing the CAS reply never permits
  another POST. An uncertain provider response is reconciled by the original UUID,
  marker, recipe and graph digest, without retrying generation or immutable PUT.
- Cancellation/deletion of a queued job prevents submission. Cancelling active work
  suppresses publication and drains its exact result. There is no global ComfyUI
  interrupt/free call and no cancellation of another pupil's work. Object integrity,
  owner-only downloads/history, private prefixes and cleanup tombstones retain
  their existing enforcement.

Queue saturation is an expected **admission 429**, distinguished by an actionable
message (own two unfinished jobs, or a globally full queue). This is not the old
"GPU busy" rejection of every simultaneous pupil. No automatic retry creates new
UUIDs, and exact receipt replay stays free even after readiness/configuration drift.

## Unknown outcome and recovery

A missing UUID is not a terminal provider receipt: a delayed POST might still
arrive. Unknown jobs therefore keep the GPU permit. Waiting owners see a safe
pause flag and can cancel their own queued job; they see no foreign name, prompt,
position, UUID, endpoint or result. Ordinary polling keeps chat/project pages usable.

Automatic progress resumes when exact owned provider history proves failed or
complete and the existing transition records the terminal usage receipt. Successful
output follows existing private storage verification before publication. A storage
outcome that is still uncertain remains conservative until its integrity check
resolves; a missing object is not permission to repeat PUT.

A permanently missing provider receipt requires operator escalation, not a timeout
that silently frees the slot. Inspect the existing worker/provider logs and exact
UUID on the protected administration channel. Preserve data and receipts. Before
any manually reviewed recovery that could release uncertain work, fence all old
API dispatchers and the provider submission path so delayed work cannot arrive,
then verify/record the provider outcome and a consistent backup. This slice adds
no privileged bypass or blind SQL repair command and does not promise automatic
progress for an ambiguous provider outcome. Restarting a worker alone is not such
a fence.

## Repeatable checks

Install frozen dependencies from GitHub and run the canonical focused gate:

```sh
pnpm install --frozen-lockfile
pnpm gate:ai-image-queue --unit-only
```

This explicitly reports real PostgreSQL NOT_RUN. The complete gate is the same
command without `--unit-only`, using a fresh disposable loopback `*_test` database
and explicit `ASA_IMAGE_QUEUE_TEST=1`, `TEST_DATABASE_URL` and
`APP_TEST_DATABASE_URL`. It owns that synthetic database; do not point it at an
existing install or a shared test database. The dedicated GitHub workflow creates
its isolated PostgreSQL with synthetic credentials and runs this exact gate.

The PostgreSQL suite applies the full history through schema286, inserts a
synthetic uncertain job, then upgrades through287/288/289 and proves the original
row/identity/recipe/digest survived and repeat migration is a no-op. It exercises
100 pupils' simultaneous admissions, bounded global/owner queues, two independent
backend connections with an observed database lock wait, fair scheduling,
pre-/post-CAS crash recovery, exact replay, cancel/delete/quota, paused unknown
recovery and denied foreign/private storage access. Existing embedded tests retain
native-image, profile, immutable PUT and historical receipt coverage.
The local embedded and real PostgreSQL suites additionally seed 121 recurring
uncertain-PUT tombstones, prove dispatch occurs on the first free-GPU claim,
then prove cleanup progresses during an active observation lease without a second
GPU dispatch or loss of any cleanup fence. No provider
network/generation is used by these fixtures. A fresh installation obtains the same
schema/policy from the versioned source; no machine address is embedded by the queue.
