# Saved Blockly mount preservation 865 completion

Candidate base: `00003a3832383356ac863d838498d65eed714b3d`.
This is a bounded source candidate only, awaiting independent source/native review
and the controller's one unchanged-SHA uncached canonical gate. No main integration,
server, Docker, port, database, runtime timing or automatic-wait changes.

## Change and self-review

Recomposed only the useful hunks of preserved `46d388c04c876546dccf1427b7758e34792d901e`.
The accepted 876 shared resize implementation remains intact. The three product/test
paths are ArduinoCodePanel.tsx, arduino-program-state.ts, arduino-program-state.spec.ts;
two focused native regression scripts accompany the evidence.

Saved programs do not publish on initial load. Load/default/layout operations run
with Blockly events disabled, and FINISHED_LOADING/UI events do not publish. Empty
saved workspaces stay empty. Invalid saved state clears the visible failed workspace
and uses the existing notice callback, without replacing saved source/workspace with
Blink. Default blocks initialize only when all three program metadata keys are absent.
Source-only sketches preserve intentional empty/whitespace text and select text mode.

Genuine events publish source and serialized workspace together. The old 180ms editor
generation debounce was removed, as explicitly approved by the controller: a callback
cannot remain pending across board switch, mode unmount, navigation or disposal.
Parent document/autosave semantics and simulation/runtime timing are unchanged.

Self-review checked the final diff against 876/current base: no whole-file restoration,
no generator changes, no policy fields, no metadata/date heuristics, no assets or caps.

## Verification

- Fresh actual web build: PASS, seven Nx tasks executed with cache skipped.
- All eight existing fixed bundle caps PASS. Arduino **1,999,233/2,000,000** bytes;
  Electronics editor **171,934/222,000**. Full values in caps.log. This does not
  establish fit for any later feature or combined candidate.
- Focused Vitest: **48/48**, five files (reader, persistence, code contract, loops,
  inactive blocks). ESLint, TypeScript and diff whitespace checks PASS.
- Archived original BEFORE script on the current base reproduced **all six source
  and workspace overwrites**, at 1440 and 390. Its fixture definitions are unchanged.
- Final actual Chromium AFTER: original **six no-edit mounts** and their remounts
  preserve source and serialized workspace byte-for-byte after 1s settling. Each
  also switches blocks / blocks-text / text / blocks with exact saved bytes. Saved
  comments and CRLF survive. Empty and corrupt originals never become Blink;
  corrupt has the existing explicit notice. Future wait policy stays absent.
- All **16 original fixture definitions and generated source bytes** match the
  published BEFORE exactly; repeated generation remains identical. See
  oracle-comparison.json and original16-oracles.json. Original raw generated XML
  remains archived; random Blockly IDs make fresh independent XML serializations
  differ, so no assertion was weakened to claim byte identity across new workspaces.
- Additional native genuine-edit journeys at both widths: public read-only renderer
  inspection; native dropdown changes; Undo/Redo; real .ino download; rapid board
  switches; mode changes; callback-props reopen; explicit blank and {} workspace;
  empty/CRLF source-only text; genuinely new default blocks. Source/workspace agree
  with actual Blockly generation/serialization at each edit/Undo/Redo boundary.
  Desktop additionally drags the existing loop through native mouse events.

The final harness uses actual React ArduinoCodePanel and scratch-blocks with the
explicit public updateArduinoProgram fixture adapter. The adapter records/merges
callback properties, and reopening mounts those exact properties. Network assets
are fulfilled in memory; no ports or private React/controller injection are used.
This proves editor callback/export/reopen-props coherence, **not** whole-controller,
backend Save/CAS, installed saving or owner acceptance.

## Preserved diagnostic attempts

The initial six AFTER cases passed before extension. Extension attempts are preserved
in after-attempt*.log: wrong dropdown accessibility role/PowerShell Cyrillic encoding;
mobile field hidden behind scrollbar/zoom controls; and the original hats' overlapping
coordinates producing a legitimate Blockly collision move after Undo that clears Redo.
Public getUndoStack/getRedoStack witnesses are retained in undo-debug files. No Undo
engine repair was made or claimed. The original six no-edit fixtures remain unchanged.
The separate edit fixture starts with explicit nonoverlapping saved positions, and
mobile uses real native horizontal/vertical wheel panning to reveal the field; no
forced clicks or renderer mutations. Source-only DOM textarea newline normalization
was corrected in the assertion only: rendered LF is compared separately while saved
CRLF properties are still required byte-exact. That failed attempt is preserved too.

Commands: see build.log, caps.log, unit.log, lint.log, typecheck.log and native-final.log.
The full canonical gate belongs to the controller after preliminary independent review.
