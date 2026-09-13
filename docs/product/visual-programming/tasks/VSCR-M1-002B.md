# VSCR-M1-002B — ASA product chrome, localization and identity shell

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** accepted VSCR-M1-002D and real editor DOM.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002B` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Productise the real mounted upstream Scratch editor without rewriting it: ASA branding/theme and parent-owned identity shell, correct initial locale, built-in Scratch language switching, familiar Settings/File/Edit/Extensions surfaces, and no premature persistence or `.sb3` claims.

## Components

```text
blocks.host.branding
blocks.host.localization
blocks.host.theme
blocks.host.identity-shell
blocks.host.file-menu
blocks.host.extensions
```

Read only those entries in `components/host.yaml` and their mapped D0-001 sections.

## Minimal read set

```text
../README.md
../components/host.yaml → selected entries
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → Branding / Localization / ASA theme boundary / ASA identity shell / Product controls / Extensions
apps/web/public/asa-lab-mark.svg
apps/web/src/components/PortalHeader.tsx          # avatar/account behaviour reference
apps/web/src/brand/brand.css                     # ASA palette reference
accepted C/D host/editor interfaces
```

## Expected write paths

```text
infra/scratch-editor/patches/0001-host-logo-prop.patch
infra/scratch-editor/patches/0002-extension-button-visibility.patch
infra/scratch-editor/patches/0003-file-menu-policy.patch
infra/scratch-editor/host/branding.js
infra/scratch-editor/host/editor-config.js
infra/scratch-editor/host/theme.css
infra/scratch-editor/host/main.js                 # composition only
infra/scratch-editor/Dockerfile
infra/scratch-editor/README.md
apps/web/src/blocks/**                            # parent avatar/account shell only when needed
e2e/blocks-host-controls.spec.ts
../components/host.yaml
```

## Localization

Use Scratch's own localization. Do not fork translations and do not add a separate top-level `Language` / `Язык` button.

Language stays inside the existing Scratch **Settings / Настройки** menu.

Initial locale policy:

```text
1. canonical ASA user locale, once such a preference exists;
2. otherwise Scratch's own browser-locale detection;
3. use upstream regional normalization (ru-RU → ru, en-US → en, etc.);
4. if upstream would fall back to English and the browser did not request English, fallback = ru.
```

Do not maintain a second ASA list of Scratch translations. Remove D's hard-coded `locale: 'en'`.

Required evidence:

```text
ru-RU/ru → Russian initial UI
en-US/en → English initial UI
unsupported non-English browser → ru fallback
Settings contains the built-in language selector
no duplicate Language/Язык control exists
Russian → English → Russian updates normal Scratch UI/block labels
no language operation needs scratch.mit.edu
```

## ASA product chrome

Canonical sources:

```text
logo: apps/web/public/asa-lab-mark.svg
header primary: #0877B3
header darker/border: #076B98
brand tokens: apps/web/src/brand/brand.css
```

Required header:

```text
ASA logo replaces Scratch product logo
no Scratch product navigation/link to scratch.mit.edu
Settings remains
File remains
Edit remains
ASA avatar/account appears on the right as parent-owned ASA UI
Scratch account/community/share/remix/backpack/cloud ownership remains absent
```

Reuse the existing ASA avatar/account behaviour. Do not pass ASA cookies to the Scratch origin and do not create a Scratch account system. Prefer a parent-owned overlay/shell visually aligned with the Scratch header.

## Theme boundary

Apply ASA colour to **product chrome only**:

```text
top product bar
Extensions launcher
sprite/backdrop add controls
selected sprite/product accent states
ASA-owned focus/selection chrome
```

Do not globally replace Scratch purple or `$looks-secondary`. Preserve the standard semantic colours of Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables and My Blocks.

## File / Edit policy

Keep familiar Scratch File and Edit menus. Do not expose false save or premature `.sb3` support.

At the pinned upstream, `canManageFiles` hides the whole File menu while local import/export items are unconditional inside `FileMenu`; configuration alone cannot meet this policy. Therefore B explicitly authorises:

```text
infra/scratch-editor/patches/0003-file-menu-policy.patch
```

Its only purpose is independent host control of **New / Load from computer / Save to computer**. It must not implement persistence or `.sb3` parsing.

B policy:

```text
File visible
Edit visible
New may remain with honest unsaved-work confirmation
Save now disabled until M1-005
Load from computer disabled/hidden until M1-007
Save to computer disabled/hidden until M1-007
```

M1-007 may later enable the same existing File-menu import/export entries; do not add duplicate ASA buttons.

## Extensions

Keep the Scratch Extensions entry point visible and ASA-themed.

```text
Extensions button visible
only local / explicitly approved sources
no Scratch Foundation runtime fallback
final sovereign extension allowlist remains M3-owned
```

Unavailable extensions may remain unavailable; do not hide the whole entry point merely to conceal unfinished policy.

## Authorised upstream patches

Exactly three patches are authorised for this pinned revision:

```text
0001-host-logo-prop.patch              # ASA logo
0002-extension-button-visibility.patch # Extensions host control
0003-file-menu-policy.patch            # File visible, unsafe items gated
```

Locale, theme and ASA identity shell use host configuration/CSS/parent composition. A fourth upstream patch requires a separate reviewed architecture decision.

## Acceptance

```text
real editor remains upstream Scratch
ASA canonical logo rendered; Scratch logo/navigation absent
header uses ASA primary colour
ASA avatar/account visible on right and remains parent-owned
Settings contains built-in language selector
no separate Language/Язык header button
browser/ASA locale policy works; Russian fallback works
File and Edit visible
Save now and .sb3 import/export unavailable before owning milestones
Extensions visible and ASA-themed
no Scratch Foundation runtime fallback
Scratch semantic block/category colours unchanged
no Scratch account/share/remix/backpack/cloud ownership
exactly three authorised upstream patches apply cleanly
```

## Browser/network evidence

```text
ASA logo and ASA header colour visible
parent-owned avatar/account visible
Settings → built-in language selector
no duplicate language button
ru-RU, en-US and unsupported-locale cases pass
Russian → English → Russian passes
File/Edit visible; premature Save/.sb3 actions absent
Extensions visible and ASA-themed
semantic Scratch category colours match upstream baseline
no scratch.mit.edu runtime traffic
Docker rebuild on exact pin
node tools/validate-blocks-docs.mjs
pnpm gate:blocks
pnpm gate:blocks --browser
```

## Forbidden

```text
no top-level language button
no ASA translation fork / duplicate translation list
no Scratch rewrite or mass string rebrand
no global semantic-colour replacement
no ASA cookie/account authority inside Scratch origin
no new iframe authority beyond C
no durable save before M1-005
no .sb3 support before M1-007
no S3/MinIO
no hidden Scratch Foundation dependency
no fourth upstream patch without explicit reviewed decision
```

## Bounded self-review

Self-review the exact B diff and browser/network evidence. Confirm language stays in Settings, ASA identity stays parent-owned, category colours stay upstream, File/Extensions behaviour is truthful, `0003` only gates File items, and C/D security/fixture boundaries remain intact.

## Stop

STOP after B evidence. `VSCR-M1-002E` requires separate selection.
