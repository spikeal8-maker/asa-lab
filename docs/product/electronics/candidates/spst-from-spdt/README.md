# Owner-authorized two-terminal derivative

This follows the superseding owner correction in TASK-ELECTRONICS-SPST-ASSET-CANDIDATE-001:
use the existing switch appearance and remove one outer leg while retaining the
centre leg. The right outer leg was selected. This is an authorized derivative
of the supplied owner SVG, not independently drawn artwork or an unchanged
`exact_owner_svg`. No repeated design approval is requested for this exact recipe.
Original protected files remain untouched.

`pin-map.json` records both parent paths and SHA256 hashes. Both states retain the
left contact at (6.46,9) and common at (9,9). Remove only the metal rectangle with
x=11.14, y=5.75, width=0.80, height=3.55, rx=0.30 (centre x=11.54).
The housing, slider positions, gradients, viewBox and every remaining drawing
node/attribute are unchanged. Only title/description and the existing pin-centre
comment may change to identify the two-terminal derivative. New SVGs have LF
line endings. Terminal identity is external metadata; no IDs are injected into
retained drawing elements.

Left is intended closed between left/common; right is intended open. This is an
asset-stage contract, not an enabled component or completed simulation model.
A later selected implementation must have exactly two simulated terminals, with
no hidden third node. The old independent rocker is rejected historical artwork.

## Reproduce and verify

No installation or server is needed. Run from the repository root with Node:

```powershell
node docs/product/electronics/candidates/spst-from-spdt/verify-preview.mjs
```

This verifies both protected owner-supplied and owner-audit hashes, the exact
removal, complete retained drawing equality and two remaining metal legs. To
regenerate only the new derivative files, add `--write`. To reproduce the paired
original/derived PNG for both states, use an already available `sharp` package
(set NODE_PATH to the bundled package directory if needed):

```powershell
node docs/product/electronics/candidates/spst-from-spdt/verify-preview.mjs --render C:\Users\spike\.codex\tmp\spst-owner-derived-777
```

The output is `original-derived-both-states.png` plus four transparent individual
PNGs. Keep these local review artifacts until the task closes. No owner original,
production catalog, application source or electrical model is changed here.
