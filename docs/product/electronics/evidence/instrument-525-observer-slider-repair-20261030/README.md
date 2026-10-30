# 525 observer / owned RECT candidate — 30 October 2026

Verdict: **NO_COMPLETE_REPAIR**. Do not run the expensive strict matrix or claim all16 complete from this candidate. The extracted observer passes narrow Chromium proof; all six reconstructed failed slider poses have zero eligible points among the unchanged nine candidates and fail closed with zero clicks. A separately selected control-hit-priority dependency is required. No production fix is included.

Base: `536bded6a1ad4fce76b95a2a439f8db2507c56a8`. Original full-spec blob `06174a9675a5e670e3798a4adb7e40239a729a3a`, SHA256 `73efacf7f218c9b5d06805c4b23fc088563ae184364f9a42a19b92b247202018`. Candidate full-spec SHA256 `d9c0c74dd49997636aca4decd6c61d0381b4aa649a030b8e094305ece7b0f93c`. Both full files are frozen as deterministic gzip files here. Future BEFORE/AFTER must use this same complete browser blob, subject to independent review and separate authorization.

Changes: name/idempotently guard the existing observer; register addInitScript and evaluate in the current document; acknowledge/assert public observer readiness before actions. The transparent Proxy/Reflect.apply path, synchronous storage snapshot, native listeners, bindings, complete ledger/CAS checks, deadlines and closure coverage remain. Generalize the existing owned RECT helper and route the two existing supply slider actions and two existing waveform actions through it. Nine candidates/order/CTM/elementFromPoint, checkpoint before one native click, strict failure without a candidate remain. Unrelated spec bytes before/after525 are identical; generated JSON differs only in generatedFrom.browserEvidenceSha256.

`narrow-browser.mjs` extracts both actual function initializers using TypeScript AST; it does not maintain copied implementations. Chromium140.0.7339.186, URL fulfilled in memory via Playwright routing, no listening ports, application server or Docker. Already-loaded document + hash navigation + repeated install and fresh-document init + repeated install each produce exactly one PUT, one dispatch snapshot and one trusted pointerdown/pointerup/click sequence; storage snapshot is before the synchronous post-fetch mutation, response status/header/body unchanged. The source forwarding return remains exact Reflect.apply; no await is added.

Six cached poses are reconstructed with genuine SVG RECT/CTM and actual wire paths from raw errors, actual post-pan body CTM, supply position600/30, dimensions147/118.5, native viewBox294/237 and raw vector-effect non-scaling-stroke. Current CSS gives stroke24 at widths<=980 and14 otherwise. Four XY cases are supply-negative; mobile320X/390X are supply-positive (correction to selection's grouped wording). All six reproduce blocked center AND all nine blocked candidates. These are cached geometry reconstruction proofs, not full application runtime acceptance. The first failed390XY witness is preserved separately with source-scale confirmation. Six fully occluded synthetic negatives and one rotated/mirrored partial-wire synthetic positive are explicitly separate: negatives give zero clicks, positive gives exactly one trusted click at the second candidate.

Validation: spec Prettier PASS, ESLint PASS, Playwright discovery exactly16 cases PASS; ad hoc spec TypeScript reports11 diagnostics on both base and candidate with identical file/code/message multiset (no new diagnostic). `typecheck.mjs` uses a virtual baseline source so no foreign file is written. This is not a canonical type/gate PASS. Canonical generator run, JSON semantic comparison and diff-check PASS. No canonical full gate, build, native full matrix, CI, deployment or acceptance run. Nx tasks executed:0, not claimed as gate evidence.

Reproduce from repository root:

```
node docs/product/electronics/evidence/instrument-525-observer-slider-repair-20261030/narrow-browser.mjs <cached-artifact/reports/playwright>
node docs/product/electronics/evidence/instrument-525-observer-slider-repair-20261030/typecheck.mjs
```

Raw cache used: `C:/Users/spike/.codex/worktrees/electronics-value-inputs/ASA-lab/reports/instrument-525-before-41061516266/artifact/reports/playwright`. Per-input SHA256 and full nine-point witnesses are in narrow-browser-result.json. Main already archives selected-raw16.zip under instrument-525-before-41061516266. No download performed.

Self-review: diff remains inside selected525 block, generated hash and this evidence directory. No oracle/assertion/action-order/fixture/timeout relaxation; no force, retry or overlay workaround. Five pre-existing untracked report directories preserved. Source is frozen only for independent source/composition/narrow-proof review; technical/owner acceptance and product AFTER remain prohibited. STOP.
