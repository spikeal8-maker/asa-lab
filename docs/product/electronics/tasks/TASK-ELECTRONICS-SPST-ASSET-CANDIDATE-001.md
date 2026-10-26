---
task_id: TASK-ELECTRONICS-SPST-ASSET-CANDIDATE-001
kind: implementation
risk: low
semantic_change: no
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Two-terminal switch derived from the existing owner SPDT

## Superseding owner correction

Owner rejected the independently drawn rocker: use the existing owner switch,
remove ONE OUTER leg, keep the centre leg and the rest of the appearance.
This is explicit authorization to derive a new two-terminal asset from the
confirmed owner SVG. Keep original three-terminal SPDT files untouched. Choose
right outer removal: retain left6.46 and common9.00, remove right11.54.
Derive BOTH existing left/right state SVGs by removing only the right leg and
adjusting nonvisual identity/pin-count metadata. No new drawing or geometry.

Original rocker files remain historical rejected candidate: mark README and
external pinmap status rejected, do not enable or present it as pending approval.
New derived files belong in candidates/spst-from-spdt/ with parent SHA hashes,
exact removal recipe, two-terminal map and reproducible original/derived preview.
Verify all retained drawing nodes, body/viewBox/slider positions and two pins
unchanged, protected source hashes identical. User's recipe is authorization;
do not repeat an approval question for an exact verified derivation. Actual
SPST electrical model still needs a separately selected implementation: two
external terminals, closed left/open right, not a hidden third simulated pin.

The original brief below records why the rejected candidate was prepared; it
does not override this owner correction or authorize further independent art.

Consolidated38 prerequisite only. Existing owner manifests prove three-terminal
SPDT and momentary tactile buttons, not a confirmed latched two-terminal SPST.
AGENTS permits new independent SVG, but component without confirmed owner SVG
remains disabled/missing. Prepare a concrete original candidate for owner's
design confirmation; do not enable, register or claim completed SPST component.

Allowed new files only under docs/product/electronics/candidates/spst/:
independently authored switch.svg, pin-map.json and short provenance/preview
instructions. Simple generic physical two-terminal latched rocker/toggle, no
brand, copied paths, tracing, imitation or edits of protected owner graphics.
Two electrical terminals with stable identifiers/centres, stable body geometry,
distinct on/off lever states, transparent canvas, readable at normal scale.
Declare original ASA candidate provenance, not owner_supplied/exact_owner_svg.
No scripts/events/foreignObject/external resources, no unsafe SVG content.

Produce local PNG side-by-side OFF/ON preview from trusted authored vector and
inspect bothstates/terminalpositions. PNG may remain ignored reproducible review
artifact; preserve it until owner decision. SVG/pinmap must be committed for
review. No application/catalog/model/source/dependency/protected-asset changes.
No approval request before concrete preview; root asks owner after independent
review. Confirmed asset remains an explicit acceptance prerequisite.

No full physics gate for nonproduction candidate. XML/provenance/pin-count and
safe-content checks, actualrender and independent source/image review. Only light
preflight/design while775 ownsCPU; renderer/tests wait explicit controller slot.
No server/Docker/DB/listeningport or other people's changes. One candidate thenSTOP.
