# Scratch task cards

This directory contains **small executable cards**, one selected implementation slice per file.

Rules:

```text
current.yaml + owner instruction selects the task
→ read only that task card
→ resolve its component IDs in ../COMPONENT_MAP.yaml
→ read only mapped canonical contracts/source/tests
→ implement one slice
→ bounded self-review
→ STOP
```

A task card is not a work queue and does not authorise itself.

Current cards:

```text
VSCR-M1-001.md   bounded-context extraction
VSCR-M1-002.md   ASA-owned Scratch host and iframe skeleton
```

Later M1 cards are created/refined only when their prerequisites are accepted. This is
intentional: do not freeze speculative source paths or APIs before preceding interfaces exist.

The older consolidated `VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md` is historical planning
material for the first wave. When an exact task card exists here, this directory card is the
default implementation instruction for that task.

For a post-implementation maintenance change that is not a milestone package, use
`MAINTENANCE_TASK_TEMPLATE.md` together with the component map.
