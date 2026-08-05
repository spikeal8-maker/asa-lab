# contexts/

Bounded contexts of the Classroom Core. Each context owns its `domain`,
`application`, `infrastructure`, `presentation` and `testing` layers behind a
single public entry point. Classroom Core never imports subject modules, and
subject modules never reach into core internals.

Introduced so far:

| Context | Role |
|---|---|
| `identity` | Accounts, sessions, capabilities |
| `organization` | Workspaces and tenancy |
| `classroom` | Classes and membership |
| `projects` | Module-neutral project lifecycle, drafts and versions |
| `electronics` | Electrical document, netlist and DC simulation kernel |
| `chess` | Chess rules, PGN and bot |
| `chess-live` | Server-authoritative live play protocol |

Still to come, each through its own vertical-slice task: Activities,
Assessment, Module Registry expansion, Billing, Safety & Audit.

Sibling directories `modules/` and `crates/` remain intentionally empty until
their own phases; that is by design and not a sign of missing work here.
