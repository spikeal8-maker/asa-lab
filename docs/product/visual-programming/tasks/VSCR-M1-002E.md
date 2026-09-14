# VSCR-M1-002E — Integrated host acceptance and independent review

**Kind:** acceptance/review slice; no new architecture  
**Risk:** high  
**Prerequisite:** VSCR-M1-002A, C, D and B each accepted on their own exact evidence.  
**Execution:** review starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-002E` and `docs/execution/current.yaml.task.status` is exactly `in_progress`; milestone `VSCR-M1-002` must remain owner-authorised.

## Goal

Доказать, что полный M1-002 host работает как единая ASA-owned поверхность, при этом настоящий Scratch не был переписан или урезан ради брендинга.

## Components

```text
blocks.upstream.pin
blocks.host.build
blocks.host.protocol
blocks.host.storage-adapter
blocks.host.branding
blocks.host.localization
blocks.host.theme
blocks.host.identity-shell
blocks.host.file-menu
blocks.host.extensions
```

## Minimal read set

```text
../README.md
../AGENT_GUIDE.md
../COMPONENT_MAP.yaml
../components/module.yaml → blocks.upstream.pin only
../components/host.yaml
../VSCR-D0-001-SCRATCH-HOST-CONTRACT.md → M1-002 acceptance
accepted A/C/D/B evidence and final diff
```

## Expected write paths

Acceptance normally changes no product implementation. Allowed writes are limited to acceptance evidence/tests or routing corrections:

```text
e2e/blocks-host-acceptance.spec.ts
.github/workflows/scratch-focused.yml or focused successor
../components/host.yaml
```

Product defect → FAIL/STOP → separate repair task. E does not silently fix product code.

## Integrated acceptance

Browser/Docker/network evidence must prove at least:

```text
exact pinned Scratch version/commit reported
shipping standalone dist used
real editor mounts only after valid INIT
workspace/stage render; controlled programme runs/stops
canonical ASA logo rendered instead of Scratch product logo
ASA top product bar uses ASA colour
Scratch semantic programming-category colours unchanged
ASA avatar/account is parent-owned; Scratch origin has no ASA cookie/account authority
Scratch Settings remains structurally native
built-in language selector remains inside Settings
no separate Language/Язык button exists
D hard-coded locale='en' is gone
ru-RU and en-US initial locale follow upstream Scratch detection
Russian → English → Russian works through normal Scratch Settings
File remains native Scratch
Edit remains native Scratch
native local New / Load from computer / Save to computer were not removed by B
upstream Scratch server-save is not presented as ASA durable save
Extensions entry point and upstream catalogue remain
existing external-service/hardware integrations were not blanket-filtered by B
explicit extension traffic is distinguished from hidden core project/asset fallback
core ASA project/asset loading does not silently use Scratch Foundation project/asset backend
wrong source/origin/project/nonce/protocol rejected
runtime token absent from URL/persistent browser storage/logs
no postMessage '*'
PROJECT_CHANGED reaches ASA host after stable load
player fixture read-only
runtime failure leaves ASA parent alive with controlled error state
```

E must not require all optional third-party/network-backed extensions to work offline. If a selected extension's own service/device is unavailable, that is extension-specific degradation, not proof that the core editor is broken.

## Tests/evidence

```text
integrated browser acceptance journey
Docker exact-pin build + health/root smoke
core project/asset network log
ru-RU and en-US locale cases
Russian → English → Russian through Settings
ASA logo/header/avatar checks
native Settings/File/Edit/Extensions presence checks
representative upstream extension catalogue entries still present
semantic category colour baseline
focused A/C/D/B gates
node tools/validate-blocks-docs.mjs
required repository gate on exact final SHA
```

## Independent review

Reviewer is a different agent/context or a human. Reviewer checks:

```text
no Scratch rewrite hidden in B
no Settings redesign
no second language control/translation fork
no blanket filtering of Extensions/external integrations
no accidental semantic-colour replacement
ASA avatar authority still parent-owned
no new unreviewed upstream patch
no hidden Scratch project/asset backend dependency for core ASA flow
no accidental ASA durable-save claim
```

Reviewer does not edit reviewed product code.

## Forbidden

```text
no new M1-002 feature invented during E
no product-code repair hidden inside review
no forced locale
no language UI replacement
no blanket network deny for native extensions
no File/Edit replacement
no new upstream patch
no runtime JWT work
no S3/MinIO
no ASA durable save/autosave implementation
no M1-003 work
no activation
```

## Bounded self-review

Confirm E changed no product architecture, accepted component cards point to real sources/tests and the final evidence distinguishes core ASA independence from explicit extension dependencies.

## Stop

STOP after independent review and exact-SHA evidence. M1-002 still requires explicit owner acceptance before M1-003 becomes selectable.
