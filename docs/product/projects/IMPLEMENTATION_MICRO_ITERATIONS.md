# ASA Lab Public Projects — Micro-Iteration Implementation Plan

**Статус:** execution playbook для разработчика Public Projects.  
**Исполнитель:** один bounded slice за один проход.  
**Основной канал:** GitHub branch → PR → CI/evidence → acceptance → merge/STOP.  
**Fallback:** подключённый авторизованный компьютер используется только когда GitHub не способен выполнить необходимую локальную операцию: Docker/PostgreSQL, browser/WebGL evidence, bundle profiling, конфликтную multi-file правку или диагностику локального окружения.

Этот документ не заменяет `ASA_PROJECTS_IMPLEMENTATION_TZ.md`, task cards или `docs/execution/current.yaml`. Он определяет **как именно разработчик разбивает их на маленькие безопасные изменения**.

---

## 0. Общие правила выполнения

### 0.1. Один PR — один доказуемый результат

Обычный PR не должен одновременно менять:

- схему БД;
- публичный API;
- крупный UI;
- module viewer;
- moderation.

Исключение допускается только когда контракт невозможно проверить отдельно и это явно объяснено в PR.

### 0.2. Ветка всегда от свежего `main`

Перед каждой микро-итерацией:

1. прочитать `docs/execution/current.yaml`;
2. проверить активный Projects task;
3. получить актуальный `main` SHA;
4. сравнить его с последним Projects audit baseline;
5. при релевантном delta обновить только затронутую часть аудита;
6. создать новую короткоживущую ветку от свежего `main`.

Не продолжать месяцами одну feature branch.

### 0.3. Имена веток

Примеры:

```text
projects/r3-convergence
projects/r7-01a-publication-revision-schema
projects/r7-01b-publish-exact-version
projects/r7-01c-legacy-convergence
projects/r7-02a-public-route
projects/r7-03a-artifact-envelope
projects/r8-01c-discovery-grid
```

### 0.4. Каждый PR обязан содержать

- точный scope;
- `REUSE / MODIFY / BUILD / DO-NOT-TOUCH`;
- before/after contract;
- migrations/API diff, если есть;
- тесты и команды;
- security/privacy negatives, если затронут public access;
- hygiene counter;
- exact final SHA;
- rollback/fallback;
- явный `NEXT = STOP` либо ссылка на owner-selected следующий slice.

### 0.5. Hygiene

- L0: каждое изменение;
- L1: каждая принятая микро-итерация;
- L2: после 3 обычных либо 2 high-risk итераций, а также раньше по event trigger;
- L3: перед release/owner acceptance крупного этапа.

Data migration, anonymous authorization, public artifact, viewer/runtime и media pipeline считаются high-risk для планирования cleanup даже если общая policy допускает более широкий класс.

---

# 1. PRE-R7 — Converge фактический R3 state

Это первый фактический шаг разработчика до Public Projects coding.

## R3-C1 — Доказать, что R3B уже в `main`

**Цель:** убрать ложный blocker, не вливая устаревший PR #112 повторно.

Проверить на current `main`:

- commit `731140d` (`feat(projects): deliver R3B project lifecycle hub`) присутствует в истории;
- `ProjectStatus`, archive/trash/restore и duplicate реально есть;
- `migrations/0013_project_lifecycle.sql` применима;
- current My Projects использует lifecycle/search/sort/pagination;
- `project_versions` immutable;
- current `e2e/project-hub.spec.ts` соответствует существующему UI.

Gate:

- `pnpm test:project-slice`;
- текущий creator-portal/project-hub focused gate;
- browser Project Hub journey;
- repository/governance gate.

Если GitHub не может запустить нужный focused workflow, выполнить на подключённом компьютере в чистом checkout current `main` с изолированной БД.

**Результат:** evidence документ. Production code не меняется.

## R3-C2 — Control-plane convergence

Только после PASS R3-C1 и owner acceptance:

- PR #112 закрывается как superseded/already integrated, а не merged;
- Issue #37 закрывается completed;
- `current.yaml` фиксирует accepted R3 state;
- следующий Projects task выбирается явно как `PROJ-R7-01`.

Это отдельная governance-итерация. Не смешивать её с R7 migration.

---

# 2. PROJ-R7-01 — Publication Foundation, разбитый на микро-PR

## R7-01A — PublicationRevision schema only

**Меняем:** одну additive migration + DB tests.

Добавить понятия:

- publication identity/current state;
- immutable publication revision;
- exact `project_version_id` FK;
- revision number;
- live/current revision pointer либо эквивалентную current-state projection;
- timestamps/state, необходимые следующему срезу.

**Не менять:** Gallery UI, anonymous read, copy, share links.

Acceptance:

- non-empty migration test;
- FK не позволяет version другого Project;
- revision immutable;
- существующая Gallery продолжает работать.

Risk: HIGH. L1 обязателен.

## R7-01B — Publish exact ProjectVersion

**Цель:** новые publish операции создают/выбирают exact immutable ProjectVersion и PublicationRevision.

Меняем только publish transaction/service/function и focused API/DB tests.

Проверить:

```text
publish v1
→ edit Working Draft
→ live revision всё ещё v1
```

Legacy publication read пока сохраняется compatibility path.

## R7-01C — Legacy publication convergence

**Цель:** существующие `project_publications` не потерять.

До кода закрыть `DEC-PROJ-104` retention reactions.

Стратегия не должна притворяться, что `snapshot_revision` исторически равен ProjectVersion. Legacy convergence помечается явно.

Проверить на непустой БД:

- publication count preserved;
- reactions preserved;
- Collections references preserved;
- provenance preserved;
- repeated migration deterministic/idempotent where repository convention requires.

**После 01A–01C:** обязательный L2, потому что три data-layer итерации завершены и есть migration risk.

## R7-01D — Non-destructive revoke/unpublish

Заменить destructive delete semantics target-state переходом.

Проверить:

- public access прекращён;
- Project сохранён;
- ProjectVersion сохранён;
- PublicationRevision history сохранена;
- reactions не исчезают побочным cascade;
- republish не переписывает старую revision.

## R7-01E — Safe anonymous public metadata

Создать sanitized read contract для eligible public publication.

DTO содержит только публично разрешённые поля.

Обязательные negatives:

- raw `document_json` отсутствует;
- tenant/class/school ids отсутствуют;
- private/revoked denied;
- StudentSeat/assignment policy fail closed;
- anonymous mutations запрещены.

Не снимать auth с legacy endpoint, пока он читает mutable draft.

Risk: HIGH.

## R7-01F — Unlisted ShareLink

Отдельный PR:

- opaque token;
- server-side digest/validation;
- optional expiry;
- revoke;
- unlisted absent from discovery;
- token не даёт write capability.

Не смешивать с публичным routing UI.

**После 01E–01F:** L2 — две high-risk security/public-access итерации.

## R7-01G — Copy/Remix source convergence

Существующий copy stack не заменять.

Меняется только source:

```text
live PublicationRevision
→ exact ProjectVersion.document_json
→ existing independent personal Project copy
→ permanent provenance
```

Проверить, что изменение Working Draft после публикации не меняет копируемый результат.

## R7-01H — R7-01 integration acceptance

Без новых product features.

- существующий Gallery E2E;
- anonymous public metadata journey;
- unlisted/revoke journey;
- exact-version copy journey;
- My Projects regression;
- migrations on non-empty DB;
- security negatives;
- L1 + актуальный L2;
- evidence exact SHA.

После PASS — STOP. `R7-02` не начинается автоматически.

---

# 3. PROJ-R7-02 — Public Project Page

## R7-02A — Canonical route + legacy compatibility

Закрыть `DEC-PROJ-101`.

Сделать только routing:

- новый stable public URL;
- legacy `/gallery/:id` продолжает открываться/redirect;
- direct reload/back/forward;
- `/projects` остаётся My Projects.

Контент страницы может временно использовать минимальный static component.

## R7-02B — Static project page core

На safe R7-01 metadata:

- preview;
- title;
- author safe projection;
- description/tags;
- license;
- provenance;
- unavailable state.

Без interactive viewer.

Responsive desktop/mobile и accessibility сразу, а не поздним refactor.

## R7-02C — Save + Share actions

- `Сохранить` → existing Collections;
- share → stable public URL/Web Share/copy link;
- no second bookmarks domain.

## R7-02D — `Сделать свою версию`

Подключить R7-01G copy/remix flow.

UX states:

- busy;
- success;
- open copy;
- stay here;
- permission/unavailable error.

## R7-02E — Owner controls + mobile/a11y acceptance

- owner state/actions, которые уже существуют в R7 foundation;
- mobile first viewport evidence;
- 320/360/390/430 + desktop samples;
- no horizontal overflow;
- keyboard/focus/200% zoom;
- static fallback always works.

После accepted 02A–02C обычный L2 threshold достигнут; выполнить L2 до завершения 02D/02E или на границе P1 milestone.

**P1 ready после accepted R7-01 + R7-02.**

---

# 4. PROJ-R7-03 — Public Artifact Contract

## R7-03A — Artifact envelope + schema tests

Только module-neutral versioned envelope, limits и capabilities type.

Никакого 3D/Electronics payload ещё нет.

## R7-03B — Adapter interface/registry + static-only adapter

- module adapter contract;
- registry;
- unsupported module → `static-only`;
- no giant controller switch;
- no editor imports.

## R7-03C — Artifact service/auth/cache semantics

- resolve PublicationRevision;
- resolve exact ProjectVersion;
- call adapter;
- validate size/depth;
- cache identity bound to revision + artifactVersion;
- fail closed to static preview.

## R7-03D — Security integration gate

- private/revoked/unlisted-without-token denied;
- Working Draft mutation does not change artifact;
- malformed/oversized payload fails safely;
- no secrets/private metadata;
- static page survives artifact failure.

R7-03 is high-risk. L2 после двух accepted high-risk микро-итераций и снова на final milestone if needed.

---

# 5. PROJ-R7-04 — Module viewers

Каждый viewer — отдельная серия PR и отдельный release capability.

## R7-04A — 3D

### 04A.1 3D artifact adapter

Sanitize exact ProjectVersion into minimal read-only geometry/scene contract.

### 04A.2 3D viewer

- rotate;
- zoom;
- reset;
- fullscreen;
- static preview before load.

### 04A.3 mobile/performance/cleanup

- touch gestures;
- lazy chunk;
- WebGL resource disposal;
- reduced motion;
- low-end/mobile evidence.

## R7-04B — Electronics

Начинать только после stable Electronics public engine boundary.

### 04B.1 Electronics artifact adapter

Minimal schematic + capabilities. No editor DTO leak.

### 04B.2 Read-only schematic viewer

Только просмотр схемы и статуса.

### 04B.3 Safe simulation runner

- run/stop/reset;
- runtime limits;
- honest unsupported diagnostic;
- cleanup;
- no write to source.

## R7-04C — Blocks

Начинать после stable Blocks/Scratch host boundary.

1. artifact adapter;
2. read-only blocks/result surface;
3. controlled run + fullscreen/performance.

## R7-04D — Games

Не строить один магический universal game runtime.

1. generic public runner contract;
2. первая конкретная stable game integration;
3. controls/fullscreen/sandbox/reload cleanup;
4. следующая игра — отдельный bounded sub-slice.

Viewer/media runtime = high-risk, поэтому L2 после каждых двух accepted viewer sub-slices или раньше при bundle/runtime trigger.

---

# 6. PROJ-R7-05 — Publication Editor, Media, Revisions

## R7-05A — Publication metadata draft

Текст/metadata only:

- draft;
- autosave;
- dirty/saved state;
- no live publication mutation.

Перед этим определить ownership/resolver для существующих `projects.description/tags/license`, чтобы не появилось два равноправных mutable source of truth.

## R7-05B — Preview + publish draft revision

- preview exact draft;
- atomic publish;
- live page changes only after publish.

## R7-05C — Revision history + restore

Restore создаёт новую revision, историю не переписывает.

После 05A–05C — L2.

## R7-05D — Image media foundation

- upload limits/MIME;
- metadata strip;
- storage;
- responsive variants;
- thumbnail;
- ACL/moderation hook;
- delete semantics.

## R7-05E — Cover/gallery/physical-result UX

- cover;
- ordering;
- captions/alt;
- photo of print/build;
- mobile camera upload.

## R7-05F — Video (optional gated sub-slice)

Только после `DEC-PROJ-108` и реального processing pipeline. Иначе flag OFF; R7 не блокируется.

---

# 7. R7 Release Gate

До R8 выполнить отдельный acceptance PR/report без новой функции:

- R7-01 accepted;
- R7-02 accepted;
- R7-03 accepted;
- R7-05 accepted;
- viewer capability matrix фиксирует, какие R7-04 реально поддержаны;
- остальные типы имеют static fallback;
- L3 hygiene/release audit;
- security/privacy regression;
- owner visual evidence;
- exact release SHA.

После owner acceptance — STOP и отдельный control-plane transition в R8.

---

# 8. PROJ-R8-01 — Discovery catalog

## R8-01A — Discovery API cursor/search

Расширить existing Gallery/list backend additive:

- cursor;
- q;
- module/category;
- real sort modes only.

Без нового UI.

## R8-01B — Public card DTO/mapper

Card payload минимален:

- preview;
- type;
- title;
- author;
- real compact metrics;
- up to 2 badges.

No full description/raw document.

## R8-01C — Projects grid

- real card component;
- 4 desktop / 3 / 2 / 1 contract;
- visual 65–72%;
- title ≤2 lines;
- description = 0;
- touch target ≥44 px.

## R8-01D — Search/category/sort URL state

- query state survives reload/back/forward;
- filters mobile bottom-sheet;
- server-backed, not local fake filtering.

После 01A–01D выполнить L2 не позднее третьей ordinary iteration; если API/search считается security-sensitive — раньше.

## R8-01E — Featured/loading/empty/error/visual QA

Featured только на real `editorsChoice`/curated source. No fake popularity.

**D1 ready после accepted R8-01.**

---

# 9. R8-02 — Interactions / public author

Small sequence:

1. existing reactions convergence + UI priority;
2. Collections UX on catalog/detail;
3. safe public author projection;
4. other published projects by author if privacy contract allows;
5. counts only from canonical persistent sources.

No Studio ownership until explicit decision.

---

# 10. R8-03 — Moderation foundation

Последовательность:

1. report storage/API;
2. moderation case + action/audit model;
3. restrict/hide/restore state machine;
4. request-changes/resubmit owner flow;
5. moderator UI/queue;
6. negative/security/rate-limit tests.

Модератор управляет public state, не становится author/editor проекта.

---

# 11. R8-04 — Comments

Только после accepted moderation.

1. comment storage + safe render;
2. create/delete/edit policy;
3. replies with bounded depth;
4. owner hide semantics;
5. moderator hide/remove semantics;
6. report integration + rate limit;
7. mobile comments UX;
8. XSS/abuse/privacy tests.

`DEC-PROJ-111` должен быть закрыт до первого write endpoint.

---

# 12. R8-05 — Metrics / related / Knowledge / refinement

1. impression/open/viewer-start deduped events;
2. canonical counters/projection;
3. additional sort modes only after data exists;
4. related projects by deterministic metadata;
5. Knowledge links by explicit tags/module/links;
6. measured performance tuning;
7. ranking formula only after `DEC-PROJ-113`.

No ML recommender until real data justifies it.

---

# 13. GitHub-first operating procedure

Для каждой микро-итерации я делаю:

```text
read current main/control-plane
→ branch from current main
→ smallest code change
→ focused tests
→ L0/L1
→ push
→ Draft PR
→ inspect CI + changed files
→ fix only scoped failures
→ browser/DB evidence when required
→ mark ready
→ merge only accepted bounded result
→ record hygiene counter
→ STOP
```

GitHub используется для:

- code/document reads;
- branch creation;
- file writes;
- issues;
- PRs;
- diffs;
- review;
- CI status/logs;
- merge/close.

---

# 14. Когда использовать подключённый компьютер

Не переходить на компьютер просто потому, что там привычнее.

Computer fallback нужен, когда GitHub API/Actions недостаточны для:

- запуска локальной PostgreSQL/Docker migration matrix;
- воспроизведения browser E2E, если workflow нельзя запустить/диагностировать через GitHub;
- WebGL/GPU/mobile gesture проверки viewer;
- bundle/profile/memory measurement;
- inspection large Git objects/history;
- generation/inspection screenshots/video evidence;
- сложного conflict resolution или широкой mechanical edit, которую GitHub Contents API делает ненадёжно.

После локального действия source-of-truth всё равно возвращается в GitHub: branch/commit/PR/evidence. Никакой «тайной версии на компьютере» не допускается.

---

# 15. Что я не буду делать

- не буду писать весь Public Projects одним PR;
- не буду merge-ить старый PR #112 поверх уже развившегося `main`;
- не буду начинать R7 при stale `current.yaml`;
- не буду одновременно менять DB + viewer + catalog;
- не буду создавать `projects_v2`;
- не буду отдавать public browser raw Working Draft;
- не буду включать comments без moderation;
- не буду делать viewer, который тащит editor runtime без доказанной необходимости;
- не буду оставлять временные V2/Final/Old реализации после acceptance;
- не буду автоматически переходить к следующему macro slice после PASS предыдущего.

---

# 16. Первая фактическая последовательность

Когда документационный PR принят, мой порядок работы:

```text
R3-C1 current-main convergence audit
→ R3-C2 owner/control-plane convergence
→ R7-01A PublicationRevision schema
→ R7-01B exact-version publish
→ R7-01C legacy convergence
→ L2
→ R7-01D non-destructive revoke
→ R7-01E anonymous safe metadata
→ R7-01F ShareLink
→ L2
→ R7-01G exact-version remix
→ R7-01H integration acceptance
→ STOP / owner transition
→ R7-02A...
```

Это минимизирует blast radius: на каждом шаге система либо остаётся на старой Gallery, либо получает один новый доказанный контракт, а не пять недоделанных подсистем одновременно.
