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
Preserve existing canonical schema4 documents without adding empty fields or
altering bytes; retain the existing schema1..3-to4 migration behavior.
Current parser discards unknown top-level keys, so persistence must explicitly
validate/preserve the new field. Protect against silent loss by older clients:
use the next supported schema5 document when annotations are introduced,
with canonical schema4 still accepted unchanged. Current schema4-only clients
then fail closed instead of dropping comments. Do not reuse legacy schema2.
If an existing versioned extension contract
provides equivalent protection, report the concrete alternative before edits.
No SQL migration, tenant/RLS change or live database action is authorized.

Actual old-client proof found that the old GET/normalization/merge path changes
5 to4 and drops annotations before its accepting parser. Therefore a version
number alone is insufficient. Add an optional module-owned replacement validator
through ModuleProviderV1, ProjectModule and their API adapter. For opted-in
Electronics saves only, bind validation to an authorized current draft revision:
if it matches baseRevision, reject version regressions from stored5 or newer;
if current is newer preserve existing stale-CAS/idempotent replay behavior;
reject a future baseRevision before attempting a write. Existing SQL CAS then
binds the checked state to the write and rejects a concurrent4-to5 race.
Do not add a racy unbound precheck, a global floor for other modules, a module-key
hardcode, row locks or SQL/RLS changes. Absent validator keeps other modules'
behavior/query path unchanged. Throwing/malformed validators fail closed; pass
detached documents and do not permit validator mutation of the saved payload.

This authorizes necessary narrow shared edits in module-sdk, Projects application
ports/SaveDraftUseCase and the existing API module-catalog bridge. Exact paths
were checked for foreign dirty work before approval. Test prepared/unprepared
saves, current/stale/future revision, replay and a controlled real SQL CAS race
in isolated CI, plus refusal preserving stored bytes/revision. Preserve deliberate
RestoreVersion behavior. Keep v5 sticky after annotation deletion/local Undo so
current clients do not send accidental downgrades. Document safe forward-fix/
rollback handling for v5 data; no deployment/restore action is authorized.

Keep the duplicate frontend API type in sync with the domain parser.
`normalizeLoadedDocument()` currently forces version4, while
`electronics-document-merge.ts` compares/reconstructs only old collections and
hardcodes version4. Explicitly preserve notes/version through these paths,
including three-way CAS merge and equality; do not rely on spreads alone.
Do not silently discard declared annotations on a legacy-format input.
Prove
server/module validation plus full document roundtrip, offline/emergency copy,
normalization and history preserve annotations. Do not claim installed Save/CAS
from an in-memory browser API fixture; real API persistence proof belongs in
isolated CI, not a working database or a new local deployment.

Text-only edits must preserve running generation, continuation, Serial and
electrical input digest. Existing electrical digest selects known fields but
includes the document version; normalize only the annotation-only5-to4 distinction.
live-worker structural comparison currently spreads the document and omits only
viewport. Omit annotations and normalize only the supported annotation-only
schema5/4 distinction there. Do not change genuine electrical/source comparisons,
physical equations, clocks, cadence, quality, thermal history or numerical output.

Expected source boundary: domain document type/parser and related tests;
frontend API type, project-state normalization, document equality/CAS merge;
module highest-supported schema metadata if required without changing old defaults;
new cohesive annotation operations/hook/layer; minimal
workbench controller/Stage/Header/CSS integration and shortcut/clipboard routing;
live-worker structural comparison; required component routing and focused tests.
Inspect actual mapped contracts first and report the exact implementation
strategy. No extraction of unrelated old functions or source/bundle cap increase.
Keep new logic in its own cohesive files rather than growing guarded owners.

Proof: add/edit/move/resize/text size/copy/paste/delete and history; old v4,
existing legacy1..3 migrations and newv5 document parse/merge roundtrips;
malicious text as literal text, malformed/excessive data
rejected; unchanged electrical digest/results and live generation through note
edits. Actual browser mouse/keyboard/touch at1440/390, reload through the full
validated document and keep browser-local NotesPanel independent. Show no lost
components/connections/code and no duplicate paste from stale clipboard state.
Focused first, frozen SHA, one uncached canonical electronics gate and all fixed
budgets; new independent exact-SHA review. No server/Docker/ports/deployment,
protected asset edits, foreign changes, broad cleanup or acceptance shortcuts.
