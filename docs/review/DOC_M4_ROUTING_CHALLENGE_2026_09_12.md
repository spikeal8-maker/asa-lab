# DOC-M4 routing challenge review

**Scope:** global maintenance routing, root-router cleanup, delegated Scratch provider.
**Product runtime:** not changed.
**Verdict:** PASS.

## Reviewed result

- Document Registry remains the global authority/status router.
- Identity and Learning keep global compact contracts and targeted Surface Maps.
- Scratch keeps one specialized component map; global routing delegates to it instead of copying it.
- `current.yaml` remains the only live execution state.
- Global `review-protocol.md` remains review authority; Scratch only adds component ownership/risk evidence.

## Adversarial checks

- unsafe or non-compact `delegated_roots` are rejected;
- delegated roots must exist and cannot be duplicated between providers;
- a document outside the exact delegated root remains unregistered;
- a shared source path across bounded contexts fails instead of guessing;
- `docs/agent/...` is not misclassified as an `agent/...` product branch;
- real `agent/...` and `origin/agent/...` branch references are still detected;
- UTF-8 replacement/question-mark corruption in critical governance docs fails validation;
- Scratch AGENT_GUIDE remains below its 9 KB routing budget.

## Evidence

- focused Registry / agent-context / targeted-context / maintenance-doc suites: PASS;
- `node tools/validate-blocks-docs.mjs`: PASS (30 components, 8 subsystem cards);
- Identity targeted routing: PASS;
- Learning targeted routing: PASS;
- Visual Programming delegated routing: PASS;
- full `pnpm gate:governance`: PASS before this receipt was added.

## Explicitly not claimed

- no GitHub push or CI claim;
- no production deployment;
- no product/runtime implementation change;
- Projects/Electronics/3D/Chess/Admin are not declared fully migrated to the global maintenance map;
- Electronics root invariants remain until an equivalent compact authority exists.
