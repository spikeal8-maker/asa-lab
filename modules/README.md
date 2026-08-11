# modules/

Subject workspaces connected through the versioned Module SDK.

- `electronics/` owns the Electronics document, solver, assets and editor UI.
- `chess/` owns chess rules and the Chess editor UI.
- `chess-live/` owns online chess application and infrastructure code.

The Portal does not import these directories. The web composition root loads a
module editor only after a user opens the matching project. Modules never receive
direct access to Classroom Core tables and never import core internals.

See `docs/architecture/FRONTEND_MODULE_BOUNDARIES.md` for file ownership and the
parallel-work rules.
