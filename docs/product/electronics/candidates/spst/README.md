# REJECTED — historical rocker candidate

The owner rejected this independent rocker and requested the existing switch
appearance with one outer leg removed. This SVG and its preserved preview remain
historical audit artifacts only. It is not pending approval and must not be
enabled. See `../spst-from-spdt/` for the owner-authorized replacement.

The original brief below is historical and its pending-confirmation wording is
superseded by this rejection. No further independent artwork is authorized.

---

# Original SPST artwork candidate

This unbranded two-terminal latched panel rocker is original ASA Lab candidate
artwork, authored directly as simple SVG geometry by Codex. No protected owner
artwork, traced raster, third-party path, trademark or external resource is used.
The author dedicates this original candidate artwork to CC0-1.0. Provenance is
`asa_independent_candidate`; it is **not** `owner_supplied` or `exact_owner_svg`.

Owner confirmation of this concrete SVG remains an explicit acceptance blocker.
Nothing here registers or enables a component, establishes owner acceptance,
claims a working electrical model or authorizes production use.

The transparent 96 × 104 drawing has exactly two exposed terminals, A and B.
`pin-map.json` records their invariant centres (30,86) and (66,86). Both states use
the same `fixed-body`; the actuator alone changes tilt. OFF shows O and opens the
contact; ON shows I and latches closed until changed again. These connection
records describe the intended candidate, not an implemented simulation model.
Physical dimensions, breadboard fit and manufacturing tolerances are unverified.

The root displays OFF. To display ON, change only the final `display-state` use
reference from `#state-off` to `#state-on`; do not change the shared geometry.
Both group definitions are static. No animation or executable SVG is included.

## Reproduce the review preview

Use Node with an already available `sharp` package; install nothing into this
repository. Set `NODE_PATH` to the bundled package directory when needed, then:

```powershell
node docs/product/electronics/candidates/spst/preview.mjs C:\Users\spike\.codex\tmp\spst-candidate-777
```

The script renders both states from this exact SVG and writes `off.png`, `on.png`
and the paired `off-on.png` to the absolute output directory. Separate state PNGs
retain transparency; the paired preview uses a light review background and
headings. Preserve the output until the owner decision. The candidate SVG and pin
map, rather than PNG pixels, remain the reviewable source.
