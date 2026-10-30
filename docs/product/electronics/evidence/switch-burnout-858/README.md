# SPST creation and ordinary LED burnout — bounded repair 858

Baseline: `dabcfe06968e7a4d8414a96061a320a85286a898` (product baseline f2ab).
Owner confirmed that the delayed burnout report concerns the ordinary LED.

## Causes and repair

New SPST catalog entries used `state=false/contactState=closed`. Historical
serialization intentionally means true=open/right and false=closed/left.
Only new defaults now use true/open; old documents retain their explicit states.
The placement ghost now carries the catalog state and corresponding right-hand
actuator position. The original SPDT geometry and its default remain unchanged.

The active-actuator CSS excluded SPDT but omitted its two-terminal SPST derivative.
An open SPST has state=true, so it received the blue active glow. Both switches
now retain the same neutral body shadow in either position. Ordinary selection,
keyboard focus, touch and the other component actuator rules remain unchanged.

The LED body subscribed to the native optical observation, while its Stage
diagnostic was rendered from old parent maps. Physical damage therefore darkened
the body before an unrelated parent render finally showed its starburst.
`NativeLedDiagnostic` owns the existing diagnostic fragment and subscribes only
for an ordinary LED. It reads the same observation as the body, including proposed
frames before their existing DOM/image ACK. It does not register a competing ACK,
alter clocks, interpolate failure or trigger whole-Stage/editor reconciliation.
Missing/reset observations suppress old failure maps; healthy overcurrent is
distinct from confirmed damage. RGB/non-LED diagnostics retain their old path.

## Verification

- Original Stage plus a mounted native body and a real 3 V / zero-ohm LED thermal
  result reproduces the missing starburst. The body fault/charred-asset checks
  pass before the burst assertion fails. The exact variant/config/log are saved.
- Current mounted Stage passes with a frozen parent and deliberately stale FAILED
  parent maps. Healthy destructive state has no burst; actual failure paints body
  and burst together, including before ACK. Parent visual reads do not increase.
  Clear/reset and a fresh healthy observation remove the effect without a render.
- Focused suite: **44 tests PASS**. Existing SPST tests retain both saved positions,
  electrical results, deterministic solve, two terminals and runtime isolation.
- Real SchematicEditor/hook/Worker: **1440 and 390 SPST cases PASS**. Newly created
  switch is open with zero current and dark LED; mouse/touch toggle both ways.
  Open/closed and selected/unselected shadows match unchanged SPDT. Preview and
  fixture JSON save/reopen preserve the expected positions.
- Real Worker/hook/Stage ordinary LED overload: **1440 and 390 PASS**. The first
  DOM update observing solver-confirmed failure already contains the fault body
  and starburst at that observation cursor. Stop clears it; fresh Start initially
  shows healthy destructive state without a false burst. Screenshots retained.
- Exact historical diagnostic-fragment versus new-child SSR markup: **six cases
  byte-equal** (resistor, DC motor, RGB × running/stopped). Handlers and geometry
  are preserved in the target fragment.
- ESLint, Web TypeScript, format/diff and task routing PASS before the final gate.
  Stage is **61,463 bytes**, down from 65,613; no source guard or bundle cap raised.

`manifest.json` binds the four product blobs and compressed/raw artifact hashes.
Native receipts were captured before the source commit; the manifest product
blobs bind their tested content. Final gate/review results are recorded separately.

No solver, damage threshold, thermal history, native commit protocol, owner asset,
Arduino code, server, Docker or live database changed. Native API save/reopen is a
fixture JSON roundtrip, not installed Save/CAS, deployment or owner acceptance.
