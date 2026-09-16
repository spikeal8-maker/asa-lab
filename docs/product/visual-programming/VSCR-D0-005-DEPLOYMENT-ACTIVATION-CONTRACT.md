# VSCR-D0-005 — Blocks deployment, backup and activation contract

**Status:** accepted design contract for Visual Programming  
**Master:** `../ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`

Этот контракт фиксирует deployment/backup/restore/activation. Он не требует ломать штатные Scratch Extensions ради офлайн-режима.

## Deployment principle

Scratch runtime работает на отдельном browser origin, но остаётся частью одной установки ASA Lab.

```text
student browser
├── ASA Web/API origin
└── Blocks runtime origin

server/install
├── ASA Web/API/PostgreSQL
├── Scratch runtime container
└── private S3-compatible object storage
```

Separate origin не означает отдельный аккаунт, БД или второй продукт.

## Required configuration

```text
ASA_WEB_ORIGIN
ASA_BLOCKS_RUNTIME_ORIGIN
ASA_BLOCKS_RUNTIME_PORT
ASA_BLOCKS_RUNTIME_BIND_ADDRESS
```

Object storage/security configuration определяются профильными контрактами. Все origins валидируются как абсолютные origins.

## Browser-visible runtime URL rule

`127.0.0.1` допустим только когда browser и server находятся на одной development-машине. Ученическому browser на другом ПК сервер должен отдавать реальный LAN/public runtime origin.

## Supported deployment shapes

Поддерживаются:

```text
developer localhost
school LAN
public/reverse-proxy HTTPS
```

При HTTPS parent runtime тоже HTTPS. Не создавать mixed-content.

## Docker/Compose ownership

Scratch runtime входит в существующий ASA Compose project:

```text
scratch-editor
  build: infra/scratch-editor/Dockerfile
  internal port: 8080
  health: /healthz
  no database credentials
  no ASA account/session cookie secret
  no object-store credentials
```

Не создавать отдельный обязательный docker-compose для Scratch.

## Runtime networking principle

Нужно различать core ASA/Scratch и явно выбранные пользователем внешние возможности.

```text
CORE:
ASA project loading
ASA asset loading
Scratch editor boot
ASA save/load
→ не должны скрытно зависеть от Scratch project/asset services

OPTIONAL EXTERNAL INTEGRATION:
Text to Speech / Translate / hardware / other upstream extension
→ может использовать свой внешний service/device, когда пользователь его выбрал
```

Не вводить blanket browser network deny, который ломает штатные Extensions. Не считать ожидаемый запрос выбранного расширения архитектурным нарушением.

Если школа работает без интернета, core editor/project flow обязан продолжать работать; network-backed extension может показать понятное unavailable/degraded состояние. Позже ASA может дать локальную альтернативу.

## Object storage placement

Self-hosted deployment может использовать MinIO в том же Compose project, public/cloud — configured S3-compatible endpoint.

API — единственный компонент с long-lived object-store credentials. Browser/Scratch container получают только ASA API URLs/capabilities.

## Availability lifecycle

```text
Owner-selected VSCR-M4-002: active local-file editor for all users
M1/M2/M3: managed persistence/security/product work continues separately
M4-001: managed-persistence production acceptance, not basic visibility
```

Решение владельца 16.09.2026 заменяет запрет ранней видимости: локальный редактор
доступен без preview-флага. Готовность server save/restore и полной эксплуатации
по-прежнему нельзя заявлять по одному save/load или изменению availability.

## Backup consistency invariant

Save order:

```text
blob bytes persisted
→ blob/alias metadata committed
→ project document revision committed
```

Safe backup baseline:

```text
1. record build/config identity
2. capture PostgreSQL
3. copy/mirror Blocks object storage without destructive delete
4. build manifest/digests
5. verify every captured DB asset reference exists in captured object set
6. mark success only after validation
```

Missing referenced blob = failed backup.

## Restore acceptance

Only isolated restore:

```text
restore DB into isolated DB
restore objects into isolated bucket/prefix
start isolated ASA stack
open historical Blocks project/version
verify projectJson
verify referenced assets/digests
run player
verify ASA .sb3 flow when M1-007 is already accepted
```

Production restore is never part of ordinary feature development.

## Dependency degradation

States should distinguish:

```text
READY
BLOCKS_RUNTIME_UNAVAILABLE
BLOCKS_STORAGE_UNAVAILABLE
BLOCKS_DEGRADED
OPTIONAL_EXTENSION_UNAVAILABLE
```

Blocks dependency outage must not take down Electronics/Chess/Checkers/3D/Learning shell or normal ASA account APIs.

Unavailable optional extension service/device should degrade that extension, not the whole Blocks runtime.

## Sovereign deployment test

M3 browser-side evidence proves core independence, not a blanket ban on external integrations.

Test at least:

```text
ASA page loads
runtime iframe loads from configured ASA origin
ASA project opens without Scratch project backend
ASA assets load from ASA/local configured storage
edit/save/reload works
historical version/player works
Gallery/Learning flows work as applicable
backup/restore candidate works
```

Then test network conditions separately:

```text
Scratch project/asset backend unavailable
→ core ASA Scratch project still works

full internet unavailable
→ core ASA Scratch project still works
→ network-backed optional extensions may be unavailable but fail clearly

internet available + user explicitly selects a native external extension
→ intended service/device integration is allowed; do not block merely because it is external
```

Browser network log must distinguish accidental core fallback from explicit extension traffic.

## LAN classroom load test

Before activation run representative shared-LAN/NAT test, at minimum:

```text
30 concurrent editor sessions
representative small projects
>= 5 min edit/autosave activity
occasional costume/sound upload
```

Assert no lost revisions, cross-tenant asset access, false ordinary-load rate limiting or whole-platform failure.

## Activation task VSCR-M4-001

Activation is a separate narrow change:

```text
BLOCKS_MODULE.manifest.availability
local-file editor → verified managed-persistence rollout
```

Activation must not simultaneously invent storage, auth, library replacement, backup tooling or upstream update.

## Activation preflight evidence

Required before `active`:

```text
M1 durability/security acceptance
M2 product acceptance
M3 deployment/backup/restore acceptance
browser save/reload
core-independence network test
historical-version restore
viewer write denial
Learning immutable submission
Gallery/remix
30-client LAN/NAT workload
DB + object-store backup/restore
runtime origin/CSP/CORS negative tests
dependency security/license gates
Compose validation
```

Do not require every optional third-party extension to work without internet. Do require that such failure is isolated and understandable.

## Post-activation rollback

Rollback may stop new Blocks creation but must preserve drafts, versions, aliases/blobs and recoverability. Never rollback by deleting learner data.

## Upstream/runtime deployment update

Changing Scratch pin is separate from app deployment and requires upstream compatibility gates. No automatic live replacement merely because upstream changed.

## Expected changed paths for deployment slices

```text
compose*.yaml
infra/scratch-editor/**
apps/api/src/blocks-*.ts
apps/web/src/blocks/**
.env*.example
tools/** only for authorised deployment/backup tooling
tests/blocks/**
e2e/blocks-*.spec.ts
schemas/openapi.yaml when contract changes
docs/product/visual-programming/**
```

No deploy/restart is implied by committing code.

## Focused deployment/activation acceptance

Before `active` prove:

```text
remote browser receives reachable runtime origin
LAN/HTTPS topology rules work
Scratch runtime joins existing Compose project
runtime container has no DB/object/account secrets
Blocks outage isolated from other modules
backup contains DB + object set
missing referenced blob is detected
isolated restore opens historical work
core independence passes without Scratch project/asset backend
optional external extension failure is isolated; explicit extension traffic is allowed
30-session LAN/NAT workload passes
module remains visible; managed persistence claims require their accepted gates
activation diff is narrow
rollback preserves data
```

## Portable local-file installation

Owner follow-up for VSCR-M4-002 requires Scratch in the normal tracked Compose
stack and removes the permanent ready-state footer. This replaces earlier
preview-only delivery and always-visible no-save notice requirements, not the
unimplemented server-storage or full activation/backup milestones.

Fresh Windows/Linux startup must build the pinned runtime from tracked sources,
without machine-specific artifact paths. Standard local origins use different
hostnames and ports. Existing environments/credentials are preserved. Health
requires coherent Web/API/Scratch revisions. Errors remain explicit; a missing
runtime must never be reported as a complete successful installation.

CI exports tracked sources into a new directory, creates its private environment,
uses a disposable `_test` database, runs POSIX and PowerShell startup, checks
unchanged credentials and the real home/create/editor/native-file/home path.
The same source-build path is used for normal deployment; GitHub CI, backup,
origin checks and deployment receipts are not waived.
No working-site domain or tunnel changes are part of this local-port repair.
