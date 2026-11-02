# Project cards and controls — 2026-11-02

Owner-approved final UI: square publication cards; two columns up to 600 px and
four above; avatar always visible, author name on hover/keyboard focus; compact
translucent rounded labels; no vignette or broad white halo. Complete previews
are contained between the overlay controls. The owner-supplied icon sheet is
shared by module filters, creation controls and personal project cards, with
circular SVG clipping and no opaque outer corners. AI and robotics are currently
catalog-only empty categories: publication permissions and API types are unchanged.

Personal cards have compact metadata, rounded corners, and small corner badges.
Learning detail and assessment content remain available. Home shows only the
gear on hover/focus (always reachable on touch), using existing properties,
publication, history and collection dialogs and existing duplicate/status APIs.
Learning action restrictions and duplicate retry idempotency are preserved.
The compact action menu is positioned in viewport bounds rather than clipped
by a horizontal shelf. Escape/outside click/scroll close it.

Shelf arrows are removed. Vertical wheel input scrolls an overflowing shelf
horizontally; at either end it returns to page scrolling. Horizontal gestures,
keyboard arrows, pinch zoom and native touch scrolling are retained.

## Focused validation

Validation performed after fast-forward integration of `3b542f32`:

- Web TypeScript: PASS.
- ESLint on changed TypeScript and publication browser spec: PASS.
- Production Vite web build: PASS (22.12 seconds; chunk-size warnings remain).
- Pointer direction regression using actual Three.js camera projection: PASS.
- Catalog browser checks at 320, 390, 1024, 1440 and 2560 px: square proportions,
  responsive column count, no page overflow, author reveal, circular icon clips,
  real WebGL hover readiness/disposal, empty AI/robotics filters: PASS.
- Home and My Projects menus at 1440, 390 and 320 px: seven icon actions,
  viewport placement, hit testing outside shelf bounds, properties/history
  dialogs and Escape: PASS.
- Isolated command checks: duplicate failure/retry reuses its idempotency key,
  archive/trash payloads are correct, errors are visible, restricted learning
  projects do not expose forbidden actions: PASS.
- Shelf browser checks: wheel in both directions, page scrolling at boundary,
  Ctrl-wheel passthrough, horizontal gestures and keyboard navigation: PASS.

Browser UI checks used the real frontend and WebGL runtime with an explicitly
isolated read-only demo API; command tests intercepted requests in a separate
browser. They are not evidence of database persistence or production acceptance.
The existing PostgreSQL-backed publication browser spec was updated for the
approved square/2-column/icon design, but was not executed in this pass because
the previous disposable PostgreSQL preview instance is absent.

No demo accounts, mock server, test project data, production configuration or
database changes belong to this source change. No deployment was performed.
