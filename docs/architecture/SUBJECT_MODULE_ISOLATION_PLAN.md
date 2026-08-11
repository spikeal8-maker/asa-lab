# ASA Lab subject-module isolation plan

**Status:** plan-only P0 contract
**Scope:** Chess, future Checkers, Electronics, 3D and shared composition roots

## 1. Findings

The current architecture already has useful separation: API `ModuleRegistry`, generic
`ModuleEditorHost`, Project/Draft/Version ownership in Project Core and separate
tenant/RLS-backed `chess_*` live tables.

The enforcement is incomplete:

- ESLint has no explicit `context:electronics` or `context:projects` rule;
- `tools/validate-context-boundaries.mjs` omits Electronics and Projects;
- subject UIs share one `web` Nx project, so Nx cannot stop cross-subject UI imports;
- API registry, web editor-loader map and database module-key allowlist may drift;
- synchronous `provider.analyse()` is unsuitable for Stockfish/Game Review jobs.

## 2. Target dependency layout

```text
contexts/projects          Project lifecycle only
contexts/classroom         Classroom lifecycle only
packages/module-sdk        subject-neutral contracts only
packages/ui-kit            shared EditorHeader and visual primitives only

contexts/chess             rules, notation, document and local Chess
contexts/chess-live        live games/clocks/ratings; may depend on Chess
contexts/chess-analysis    engine jobs/review; may depend on Chess
contexts/chess-training    puzzles/training; may use public Chess/analysis contracts

contexts/checkers          separate future rules/document/provider
contexts/electronics       Electronics only
contexts/three-d           3D only

modules/chess-web
modules/checkers-web
modules/electronics-web
modules/three-d-web
apps/web                   composition root only
apps/api                   composition root only
```

Allowed directions:

```text
projects/classroom -> module-sdk and shared packages
chess-live -> public chess export
chess-analysis -> public chess export
chess-training -> public chess and analysis contracts
subject web module -> its own context plus ui-kit
apps/web and apps/api -> public subject entries
```

Forbidden directions:

```text
chess <-> checkers
chess <-> electronics
chess <-> three-d
projects/classroom -> any subject context
one subject UI -> another subject UI
deep imports outside declared package exports
domain code -> React, Nest, Fastify or PostgreSQL
```

There is no generic shared board-game domain. Only proven presentation primitives may
later move to `ui-kit`.

## 3. Boundary hardening

- discover every `contexts/*/project.json` automatically;
- fail when a new context has no declared boundary policy;
- add `context:projects`, `context:electronics`, `context:checkers`,
  `context:chess-analysis` and `context:chess-training` rules;
- add negative fixtures for every forbidden dependency;
- keep one explicit positive dependency: `chess-live -> @asa-lab/chess` through the
  public export;
- verify package `exports` and reject deep imports;
- preserve lazy loading for unopened subject editors.

## 4. Registry and routing parity

Tests must prove:

- active API module keys exactly equal active web editor-loader keys;
- every active module has one provider and one lazy UI loader;
- no duplicate module key, project type, editor route or viewer route;
- future Checkers may be discoverable but not creatable until active;
- unknown modules use the generic unavailable state;
- adding Checkers changes no Project or Classroom domain file;
- the generic project route remains based on `projectId` without subject switches.

The database module-key allowlist must be compared with the controlled active registry
or replaced later by a single first-party module catalogue.

## 5. Data and RLS

Generic documents remain in Project Core. Each subject-owned table requires:

- `tenant_id` and forced RLS using transaction-local `app.tenant_id`;
- tenant-composite foreign keys;
- narrow runtime grants;
- append-only protection for events, results and rating ledgers where applicable;
- two-tenant positive/negative integration tests.

Future Checkers tables use `checkers_*` names and never reuse Chess live/rating tables.

## 6. Planned test IDs

```text
TST-MODULE-ISOLATION-001
TST-MODULE-BOUNDARY-NEGATIVES-001
TST-MODULE-PUBLIC-EXPORTS-001
TST-MODULE-REGISTRY-PARITY-001
TST-MODULE-ROUTE-PARITY-001
TST-EDITOR-CHROME-CONTRACT-001
TST-ELECTRONICS-HEADER-REGRESSION-001
TST-SUBJECT-UI-LAZY-001
TST-MODULE-DB-ALLOWLIST-001
TST-SUBJECT-RLS-001
TST-CHECKERS-NO-CHESS-DEPENDENCY-001
```

Future gates:

```text
pnpm gate:module-isolation
pnpm gate:module-isolation:data
pnpm gate:module-isolation:browser
```

The first covers boundary negatives, public exports, registry parity, EditorHeader,
Electronics regression, lazy bundles, types and build. The data gate covers migrations,
allowlist parity and cross-tenant RLS. The browser gate opens Electronics, Chess and 3D
independently, verifies the shared header foundation and confirms unopened editors are
not eagerly loaded.

## 7. Governance constraint

This plan must not weaken `pnpm gate:governance`. While the canonical state names active
3D M0, another product branch is intentionally not green. Parallel preparation remains
plan-only until an owner transition names the first executable Chess task.
