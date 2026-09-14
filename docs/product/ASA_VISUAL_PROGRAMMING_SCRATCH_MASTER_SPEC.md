# ASA Lab Visual Programming — Scratch integration master specification

**Version:** 3.6  
**Module:** `blocks`  
**Product:** `Визуальное программирование`

## 0. How to use this master

Это стабильный продуктовый и архитектурный master. Он не выбирает активную задачу. Текущее исполнение живёт только в `docs/execution/current.yaml`.

Маршрут для агента:

```text
docs/product/visual-programming/README.md
→ COMPONENT_MAP.yaml
→ одна карточка компонента
→ выбранная task card
→ mapped contract/source/test
```

Старые issue/ветки не имеют права переопределять этот master и текущую task card.

## 1. Product goal

ASA Lab предоставляет настоящий Scratch-3-compatible редактор внутри ASA Lab, а ASA остаётся system of record для аккаунтов, проектов, версий, обучения, публикации и долговременного хранения.

```text
создать проект ASA Visual Programming
→ открыть настоящий Scratch внутри ASA
→ редактировать/запускать блоки, спрайты, костюмы и звук
→ сохранять проект в ASA
→ закрыть/открыть без потери состояния
→ версионировать / сдавать / публиковать / remix
```

Ключевое решение: **Scratch не переписывается.** ASA не строит свой клон Scratch GUI.

## 2. Ownership boundary

Scratch owns:

```text
блочный редактор
VM execution
renderer
paint/sound mechanics
Scratch 3 compatibility
Settings
built-in localization and language menu
File/Edit local UI
Extensions catalogue and extension mechanics
existing upstream external-service and hardware integrations
semantic programming-category colours
```

ASA owns:

```text
identity/authorisation
projects/drafts/versions
Learning/Gallery product flows
ASA durable save/recovery/conflicts
ASA object storage
product branding around Scratch
ASA logo and ASA colours in product chrome
parent-owned ASA avatar/account shell
runtime security/deployment/backup/activation
```

Нет второго Scratch account backend, второго Scratch LMS или второго собственного block editor.

## 3. Stable architecture

```text
ASA Lab Web
└── separate-origin iframe
    └── ASA Scratch Host
        ├── pinned official Scratch Editor standalone
        ├── ASA bootstrap/protocol
        ├── ASA project/storage adapter
        └── later ASA save/recovery orchestrator
             ↓ short-lived capability
        ASA Blocks Runtime API
```

Scratch GUI/VM packages остаются вне основной dependency graph ASA Web.

## 4. Canonical project document

```ts
interface BlocksProjectDocumentV1 {
  schemaVersion: 1;
  format: 'scratch-3';
  projectJson: Record<string, unknown> | null;
  assets: BlocksAssetReferenceV1[];
}

interface BlocksAssetReferenceV1 {
  assetId: string;
  dataFormat: 'svg' | 'png' | 'jpg' | 'wav' | 'mp3';
  sha256: string;
  sizeBytes: number;
}
```

`.sb3` — interchange format, а не внутренний ASA autosave format.

## 5. Product branding and preserved Scratch shell

Пользователь видит **ASA Lab — Визуальное программирование**, но внутри остаётся настоящий Scratch.

Canonical ASA logo:

```text
apps/web/public/asa-lab-mark.svg
```

B изменяет только:

```text
Scratch product logo → ASA Lab logo
верхний product-bar colour → ASA Lab colour
правый account/avatar area → ASA parent-owned avatar/account
```

B **не переделывает**:

```text
Scratch Settings
Scratch language selector
Scratch File/Edit
native Load/Save to computer
Scratch Extensions catalogue
existing external-service integrations
existing hardware integrations
Scratch semantic block colours
```

### Language

В D был технический `locale: 'en'`. B должен **только удалить этот forced-English override**.

Не ставить `locale: 'ru'`. Не создавать отдельную кнопку «Язык». Не копировать переводы.

Если host не задаёт locale, pinned Scratch сам определяет язык браузера. Выбор языка остаётся внутри штатного Settings.

### File/Edit

File/Edit остаются штатными. Native `Load from your computer` / `Save to your computer` — нормальная локальная функция Scratch и не равна ASA durable server-save.

`canSave=false` используется только чтобы не включать upstream Scratch server-save как будто это ASA save.

M1-007 отвечает за безопасную **ASA-интеграцию** `.sb3` (validation, ZIP limits, compatibility, ASA import/export flows), а не за скрытие native local File UI.

### Extensions and external services

Штатная кнопка Extensions, каталог и внешние/hardware integrations остаются.

```text
core ASA project/assets/editor loading
→ не должен скрытно зависеть от Scratch project/asset backend

user explicitly chooses an extension requiring external service/device
→ intended external integration is allowed
```

ASA позже может добавить собственные extensions/альтернативы. Это не причина заранее фильтровать upstream catalogue.

Если отдельному расширению нужны особые CSP/sandbox/device permissions, это отдельная bounded integration task; расширение не удаляется просто потому, что такой task ещё не выполнен.

### Colour boundary

ASA primary header reference:

```text
#0877B3
#076B98 darker/border reference
```

Меняем только product chrome. Нельзя глобально перекрашивать Motion/Looks/Sound/Events/Control/Sensing/Operators/Variables/My Blocks.

## 6. Security invariants

1. Scratch iframe получает короткоживущую capability, не ASA cookie.
2. Origin/CORS/CSP проверяются точно.
3. Runtime token memory-only; не URL/localStorage/sessionStorage/logs.
4. Player read-only и version-bound.
5. Object-store credentials не попадают в browser.
6. ASA avatar/account остаётся parent-owned.
7. Расширение, явно выбранное пользователем, может иметь свою внешнюю сеть; это не делает Scratch origin ASA account authority.
8. Не расширять sandbox/CSP глобально ради одного расширения — интегрировать его отдельно и минимально.

## 7. Persistence and assets

ASA project JSON и assets долговечны независимо от upstream Scratch project backend.

```text
projectJson → Project Core state
binary assets → separate durable objects
assetId → Scratch compatibility identity
sha256 → ASA integrity
```

No silent last-write-wins. GC выключен до отдельного доказанного дизайна исторических ссылок.

## 8. Gallery and Learning

Gallery/player/submission используют immutable ASA project versions. Cross-tenant remix re-materialises assets into destination ownership. Не создаётся Scratch-specific LMS.

## 9. Code placement

```text
contexts/blocks/**      domain/application/infrastructure
apps/api/**             transport/composition
apps/web/src/blocks/**  ASA parent UI / iframe shell
infra/scratch-editor/** isolated Scratch runtime image
```

## 10. Capability-oriented milestone order

```text
M0/M0.1  foundation/document contract                      COMPLETE
M1-001    @asa-lab/blocks bounded context                   COMPLETE

M1-002    ASA-owned Scratch host
  M1-002A standalone build                                 accepted
  M1-002C strict parent/iframe bootstrap                   accepted
  M1-002D real editor + fixture storage                    FIRST VISIBLE SCRATCH
  M1-002B ASA logo/colour/avatar + restore native shell
  M1-002E integrated host acceptance

M1-003    runtime capability + exact Origin/CORS/CSP/current authority
M1-004    durable tenant-private assets + S3/MinIO
M1-005    ASA durable project load/save
M1-006    autosave/recovery/conflict/snapshot
M1-007    safe ASA .sb3 validation/import/export integration
M1-008    full M1 durability/security acceptance

M2        product UI + Gallery/player/remix + Learning
M3        deployment/backup/restore + local/offline alternatives where needed
M4-001    explicit coming_soon → active
```

M3 **не означает blanket network deny для штатных Scratch extensions**. M3 доказывает, что core ASA/Scratch работает без скрытой зависимости от Scratch project/asset services, а внешние extensions имеют явно описанное available/degraded поведение.

No task auto-advances.

## 11. M1-002 checkpoints

### First visible Scratch — D

```text
valid INIT
→ real Scratch mounts
→ workspace/stage visible
→ controlled programme runs/stops
→ fixture save is honestly non-durable
```

### ASA shell — B

```text
real Scratch stays intact
→ ASA logo
→ ASA top-bar colour
→ ASA parent-owned avatar/account
→ remove D forced-English locale
→ Settings/language/File/Edit/Extensions remain native Scratch
→ semantic category colours unchanged
```

### Integrated host — E

E verifies D+B+C together and does not invent new architecture.

## 12. Activation gate

`blocks` remains `coming_soon` until explicit M4-001.

Before activation prove at least:

```text
durable ASA save/load/reopen
autosave/recovery/conflict
safe ASA .sb3 flows
immutable Gallery/player/remix
Learning immutable submission
backup/restore
deployment topology and LAN load
core editor/project/assets operate without hidden Scratch Foundation project/asset dependency
explicit external extensions degrade clearly when their own service/device is unavailable
```

Do **not** require every optional third-party extension to work offline. Offline school mode may provide local alternatives later without deleting upstream integrations globally.

## 13. Agent execution invariant

For every Scratch slice:

```text
check current.yaml
→ read one selected task/component
→ state exact allowed paths
→ implement one bounded change
→ run focused evidence
→ run docs validation
→ independent review when required
→ STOP
```

If an old issue/branch/document conflicts with this master or the currently selected task card, treat it as stale and repair routing/docs before coding disputed behaviour.

Deployment/restart/activation always require separate owner instruction.
