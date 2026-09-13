# Visual Programming / Scratch — agent router

Execution state: `pnpm agent:context --scope visual-programming` reads
`docs/execution/current.yaml`. Product work starts only after the owner selects it.
Maintenance of existing code/tooling follows the owner's bounded request; it does
not require an extra product milestone. Stop when that request is complete.

## Read only the selected concern

```text
START_HERE_FOR_AI.md
→ this router
→ tasks/<selected-task>.md
→ the named component entry in components/*.yaml
→ the mapped D0 heading
→ source + tests
```

Task cards link directly to their components. `COMPONENT_MAP.yaml` is a lookup by
keyword when the component is unknown, not another mandatory read. Load one direct
dependency only when the task needs its interface. Master, ADR, AGENT_GUIDE, roadmap,
all D0 and all component cards are reference material, never a default reading list.

## Checks

```bash
pnpm gate:blocks             # Scratch source, protocol, types, boundaries and docs
pnpm gate:blocks --browser   # existing standalone runtime on 127.0.0.1:4613
pnpm gate:blocks --docs      # routing and document format only
pnpm gate:blocks --list      # inspect the complete command list
```

The cumulative runner is `tools/blocks/gate.mjs`. Extend it when a slice adds tests;
do not add task-specific root scripts. Full API/Web integration stays in
`pnpm gate:repository`. Shared package/lockfile changes still trigger other affected
focused workflows. Scratch-only source/tooling changes do not need those files.

## References when needed

| Question                          | Source                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| Next product capability/readiness | `VSCR-M1-FORWARD-PLAN-2026-09-11.md`                            |
| Ownership/review guidance         | `AGENT_GUIDE.md`                                                |
| Unknown component                 | `COMPONENT_MAP.yaml`                                            |
| Product goal                      | `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`              |
| Architecture decision             | `../../architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md` |

Preserve the exact upstream pin and accepted parent/iframe boundary. Scratch GUI/VM
stays outside `apps/web` dependencies. New upstream patches require an explicit
reviewed decision. Source/test moves update the owning component entry in the same
change. Deployment and activation require separate owner instruction.
