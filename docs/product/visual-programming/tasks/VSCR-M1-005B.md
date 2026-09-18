# VSCR-M1-005B — реальное хранение и browser save→close→open

**Kind:** executable implementation slice  
**Risk:** high  
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-005B` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.

## Goal

Подключить проверенный M1-005A save/open pipeline к реальным инфраструктурным
адаптерам ASA и редактору. Пользовательский checkpoint: изменить блоки,
спрайт и звук → сохранить в ASA → закрыть редактор → открыть тот же проект →
получить тот же project JSON и точные asset bytes.

## Prerequisite boundary

Exact M1-005A candidate: PR #286, `576bb086fc2daaa3a1c0d6445b6274e71d7a0388`.
005B разрабатывается поверх этого кандидата, но не объявляет 005A, PR #278,
B/E или M1-005 в целом принятыми. До merge/release обязательна общая независимая
проверка накопленной связки.

## Current execution routing

Текущий bounded implementation продолжается в существующем **Draft PR #288**:

```text
branch: codex/scratch-real-storage-005b
base: main
issue: #287
execution authority: docs/execution/current.yaml
```

Не создавать параллельную ветку или второй storage implementation. Перед любыми
тестами, review или merge получить **actual PR HEAD** из GitHub. SHA из старого
комментария, handoff или описания PR является только историческим наблюдением.

VSCR-M4-002 уже разрешает пользователям работать в настоящем Scratch через native
local File. Это отдельный режим доступности и **не является доказательством**
сохранения проекта в аккаунт ASA.

## Current implementation checkpoint

PR #288 now carries an **implemented candidate** for the bounded runtime path:

- real Parent Web runtime-session bootstrap;
- real read-only existing-project open from runtime-session project JSON and assets;
- explicit FLUSH using the live Scratch VM snapshot and exact current media bytes;
- asset PUT before canonical draft PUT with confirmed revision;
- deterministic canonical-document fingerprint and unchanged-FLUSH zero-write semantics;
- memory-only durable-asset knowledge across failed draft attempts;
- stable mutationId/baseRevision replay after ambiguous lost/5xx/malformed draft responses;
- explicit `revision_conflict` for `project_revision_conflict`;
- focused/browser evidence for first save, unchanged no-op, lost-response replay,
  a subsequent edit and conflict.

This remains a **candidate, not M1-005B acceptance**. The still-open acceptance boundary is
full save → close → fresh browser/session → reopen against the real PostgreSQL/object-storage
stack, plus the remaining authorization/storage acceptance and independent critical review.

Current bounded persistence semantics:

```text
runtime-session → real bootstrap/open
→ explicit FLUSH
→ live VM canonical fingerprint
→ unchanged: confirmed revision, zero writes
→ changed: missing durable asset PUTs
→ stable pending mutationId + canonical draft PUT
→ confirmed revision
→ ambiguous lost response: same mutationId/baseRevision replay
→ revision conflict: explicit fail-closed reason
```

## Scope

- Production `BlocksDurableAssetPort`: private S3-compatible blob store plus
  PostgreSQL metadata/aliases defined by D0-003; no physical object key in documents.
- Exact migration/RLS for `blocks_blobs` and `blocks_asset_aliases`, with negative
  cross-tenant tests and immutable alias semantics.
- Compose the existing generic `ProjectDraftPersistenceGuardPort` into the one
  production `SaveDraftUseCase`; generic `PUT /api/projects/{projectId}/draft`
  must not bypass Blocks durability validation.
- Bounded Blocks runtime API for asset upload/read and explicit project save/open,
  using existing Account/StudentSeat/Project Core authority and the accepted
  runtime-capability contract. Scratch iframe cookies are never authority.
- Parent/VM bridge supplies actual project JSON/assets and persists explicit save.
- Isolated browser acceptance proves save → close/reopen for program, costume and
  sound, plus foreign-project, revoked-access and storage-failure denials.

## Storage constraints

Use D0-003: `@aws-sdk/client-s3`, configured private S3-compatible storage and
MinIO for self-hosted/test when introduced. MinIO joins the existing ASA Compose
project; no public console, new permanent Compose project or silently invented bucket.

Runtime request shaping for this slice:

```text
per editor capability: 2400 runtime requests / 10 minutes
tracked capability windows: max 4096 per API process
broad pre-JWT runtime ceiling: 60000 requests / 5 minutes / client address
asset upload concurrency: 4 per capability (D0-003)
generic cookie/browser IP mutation limiter: not used for /api/blocks/runtime/**
```

The runtime-origin hook must pass before the generic school-NAT IP limiter is bypassed;
controllers still require the exact bearer capability/current-authority check.

## Optimisation evidence

This high-risk storage slice also follows D0-008 and the repository-wide hygiene policy.

Before acceptance record P0/P2 evidence for the representative browser save fixture:

- first save asset PUT count, bytes, blob rows and alias rows;
- repeated unchanged save MUST create 0 new unique asset bytes and 0 new blob/alias rows;
- repeated unchanged document fingerprint MUST create no redundant draft revision;
- same bytes reused by multiple Scratch references reuse one tenant blob;
- upload is streaming/bounded; a 25 MiB audio limit must not imply a permanent 25 MiB application buffer;
- canonical Scratch bytes remain exact; preview/thumbnail optimisation is separate;
- save/open latency and object-store request count are reported as measurements, not guesses;
- L1 cleanup is completed before acceptance; count this slice toward the Scratch heavy-lane L2 threshold of 2 accepted slices.

## Acceptance

- Real blob bytes are persisted before relational metadata and before draft commit.
- Server computes MD5/SHA-256/size/format; client cannot choose object key.
- Generic draft route and Blocks-specific route share the same guard semantics.
- Save failure never increments revision or returns success; retry keeps the same
  mutation identity; optimistic conflict remains explicit.
- Exact saved JSON and every referenced asset reopen after a new browser/editor session.
- Account and StudentSeat paths preserve current Project Core authorization.
- Runtime bearer/Origin checks fail closed; account cookies are not accepted by iframe routes.
- Focused/repository/browser gates run on the exact candidate SHA.
- Optimisation evidence proves no redundant unchanged asset/document writes and records storage/network measurements.

### Definition of Done

M1-005B остаётся `in_progress`, пока не доказано всё:

- [ ] Parent Web получает настоящий runtime-session, а не preview token.
- [ ] Child Scratch Host больше не использует fixture/local save path для ASA save/open.
- [ ] Project JSON сохраняется через существующий Project Core.
- [ ] Costume/image bytes сохраняются в private object storage и открываются byte-exact.
- [ ] Sound bytes сохраняются в private object storage и открываются byte-exact.
- [ ] Explicit save возвращает только подтверждённую сервером revision.
- [ ] Close → reopen того же проекта восстанавливает точное состояние.
- [ ] New browser session → reopen восстанавливает точное состояние.
- [ ] Foreign user/tenant access denied.
- [ ] Revoked access denied.
- [ ] Invalid Origin / expired capability / player write denied.
- [ ] Storage failure не возвращает Saved и не создаёт revision.
- [ ] Missing referenced asset не превращается в successful draft.
- [ ] Conflict не превращается в silent overwrite.
- [ ] Retry одной mutation не создаёт вторую revision.
- [ ] Repeated unchanged save создаёт 0 новых asset bytes/blob/alias rows.
- [ ] Unchanged canonical fingerprint создаёт 0 redundant revisions.
- [ ] P0/P1/P2/P3 evidence записано для exact candidate.
- [ ] `pnpm gate:blocks`, browser gate и repository gate прошли на candidate SHA.
- [ ] Независимый critical review выполнен до merge/release.

Только после этого допустима формулировка **«M1-005 durable ASA save/load готов»**.

## Out of scope

No autosave/recovery/conflict UI (M1-006), Gallery/Learning, arbitrary `.sb3`
import, public bucket, second backend/project DB, editor redesign or working-server
deployment. Do not change ports 4610/4613 or domain/FRP in this slice.

## Independent review

HIGH-risk integrated storage/auth slice requires an independent critical review
before merge/release. Author tests and green CI do not substitute that review.

## Stop

Stop after exact-candidate evidence. Do not auto-start M1-006 and do not deploy
until the owner separately authorises integration/deployment.

## Bounded self-review

Проверить, что этот срез не создаёт второй Project Core, отдельный Scratch backend,
новые порты или публичный bucket; production storage остаётся tenant-private.

По сохранению и оптимизации обязательно проверить:

- asset bytes durable до metadata и draft commit;
- unchanged document fingerprint не создаёт лишнюю ревизию;
- unchanged assets создают 0 новых unique bytes/blob/alias rows;
- одинаковые bytes в одном tenant переиспользуют один blob;
- canonical Scratch bytes не перекодируются ради оптимизации;
- upload/read остаются streaming/bounded и не превращают file limit в постоянный RAM buffer;
- object-store/network failure не превращается в `not found` или ложное `saved`;
- browser save→close→open восстанавливает exact project JSON и exact asset bytes;
- P0/P1/P2/P3 evidence и hygiene counter записаны честно;
- autosave/preview/M2 card work не начинается внутри 005B.

Если хотя бы один пункт не доказан, verdict не может быть PASS.
