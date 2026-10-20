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
