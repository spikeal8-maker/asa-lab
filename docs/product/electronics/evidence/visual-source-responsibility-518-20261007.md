# Production visual source: bounded responsibility review

Date: 2026-10-07. Selected documentation-only responsibility review; product acceptance is not claimed.

## Scope and method

This is the one-file responsibility re-review requested by [#518](https://github.com/spikeal8-maker/asa-lab/issues/518), a documentation-only dependency of [#517](https://github.com/spikeal8-maker/asa-lab/issues/517) in programme #452. The applicable rules are Engineering Hygiene Contract §§6/8 and AGENT_GUIDE §10. This report does not constitute a whole Electronics hygiene checkpoint.

Read the actual `apps/web/src/electronics/ProductionComponentVisual.tsx`, its exact candidate diff and source history. Inspect its two direct production importers, `WorkbenchStage.tsx` and `component-preview.tsx`, and the narrow shared-recovery and `OwnerServoVisual` boundaries. No product source, tests, owner artwork, runtime state or routing ownership is changed by this review.

Measure Git blob bytes, rather than checkout bytes or editor line counts, using `git show <revision>:apps/web/src/electronics/ProductionComponentVisual.tsx` as binary data and `git rev-parse <revision>:<path>` for blob identity. The original baseline source is independently verified from the commit that introduced the hygiene baseline.

## Source identities and accumulated growth

| Reviewed source | Exact revision | Git blob | Bytes |
| --- | --- | --- | ---: |
| Original reviewed baseline | `f0919000d50a766111ab087becd988fbf33048c5` | `1fc454f5e7eae9dfd449ab5de77a1b119680c192` | 60,089 |
| Actual main inspected for this review | `da4e37461e4c73dc76f564ac6171fffbb45cb8ea` | `008595db4bd18c4c26211bf5867b3c8f9ccf1c0f` | 71,754 |
| Unaccepted #517 product candidate | `d6a78196c6c2423ebad59de4e682141d3d9d837d` | `ab292c4a22f9689b018d1dea1d760120cafa29ec` | 72,432 |

The previous ceiling is `60,089 × 1.20 = 72,106.8` bytes. Actual main is 11,665 bytes above the original baseline, approximately 19.41%; the reviewed candidate is 12,343 bytes above it, approximately 20.54%, exceeding the old ceiling by 325.2 bytes. The candidate alone adds 678 bytes (24 inserted and 9 removed lines). Crossing the threshold requires this selected re-review; it does not mandate extraction or confer product acceptance.

The file has exactly four source-changing commits between the original baseline and the inspected main:

| Commit | Responsibility added or adjusted | Resulting bytes | Net growth |
| --- | --- | ---: | ---: |
| `d1f90203` | Servo presentation delegates to the existing separate `OwnerServoVisual` | 60,415 | +326 |
| `a668c8e7` | Owner SVG/image loading, bounded retries, failed-state presentation and recoverable lifecycle | 68,288 | +7,873 |
| `81942701` | Quiet asset recovery subscriptions, mounted-consumer signalling and cleanup | 71,308 | +3,020 |
| `1c714a91` | Preserve multimeter markup across reading updates and respect explicit instrument state properties | 71,754 | +446 |

This is a description of factual history. Earlier commit subjects or accepted reports are not substituted for the required review of the #517 final product SHA.

## Responsibilities, consumers and boundaries

| Boundary in this file | Actual responsibility and coupling | Retention/decomposition finding |
| --- | --- | --- |
| `ownerSvgSource`, `useOwnerSvgSource`, `recoverOwnerImage`, `useOwnerImageHref` | Cache asset requests and recover transient transport/decode failures; hooks bind each mounted visual to shared recovery. Caches are module-level, lifecycle state is local. | Asset lifecycle is a real independent concern. Future extraction must preserve cache identity, cancellation, asset changes, per-consumer decode signalling and shared subscription behaviour. |
| `OwnerAssetErrorBadge`, `OwnerSvgFallback` | Common loading/error presentation with accessible status and existing owner image fallback. | Closely tied to loader state and used by multiple visual families; extraction should retain a single coherent lifecycle/presentation contract. |
| Instrument and motor `Owner*Visual` wrappers | Project properties and `ComponentResult` into owner markup; pointer gestures emit callbacks to the workbench for multimeter/supply/generator changes. Motor presentation converts provided values into visual motion. | Instrument controls and family rendering are useful stable boundaries. Repeated wrappers are remaining decomposition debt, not evidence of dead code. |
| `ProductionComponentVisual` | Shared SVG dimensions/transforms, selection silhouette, family dispatch, measured resistor/button/switch geometry, overlays, Arduino indicators/reset callback and seven-segment/RGB/LED presentation. | Public renderer remains a coherent composition point for stage and catalog, but its long family dispatch mixes multiple presentation responsibilities and stays a decomposition candidate. |

`WorkbenchStage` uses the renderer both for placed components and a picked-up catalog preview. The placed-component call provides the workbench's runtime presentation result, brightness, simulation state/time and interaction callbacks. `ComponentPreview` uses the same renderer for enabled catalog entries with default visual state and zero effective brightness. These are live consumers; replacing them with alternate renderers would risk stage/catalog drift.

Existing stable separation already includes `visualAsset` in the catalog, pure owner-markup/motion helpers and shared quiet-recovery subscription in `production-asset-contracts.ts`, and the imported `OwnerServoVisual`. The examined file does not import the electrical solver or persist schematic revisions. It formats received values and emits user intents; this review does not certify every existing presentation fallback as a new electrical result.

The ordinary-image hook is also instantiated for specialized visual families because selection may render an ordinary image copy. Selection and body can share its callbacks. This is concrete coupling to preserve if loader or family rendering is extracted. Specialized SVG wrappers use their own source hook. A split made solely to reduce bytes would risk changing those lifecycles and cache identities.

## Candidate ordinary-image event boundary

The only production-file difference from the inspected main to candidate `d6a78196…` is inside `useOwnerImageHref`: two initially empty callback refs become asset-keyed mounted handlers plus one latest early event. `notify` either dispatches to handlers for the same asset or queues the event. Effect setup replays the matching event; cleanup clears only its handler identity and matching resource event. The existing recovery bodies, retry constants, transport scheduler and mounted image callbacks remain in their established boundary.

Keeping that small change inside the existing private lifecycle hook is structurally reasonable for the bounded asset repair. A new general module or a broad family extraction would add ownership and lifecycle changes without addressing the observed test failures. No source extraction is performed here.

This observation is a responsibility/cohesion review, not a correctness verdict on the event queue. The candidate remains unaccepted after independent REQUEST_CHANGES. Its typed test fixture, controlled built-browser scenario and final required gates still need the separate #517 repair and NEW exact-SHA independent review. This report does not prove the native historical failure's event ordering or its frequency on school devices.

## Baseline decision and residual debt

After this factual review, the permitted baseline change is confined to this file: retain `class: decomposition-candidate`, set `reviewed_bytes: 72432` to the measured reviewed candidate ceiling, and explain the lifecycle/family boundaries and remaining debt with a reference to this report. The ceiling describes source actually examined, even though the candidate is unaccepted. Main's source remains 71,754 bytes; no product bytes are incorporated by changing the documentation baseline.

Preserve the 50,000-byte threshold, 20% growth rule, every other large-source entry, legacy retirement condition and checkpoint counter. This one-file review neither resets the recurring hygiene checkpoint nor claims all Electronics hotspots were reviewed.

Residual debt is explicit: shared loader/error presentation, instrument-specific controls and the long family/selection dispatcher still coexist in one file. A future separately selected extraction must follow those responsibility boundaries, preserve measured owner geometry and assets, update mapped ownership when it actually changes, and verify unchanged catalog/stage presentation, interactive instrument controls, transient/permanent failure, asset replacement/unmount and simulation result projection. The hidden potentiometer contract and Arduino presentation time windows are preserved; this review supplies no deletion or semantic-change proof for them.

The immediate user-facing dependency remains the #517 image-error/recovery repair, then the suspended observation-cadence and board-transfer acceptance. This documentation review does not make the editor work better by itself and authorizes no next product slice, deployment or owner acceptance.
