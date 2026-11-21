---
task_id: TASK-ELECTRONICS-DIAGNOSTIC-POSITIONS-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Owner23 item5: diagnostics point to the actual Arduino source

Functional correction only; NO refactoring, function/file redistribution or
parser redesign. Not701/Scratch message initialization, not timing682 repair.

Confirmed cause: analyseArduinoSourceSupport guesses setup/loop from the syntax
message then points at the declaration. analyseArduinoProgramSyntax loses source
positions when compile messages are mapped. compileStatements already tracks
instruction lines. Editor revealDiagnostic already consumes start/length/line.

Allowed production scope: contexts/electronics/domain/arduino-program-runtime.ts,
arduino-capabilities.ts beside it, and ArduinoCodePanel.tsx only if needed for
correct location consumption. Supporting focused diagnostics/runtime tests,
one actual editor native fixture and exact routing. No unrelated source edits.

Carry actual original-source start/length/line/column through syntax diagnostics.
Handle first/middle/nested errors, setup/loop/rootless source, repeated identical
statements, comments/strings, LF/CRLF, whitespace and Unicode UTF16 selection.
Structural missing/unmatched delimiters must identify the responsible token or
EOF honestly, not guess by message text. Preserve severity/messages and existing
unsupported/fail-closed behavior; do not accept formerly invalid programs.

No changes to execution rules, valid compiled instructions, clocks, budgets,
fingerprints, persisted runtime-state/schema, cache policy, solver/Worker/API,
dependencies/workflows/assets/server/liveDB. Preserve comment-cleaning output and
accepted grammar; any original-source mapping must not silently change parsing.
Stay in existing files; add only essential location metadata logic.

Verify exact expected source slices/line/column for positive/negative cases and
unchanged valid execution/state. Native1440/390 actual diagnostics click selects
the real token, scrolls to correct line, updates after text edits/mode switches.
Old projects and all4cf/701/14/13/20 behavior remain intact. No guessed positions.

Fresh focused tests/types/build/bundles and gate:electronics-m1 required, plus NEW
independent exact-SHA review. Known Windows corepack.cmd EINVAL is infrastructure:
do not edit foreign runner/tests; use canonical Linux focused CI for that gate.
Keep all caps222000/2000000; if feature cannot fit, report exact measured blocker,
never start unrelated cleanup/refactoring. General/release/installed acceptance
separate; no foreign CI repair/chase. One bounded candidate then STOP.
