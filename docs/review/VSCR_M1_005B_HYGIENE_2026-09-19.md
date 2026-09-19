# VSCR-M1-005B — Scratch L2 Hygiene Audit

## 1. Audit passport

- **Lane:** visual-programming / Scratch runtime
- **Level:** L2
- **Baseline SHA:** `1d101b699b7db34efa838a143a93f9b19940e5c9`
- **Implementation target SHA:** `f4012afa9d056acb8ec54cb365e806094c6df3e3`
- **Issue / PR:** #287 / Draft PR #288
- **Trigger:** conservative heavy-lane threshold/milestone boundary. No earlier Scratch L2 target
  could be proven from the repository, so the counter is not guessed.
- **Scope:** `contexts/blocks/**`, `infra/scratch-editor/**`, `apps/web/src/blocks/**`,
  Blocks API files, `tools/blocks/**`, Blocks E2E and visual-programming docs.
- **Out of scope:** Electronics, Learning, games, 3D and other parallel lanes.

## 2. Verdict

**Verdict: PASS**

No BLOCK finding was found in the M1-005B implementation window. L0/L1 cleanup is complete
for the slice. The large test-only orchestration files below have explicit bounded exceptions;
none is shipped as browser/runtime product code.

After this L2 PASS the Scratch heavy-lane hygiene counter resets to `0`.
This hygiene verdict is not the independent critical review required for M1-005B.

## 3. Repository delta

Scratch-scope inventory:

```text
baseline: 61 tracked files / 254434 bytes
target:   124 tracked files / 819669 bytes
```

The growth is primarily the bounded runtime capability/storage/persistence implementation,
tests and contracts accumulated in M1-005B. No generated reports, Playwright output,
coverage, traces, logs, dumps, `dist/`, `build/` or cache directories are tracked in the
Scratch scope. No new Scratch binary/media file is tracked by this slice.

No second Project Core, alternate Scratch backend, public asset bucket, new product port or
parallel draft database was introduced.

## 4. Large source/test files

| Path | LOC | Responsibility | Decision |
|---|---:|---|---|
| `e2e/blocks-product-integration.spec.ts` | 1428 | Browser protocol/product regression matrix | Documented test-only exception. Not runtime code; keep one browser contract suite until a future bounded test-structure cleanup can split it without duplicating fixture lifecycle. |
| `tools/blocks/portable-smoke.mjs` | 990 | Disposable Compose + PostgreSQL + MinIO + real-browser acceptance orchestrator | Documented test-only exception for M1-005B closure. It owns one end-to-end lifecycle and is not imported into product bundles. Split before adding another major acceptance domain or if it crosses 1200 LOC. |
| `tools/blocks/host.test.mjs` | 937 | Host/protocol regression suite | Existing test-only exception; no runtime responsibility. |
| `apps/api/src/blocks-project-persistence.spec.ts` | 851 | Persistence/parser/guard regression suite | Existing test-only exception; production implementation remains separated. |

Production files remain below the mandatory >800 LOC decision threshold in this audit window;
for example `infra/scratch-editor/host/storage.js` is ~451 LOC and
`apps/web/src/blocks/BlocksEditor.tsx` is ~259 LOC.

## 5. Dependencies and bundle impact

M1-005B adds server-side dependencies required by the selected contracts:
`@aws-sdk/client-s3`, `file-type`, `jose`, `saxes`, and `scratch-parser`.
They are API/runtime dependencies, not additions to the browser Scratch bundle.

Repository build measurements around the explicit-Save closure:

```text
main web index JS:
  361.10 kB → 362.38 kB  (+1.28 kB, +0.35%)
  gzip 105.18 kB → 105.57 kB (+0.39 kB, +0.37%)

main web index CSS:
  162.95 kB → 163.92 kB (+0.97 kB, +0.60%)
  gzip 30.52 kB → 30.72 kB (+0.20 kB, +0.66%)
```

This is below the repository +10% WARNING threshold. Existing lazy-loaded heavy subject chunks
remain separate; the explicit Save control did not import the standalone Scratch runtime into
the portal bundle.

## 6. L1 cleanup

Verified for this slice:

- no debug-only controls or console instrumentation in product changes;
- no autosave, debounce, recovery, IndexedDB, preview, Gallery/Learning or M1-006 code;
- no generated evidence committed to the source tree;
- no duplicate Save implementation: parent control calls the existing
  `BlocksRuntimeBridge.requestFlush(requestId)`;
- no native Scratch File/Edit replacement;
- no persistent browser store added;
- no new product ports or deployment topology;
- exact formatting, ESLint, typecheck and boundary checks pass.

## 7. Architecture boundaries

The flow remains:

```text
ASA parent Save control
→ BlocksRuntimeBridge explicit FLUSH
→ isolated Scratch live VM snapshot
→ runtime capability-protected asset/draft API
→ Blocks persistence guard
→ common Project Core SaveDraftUseCase
→ PostgreSQL metadata/draft + private S3-compatible object storage
```

Browser UI owns only explicit action/status. It does not own authorization, revision choice,
canonical persistence or retry loops.

## 8. Measured storage/performance evidence

Exact implementation evidence SHA `f4012afa9d056acb8ec54cb365e806094c6df3e3`:

```text
first save:
  asset PUT          10
  uploaded bytes     293385
  draft PUT          1
  revision delta     +1
  blob delta         +10
  alias delta        +10
  object delta       +10
  object byte delta  +293385
  latency            898.41 ms

fresh reopen:
  asset GET          5
  object GET         5
  latency            2339.54 ms

fresh no-op:
  runtime requests   0
  asset PUT          0
  draft PUT          0
  uploaded bytes     0
  object requests    0
  blob delta         0
  alias delta        0
  object delta       0
  object byte delta  0
  revision delta     0
```

No performance claim beyond these measured CI values is made.

## 9. Findings ledger

No BLOCK or deferred WARNING finding is open from this L2 audit.

The explicit large-test-file decisions above are bounded exceptions, not production
architecture exceptions. A future growth trigger reopens decomposition review.

## 10. Regression evidence

On implementation target `f4012afa9d056acb8ec54cb365e806094c6df3e3`:

- `Scratch Focused` run `35425860037`: SUCCESS;
- `ASA Lab Governance and Code Gates` run `35425860017`: SUCCESS;
- `Scratch Documentation Routing` run `35425860058`: SUCCESS;
- portable artifact `scratch-portable-f4012afa9d056acb8ec54cb365e806094c6df3e3`: PASS.

The final documentation-only closure commit must repeat exact-HEAD CI before STOP.

## 11. Acceptance statement

Hygiene audit completed with PASS. BLOCK findings are absent, current-scope cleanup is
complete, and the heavy-lane counter resets to `0`.

This does **not** mark VSCR-M1-005B done/accepted/merged and does not substitute for its
independent critical review.
