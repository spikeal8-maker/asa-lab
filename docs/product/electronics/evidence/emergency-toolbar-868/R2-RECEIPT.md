# Nested and long clocks — bounded R2 evidence

Independent review rejected candidate485112b50: a100-hour clock left41.84375px
for tools at320px, and the nested768px clock retained its48px default height
inside a47px toolbar. Four exact reviewer raw receipts and all39 available PNGs
were preserved under `r2-before/` and pushed in1a26ec253 before the R2 source edit.
Their uncompressed raw hashes and source SHA are recorded in provenance.json.
All original and R1 proof remains unchanged.

R2 changes only workbench.css. Mobile clock rules now select both the direct
clock and the clock nested in the actual speed control. All widths through980
use the same44px speed button and22px nested clock, retaining the complete time
and rate. The former390px layout exception is removed. Recovery controls keep
their42x44 targets; mobile group gaps and outer padding are removed to reserve a
complete left tool target beside longer clocks. The mobile clock remains11px.
The desktop clock uses clamp(11px,1.1vw,14px), keeping its full visible prefix
and value, and preserving the nominal14px size at1440px. No time format, clock
computation, pacing logic, suppression, truncation or source font changes occur.
The R1 concise toolbar pausing label and full dialog explanation remain intact.

The final actual Header/SpeedControl/SimulationPacing fixture passes432 geometry
states and2928 native keyboard/touch actions. Widths320/390/391/400/480/768/980/
981/1024/1152/1440/1536 and DPR1/1.25 cover both sides of each relevant boundary.
The original base192 combinations retain Code open/closed, running/stopped and
emergency present/absent. Another96 corner states cover the actual supported
pausing0, paused0, running0.1 and running10 states at every width. Another144
geometry corner states cover complete100- and1000-hour clocks while running,
pausing and paused, with Code open and emergency present. Long-clock geometry
cases reuse the production callback proof rather than repeating those actions.
All actual adapter phases/rates, complete time text, bounds, vertical containment,
action center hits, nonoverlap and a minimum44px left tool strip are checked.

At320 with1000 hours and pausing, the left tool strip is53.71875px and the full
clock is56.28125px wide at11px. At768, the clock is22px high inside the44px speed
button and47px toolbar. At981, even1000-hour pausing retains51.734375px for tools;
the full clock prefix remains visible at11px. At1440 it remains14px. The320 and
768 long-clock PNGs were visually reviewed. The committed44 representative PNGs
include every width at1000 hours and the critical mobile/desktop phase corners;
the complete generated screenshot set is retained locally under test-results.

The first R2 native attempt exposed the additional981px desktop boundary, where
the original14px full clock prefix left37.03125px for tools. Its partial raw and
build/cap logs are preserved under `r2-first-attempt/`. A subsequent readable
clock-sizing iteration passed352 states/3632 actions; its exact CSS and raw
receipt are preserved under `r2-sizing-attempt/`. The final smoother sizing and
expanded432-state proof supersede that intermediate result. No failed evidence
was silently replaced in the committed history.

Selected-task routing114 tests PASS; focused workbench presentation, clock and
speed-control22 tests PASS; targeted ESLint, Prettier and diff checks PASS.
Final uncached web build executes7 fresh tasks, cache skipped, and all8 fixed
bundle caps pass. No budget, workflow, timeout, original E01 oracle or foreign
module change is included. Canonical selection e1a16c578 was merged once before
implementation. Foreign report directories remain preserved and unstaged.

SELF_REVIEW: PASS. Component electronics.ui.workbench; R2 product scope CSS only.
This proof establishes actual component layout and callback reachability through
the tested1000-hour range, not an installed owner Save journey or an arbitrary
unbounded-duration guarantee. Fresh independent source/native review comes first;
the controller then runs the canonical gate on the unchanged final SHA. No old
candidate gate is claimed as final evidence. No release, deployment or owner
acceptance is claimed. NEXT_ALLOWED_TASK: STOP / OWNER REVIEW.
