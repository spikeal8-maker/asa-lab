---
task_id: TASK-ELECTRONICS-GOVERNANCE-012
kind: maintenance
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Controller selection accepted on main before helper authoring
  - Exact remote PR660 branch and source identity fixed before dispatch
acceptance_boundary: slice
review: independent
---

# One cloud dispatch of the existing classroom qualification

Issue662 supports Issue658 / programme452. The owner authorised cloud resources
and separate authors/reviewers. This temporary transport helper requests an
already selected gate; it changes no product, gate, profile or acceptance rule.

## Fixed target

Repository `spikeal8-maker/asa-lab`, PR660, branch
`codex/electronics-core-fet-658`, head
`e826794c1cb4aec1280630040f2652272b3d5de1`, tree
`5e162fa4744feabe7845c87556a744fe4ff27f7b`.
Dispatch only existing `electronics-r4-m1-focused.yml` with
`qualification_profile=classroom-d13-v3`. No substitute ref, workflow or input.
The POST ref is the fixed target branch, never the helper branch. No external
inputs or PR-body content may choose its URL, ref, SHA or request data.

## Bounded helper and authority

After main accepts selection, `/root/pr651_intake` authors only
`.github/workflows/electronics-qualification-dispatch.yml` on temporary branch
`codex/electronics-qualification-dispatch-662`. `/root/core_baseline` reviews
security independently; `/root` is sole integrator. Existing workflow shared-path
authority remains intact. Only the controller edits this card/own lane.

The helper never enters main/production. Trigger only the `pull_request.opened`
event for its exact own path, guarded by exact repository/helper branch,
same-repository non-fork head and `run_attempt == 1`. No synchronize, reopened or
other repeat trigger. Bind/check target PR660, target branch and
head again immediately before POST. No `pull_request_target`, checkout, artifact
execution, app stack, ports, database, secrets, retries or loops. Finite job: 5 min.

Permissions are only `actions: write` and `contents: read`. Actions write is a
repository-wide capability, not workflow-scoped: the reviewer must challenge
every token use, URL, method and branch/head guard. Permit one fixed GitHub API
dispatch POST only; reject redirects and arbitrary destinations/methods. Never
forward or log the token. Pin any external action to a reviewed immutable revision.
This elevated task is separate from GOV011's read-only transport authority.

Root verifies the actual helper HEAD against the frozen reviewed source before
opening its triggering same-repository PR. Record the actual helper PR number and
head after creation; no unknowable PR-number or self-referential SHA guard is
required before the opened event. Exactly one dispatch request is allowed.
A 204 response proves receipt, not a qualification
run or PASS. Verify the resulting actual workflow run's repository, workflow,
event, branch and head against the fixed target and retain the binding receipt.
Branch movement, wrong SHA, ambiguous/missing result or dispatch uncertainty
fails closed: no retry or automatic rebind. Root resolves pending evidence through
read-only inspection; do not call POST again.

## Verification and stop

Check syntax, single-POST control flow, permissions and wrong-repo/fork/PR/branch/
SHA/attempt/redirect/race negatives; task routing, control plane and independent
security review are required. Existing FET/D2/PR651/R27 state, counters, blockers,
commands and all programme gates remain unchanged. No workflow/runtime edit is
part of this selection commit.
The target uses only its existing isolated cloud test containers; this grants no
working-database or production installation action.

Never merge the helper into main. Close only this dispatch task after a verified
target-run receipt. The target run's fresh results and native evidence retain
their original acceptance requirements; dispatch is not FET or programme PASS.
Author/reviewer STOP; controller continues the programme.


## Technical dispatch completion observed 2026-10-20

Independently reviewed helper source
`d1eb77a692daa3fc923aa47cb52a53e3afcac7e3`, tree
`5518a52afbcfe9580f9823770adeec8507bf1f35`, workflow SHA256
`7e2c444e487cc0fcf3aa30a6cf10d171f4759462fa6c3fedd92ba9d7a7830c6d`
passed62 offline security checks. Helper run `39448724854`, job `118717497697`,
succeeded with exactly one HTTP204 at `2026-10-20T15:28:36Z`.

Root and the independent reviewer verified actual target run `39448747806`:
repository `spikeal8-maker/asa-lab`, workflow ID `326529119`
(`electronics-r4-m1-focused.yml`), event `workflow_dispatch`, branch
`codex/electronics-core-fet-658`, exact head
`e826794c1cb4aec1280630040f2652272b3d5de1`, profile `classroom-d13-v3`,
run_attempt1, created `2026-10-20T15:28:36Z`. At this dated closure observation
(`2026-10-20T15:31:42Z`), the actual target run was **in_progress**. This is a
verified dispatch/run-identity receipt, not a qualification result or native PASS.

Only Issue662's fixed dispatch control task is technically complete; owner
acceptance remains pending. Helper PR663 is closed **unmerged**, branches retained.
Never reopen/rerun it or issue another POST; the helper never enters main.
Fresh target-run results and native evidence remain governed by Issue658's
unchanged acceptance boundary. FET/D2/R27, source history, gates, leases, counters
and every product blocker remain unchanged. STOP.
