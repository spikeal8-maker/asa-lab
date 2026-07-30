# TASK-DOCKER-LINUX-001 — Work Status

Status: `in_progress / bounded baseline preflight authorized / Docker implementation pending`

Canonical references:

- Issue: #69
- Base branch: `assistant/chess-online-core`
- Work branch: `assistant/docker-linux-bootstrap`
- Draft PR: #70
- Frozen product focus: `TASK-ELECTRONICS-SLICE-001`
- Infrastructure focus: `TASK-DOCKER-LINUX-001`
- Activation contract: `docs/delivery/TASK_DOCKER_LINUX_001_ACTIVATION.md`

## Current normative state

- `docs/delivery/INFRASTRUCTURE_EXECUTION_MANIFEST.yaml` is the active infrastructure execution source.
- `docs/project-map/infrastructure-focus.yaml` keeps the product queue frozen without completing or reordering it.
- The activation contract authorizes a bounded baseline-preflight stage.
- Existing mandatory baseline failures may be corrected only under that activation contract.
- New product capabilities remain forbidden.

## Reported workstation state before the correction

```text
WSL2 / Ubuntu 24.04 / Docker Linux backend: ready
Node 22 / pnpm 9.15.9: ready
old synchronized checkpoint: 41355e5de008f4651c56c3481866f52e87497787
six governance validators: PASS
pnpm install --lockfile-only: PASS
pnpm install --frozen-lockfile: PASS
pnpm boundaries:check: PASS
uncommitted generated files:
  pnpm-lock.yaml
  docs/project-map/nx-project-graph.json
```

The local agent correctly stopped because the previous manifest required every
baseline command to pass but did not explicitly authorize corrections for
pre-existing product/shared-code failures. The updated manifest and activation
contract resolve that conflict without changing the frozen product queue.

## Safe continuation

Preserve the two generated local files with a path-limited stash, fast-forward
the branch, restore the stash, rerun governance validators, commit lock/graph,
then perform only the bounded baseline-preflight corrections before Docker
runtime work.

No product capability may be started in this branch. `main`, PR #66 and PR #68
must not be merged or rebased as part of this task. PR #70 remains Draft.
