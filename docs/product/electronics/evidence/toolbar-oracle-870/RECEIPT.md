# Bounded desktop header oracle alignment

Original failures were published in87196bee6 before editing the test. The BEFORE
archive retains all23 available geometry/context/PNG files from the four failing
compact-controls cases, with raw hashes and source/run provenance. No artifact
download or full-suite reproduction was needed.

Only two old header expectations change: all four desktop boundary widths expect
48px, and breadboard expects16 controls. A new identity assertion requires exactly
one `Добавить текст на схему` control. Schematic8 and BOM6 remain unchanged.
Reversing precisely these three edits reproduces the original test source byte
for byte after newline normalization. Every other assertion, case, width, state,
timeout, native action and Code/persistence journey is preserved. The canonical
coverage generator changes only browserEvidenceSha256.

The dedicated native witness reuses868's actual WorkbenchHeader, speed control,
clock and SimulationPacing imports. It loads both production stylesheets,
including the application box-sizing reset; no toolbar geometry override is used.
All16 legal states PASS: four widths1180/1181/1373/1374 times stopped breadboard,
running breadboard, stopped schematic and stopped BOM. Heights are48px, counts
are16/8/6, text-tool identity is present exactly once in breadboard, and running
clock text retains its full prefix and time. Raw JSON and16 PNGs are archived.
The1180 running screenshot was visually inspected. This fixture establishes the
two header oracle fields; it does not establish full Code/persistence journeys.

Targeted ESLint, Prettier, exact source reversal, diff check and Playwright
discovery of all four targeted cases PASS. The fifth mobile segment remains
discoverable and unchanged. Canonical focused gate is recorded separately after
candidate freeze. Full journeys NOT_RUN; no release or owner acceptance claim.
No production, workflow, dependencies, server, Docker, ports or database changes.
Foreign report directories remain preserved and unstaged.
