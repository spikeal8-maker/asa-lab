---
task_id: TASK-ELECTRONICS-BLOCK-MOUNT-PRESERVATION-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Preserve saved Blockly programs on opening

Issue [865](https://github.com/spikeal8-maker/asa-lab/issues/865), bounded
compatibility prerequisite for automatic waits #864. Execution state lives only
in `docs/execution/current.yaml`.

## Resumption after approved resize refactoring — 30 October 2026

Owner's request to finish prepared work remains active; the new explicit
refactoring request produced accepted876 in main3b8e6e6ac, independently reviewed,
with all4 General jobs successful at exact84e4acc1. Arduino was actually measured
at1998988/2000000, preserving the fixed cap. This supersedes only the earlier
budget deferral: it does not accept old46d388c or infer additive fit.

Recompose only the useful saved-state reader/loading-event changes of preserved
46d388c against current main, retaining876 and every foreign change. Product
scope remains ArduinoCodePanel.tsx, arduino-program-state.ts and focused tests;
no wait policy or runtime changes. Preserve old candidate/BEFORE branches.
First run one actual current build/all8caps; stop on failure without adjacent
cleanup. Then qualify the original six no-edit mounts plus genuine edit/export/
reopen and empty/corrupt/new-program behavior using actual Blockly/UI events.
Record exact current baseline; reuse original16 fixture oracles unchanged and
confirm the defect still exists before applying a fix. No new heavy baseline
build is needed solely to repeat a historical measurement.

Mirror877 strict qualification continues remotely on its frozen source. This
865 author may prepare and publish a candidate, but no new product integration
ahead of the mirror dependency review: controller owns integration order.
Fresh independent source/native review precedes one unchanged-SHA uncached
canonical gate and final review. No server/foreign/protected asset change.

Published BEFORE `8fd7f251233c359d77935f556197807991d476c8` contains 16 fixtures
and six actual desktop/mobile mounts. All six replace saved source and XML
without an edit; valid empty and corrupt XML can become Blink. Inspect
`reports/arduino-auto-wait-864/before/README.md` in that published branch.

## Required behavior

Opening, mounting, remounting, mode switching and no-edit reopening preserve
saved source and raw workspace exactly, including comments, CRLF, explicit empty
XML and absent future policy. Loading events queued by Blockly are not user
edits. Corrupt saved XML must not silently become Blink or overwrite source;
use a clear existing error path or a minimal explicit recovery indication.
Genuine newly created/default programs must still initialize correctly, and
genuine Blockly edits must publish coherent source/workspace and persist them.
Do not infer creation provenance from dates or overwrite saved text C++.

Inspect the mount, reader and persistence callbacks and propose the minimal
repair before editing. Keep genuine edit, Undo/Redo, block drag/drop, source
display, export, mode switch and save/reopen behavior working. Cover queued
initial events and the existing debounced callbacks. This repair adds no wait
policy, runtime timing changes, document migration or unrelated refactoring.

## Proof and delivery

Reuse published BEFORE without weakening its six cases; add focused regression
tests for the actual cause. Native actions at 1440/390 must show exact no-edit
preservation, empty/corrupt handling and genuine edit/export/reopen consistency.
Do not claim installed saving from an isolated fixture. Preserve failed attempts.

Candidate build and all fixed caps first: Arduino 1,999,925/2,000,000 bytes,
Editor 187,873/222,000. No cap increases, dummy imports or unrelated extraction.
Freeze and publish candidate, run one uncached canonical electronics gate and
fresh independent exact-SHA review. Root controller owns execution metadata.
No server, Docker, live DB, deployment, protected assets or foreign edits.
