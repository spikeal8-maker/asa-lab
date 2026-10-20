---
task_id: TASK-ELECTRONICS-GOVERNANCE-013
kind: maintenance
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Exact reviewed remote PR652 SHA and tree bound before selection publication
  - Controller selection accepted on main before helper authoring
acceptance_boundary: slice
review: independent
---

# One fixed cloud dispatch for D2 classroom qualification

Issue664 supports Issue649 / programme452. Owner-authorised cloud orchestration
only; no product, gate, profile or acceptance-rule change. This prospective
selection must be independently reviewed and published on main before helper
authoring. Exact remote Draft PR652 source was reviewed APPROVE with zero
findings; cloud CI is starting, not a qualification result.

## Target and sole helper

Repository `spikeal8-maker/asa-lab`, PR652, branch
`codex/electronics-classroom-d2-d4-649`, exact head
`793fc599b2a2f0182147b06e0650c51fe386a993`, tree
`4b3c71c3d151eb79fb6495919278d3148e7aeeb6`. Hard-code and reverify this remote
identity before POST. Request only existing
`electronics-r4-m1-focused.yml` (workflow ID326529119),
`qualification_profile=classroom-d13-v3`; preserve its target-branch50min budget.
POST the target branch, never the helper branch. No external input or PR-body
content may choose repository, URL, ref, SHA, workflow or request data.

Root assigns `/root/pr651_intake` as sole author of
`.github/workflows/electronics-d2-qualification-dispatch.yml` on temporary branch
`codex/electronics-d2-qualification-dispatch-664`; `/root/core_baseline`
independently reviews security; root alone integrates controller documents.
Workflow stays under existing global shared scope and NEVER enters main or
production. Existing GOV012 remains done; PR663 is never reopened or rerun.

## Bounded authority and fail-closed receipt

Only automatic `pull_request.opened` on exact own path, exact same repository
and helper branch, non-fork head, `run_attempt == 1`; no synchronize/reopened,
`workflow_dispatch` helper trigger or `pull_request_target`. Root checks the
actual helper HEAD equals frozen reviewed source before opening the PR; record
actual helper PR number/head afterwards, without impossible self-referential
SHA or preknown PR-number requirements. Finite job:5min.

Only `actions: write` and `contents: read`. Actions write is repository-wide,
not workflow-scoped: independently challenge each request path/method/token use.
Use unauthenticated public PR reads; authenticated reads stay on fixed reviewed
same-repository API paths. Reject redirects for EVERY request, including one
fixed dispatch POST. Never forward/log token or signed URL. No checkout,
artifact execution, arbitrary requests, external actions without immutable pins,
app stack, ports, working database, secrets, retry or dispatch loop.

Verify exact target PR/head/branch/repository/workflow and fail closed if a prior
matching classroom dispatch exists or the prior-run listing is ambiguous or
incomplete. Repeat final identity/prior-run checks immediately before exactly
ONE POST. Wrong SHA, branch movement, uncertain POST or ambiguous receipt means
STOP, never retry/rebind. HTTP204 alone is not qualification evidence. Root and
reviewer read-only verify the actual target run's repository/workflow/event,
branch/head/profile/run_attempt1 and retain receipt; race or mismatch cannot
close this task. No second POST while resolving missing results.

## Checks and stop

Require syntax/security review and meaningful wrong-repo/fork/PR/branch/SHA/
attempt/redirect/prior-run/race/single-POST negative checks, task routing and
control-plane validation. Product qualification uses only existing isolated
cloud test containers and unchanged commands. Preserve all foreign source,
lanes, blockers, counters, leases, GOV012 completion, FET strict hold and R27 rule.

Close only Issue664's transport/control task after verified dispatch identity.
Never merge the helper; retain source and target hashes and close helper PR
unmerged after use. D2 full classroom/native/strict evidence and independent
acceptance remain required separately. No product PASS, Issue649 closure,
blocker removal, deployment or owner acceptance follows from dispatch. STOP.
