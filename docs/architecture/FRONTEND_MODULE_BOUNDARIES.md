# Frontend module boundaries

## Purpose

ASA Lab has one web application and several independently changing product
surfaces. The Portal must remain available when a subject editor fails, and work
on one subject must not require editing another subject's files.

## Ownership map

| Area | Directory | Owns | Must not own |
| --- | --- | --- | --- |
| Web composition | `apps/web/src/` | session and route composition, lazy editor selection | subject UI, subject domain types, subject bootstrapping |
| Portal | `packages/portal-shell/` | public entry, account, home, projects, classrooms and Portal navigation | Electronics or Chess UI and assets |
| Editor host | `packages/editor-host/` | shared project title, save state, view tabs, brand and user chrome | subject tools, solver controls or component catalogues |
| Shared UI | `packages/ui-kit/` | subject-neutral icons and primitives | subject state or API calls |
| Web API client | `packages/web-api-client/` | generic HTTP transport and platform resource types | Electronics or Chess documents and results |
| Electronics | `modules/electronics/` | document, simulation, production assets and complete Electronics editor | Portal pages or Chess behavior |
| Chess | `modules/chess/` | chess domain and complete Chess editor | Portal pages or Electronics behavior |
| Chess Live | `modules/chess-live/` | online-chess application and infrastructure | Portal or Electronics behavior |

## Runtime composition

`apps/web/src/main.tsx` mounts the Portal without loading subject assets. The
project route reaches `apps/web/src/modules/ModuleEditorHost.tsx`, which performs
a dynamic import of the selected editor. Each editor has its own loading state
and error boundary. Electronics loads and validates its owner catalogue inside
the Electronics entry point, not during Portal startup.

This creates three independent failure domains:

1. Portal authentication and project navigation;
2. Electronics assets, editor and simulation;
3. Chess and Chess Live.

## Parallel work contract

A Portal change stays in `packages/portal-shell/`. An Electronics change stays
in `modules/electronics/`. A Chess change stays in `modules/chess/` or
`modules/chess-live/`. Those lanes can be developed independently.

Changes to `apps/web/src/modules/ModuleEditorHost.tsx`, `packages/editor-host/`,
`packages/ui-kit/`, `packages/web-api-client/` or shared configuration affect
more than one lane and must be integrated deliberately, not edited concurrently
as part of unrelated feature work.

## Enforced invariants

- Portal source cannot import a subject module.
- Subject editor imports are permitted only in `ModuleEditorHost.tsx` and must
  remain dynamic imports.
- `main.tsx` cannot initialise a subject module.
- The API client cannot define subject document or simulation types.
- Electronics and Chess are `scope:module`, not `scope:core`.
- The editor host and shared UI are `scope:shared` and cannot depend on a subject.
- Project graph, lint boundaries, architecture tests and the custom boundary
  validator must all pass before integration.
