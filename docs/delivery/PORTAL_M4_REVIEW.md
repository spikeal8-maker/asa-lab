# Teacher Portal Milestone 4 — final review package

Task: `TASK-PORTAL-001`  
Issue: `#18`  
Primary PR: `#22`

This document is an implementation aid. The normative scope remains Issue #18 and
`docs/delivery/EXECUTION_MANIFEST.yaml`.

## Required sequence

1. Apply/cherry-pick the Milestone 4 preimplementation after Milestone 3 commit
   `2fe042d`.
2. Run `pnpm graph:report` so the committed Nx graph contains the new context
   tags.
3. Run `pnpm boundaries:check`.
4. Run `pnpm portal:m4:check`.
5. Run the authoritative task gate:

   ```text
   python tools/run_task_tests.py --task TASK-PORTAL-001
   ```

6. Only after `21 PASS / 0 FAIL / 0 BLOCKED / 0 NOT_RUN`, update the map to
   review state and regenerate all evidence.

## Boundary evidence

`TST-BOUNDARY-001` now proves both:

- Nx project-level constraints;
- direct import and domain-layer constraints from
  `tools/validate-context-boundaries.mjs`.

Expected context tags:

```text
identity      context:identity
organization  context:organization
classroom     context:classroom
```

Domain files under `contexts/*/domain/` must not import NestJS, Fastify,
PostgreSQL, React or HTTP transports. A bounded context must not import another
bounded context directly.

Generated local artifact:

```text
reports/context-boundaries.json
```

## Evidence validation

`pnpm portal:m4:check` validates:

- exact 21 test IDs for `TASK-PORTAL-001`;
- current focus and allowed pre-merge task status;
- desktop and mobile screenshots;
- required API/Web/context nodes and API-to-context edges in the committed Nx
  graph;
- presence of Project Map, Quality Map and Nx graph updates in the Portal PR.

Generated local artifact:

```text
reports/portal-m4-evidence.json
```

## Required committed evidence

```text
docs/project-map/project-map.yaml
docs/project-map/PROJECT_MAP.md
docs/project-map/QUALITY_MAP.md
docs/project-map/nx-project-graph.json
e2e/artifacts/portal-desktop.png
e2e/artifacts/portal-mobile.png
```

The map status before merge must be:

```text
TASK-PORTAL-001 = in_review
current_focus = TASK-PORTAL-001
TASK-PROJECT-SHELL-001 = blocked
```

The next task becomes `ready` only in a separate after-merge map transition.

## Final PR report

The PR body and final comment must state:

```text
USER_FLOW:
  site opens: PASS
  teacher login: PASS
  dashboard rendered: PASS
  empty classrooms: PASS
  create classroom: PASS
  classroom visible after reload: PASS
  logout: PASS
  tenant isolation: PASS
  owner membership: PASS
  AuditEvent: PASS
  accessibility: PASS
  automated browser E2E: PASS

PORTS:
  web: 127.0.0.1:4610
  api: 127.0.0.1:4611
  e2e: 127.0.0.1:4612

GATE:
  PASS: 21
  FAIL: 0
  BLOCKED: 0
  NOT_RUN: 0

WORKING_TREE: clean
NEXT_ALLOWED_TASK: none until owner review and merge
```

PR #22 remains Draft. It must not merge automatically and must not start Project
Shell.
