---
task_id: TASK-ELECTRONICS-SAVE-VALIDATION-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Point 3: diagnose and repair Electronics draft validation failures

## Goal

Preserve the user's circuit when saving fails; remove stale hole bindings after deleting
a breadboard and return stable safe validation reasons in the existing API and request log.
The old 35 HTTP400 records lack subreasons: do not claim their exact cause is established.

## Component / contract

Primary: `electronics.persistence.project` (cross_boundary, high).
Dependency: `electronics.engine.document`; `README.md#5-circuitdocument`.
Existing Projects validation, revision, mutation identity, permissions and local recovery remain mandatory.

## Bounded paths / justified budget

One persistence repair crosses existing validation interfaces. Exception to the five-file
maintenance default: eleven small production edits are required to carry the same reason
from the parser through the module/provider, Project Core and API into the existing request log.
No new backend, schema, migration, source of truth or retry loop.

- `apps/web/src/electronics/workbench-document.ts`: removeSelectionFromDocument.
- `contexts/electronics/domain/document.ts`, `contexts/electronics/module.ts`: finite reasons.
- `contexts/projects/application/ports.ts`, `project.usecases.ts`: additive reason propagation.
- `apps/api/src/app.module.ts`, `validation.ts`, `projects.controller.ts`: existing validation/API;
  extracting the existing provider adapter avoids importing the whole composition graph in focused tests.
- `apps/api/src/server-diagnostics.ts`, `app.factory.ts`: safe request log metadata.
- Focused changed tests: workbench-document, electronics-save-validation, server-diagnostics.
  Existing workbench-project-state HTTP400 recovery and Project Core tests verify compatibility.
  The API gateway uses an explicit finite exposure allowlist; domain classification stays canonical.
  Shared logging and generic project tests acquire no runtime Electronics dependency.

## Acceptance

1. Reproduce delete-board invalid document before repair; after repair, components and wires
   survive, only removed-board bindings disappear, and canonical validation/save/reopen works.
2. Malformed schema/shape/mutation/document fails with stable safe reason codes, no raw content in logs.
3. Failed saves do not change confirmed revision or destroy the local unsaved document.
4. Exact-SHA focused/general evidence and independent review; classify unrelated CI failures.

## Stop

Point3 only. No409 retry repair, solver changes, telemetry programme expansion, live DB mutation
or deployment. `NEXT_ALLOWED_TASK: STOP / OWNER REVIEW`.

## Implementation evidence (2026-10-15)

- Before repair, the new delete-board regression failed canonical validation because
  surviving components retained bindings to the removed breadboard.
- After repair: workbench-document 16 tests; Electronics API validation 8 tests;
  server-diagnostics 11 tests; existing Projects 34 tests; existing permanent HTTP400
  local recovery case 1 test (42 unrelated cases skipped): PASS.
- The API suite exercises the real parser/provider, composition validation adapter,
  SaveDraftUseCase and controller against an in-memory repository. It is not a real
  PostgreSQL/browser persistence journey. Invalid input makes no write and leaves
  revision unchanged; valid corrected input saves and reopens through that fixture.
- Electronics and Projects builds, changed TypeScript ESLint and Electronics routing
  validator: PASS. Exact published SHA general CI and final independent review are
  recorded in the dated owner delivery report after publication, not preclaimed here.
- SELF_REVIEW: PASS_WITH_RISK. No schema, solver, retry, asset or deployment change.
  Historical HTTP400 subcauses cannot be recovered; new safe reasons start only after
  deploying this code. Production and its database have not been changed.
