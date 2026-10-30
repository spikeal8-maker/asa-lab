---
task_id: TASK-ELECTRONICS-PSU-SWITCH-NATIVE-HIT-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Native PSU power-switch priority over ordinary wire hit strokes

Issue [877](https://github.com/spikeal8-maker/asa-lab/issues/877). A separate
dependency of mirror525, not authorization for mirror compensation. Owner asks
to finish mirror work and permits refactoring; server/foreign changes remain
forbidden. Mirror AFTER still requires complete16 BEFORE and new actual review.

Strict41061516266 has six poses where wire segment hits intercept the power
slider. Frozen test dependency f33577dc27fc94caa5cf451bcbe957693fcbdb1d independently
proves all nine owned points blocked in reconstructed actual poses. MobileX uses
supply-positive; XY uses supply-negative. Preserve precise per-pose attribution.
Existing bodies paint below wires, with a switch-only forwarding workaround;
forwarding does not restore native target ownership. Do not extend forwarding.

## Bounded source contract

Use hit-only SVG clipping for the PSU stationary rounded switch track, owner
coordinates x14,y202,width67,height26,rx13. Ordinary whole-wire/segment hits must
fall through natively inside the live track. Keep visible wire paint, existing
runtime DOM/handlers and control coordinate system. No body/control DOM split,
new overlay, knob holes, mirror compensation or protected-asset edit.

Source budget: WorkbenchStage.tsx and ProductionComponentVisual.tsx; one cohesive
geometry helper is allowed only if justified before editing. Focused tests and
evidence may be added. No controller/clock/solver/protocol/persistence/CSS hit-width,
workflow/dependency/cap or unrelated change. Compose frozen f33577d test/evidence
paths unchanged, with their reviewed full-spec blob b450bd6d148285008ba226bb688a315f1120eb1a
and SHA256 d9c0c74dd49997636aca4decd6c61d0381b4aa649a030b8e094305ece7b0f93c.

Use existing paintedComponentPoint/canonical component projection with actual
runtime viewBox and base dimensions, ordinary rotation and mirrors. Preserve
rounded arcs and reflection sweep; no bounding-rectangle approximation, arbitrary
infinite outer rectangle, hardcoded zoom or native-scale assumption. Complement
domain must cover current wire hit extents with finite values. Per-supply
complement clips must intersect safely: overlapping exclusions never re-enable
wire hits by even-odd parity. Stable IDs cannot collide between Stage instances.

Emit exclusions only when actual live generated switch markup is mounted and
validated, not while owner source loads/fails or on fallback/unmount. Stage does
not currently know this: one small stable readiness callback from the existing
OwnerRegulatedPowerSupplyVisual is allowed. It must not subscribe Stage/editor
to per-frame results or toggle readiness on every measurement update. Validate
the existing track geometry; clean availability on source/fallback/unmount.

No exclusions during pending-terminal wiring: keep existing routing. Selected
endpoints and vertices keep their existing higher priority. Do not shrink the
30/24px mobile or existing desktop hit widths. Hidden/occluded controls must not
create a new wire-selection gap over foreground bodies. State any conservative
overlap boundary explicitly and prove it; do not claim universal control priority.
Preserve existing fallback semantics unless concrete native proof justifies a
minimal change; one native switch activation must never toggle twice.

## Required proof and delivery

Before edits inspect exact APIs and report minimal implementation plan. Preserve
the blocked actual-pose BEFORE. After source edits prove genuine native ownership
and one trusted activation in all six failed poses, plus all rotations/mirrors
and representative1440/1024/390/320. Rounded corners remain wire-owned outside
the actual track. Two overlapping supplies, hidden foreground body, loading,
fallback, unmount, multiple Stages and pending-wire/selected endpoint/vertex
priorities need meaningful regressions. Preserve component body drag/select,
wire selection/segment drag/bend/endpoints/terminals and #544 field boundary.
Keep #544/#547 OPEN; this does not qualify their closure.

Run focused geometry/routing/presentation/native regression and one early fresh
web build/all8 fixed caps. Freeze/push after self-review. NEW independent exact
source/native/final-composition review precedes ONE existing strict workflow on
the frozen combined candidate, providing canonical focused/benchmark/browser
evidence without a duplicate local full gate. Preserve f33577d spec unchanged.
All16 completed journeys and NEW actual review are required before mirror AFTER.
Do not run CI before approval or retry unchanged failures without a new cause.
No server/Docker/live database/ports/deployment or owner/release acceptance.
