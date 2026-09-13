# Execution revision semantics

This file defines field meanings, not current task/branch/SHA values. Only `current.yaml` selects tasks. A change proposed by a documentation/governance branch takes effect on canonical main only after owner-approved integration; a published proposal is not self-authorization.

## Existing single-history records

`task.branch` identifies the delivery/product branch, not the agent's local checkout. In `direct_main` the default delivery target is main; optional working branches, leases and path ownership grant no authority.

For legacy records, `revisions.convergence_baseline_sha` is the historical integration baseline, and `head_sha` is the recorded task revision used by the older PR/ancestor check. Neither is guaranteed to track the current remote tip. Completed/accepted records retain their historical revision and normative references. Do not repin their accepted specification when publishing a new edition.

The validator previously checked full-SHA shape, and coordinated mode checked PR ancestry. `direct_main` skipped remote PR checks. Consequently a stale but well-formed task revision could be rendered as a current HEAD. It must not be used to infer current GitHub branch state.

## Schema 1.2: split history

When a direct-main task has an unintegrated recovery and a bounded review branch, its `revisions.kind` is `split_history`:

| Field | Meaning |
|---|---|
| `task.branch` | Remains main, the delivery target; no feature branch chooses the task |
| `convergence_baseline_sha` | Historical common ancestor of the observed main and recovery, not their current HEAD |
| `head_sha: null` | No single integrated task candidate exists; neither recovery nor bounded Preview is a main candidate |
| `observed_at` | UTC/offset timestamp of a verified GitHub snapshot, not an assertion that refs never move |
| `main.branch/sha` | Main at that observation |
| `recovery.branch/sha` | Immutable safety branch and exact preserved commit; not a merge candidate |
| `bounded_review.branch/sha` | Exact bounded review artifact at that observation, not owner acceptance |
| `bounded_review.base_branch/base_sha` | Must equal the recorded recovery; this is the meaningful bounded diff base |

There are no task/status/acceptance/gate-outcome fields in these observations. Task ID, checkpoint, status, owner acceptance and normative references remain in the existing task record. CI conclusions are read from GitHub for the exact SHA, never manufactured from an observation.

Before writes, fetch main and the recorded refs, verify current GitHub heads and exact-SHA CI, and distinguish any movement from the recorded snapshot. Verify the historical merge base and that recovery is an ancestor of the bounded review. A new commit on main does not silently integrate recovery; a new bounded review commit does not become the task's main HEAD. An immutable recovery ref moving is an integrity failure to investigate.

The validator checks the versioned shape, dated observation, full SHAs, role/branch boundaries, null unified HEAD and exact recovery base. It also treats the recovery/review refs as product branches for the canonical-copy check: they cannot edit execution state to authorize themselves. The schema check alone is not evidence of remote freshness or Git ancestry; those are part of the explicit GitHub snapshot receipt.

Both lane and targeted agent contexts label these values as recorded observations, show all three refs, and require a fresh fetch. They never label the historical baseline as the current Learning HEAD. Existing schemas 1.0/1.1 and accepted historical records retain their behavior. Full semantic integration, selecting a new slice, owner acceptance, merge and deployment remain separate decisions.

## Test catalog source under direct_main

`validate_test_catalog.py` selects main as its test-source ref in direct_main, independently of a legacy optional task.branch. A branch deleted after integration does not erase test availability on main. The selected task ID/status are unchanged. Ancestry and actual command/file validation still determine whether the current checkout can verify the active layer; a checkout behind main explicitly reports that layer as not verified here and confirms the remote source exists. Coordinated mode continues to use the selected task branch. This is source selection, not an unconditional executable-test PASS or acceptance of a merged task.
