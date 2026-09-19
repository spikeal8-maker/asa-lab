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

PR #288 now carries an **implementation-complete candidate** for the bounded M1-005B path.
Independent critical review, merge and release remain pending.

Implemented and evidenced:

- real Parent Web runtime-session bootstrap;
- real read-only existing-project open from runtime-session project JSON and assets;
- parent-owned explicit `Сохранить в ASA` control with one FLUSH in flight and distinct
  `Сохранение…` / `Сохранено` / `Ошибка сохранения` / `Конфликт сохранения` states;
- explicit FLUSH using the live Scratch VM snapshot and exact current media bytes;
- asset PUT before canonical draft PUT with confirmed revision;
- deterministic canonical-document fingerprint and unchanged-FLUSH zero-write semantics;
- memory-only durable-asset knowledge across failed draft attempts;
- stable mutationId/baseRevision replay after ambiguous lost/5xx/malformed draft responses;
- explicit `revision_conflict` for `project_revision_conflict`;
- real PostgreSQL + private MinIO/S3-compatible save → destroy browser context →
  re-authenticate → fresh runtime-session → exact reopen;
- byte-exact costume/image and sound proof after fresh reopen;
- immediate fresh-reopen no-op with zero asset/draft/object-store writes and zero
  blob/alias/revision deltas;
- Account and StudentSeat authorization journeys plus foreign/revoked/origin/storage negatives;
- exact-SHA focused/browser/repository CI.

Implementation evidence SHA:

```text
f4012afa9d056acb8ec54cb365e806094c6df3e3
```

Portable real-stack evidence:

```text
first save:
  asset PUT          = 10
  uploaded bytes     = 293385
  draft PUT          = 1
  revision delta     = +1
  blob rows          = +10
  alias rows         = +10
  MinIO objects      = +10
  object bytes       = +293385
  save latency       = 898.41 ms

fresh reopen:
  asset GET          = 5
  revision           = 2
  reopen latency     = 2339.54 ms
  exact project JSON = confirmed

fresh no-op:
  asset PUT          = 0
  draft PUT          = 0
  uploaded bytes     = 0
  object requests    = 0
  blob rows          = +0
  alias rows         = +0
  object rows/bytes  = +0 / +0
  revision delta     = 0
```

Media proof:

```text
Abby-a.svg:
  MD5      809d9b47347a6af2860e7a3a35bce057
  SHA-256  fd571722a4ccfac705c28aaef6e6310bbd346929b440878c20cbc0ec484e9956
  bytes    62926

Bark.wav:
  MD5      cd8fa8390b0efdd281882533fbfcfcfb
  SHA-256  f9a29b2bb69d732182cb3fcb775a4a9d1888462b81a2a1b01072c25b09cee127
  bytes    6380
```

The before/after digests and sizes are identical. Fresh reopen obtains the durable
media through runtime asset GET, not stock-library fallback.

Authorization/failure evidence on the same disposable real stack:

```text
Account save/reopen revision       = 2 / 2
StudentSeat save revision          = 2
foreign bootstrap                  = 404
foreign asset                      = 401
foreign draft                      = 401
invalid Origin                     = 403
revoked capability                 = 403
storage failure UI                 = error
storage failure revision           = 2 → 2
portal cookie leaked to runtime    = false
browser page errors                = 0
```

Expired capability and player-write denials remain covered by the focused runtime
security suite; missing referenced asset, optimistic conflict and same-mutation replay
remain covered by the focused Project Core/Blocks persistence and browser suites.
No already-proven mechanism was rewritten for this closure.

This is **not** owner acceptance. `M1-005B` stays `in_progress`; the only open DoD
item is independent critical review before merge/release.

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

- [x] Parent Web получает настоящий runtime-session, а не preview token.
- [x] Child Scratch Host больше не использует fixture/local save path для ASA save/open.
- [x] Project JSON сохраняется через существующий Project Core.
- [x] Costume/image bytes сохраняются в private object storage и открываются byte-exact.
- [x] Sound bytes сохраняются в private object storage и открываются byte-exact.
- [x] Explicit save возвращает только подтверждённую сервером revision.
- [x] Close → reopen того же проекта восстанавливает точное состояние.
- [x] New browser session → reopen восстанавливает точное состояние.
- [x] Foreign user/tenant access denied.
- [x] Revoked access denied.
- [x] Invalid Origin / expired capability / player write denied.
- [x] Storage failure не возвращает Saved и не создаёт revision.
- [x] Missing referenced asset не превращается в successful draft.
- [x] Conflict не превращается в silent overwrite.
- [x] Retry одной mutation не создаёт вторую revision.
- [x] Repeated unchanged save создаёт 0 новых asset bytes/blob/alias rows.
- [x] Unchanged canonical fingerprint создаёт 0 redundant revisions.
- [x] P0/P1/P2/P3 evidence записано для exact candidate.
- [x] `pnpm gate:blocks`, browser gate и repository gate прошли на candidate SHA.
- [ ] Независимый critical review выполнен до merge/release.

Текущий максимум формулировки: **«M1-005B implementation complete — independent critical review pending»**. Не `done`, не `accepted`, не `merged`.

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
