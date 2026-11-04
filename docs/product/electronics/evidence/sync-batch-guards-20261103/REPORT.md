# Synchronous batch guard design — rejected before implementation

Selected source: `cd29ac332609d31534f61c1a5267c6cd67bbb7a8`.
Task: TASK-ELECTRONICS-SYNC-BATCH-GUARDS-001. No product patch was made.

Author and independent reviewer both returned NOT_SAFE_WITHIN_SELECTED_PATH_SET.
The callback-free local batch can preserve old step partitions, but existing
admission checks do not establish transitive producer/prototype provenance.
An imported producer wrapper may capture a private graph during an ordinary
step and restore its identity before a later batch. Entry-only identity checks
cannot prove permanent revocation; existing model guards must remain fresh.
Capturing a native clock addresses only one callback route, not that larger gap.

A stronger immutable executor/provenance architecture exceeds the three selected
files. No incomplete guard list or relaxed validation was implemented. The
occupied engine-timed-api test was not changed. Worktree remained clean at the
selected source; no build, benchmark, tests, CI, server, Docker or DB action.

Disposition: reject this design and preserve all current per-step guards.
Zero timing failures closed. Controller selects a separate duplicate due-scan
repair; that is not authorization to resume this rejected batching approach.
