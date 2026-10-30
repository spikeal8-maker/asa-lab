---
task_id: TASK-ELECTRONICS-CANVAS-ANNOTATIONS-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Persisted non-electrical canvas text — remaining requirement 14

Next independent feature in the owner's remaining20 programme after verified
switch/case859. Existing toolbar NotesPanel is browser/session-local: preserve
its contents and behavior. Add a distinct accessible canvas-text action, not an
implicit conversion of those notes. No unrelated refactor or new dependencies.

Create editable text objects with finite world position, box dimensions and font
size. Support selection, mouse/touch move, copy/paste, delete, Undo/Redo and
save/reopen. One drag is one history entry; Escape/pointer cancel restores the
original. Keep the existing one-row toolbar and keyboard/text-editor shortcuts.
Render user text with React text escaping, never innerHTML or uploaded SVG.
Apply bounded IDs, counts, text length, dimensions, font and coordinates.

Annotations are a separate document collection, never electrical components.
Preserve old schema1 documents without adding empty fields or altering bytes.
Current parser discards unknown top-level keys, so persistence must explicitly
validate/preserve the new field. Protect against silent loss by older clients:
prefer a supported new schema2 document only when annotations are introduced,
with schema1 still accepted unchanged. Older schema1-only clients then fail
closed instead of dropping comments. If an existing versioned extension contract
provides equivalent protection, report the concrete alternative before edits.
No SQL migration, tenant/RLS change or live database action is authorized.

Keep the duplicate frontend API type in sync with the domain parser. Prove
server/module validation plus full document roundtrip, offline/emergency copy,
normalization and history preserve annotations. Do not claim installed Save/CAS
from an in-memory browser API fixture; real API persistence proof belongs in
isolated CI, not a working database or a new local deployment.

Text-only edits must preserve running generation, continuation, Serial and
electrical input digest. Existing electrical digest already selects known fields;
live-worker structural comparison currently spreads the document and omits only
viewport. Omit annotations and normalize only the supported annotation-only
schema distinction there. Do not change genuine electrical/source comparisons,
physical equations, clocks, cadence, quality, thermal history or numerical output.

Expected source boundary: domain document type/parser and related tests;
frontend API type; new cohesive annotation operations/hook/layer; minimal
workbench controller/Stage/Header/CSS integration and shortcut/clipboard routing;
live-worker structural comparison; required component routing and focused tests.
Inspect actual mapped contracts first and report the exact implementation
strategy. No extraction of unrelated old functions or source/bundle cap increase.
Keep new logic in its own cohesive files rather than growing guarded owners.

Proof: add/edit/move/resize/text size/copy/paste/delete and history; old v1 and new
document parse roundtrip, malicious text as literal text, malformed/excessive data
rejected; unchanged electrical digest/results and live generation through note
edits. Actual browser mouse/keyboard/touch at1440/390, reload through the full
validated document and keep browser-local NotesPanel independent. Show no lost
components/connections/code and no duplicate paste from stale clipboard state.
Focused first, frozen SHA, one uncached canonical electronics gate and all fixed
budgets; new independent exact-SHA review. No server/Docker/ports/deployment,
protected asset edits, foreign changes, broad cleanup or acceptance shortcuts.
