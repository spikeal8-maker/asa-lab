# Canvas annotations 860 — bounded candidate

Canvas text has one document authority: separate schema 5 annotations, shared
project history and clipboard. Existing default/schema 4 bytes and schemas 1–3
migrations remain unchanged. The new layer owns only transient pointer preview;
one completed drag commits once, cancellation commits nothing. Literal React text
preserves markup as text. Existing browser-local NotesPanel remains independent.

The API provider's optional replacement validator is forwarded through Project
Core, with undefined as the only opt-out. The same captured identity/revision is
used for the authorized read and existing atomic CAS. Current format downgrade
and future-base guesses are denied; stale requests preserve replay/conflict
semantics. Callback payloads are detached, malformed/throwing validators fail
closed. No SQL, migration, RLS, deployment or server changes are included.

Before/after gzip files contain the full parser/digest/numerical oracle: 13 cases,
19,716 raw bytes, identical SHA256
`50feaa528eaf2c655732396f69226ef157bb2bf01e41f1db0b503cc7505bc743`.
The before oracle was recorded on ee867abe before production edits and published
in artifact-only d3098d83. The canonical empty/default document remains version 4;
version 5 is explicit and sticky after adding, undoing or deleting annotations.
Once version 5 is stored, use a forward fix preserving its format; rolling back
to an old unguarded writer can silently erase annotations.

The native production editor/hook/Worker script is
`apps/web/src/electronics/testing/canvas-annotations.browser.mjs`. Its 1440/390
journeys cover add/edit/font/resize, mouse and trusted touch movement, natural
object keyboard nudge/copy/delete/paste, textarea Delete isolation, one-step
drag Undo/Redo, Escape rollback, literal hostile markup, later component copy
replacing annotation clipboard, independent old NotesPanel and JSON save/reopen.
During Run a real Worker advance response is held, annotation edits are saved
through the toolbar with canonical parser/real analysis response, then the held
ACK is released: generation and electrical digest remain unchanged, the horizon
is accepted and Serial sequences continue. Arduino source survives reload.
The screenshots and native receipt are durable evidence of that fixture run.

Fixture save/reopen is **not installed API SaveCAS evidence**. Actual restricted
PostgreSQL tests were added to the existing isolated CI suite
`tests/capacity/prepared-draft-save.pg.spec.ts`; local DB/Docker were not used.
Independent review and exact-SHA CI/canonical gate are separate acceptance steps.
This candidate does not claim owner acceptance or deployment.
