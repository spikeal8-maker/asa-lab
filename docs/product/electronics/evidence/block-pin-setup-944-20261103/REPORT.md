# Generated pin setup and seven scoped browser journeys

Dated evidence snapshot, 3 November 2026 (Europe/Moscow), for Task944 and the
four selected compact-toolbar regressions. Canonical live status remains in
`docs/execution/current.yaml`.

Source: `f64141870b52458ad19b82b51582c47cb14460ea`.
Isolated browser transport: `c16623b4486cbd49b7956287ef30876b0a8ec853`.
Only the temporary workflow and scoped runner differ between those revisions;
neither temporary file belongs in main.

## Behavior

Generated explicit `pinMode` declarations initialize the twenty canonical Uno
GPIO ports in `setup()`. Inferred button/sensor inputs and the owner's explicit
per-board input list take precedence over OUTPUT. Computed writes retain simple
expressions without per-command pinMode wrappers in loop. The existing mode menu
opens input settings without adding another toolbar row. Text-authored source
remains verbatim. Configuration, pending Blockly edits and board isolation use
the existing persistence and Undo/Redo paths; no schema or database change.

The immutable public owner fixture is project
`7ad29bb5-d39c-437e-b38d-d0a06ff6ef9a`, revision
`dc6cd288-1334-429e-95be-d9edd952b86a`. Its original and generated command sequences
match for 765 electrical-write/delay actions over 22 engine seconds, excluding
the intentional initialization changes. This is not an instruction-clock or
wall-clock equivalence claim. The user's algorithm reaches D0–D11; it was not
silently rewritten to match only the wired LED ports.

## Verification

- [Focused M1 and seven browser cases](https://github.com/spikeal8-maker/asa-lab/actions/runs/41525333022):
  PASS, seven cases, attempt 1 / retry 0, none skipped or flaky.
- Canonical `pnpm gate:electronics-m1`: 1,424 core tests and 1,208 frontend
  tests passed. Another 117 classroom qualification adversaries passed.
  `NX_SKIP_NX_CACHE=true`; 72 Nx tasks ran afresh (1 SDK build, 44 typecheck
  tasks including dependencies, 27 builds); all three Nx summaries say cache
  skipped. Restored package-manager downloads are not Nx result-cache evidence.
- Independent source review: APPROVE, including exact final mobile prompt
  adjustment. Independent actual-browser review: APPROVE for all seven cases.
- [General gate on the preceding product-identical revision518](https://github.com/spikeal8-maker/asa-lab/actions/runs/41520537697):
  all four jobs PASS. Final f641 differs only in the causal mobile E2E prompt
  handling.
- [Exact-source final General gate](https://github.com/spikeal8-maker/asa-lab/actions/runs/41527917133):
  all four jobs PASS on the exact final source revision.

Desktop 1536×864 and genuine touch/coarse/mobile Chromium at 390×844 pass all
25 caption/layout guards, inferred and explicit input settings, Cancel/Escape/
focus behavior, immediate Apply→Save, Undo/Redo, per-board isolation, native
pending Blockly editing, and complete expected/request/server/reopened document
equality. Existing block coordinates and all other fields remain unchanged;
text source survives saving and reopening verbatim.

The mobile native field editor uses a browser prompt. The listener is armed
before tapping, verifies the original default value, accepts the intended edit,
then immediately opens settings. The actual Worker journal contains 2,199
solved/ready samples and 202,308 finite electrical values, zero diagnostics,
D0–D11 each HIGH, 33 LED signatures and illuminated samples in all four checked
engine-time intervals through 22 seconds. Desktop has 2,129 solved/ready samples
and 195,868 finite values. Both record zero console/page/request/server errors.

The original five scoped journeys pass again: four compact cases contain exactly
87 phases (18/26/24/19), 87 screenshots and 1,372 control observations, with
native ownership and clipping guards retained. E01 records 56 layouts and whole
emergency export/request equality, preserving the previous local draft.
Historical 95 included another text-mobile case outside this scoped registration;
this evidence does not claim that broader total.

## Additional legacy mobile qualification (Task870)

[Run41537679267](https://github.com/spikeal8-maker/asa-lab/actions/runs/41537679267)
qualifies the unchanged original `text — mobile` case at main source
`31f1b7b41f8fe62290cb9eec33e63d236d14a920`, transport
`345e86c026a98145ecbe2d9fb8052104b81d60ff`. Only the two temporary transport files
differ; relevant product and test bytes equal f641 above.

The case passes once, retry0, with all nine original phases in source order:
980/390/320 widths, each stopped/running/resized. Independent actual review
approves all nine screenshots, 72 control observations, all360 native hit points,
clipping/caption/font guards, and 32px drawer-height changes. Server document and
revision2 remain unchanged, local snapshots stay null, and all nine editor
sources equal the saved source.

Combined with the independently reviewed87, these nine establish96 current
compact observations: all95 historical observations plus981-native-closed. No
original phase was removed or renamed. This case uses its original viewport
context and establishes neither phone hardware/touch identity nor elapsed-clock
advancement; the running screenshot proves only clock presence. Its existing
anonymous-probe/navigation-abort collector exceptions remain unchanged.

The [post-integration main31 General gate](https://github.com/spikeal8-maker/asa-lab/actions/runs/41535688893)
also passes all five jobs, including `ASA / required`.

## Limits and operations

The mobile isolation journey uses the existing native Expand→Reset route.
Default-height Reset is still an open layout defect: a 128px workspace cannot
contain the vendor's vertical control stack and trashcan without overlap.
This report does not close broader Task865 raw/empty/corrupt mount preservation,
the twenty remaining runtime timing failures, full Electronics strict, full C++
support, real-time performance, release readiness or owner acceptance.

Deployment NOT_RUN; no owner server, Docker installation, live database, network
settings, protected artwork, backups or foreign work-in-progress changed.
Database fixtures and migrations ran only inside isolated GitHub Actions.
