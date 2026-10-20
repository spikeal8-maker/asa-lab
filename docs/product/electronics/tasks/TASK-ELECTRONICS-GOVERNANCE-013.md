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


## Technical dispatch completion observed 2026-10-20

Remote helper source `726c5cb8d7cd058df3c3b52c34794148bc240cf5`, tree
`6cbd26ccfe56d1989539667f215cd323010c0e3d`, workflow blob
`a961935f755b23defe7e2e6e29edc13061ae6e3f`, SHA256
`a21a4ef5292bb9509776f8c93474ae7515d2c361b533159c997e8b5f16745dec`.
Author62 offline checks passed and the independent core security review approved.
Actual helper run `39455436882`, job `118740956225`, succeeded: exactly one
HTTP204 at `2026-10-20T16:12:59.319567Z`, prior matching runs0.

Independent API/log review verified actual target run `39455455432`, created
`2026-10-20T16:12:59Z`: repository `spikeal8-maker/asa-lab`,
workflow ID326529119/path `.github/workflows/electronics-r4-m1-focused.yml`,
event `workflow_dispatch`, attempt1, profile `classroom-d13-v3`, target branch
`codex/electronics-classroom-d2-d4-649`, head
`793fc599b2a2f0182147b06e0650c51fe386a993`, tree
`4b3c71c3d151eb79fb6495919278d3148e7aeeb6`. Target is still **in_progress**
at this dated observation, not qualification PASS.

Only this transport/control task is technically complete; owner acceptance stays
pending. Active task PR remains null. Temporary helper receipt PR665 was
independently verified CLOSED_UNMERGED at `2026-10-20T16:13:59Z`; retain its
branch/source and NEVER merge, reopen, rerun or reuse the helper. No second POST.
Root may close Issue664 after reviewed controller publication; this author does
not change the Issue. No D2/FET state, gate, blocker or acceptance is changed.
Fresh product results and native acceptance remain separate. STOP.
