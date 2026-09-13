# VSCR-M1-002B — ASA product chrome, localization and identity shell

**Kind:** executable implementation slice  
**Risk:** medium  
**Prerequisite:** VSCR-M1-002D accepted and the real editor DOM is available through the accepted C/D bootstrap path.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002B` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Productise the already working editor DOM without rewriting Scratch: keep the real upstream Scratch editor/runtime and its built-in localization/menu mechanics, while applying ASA Lab product chrome, ASA identity shell and the approved control policy to the real mounted GUI.

The result must look and behave like an ASA Lab tool while preserving the familiar Scratch programming model and colour semantics.

## Components

```text
blocks.host.branding
blocks.host.file-menu
blocks.host.extensions
blocks.host.localization
blocks.host.identity-shell
blocks.host.theme
```

Open only the matching entries in `components/host.yaml`.

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/host.yaml → selected entries only
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → Branding + Product controls + Extensions + Localization + ASA shell/theme
apps/web/public/asa-lab-mark.svg
apps/web/src/components/PortalHeader.tsx          # avatar/account behaviour reference only
apps/web/src/brand/brand.css                     # canonical ASA palette reference
actual host/protocol/editor mount accepted in M1-002A/C/D
```

Do not preload unrelated roadmap/contracts.

## Expected write paths

```text
infra/scratch-editor/patches/0001-host-logo-prop.patch
infra/scratch-editor/patches/0002-extension-button-visibility.patch
infra/scratch-editor/patches/0003-file-menu-policy.patch
infra/scratch-editor/host/branding.js
infra/scratch-editor/host/editor-config.js
infra/scratch-editor/host/theme.css               # ASA product chrome only; do not recolour Scratch block categories
infra/scratch-editor/host/main.js                 # composition wiring only
infra/scratch-editor/Dockerfile                   # deterministic patch/logo/theme copy only
infra/scratch-editor/README.md
apps/web/src/blocks/**                            # parent ASA avatar/account overlay only if required by accepted C boundary
e2e/blocks-host-controls.spec.ts
.github/workflows/scratch-focused.yml             # only if focused command needs it
../components/host.yaml                           # selected entries only
```

## Localization requirements

Scratch's own localization system is authoritative. Do **not** create an ASA translation fork and do **not** add a separate top-level `Язык` button.

The existing Scratch language control stays inside the existing Scratch `Настройки` / Settings menu.

Initial locale resolution:

```text
1. explicit ASA user locale, when/if a canonical ASA preference already exists;
2. otherwise reuse Scratch's own browser-locale detection against its supported locale registry;
3. regional tags resolve through upstream Scratch behaviour where supported (for example ru-RU → ru, en-US → en);
4. if upstream detection would fall back to English while the browser did not request English, use ru as ASA fallback.
```

Do not maintain a second hand-written list of Scratch languages in ASA merely to implement this policy.

Requirements:

```text
no hard-coded locale='en'
default on a Russian browser is Russian
fallback locale is Russian when no requested browser locale is supported
built-in Scratch language selector remains in Settings
no duplicate Language/Язык control is introduced elsewhere in the header
language switching uses upstream Scratch localization and updates the normal Scratch UI/block labels
no language switch may require scratch.mit.edu or another Scratch Foundation runtime dependency
```

If ASA later gains a persisted account language preference, it becomes step 1 above without changing the Scratch localization implementation.

## ASA product chrome and identity shell

The Scratch programming surface remains real Scratch, but the surrounding product chrome becomes ASA Lab.

Canonical ASA sources:

```text
logo: apps/web/public/asa-lab-mark.svg
current ASA header primary: #0877B3
current ASA header border/darker state: #076B98
canonical brand palette remains defined by apps/web/src/brand/brand.css
```

Required header result:

```text
ASA Lab logo/brand mark is rendered where the Scratch product logo currently appears
Scratch product logo/navigation/link to scratch.mit.edu is absent
existing Scratch Settings menu remains
existing Scratch File menu remains
existing Scratch Edit menu remains
fixture/debug-only controls are absent from the product surface
ASA account/avatar control appears on the right as ASA-owned parent UI, not as Scratch identity
Scratch account/community/share/remix/backpack/cloud ownership remains absent
```

The ASA avatar/account surface must reuse the existing ASA identity/avatar behaviour from the parent application. Do not pass ASA cookies to the Scratch origin and do not create a second Scratch account system. Prefer a parent-owned overlay/shell that visually joins the Scratch header while preserving the accepted separate-origin iframe boundary.

## File menu policy

Do **not** remove the File menu merely to simplify the host. Keep the familiar Scratch menu surface, but do not expose functionality that falsely implies durable ASA persistence or prematurely enables unvalidated `.sb3` interchange.

At the pinned upstream revision, `canManageFiles` gates the entire File menu while `Load from your computer` and `Save to your computer` are unconditional inside the upstream `FileMenu`. Therefore the accepted product requirement cannot be implemented truthfully by configuration alone.

A third minimal compatibility patch is explicitly authorised for this purpose:

```text
infra/scratch-editor/patches/0003-file-menu-policy.patch
```

Its only allowed behavioural purpose is to let the ASA host keep the normal File menu visible while independently controlling New / local import / local export items. It must not implement ASA persistence, parse `.sb3` itself, alter VM semantics or create a second file menu.

Until the corresponding milestones are accepted:

```text
File menu visible
New may remain only if browser evidence proves honest fixture-only behaviour
upstream/server Save now remains disabled
Load from computer hidden/disabled until M1-007
Save to computer hidden/disabled until M1-007
no fake ASA save success
no durable save/load claim before M1-005
no .sb3 import/export claim before M1-007
```

The later M1-007 task may enable the existing File import/export entries after bounded `.sb3` validation/compatibility is accepted; do not add duplicate ASA import/export buttons merely for branding.

## Extensions policy

Do **not** remove the Extensions button as a product rule. Keep the familiar Scratch extension entry point and style its product chrome with ASA branding.

At this stage:

```text
Extensions button is visible
no extension/library traffic may silently fall back to Scratch Foundation infrastructure
only locally bundled / explicitly approved extension sources are permitted
future sovereign extension allowlist/policy remains owned by the later milestone
```

If the current local fixture/library cannot satisfy an extension safely, that extension may be unavailable; the button itself is not removed merely to hide unfinished policy.

## Theme / colour policy

Apply ASA colour to **product chrome only**.

Use ASA primary header colour (`#0877B3`) for the top editor bar and ASA-associated chrome. Related darker/hover states may use the existing ASA header darker colour (`#076B98`) or another already-defined ASA token.

The following ASA-owned/neutral chrome may be restyled to the ASA palette when technically isolated:

```text
top product bar
Extensions launcher/button
sprite/backdrop add controls
selected sprite/product accent states
ASA-owned focus/selection chrome
```

Do **not** globally replace Scratch purple (`$looks-secondary`) or recolour semantic Scratch programming categories. In particular, preserve the standard Scratch colours for Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables and My Blocks. Category colours are part of the Scratch programming language/learning model, not ASA branding.

Any upstream styling change required only because the same Scratch colour token currently drives both semantic category colour and product chrome must be narrowly scoped. Do not fork the whole Scratch stylesheet.

## Authorised upstream patch budget

For the accepted pinned Scratch revision, B is allowed exactly these three reviewed compatibility patches:

```text
0001-host-logo-prop.patch              # host-supplied ASA logo
0002-extension-button-visibility.patch # host-controlled Extensions entry point
0003-file-menu-policy.patch            # keep File visible while gating unsafe items
```

No other upstream source modification is authorised by this task. Locale handling, ASA colour theme and ASA avatar/account shell must use host configuration/CSS/parent composition unless an explicit later architecture decision approves another upstream patch.

## Acceptance

```text
real editor remains the accepted upstream Scratch editor/runtime
canonical apps/web/public/asa-lab-mark.svg bytes are the logo source
ASA logo is rendered in the real mounted editor surface
Scratch product logo/navigation/link is absent
header product chrome uses ASA primary colour
ASA avatar/account control is visible on the right without giving Scratch-origin account authority
Settings remains and contains the built-in language control
no separate Language/Язык header button exists
initial locale follows ASA preference / upstream browser detection / fallback=ru policy
Russian browser resolves to Russian without manual translation patches
switching language through Settings works with upstream localization
File remains visible
unsafe local import/export remains unavailable before M1-007
Edit remains visible
Extensions entry point remains visible and uses ASA product chrome
no Scratch Foundation network fallback occurs
Scratch block/category semantic colours remain unchanged
account/share/remix/backpack/cloud Scratch ownership remains absent
exactly three authorised upstream patches exist and apply cleanly
no second independently editable ASA logo is introduced
```

## Tests/evidence

Use actual mounted-editor DOM/browser/network evidence, not source grep only:

```text
ASA logo rendered
no Scratch logo/link to scratch.mit.edu
ASA header colour visible
ASA avatar/account surface visible on the right and owned by parent ASA UI
Settings visible
built-in language selector exists inside Settings
no duplicate Language/Язык top-level control
Russian locale selected on ru-RU/ru browser fixture
English locale selected on en-US/en browser fixture
unsupported non-English browser locale falls back to ru
Russian → English → Russian switching updates normal Scratch UI through upstream localization
File menu visible
File menu does not expose premature Save now / .sb3 import / .sb3 export success
Edit menu visible
Extensions button visible and ASA-themed
no account/share/backpack/cloud product ownership
semantic block/category colours match upstream Scratch baseline
network evidence contains no Scratch Foundation runtime fallback
exactly three accepted patches apply against the exact upstream pin
Docker rebuild succeeds on exact upstream pin
node tools/validate-blocks-docs.mjs
pnpm gate:blocks
pnpm gate:blocks --browser
```

## Forbidden

```text
no new top-level language button
no ASA-owned translation fork of Scratch strings
no hand-maintained duplicate list of Scratch translations merely for locale selection
no mass rebranding/upstream string rewrite
no global replacement of Scratch semantic colour variables
no new iframe authority beyond accepted C
no ASA cookie/account authority inside Scratch origin
no runtime token issuance changes
no real ScratchStorage/runtime persistence beyond accepted D fixture boundary
no fake save/load
no S3/MinIO
no premature .sb3 support
no hidden dependency on scratch.mit.edu
no fourth upstream patch without an explicit reviewed architecture decision
```

## Bounded self-review

Check only product chrome, localization, identity shell, selected controls, final diff and browser/network evidence. Verify that:

- Scratch remains upstream rather than being rewritten;
- language selection stays in Settings and is not duplicated;
- browser/default locale resolution reuses upstream detection and is tested;
- ASA avatar remains parent-owned;
- semantic Scratch category colours are unchanged;
- File/Extensions behaviour is truthful for the current milestone;
- `0003-file-menu-policy.patch` only gates File items and does not implement persistence or `.sb3` processing;
- `main.js` did not absorb branding/localization/theme business logic;
- the accepted C/D security and fixture boundaries remain intact;
- exactly three approved upstream patches exist.

## Stop

STOP after product-chrome/localization/identity evidence. `VSCR-M1-002E` is the next planned slice and performs the integrated host acceptance/review. E requires separate selection in `current.yaml`; do not begin it automatically.
