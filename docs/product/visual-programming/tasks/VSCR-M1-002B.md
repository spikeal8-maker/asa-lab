# VSCR-M1-002B — ASA product chrome without rewriting Scratch

**Kind:** executable implementation slice  
**Risk:** high  
**Prerequisite:** accepted VSCR-M1-002D and real editor DOM.  
**Execution:** coding starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002B` **and** `docs/execution/current.yaml.task.status` is exactly `in_progress`; `docs/execution/current.yaml.primary_lane.milestone.id` must be exactly `VSCR-M1-002` and its `owner_authorization` must be `accepted`.

## Goal

Keep the real upstream Scratch editor and its familiar behaviour. ASA changes only product chrome and ASA-owned identity presentation: ASA logo, ASA colours around the editor and parent-owned ASA avatar/account surface.

Do not redesign Scratch Settings, do not create a second language control, do not replace Scratch localization and do not remove the normal Scratch Extensions ecosystem or its external integrations.

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

A separate Extensions-visibility patch is not part of B unless a later concrete defect proves it necessary and the architecture is reviewed first. The pinned upstream already renders the Extensions entry point normally.

## Localization and Settings — preserve upstream Scratch

Scratch's own Settings and localization are authoritative.

At the pinned upstream revision:

```text
canChangeLanguage default = true
Settings already contains the built-in Scratch language selector
EditorState detects browser locale when host does not force a locale
regional browser locale is normalized by Scratch when supported (for example ru-RU → ru)
```

Therefore B must **not implement a new language system at all**.

The only correction from the D fixture is:

```text
remove the hard-coded locale: 'en'
do not replace it with another hard-coded locale
do not add a top-level Language/Язык button
do not create an ASA copy of Scratch translations
do not create a second locale registry
```

After the hard-coded English override is removed, the pinned Scratch editor itself chooses its initial language from the browser using its existing detection logic. A Russian browser therefore opens Russian because upstream Scratch supports `ru`; an English browser opens English; other languages follow normal upstream Scratch behaviour, including Scratch's own fallback when a browser language is unsupported.

The existing Scratch Settings menu remains intact. Language switching stays inside Settings exactly as in normal Scratch. Other normal Settings options are not removed merely for ASA branding.

Required evidence:

```text
D's hard-coded locale='en' is absent
ru-RU/ru browser opens Russian through upstream Scratch detection
en-US/en browser opens English through upstream Scratch detection
Settings remains visible and contains the existing language selector
no duplicate Language/Язык control exists anywhere else
Russian → English → Russian works through the existing Scratch Settings menu
no ASA translation files/fork were added
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
no product-navigation click through the ASA logo to scratch.mit.edu
existing Scratch Settings remains
existing Scratch File remains
existing Scratch Edit remains
ASA avatar/account appears on the right as parent-owned ASA UI
Scratch account/community/share/remix/backpack/cloud ownership remains absent
```

Reuse existing ASA avatar/account behaviour. Do not pass ASA cookies to the Scratch origin and do not create a Scratch account system. Prefer a parent-owned overlay/shell visually aligned with the Scratch header.

## Theme boundary

Apply ASA colour to **product chrome only**:

```text
top product bar
Extensions launcher chrome
sprite/backdrop add controls where technically isolated
selected sprite/product accent states
ASA-owned focus/selection chrome
```

Do not globally replace Scratch purple or `$looks-secondary`. Preserve standard semantic colours of Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables and My Blocks.

## File / Edit policy

Keep familiar Scratch File and Edit menus. Do not expose false ASA save or premature `.sb3` support.

At the pinned upstream, `canManageFiles` hides the whole File menu while local import/export items are unconditional inside `FileMenu`; configuration alone cannot keep File visible while independently gating those items. Therefore B authorises:

```text
infra/scratch-editor/patches/0003-file-menu-policy.patch
```

Its only purpose is independent host control of **New / Load from computer / Save to computer**. It must not implement persistence or parse `.sb3`.

B policy:

```text
File visible
Edit visible
New may remain with honest unsaved-work confirmation
Save now disabled until M1-005
Load from computer disabled/hidden until M1-007
Save to computer disabled/hidden until M1-007
```

M1-007 may later enable the same familiar File-menu import/export entries; do not add duplicate ASA buttons.

## Extensions and external integrations — preserve upstream Scratch

The normal Scratch Extensions entry point and the normal upstream extension catalogue remain available.

B must **not** introduce an ASA allowlist that removes existing Scratch integrations merely because they use external services or hardware. Existing Scratch integrations such as network-backed services and peripheral integrations remain part of the Scratch experience. ASA may later add its own extensions or improve individual integrations in separately selected work.

Important distinction:

```text
core editor startup / ASA project loading / ASA asset loading
→ must not silently depend on scratch.mit.edu project or asset backends

user explicitly opens or uses a Scratch extension which normally needs an external service/device
→ its expected upstream external integration may operate normally
```

Therefore network acceptance must distinguish accidental hidden dependency from explicit extension behaviour. A test must not fail merely because a user-selected upstream Scratch extension legitimately calls the external service it was designed to use.

B does not redesign the extension catalogue, block external services globally, replace Scratch hardware flows, or create a new extensions subsystem.

## Authorised upstream patches

For B, prefer native upstream behaviour and host CSS/configuration. The currently required compatibility patches are:

```text
0001-host-logo-prop.patch   # ASA logo
0003-file-menu-policy.patch # File visible, premature file actions gated
```

Extensions use native upstream behaviour and need no visibility patch while the product requirement is to keep them available.

A new upstream patch requires a concrete demonstrated need and explicit architecture review before implementation.

## Acceptance

```text
real editor remains upstream Scratch
ASA canonical logo rendered; Scratch product logo/navigation absent
header uses ASA primary colour
ASA avatar/account visible on right and remains parent-owned
Scratch Settings remains structurally intact
built-in language selector remains inside Settings
no separate Language/Язык control exists
no host-forced English or host-forced Russian locale exists
browser language is handled by the existing Scratch locale mechanism
File and Edit remain visible
Save now and .sb3 import/export remain unavailable before owning milestones
Extensions entry point remains visible
normal upstream Scratch extension catalogue/integrations are not removed by B
expected external traffic caused by an explicitly used extension is allowed
core project/asset loading does not silently fall back to Scratch Foundation backends
Scratch semantic block/category colours remain unchanged
no Scratch account/share/remix/backpack/cloud ownership
only reviewed compatibility patches exist
```

## Browser/network evidence

```text
ASA logo and ASA header colour visible
parent-owned avatar/account visible
Settings remains normal Scratch Settings
Settings → built-in language selector
no duplicate language button
ru-RU and en-US initial locale cases pass using upstream detection
Russian → English → Russian passes through Settings
File/Edit visible; premature Save/.sb3 actions absent
Extensions visible and normal upstream entries remain available
explicit extension external traffic is distinguished from hidden core dependency
semantic Scratch category colours match upstream baseline
core Scratch host does not fetch project/assets from Scratch Foundation unexpectedly
Docker rebuild on exact pin
node tools/validate-blocks-docs.mjs
pnpm gate:blocks
pnpm gate:blocks --browser
```

## Forbidden

```text
no top-level language button
no ASA translation fork / duplicate locale registry
no hard-coded locale='en'
no hard-coded locale='ru'
no redesign/removal of Scratch Settings
no blanket removal of existing Scratch extensions or external integrations
no ASA extension allowlist in B
no Scratch rewrite or mass string rebrand
no global semantic-colour replacement
no ASA cookie/account authority inside Scratch origin
no new iframe authority beyond C
no durable save before M1-005
no .sb3 support before M1-007
no S3/MinIO
no hidden core dependency on Scratch project/asset backends
no new upstream patch without explicit reviewed need
```

## Bounded self-review

Self-review the exact B diff and browser/network evidence. Confirm Settings and its built-in language control were preserved rather than reimplemented; only D's forced English locale was removed; normal Scratch Extensions and their intended integrations remain; ASA identity remains parent-owned; category colours remain upstream; File behaviour is truthful; and C/D boundaries remain intact.

## Independent review

A reviewer outside the authoring context checks the exact final diff and evidence. Verify that no new language control or translation fork exists, Scratch Settings was not redesigned, existing Extensions were not arbitrarily filtered, ASA avatar/account authority remains parent-owned, semantic Scratch category colours are unchanged, and File controls do not claim later capabilities. The reviewer does not edit reviewed product code.

## Stop

STOP after B evidence and independent review. `VSCR-M1-002E` requires separate selection.
