# Карта проекта ASA Lab

Source: [`project-map.yaml`](project-map.yaml)  
Execution: [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml)  
State of record: [`../execution/current.yaml`](../execution/current.yaml)

## Current focus

Rendered from the control plane. Do not edit these values here — change
[`current.yaml`](../execution/current.yaml) and re-render, or
`pnpm control-plane:check` will fail.

```text
TASK-ELECTRONICS-M1-001
Issue #63
branch agent/r4-electronics-m1
status in_progress
checkpoint phase_5_asset_separation
execution lease unassigned
```

Returned from `in_review` on 2026-08-05: the general repository gate fails on the
branch head, so no release-candidate claim is currently defensible. See
`blocking` in the control plane.

```mermaid
flowchart LR
  ACCOUNT["Account C1 done"] --> PORTAL["Creator Portal done"]
  PORTAL --> GATE["R3A Electronics Gateway done"]
  GATE --> M1["Electronics M1 in progress"]
  M1 -. owner transition .-> M2["R4-M2 blocked"]
  GATE -. deferred .-> R3B["R3B blocked"]
```

R3A verified the existing server-side Module Registry, manifest/provider
registration, shared Editor Host and module-neutral personal Project lifecycle.
It does not declare full R3 completion; R3B remains blocked/deferred.

Electronics M1 is converging without new features: one fail-closed owner
catalog, one exact runtime SHA, one Compose project and one real-editor owner
flow. The current corrective checkpoint covers ordinary-LED runtime states and
zoom-stable wire/terminal presentation. R4-M2 remains blocked.

Draft persistence is now ordered. The saved indicator is derived from which
document the server is known to hold rather than set by whichever request
happened to finish, so an edit made while a save is in flight can no longer be
reported as saved and then lost by a checkpoint taken straight after it.

The canonical owner runtime assets live in `main`, delivered as their own
reviewable unit rather than inside the product pull request. Membership is the
value of a `runtimePath` key, compared as an exact path. `pnpm assets:check` fails
if a named file is absent, is not an SVG, does not hash to the value recorded
beside it, disagrees between source and runtime hashes, carries embedded raster,
a script or an external reference, escapes the asset root, or if the runtime tree
holds a file the catalog does not name.

## Quality gate

See [`QUALITY_MAP.md`](QUALITY_MAP.md) and
[`../testing/active-task-tests.yaml`](../testing/active-task-tests.yaml).
Only focused tests run before owner visual acceptance; the final full matrix is
intentionally not active.

## Ports

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```
