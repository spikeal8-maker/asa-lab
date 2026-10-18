---
task_id: TASK-ELECTRONICS-IDENTIFIER-RECOVERY-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Classroom audit point 2: recover existing invalid identifiers safely

## Goal / authority

Owner selected point 2. Recover old Electronics drafts that cannot save because
copying previously grew identifiers beyond the canonical limit. Publish to main,
report and STOP. No deployment, live database changes or next repair.
GitHub issue: #596; prerequisite copy generation fix: #594.

## Component / contract

Primary: `electronics.persistence.project`; dependency: `electronics.ui.workbench`.
Read `components/ui-assets-persistence.yaml` and `README.md#5-circuitdocument`.
Keep canonical validation, revision compare-and-swap, actor/project storage scope,
all components, wires, breadboard references, sketches and the original draft.

## Expected write paths

- `apps/web/src/electronics/electronics-document-repair.ts`: deterministic bounded
  identifier repair with canonical validation; refuse ambiguous component identities.
- `apps/web/src/electronics/electronics-project-recovery.ts`: verified original
  backups outside the pending-draft namespace and acknowledgement support.
- `apps/web/src/electronics/use-workbench-project-state.ts`: load-time recovery and
  acknowledgement; repaired documents remain dirty until server confirmation.
- `apps/web/vite.config.ts`: put the recovery helpers in a dedicated acyclic chunk
  to retain the existing editor bundle budget without increasing it.
- `apps/web/src/electronics/testing/electronics-document-repair.spec.ts` and
  `apps/web/src/electronics/testing/workbench-project-state.spec.ts`.
- This card, subsystem source/test mapping and selected child lane in current.yaml.

## Acceptance / focused evidence

1. Deterministically replace unambiguous invalid component/wire identifiers and
   references together. Preserve valid IDs, geometry, model properties and code.
   Only repair overlong generated copy names when needed; preserve their originals.
2. Verify a scoped original backup before applying a repair. Storage failure or
   ambiguous IDs must retain the original; never guess wiring or drop objects.
3. Confirmed saves retire the repaired original branch without resurrection after
   reload. Conflicts and account/seat isolation retain their existing semantics.
4. Pure repair/storage and mounted lifecycle tests, existing affected recovery/
   merge/autosave suites, changed-file lint/format, web typecheck/build and one
   independent read-only review of the final source SHA. Report general CI separately.

## Stop

No schema/API relaxation, server bulk migration, Scratch, UI redesign, deployment
or unrelated cleanup. Narrow edits in the existing large controller; no decomposition.
`NEXT_ALLOWED_TASK: STOP / OWNER REVIEW`.

## Implementation evidence, 2026-10-18

- Load repairs unique empty/overlong IDs deterministically, together with wire
  endpoints and breadboard bindings. Valid IDs, geometry, properties and sketches
  remain intact; generated overlong copy labels keep the existing 120-character limit.
- Full original scoped records are backed up and read back before repair is applied.
  Content-addressed backup keys are outside the pending-draft namespace. Storage
  failure and ambiguous component/wire IDs stop opening without rewriting the source.
- Repaired views remain dirty until the existing save protocol confirms them.
  Acknowledgements recognize the repaired original only after preserving its bytes;
  the mounted test confirms later deletions do not resurrect that branch.
- Conflict recovery retains the actual original base snapshot and revision, including
  invalid legacy bases; no validation or compare-and-swap contract is weakened.
- Final repair/storage and mounted lifecycle suites: 64 PASS. Affected existing
  recovery/merge/autosave regressions: 23 PASS. Total relevant cases: 87 PASS.
  These are local fixtures with a mocked API, not real browser/PostgreSQL evidence.
- Changed-file ESLint, web TypeScript and formatting: PASS. Routing validation: PASS.
- Web build: PASS, six tasks executed with Nx cache skipped. Bundle budgets: PASS;
  Electronics editor 208464/209000 bytes; initial JS/CSS graph 471403/600000 bytes.
  An initial chunk split pulled shared CommonJS interop into the recovery bundle;
  isolating that shared runtime/storage fixed eager engine loading without raising budgets.
- SELF_REVIEW: PASS. Four production files, two focused test files, mapped metadata;
  no DOM/CSS, permission, schema, server/database, solver, production or Scratch change.
- The final source SHA, independent review and exact-SHA general CI outcome are
  recorded in issue #596 and the owner report after they actually complete.
