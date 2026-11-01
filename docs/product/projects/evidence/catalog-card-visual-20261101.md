# Owner-reference catalog card layout — 2026-11-01

## Bounded result

L0_LOCAL_UI; only public catalog DOM/CSS and regression checks. Square rounded
image-led cards, current public author top-left with explicitly decorative initials
fallback (catalog API exposes no public avatar), minimal unboxed module top-right,
real likes over preview, and only a compact pale-blue title strip below. Complete
title/name retained in native tooltips. Publication date with year appears top-left
below identity on pointer hover or keyboard focus; touch devices show it directly.
Engineering previews remain object-fit:contain to avoid cropping circuit/stage data.
No fabricated download total: the API has no such metric and physical export is not
implemented. No new API/database/profile projection, private avatar access, Games
changes, player modifications, downloads, permissions or production deployment.

## Local evidence and self-review

- Five component tests PASS, including identity/likes/date inside preview and only
  title in footer; actual immutable navigation and metadata remain covered.
- ESLint PASS for changed TS/TSX (existing uncached Nx graph warning recorded).
- Isolated actual React component DOM rendered with three existing public catalog
  records, using production public image endpoints, current CSS and minimal shell.
  Native Chromium checks PASS at1440/1024/390/320: square/flush cover-footer,
  author/module separation, transparent module background, page overflow absent,
  hover/focus date. This is component-level visual evidence, NOT a deployed site
  or complete built application acceptance. No production data written.
- Screenshots and receipt: F:/Asa-Lab/operations/reports/catalog-card-20261101/
  catalog-{1440,1024,390,320}.png, card.png, visual-checks.json.
- Controller visually inspected390 and enlarged actual card. Long public name is
  ellipsized with full native tooltip. Module gets reserved width rather than
  shrinking into an unreadable fragment; mobile electronics label is compact
  «Схемы», retaining full «Электроника» in accessible text and native tooltip.
  An additional native touch390 check confirms date visible without hover.
- Temporary local rendering harness removed; evidence retained outside repository.
- Existing built-browser seven-width journey now checks square card, no empty
  footer rows, author/module placement, likes bounds and hover/keyboard date.
  Its CI result is pending, not declared PASS.

LAYOUT_IMPACT: catalog card only; unchanged shared preview rules/detail page,
owner dialogs and player. Card-specific preview rule retains contain geometry.
CHANGE_CLASS: L0_LOCAL_UI
AUTHORITY_IMPACT: none
STATE_IMPACT: none
VIEWPORTS:1440/1024/390/320 isolated component PASS; built seven-width gate pending
VISUAL_EVIDENCE: local paths above, isolated component explicitly labelled
DOC_DRIFT: none; missing API avatar/download metrics explicitly recorded
UNVERIFIED: complete built-app CI; owner acceptance; deployed visual
VERDICT: local surface PASS; not a release/deployment acceptance
