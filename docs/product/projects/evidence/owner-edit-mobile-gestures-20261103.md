# Publication author controls and mobile viewers — 2026-11-03

## Changes

- Catalog author avatars: 32 px desktop, 28 px mobile; detail avatar: 48 px.
- A private, uncached editor-target lookup resolves only active original owners.
  Migration 0303 checks both publication and project ownership, current owner
  status and immutable Learning provenance; the function is not PUBLIC executable.
  Public catalog/detail/artifact DTOs do not gain source project/principal IDs.
- The author can open the original editor and current publication settings.
  Settings read current private project metadata, not the frozen public snapshot.
  Publishing remains explicit; public revisions and reactions are not rewritten
  by an edit or by this migration. Failed owner lookups offer retry.
- Electronics supports anchored two-finger zoom and two-axis panning, with SVG
  letterboxing and bounded scale. Interactive inputs remain usable; switches and
  potentiometers commit touch taps on release, not on pinch admission. Second
  fingers/cancellation release momentary buttons; remaining fingers cannot turn
  a pinch into an accidental input tap. Viewer changes never save a project.
- Public 3D already had touch routing. Its read-only camera now allows zoom below
  the editor's fixed 35 mm floor for small models, adjusts clipping planes and
  fits portrait viewports. Editor camera limits and editing commands are unchanged.

## Validation

- 78 focused tests passed across API owner access, public page, owner controls,
  electronic scene/playback, viewport math and 3D touch navigation.
- Web/API TypeScript and changed-file ESLint passed. Rebuilt stale local library
  declarations after upstream integration; no unrelated product fixes were made.
- Production web build passed (21.02 seconds; chunk-size warnings remain).
- Chromium mobile emulation with native CDP touch events: real published
  Electronics/3D artifacts rendered by the local frontend; pinch zoom, electronic
  two-axis pan and 3D single-finger orbit passed. Artifacts remained unchanged.
  Owner controls appear only for a positive owner lookup. Browser UI API answers
  were isolated fixtures; production was only read, never edited.
- Added a real-API publication E2E covering original owner, anonymous visitor and
  a different account; extended installed-prefix migration ledgers for 0303.
  This PostgreSQL-backed E2E was not run locally: the disposable database is
  unavailable. GitHub browser/data gates remain the authoritative pending check.

No deployment or live migration is part of this source change.
