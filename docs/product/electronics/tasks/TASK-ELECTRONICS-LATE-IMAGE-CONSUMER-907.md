---
task_id: TASK-ELECTRONICS-LATE-IMAGE-CONSUMER-907
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Deliver an existing image recovery failure to a late consumer

Issue907 is a bounded consumer repair for the owner-requested full836 native
qualification. Exact0d489e5e strict41334492559 fails the catalog battery-holder-aa
error badge while Stage error badges pass; before-b4 this case passed.

Verified trace: Stage native errors occur697-699ms, catalog same-asset image
mounts941.4ms without its own error event, current finite recovery fails1501ms.
useOwnerImageHref observes only its own native error; a late mount ignores an
existing recoveredOwnerImages promise or failedOwnerImages cache. Shared quiet
recovery broadcasts successful recovery only. Hook bytes are unchanged before
836; changed mount timing may expose the gap, not proof836 originally created it.

## Selected scope

ProductionComponentVisual.tsx useOwnerImageHref and focused image-consumer tests.
Observe failure of an already existing pending recovery, or an already completed
failed cache, for the currently mounted asset. Do not initiate requests or a new
recovery cycle to obtain this status. Keep unmount/asset-change guards and reject
stale outcomes; preserve successful recovery and existing quiet subscriptions.

Regression: Stage starts finite recovery; catalog mounts later without synthetic
native error; the same promise fails and both show errors with unchanged request
count. Cover already-failed mount, success, unmount, asset change and cleanup.
Preserve image identity, listener ordering, every existing retry budget and all
reviewed836/877/525/902 behavior. No owner asset or original illustration changes.

One separate clean writer; all previous Visual writers stopped. Pure905 test
work is disjoint. Focused causal tests, fixed caps/hygiene, source preservation,
fresh independent review and full combined strict qualification are required.
No core/clock/worker/waveform/workflow/dependency/cap/timeout/server/DB changes.
Report exact evidence and STOP; this does not waive timing failures or close836.
