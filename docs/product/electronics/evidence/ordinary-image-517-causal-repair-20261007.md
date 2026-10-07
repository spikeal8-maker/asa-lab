# Ordinary image early-error repair — bounded causal evidence

Issue [#517](https://github.com/spikeal8-maker/asa-lab/issues/517), programme #452. This report records the separate test repair after independent REQUEST_CHANGES on `d6a78196c6c2423ebad59de4e682141d3d9d837d`. It does not grant product acceptance, owner acceptance or deployment. The controller resumed this repair on canonical main `e67719cf06e6d4b72162fc05344a1b592448d57f` after independently accepted source-responsibility review #518; the author inherited that state through ordinary merge `1cac2cc2c90b4b0030dc4f8ca96d6c113fdb986c`.

## What is proved

An error delivered to the actual React SVG image handler before passive ordinary-image lifecycle setup is lost by the original no-op callback refs. The candidate stores the latest matching resource event and replays it once when callbacks exist. This is a confirmed induced lifecycle defect class. The historical native catalog failure in run 37662037546 has no captured error/setup ordering; its exact cause and frequency on classroom devices remain **UNPROVEN**.

The saved corrected native probe [37668032196](https://github.com/spikeal8-maker/asa-lab/actions/runs/37668032196) passed the original permanent-missing assertions. Its three actual errors followed setup (263.1→350.1/350.7 ms; 422.5→508.8 ms). It neither reproduces the historical race nor estimates its frequency. No additional native rerun was needed in this cycle.

## Corrected built before / after proof

The test installs a minimal React DevTools commit callback before the application loads. Installed React 18.3.1 calls this hook after restoring event delivery and before passive effects, including synchronous commits. It dispatches an explicitly untrusted error once per connected matching SVG image. Original native image responses are held until the assertions finish; retry-image 404 responses retain the existing finite recovery contract. Only this induced case navigates with `domcontentloaded`; original scenarios and all existing assertion/test timeouts remain unchanged.

The old prototype-insertion probe 37670067715 is **INVALID evidence**: React suppressed event delivery during mutation and held images blocked navigation's load event. The later microtask attempt was not accepted because synchronous passive flushing can precede it. Neither is counted as causal proof.

| Variant | Exact SHA | Directed built run | Result |
| --- | --- | --- | --- |
| Original hook, corrected fixture | `627c97ac8c006e4df3fc07c6c7074dfcda0f274f` | [37678410095](https://github.com/spikeal8-maker/asa-lab/actions/runs/37678410095) | Expected stage failure badge is absent at the original 10,000 ms assertion; navigation completes. |
| Queued hook, identical fixture | `0bd2794681217c99348f9d81789988aa2599904a` | [37679148933](https://github.com/spikeal8-maker/asa-lab/actions/runs/37679148933) | PASS: stage and catalog badges appear before original native responses are released; document unchanged, no save requests, no browser errors. |

Both probes run only the named induced scenario against freshly built CI Web/API images and disposable PostgreSQL. Their test, typed unit fixture and temporary workflow blobs are identical. Their only differing source is `ProductionComponentVisual.tsx`: the same passive diagnostics surround the functional no-op-ref versus queued-event change. Temporary diagnostics/workflows are excluded from the final candidate.

The raw records confirm **actual React handler delivery before callback setup** for each matching AA-2 hook instance. IDs are stable within each run, not cross-run identities or independently established stage/catalog role mappings.

| Run | Hook ID | React error (ms) | Callback setup (ms) |
| --- | --- | --- | --- |
| Before | 0 | 230.3 | 231.0 |
| Before | 2 | 230.3 | 231.0 |
| Before | 6 | 387.9 | 388.7 |
| After | 0 | 240.9 | 241.6 |
| After | 2 | 241.0 | 241.9 |
| After | 6 | 411.7 | 412.3 |

Before's late native errors at about 10,945 ms occur after assertion failure and response release. After's later errors at about 1,698 ms reach already installed callbacks; these raw hook records alone do not identify the request URL or native/retry class. These are not evidence of native early delivery.

## Artifact integrity and reproducibility

Original Actions archive digests were checked against downloaded bytes, and raw JSON was extracted from `reports/controlled-commit-image-probe.json` in each archive. Trace ZIPs and failed-step logs are preserved alongside the original archives in controller handoff storage `C:/Users/spike/.codex/temp/electronics-517/`; local availability is not a portable substitute for the linked exact runs/artifacts.

| Evidence | Artifact ID | Archive SHA-256 | Raw JSON SHA-256 |
| --- | --- | --- | --- |
| Before | 11508301233 | `fcd48b7e84ed3181c919dfe5285412b8693552ce3cd1f093e6b82c20e9b8f1dd` | `26740b342e50f7fff5410e41b7cb2023ab0cd9a3dfdd9abd268eea3ccbfd1b97` |
| After | 11507593282 | `28ab9e9b2be0228c718d0ee7b3daf3ad2145f85ed9125159d086de7fcdae7aef` | `6ddc4ef57a21332f1b41987665c9eaf2b275e98de6ac8fb5b290c6e02e5a5e36` |

## Final scope and verification boundary

Product source remains byte-identical to the independently reviewed, still unaccepted candidate's blob `ab292c4a22f9689b018d1dea1d760120cafa29ec`. This repair corrects the actual SchematicComponent fixture (`kind`, `componentTypeId`, `position`, `value`) and replaces the flawed controlled browser delivery seam. The independently accepted #518 baseline/report are inherited, not modified. No physics, controller #516, #505/PR #506, owner assets, authorization, persistence or working installation is changed.

Local preflight SAFE_TO_START, control plane PASS, selected-card routing 84/84 PASS, actual web typecheck PASS (six fresh Nx tasks with literal `NX_SKIP_NX_CACHE=true`), asset recovery 21/21 PASS and scoped ESLint PASS preceded the expensive directed probes. The asset tests retain error-before-setup, last early load wins, resource switching/stale completion and unmount cancellation coverage.

Directed induced proof is not the full acceptance gate. Final exact-SHA focused Electronics, full Electronics browser, repository CI and a NEW independent review remain required; their actual results belong to the implementer/controller handoff and canonical closeout. No owner acceptance, release or deployment is claimed by this report.
