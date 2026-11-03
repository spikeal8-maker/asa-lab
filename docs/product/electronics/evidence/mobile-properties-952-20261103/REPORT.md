# Compact phone component properties — Task952

Dated evidence snapshot, 3 November 2026 (Europe/Moscow). Live execution status
remains in `docs/execution/current.yaml`.

Source `b77a43e0d473cef72bf182b0700f19867f6dbdaa`; isolated transport
`29dc74d49291293341c0ae5d47df705cc01483b6`. Only the temporary workflow and
three-case runner differ; neither temporary file is part of main.

## Result and source boundary

Selected components expose a collapsed 48px phone disclosure. Expanded properties
stay compact and scroll internally; existing editors, validation, controller
commits and history are reused. Selection changes reset the disclosure. Desktop
properties open immediately. Circuit zoom-in/out buttons are hidden on phones,
with actual two-finger zoom/pan retained; desktop controls remain available.
Independent Blockly/palette scaling controls are not removed by this slice.

Phone labels and number/unit editors stack without clipping. Only this task's
new CSS was extracted; the shared `workbench.css` remains byte-identical to the
previous main at 143,648 bytes. The new stylesheet is imported immediately after
it. The hygiene limit and baseline were not changed. Physics, Arduino source,
document schema, dependencies, artwork and server behavior are unchanged.

## Checks and independent review

- [Exact-source General](https://github.com/spikeal8-maker/asa-lab/actions/runs/41542126607):
  all four jobs PASS.
- [Canonical M1 and three native browser journeys](https://github.com/spikeal8-maker/asa-lab/actions/runs/41539218485):
  both jobs PASS, three cases on attempt1/retry0, no skips or flaky outcomes.
- `pnpm gate:electronics-m1`: 1,424 core tests and 1,210 frontend tests PASS;
  another117 qualification adversaries PASS. Literal `NX_SKIP_NX_CACHE=true`;
  72 Nx task invocations ran afresh (1 SDK build, 44 typecheck/dependency tasks,
  27 builds), with cache skipped in every Nx summary.
- Independent product/packaging, final test-source and actual-browser reviews:
  APPROVE. Tests retain120s deadlines, full captions, clipping, native hit,
  persistence and history assertions; no forced input or blind click retry.

| Context | Duration | Whole document checkpoints | PUT / matching200 replies |
| --- | ---: | ---: | ---: |
| Touch/coarse 390×844 | 10.289s | 13/13 | 2/2 |
| Touch/coarse 568×320 | 9.724s | 13/13 | 2/2 |
| Desktop 1536×864 | 6.326s | 5/5 | 2/2 |

Each finishes at680Ω with the intended component selected and zero recorded
errors. Complete expected editor, request, response, saved server and fresh
reopened documents match structurally: types, array order and unknown metadata
are preserved. Object-key insertion order is not treated as corruption. Only the
explicitly authored resistor phase values220/680/681 are allowed in write audits;
negative checks still reject changed types, missing/extra metadata, reordered
arrays and unrelated or invalid values.

Undo/Redo, invalid Escape fold, valid pending681 fold and Undo back to680 pass.
Fresh contexts have origins `[]` and pre-app local/session storage empty.
Selection uses genuine input over painted owner imagery, with the production
foreground component fallback for transparent wire hits; committed selected-ID
and unchanged-document postconditions are mandatory. Stage and target geometry
settle before Fit and selection, including the existing160ms layout transition.

Expanded heights221/844 and121.594/320 remain below half the viewport. The
shelf-open landscape panel is54px high and scrolls internally; native scrollTop
advances0→19, and field probes fit actual ancestor clipping with native ownership.
Portrait needs no scroll at217/217. Screenshots show complete stacked captions,
folded controls, reopened680 and retained desktop controls.

Trusted two-finger moves shrink both viewBox dimensions: width2302.739→1315.851
and height1410.428→805.959 at390; width1124.789→642.737 and
height688.934→393.676 at568. Numeric SVG scale increases. Browser viewport scale
stays1, component positions/transforms and the complete document stay unchanged,
and post-pinch reselection/reopen pass. Genuine touch/coarse identity remains
stable; one CDP input session is retained per page until context closure.

## Limits and operations

This is Chromium touch emulation, not physical-device or OS soft-keyboard proof.
The partial-code landscape screenshot captures a layout transition; settled
partial-code control accessibility is not separately established by that image.
Fullscreen visibility and the complete ordinary editing journeys pass. These
limits are not claims of a reproduced product defect.

No full Electronics strict, real-time performance, release-candidate or owner
acceptance claim. Deployment NOT_RUN; no owner server, local Docker installation,
live database, network, protected artwork, backups or foreign work-in-progress
changed. Fixtures and database work ran only in isolated GitHub Actions.
