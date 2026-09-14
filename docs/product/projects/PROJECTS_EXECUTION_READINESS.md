# ASA Lab Public Projects — Execution Readiness

**Статус документации:** `IMPLEMENTATION-READY / EXECUTION NOT ACTIVATED`  
**Область:** публичный раздел «Проекты» + отдельная публичная страница проекта.  
**Canonical execution authority:** `docs/execution/current.yaml`.  
**Главное правило:** готовность определяется принятыми bounded slices и gates, а не календарной датой.

---

# 1. Итоговый статус

Документационный пакет Public Projects считается **достаточным для последовательной реализации без проектирования продукта заново**.

Есть:

- продуктовый/UI/UX контракт;
- глубокая integration specification;
- фактический AS-IS architecture audit + delta audit;
- executable implementation TZ;
- decision ledger;
- errata для найденного противоречия старой Implementation Spec;
- task cards всех R7/R8 bounded slices;
- acceptance criteria;
- required tests/evidence;
- STOP conditions;
- rollback/compatibility principles;
- repository hygiene policy, привязанная к итерациям.

**Но:** документационная готовность не является разрешением писать production code. Активный slice всегда выбирается только canonical control-plane.

---

# 2. Нормативный пакет

## Product / UX

`docs/product/ASA_PROJECTS_UI_UX_SPEC.md`

Определяет:

- каталог «Проекты»;
- карточки;
- отдельную project page;
- publication editing UX;
- mobile/tablet/desktop;
- responsive/large-screen behavior;
- permissions/moderation UX;
- accessibility/visual hierarchy.

Legacy header `концепция v1` не означает «необязательная идея»: для Public Projects task cards этот документ является нормативным UI/UX contract в пределах, не конфликтующих с executable TZ/current code.

## Executable TARGET

`docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

Определяет system ownership, R3→R7→R8 order, bounded slices, global acceptance и per-slice DoD.

## Deep technical reference

`docs/product/ASA_PROJECTS_IMPLEMENTATION_SPEC.md`

Используется вместе с:

`docs/product/projects/IMPLEMENTATION_SPEC_ERRATA.md`

Старые AS-IS утверждения Implementation Spec не имеют приоритета над фактическим audit/errata.

## AS-IS evidence

- `docs/product/ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md`
- latest `docs/product/projects/PROJ-A0-DELTA-*.md`

## Decisions

`docs/product/projects/DECISION_LEDGER.md`

## Engineering hygiene

- `docs/delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md`
- `docs/review/HYGIENE_AUDIT_TEMPLATE.md`

---

# 3. Подготовленные bounded slices

| Slice | Смысл | Документация | Activation dependency |
|---|---|---|---|
| PROJ-A0 | Current Architecture Audit | COMPLETE + delta | refresh if relevant main changed |
| PROJ-R7-01 | Publication Foundation | `tasks/PROJ-R7-01.md` | R3 accepted + owner/control-plane transition |
| PROJ-R7-02 | Public Project Page | `tasks/PROJ-R7-02.md` | R7-01 accepted + canonical route decision |
| PROJ-R7-03 | Public Artifact Contract | `tasks/PROJ-R7-03.md` | R7-01 accepted + explicit activation |
| PROJ-R7-04A | 3D Public Viewer | `tasks/PROJ-R7-04A-3D.md` | R7-03 + stable 3D boundary |
| PROJ-R7-04B | Electronics Public Viewer | `tasks/PROJ-R7-04B-ELECTRONICS.md` | R7-03 + safe Electronics boundary |
| PROJ-R7-04C | Blocks Public Viewer | `tasks/PROJ-R7-04C-BLOCKS.md` | R7-03 + safe Blocks runtime boundary |
| PROJ-R7-04D | Games Public Runner | `tasks/PROJ-R7-04D-GAMES.md` | R7-03 + per-game stable runtime |
| PROJ-R7-05 | Publication Editor/Media/Revisions | `tasks/PROJ-R7-05.md` | R7-01 + R7-02 + relevant decisions |
| PROJ-R8-01 | Discovery Catalog | `tasks/PROJ-R8-01.md` | accepted R7 release gate + owner transition |
| PROJ-R8-02 | Interactions/Public Author | `tasks/PROJ-R8-02.md` | R8-01 + privacy decisions |
| PROJ-R8-03 | Moderation Foundation | `tasks/PROJ-R8-03.md` | stable publication/media + R8 activation |
| PROJ-R8-04 | Comments | `tasks/PROJ-R8-04.md` | R8-03 accepted + participant policy |
| PROJ-R8-05 | Metrics/Related/Refinement | `tasks/PROJ-R8-05.md` | core R8 accepted + real metric/ranking decisions |

Graphics/image-only projects and unsupported modules may use the safe static public-page fallback from R7-02 until a dedicated interactive adapter is justified. Не создавать пустой viewer только ради симметрии.

---

# 4. Когда считается готовой именно «страница проекта»

Это не одна дата и не один mega-PR.

## Stage P1 — Public Page Foundation Ready

Требует accepted:

```text
PROJ-R7-01
→ PROJ-R7-02
```

После этого существует честная отдельная project page со stable URL, immutable publication source, static preview, author metadata, license/provenance, save/share/remix и mobile/accessibility contract.

**Это первая версия публичной страницы, которую уже можно считать функционально настоящей, даже без интерактивных viewers.**

## Stage P2 — Interactive Project Page Ready for a module

Требует:

```text
P1
+ PROJ-R7-03
+ соответствующий PROJ-R7-04X
```

После этого конкретный тип проекта можно не только посмотреть как preview, но и безопасно исследовать/запустить read-only.

Готовность считается **по модулю**. Нельзя блокировать хороший 3D viewer тем, что будущий иной модуль ещё не имеет public adapter; но release scope обязан явно перечислить поддерживаемые интерактивные модули и static fallbacks.

## Stage P3 — Author-Managed Rich Public Page Ready

Требует:

```text
P1
+ PROJ-R7-05
```

После этого владелец имеет publication draft/autosave/preview/revisions, cover/gallery/physical-result media и выбор exact published ProjectVersion.

Video не является обязательным blocker, если DEC-PROJ-108 pipeline ещё не принят: images/physical-result media могут быть готовой P3, video остаётся feature-flagged OFF.

---

# 5. Когда считается готовым весь R7

R7 release gate считается готовым, когда приняты:

- PROJ-R7-01;
- PROJ-R7-02;
- PROJ-R7-03;
- PROJ-R7-05;
- утверждён release-scope module viewer matrix для R7-04.

Для каждого заявленного interactive module его R7-04X должен быть accepted. Для остальных модулей должна существовать честная static fallback policy.

Так R7 не требует искусственно написать интерактивный viewer для каждого возможного будущего типа проекта, но запрещает обещать интерактивность там, где её нет.

R8 не активируется до accepted R7 release gate и отдельного owner/control-plane transition.

---

# 6. Когда считается готовой сама вкладка «Проекты»

## Stage D1 — Discovery Catalog Ready

После accepted R7 release gate + `PROJ-R8-01`.

Пользователь получает:

- public «Проекты»;
- server-backed search;
- categories;
- real sort;
- optional real featured;
- 4/3/2/1 responsive grid;
- public project cards;
- переход на P1/P2/P3 project pages.

Это первая стадия, когда **вся пользовательская вкладка «Проекты» существует как целостная discovery-система**, а не только direct-link page.

## Stage D2 — Community Context Ready

После `PROJ-R8-02`.

Добавляются контролируемые real interactions и safe public author projection.

## Stage D3 — Moderated Discussion Ready

После:

```text
PROJ-R8-03
→ PROJ-R8-04
```

Только здесь безопасно включаются comments.

## Stage D4 — Full Target Refinement

После `PROJ-R8-05`.

Реальные metrics, related projects, Knowledge links, documented ranking and measured performance refinement complete target discovery loop.

---

# 7. Dependency graph

```text
R3 Project lifecycle owner acceptance
        ↓
R7-01 Publication Foundation
        ├────────→ R7-02 Public Project Page
        │                 ↓
        │               R7-05 Publication Editor/Media/Revisions
        │
        └────────→ R7-03 Public Artifact Contract
                          ├→ R7-04A 3D
                          ├→ R7-04B Electronics
                          ├→ R7-04C Blocks
                          └→ R7-04D Games

R7 release gate accepted
        ↓
R8-01 Discovery Catalog
        ↓
R8-02 Interactions/Public Author
        ↓
R8-03 Moderation Foundation
        ↓
R8-04 Comments

R8 core + real data
        ↓
R8-05 Metrics/Related/Refinement
```

R8-03 may be prepared in parallel conceptually but its coding remains an explicitly activated bounded slice. Comments always remain downstream of accepted moderation.

---

# 8. Hygiene cadence for Public Projects

No calendar schedule.

Public Projects ordinary UI/API slices:

- L0 each change;
- L1 each accepted slice;
- L2 after every 3 accepted ordinary slices.

High-risk Public Projects runtime/media slices:

- Public Artifact;
- 3D/Electronics/Blocks/Game viewers;
- media processing;

use L2 after every **2 accepted high-risk slices**, or earlier at milestone/event trigger.

The implementation report must keep the per-lane hygiene counter.

---

# 9. Definition of Ready for any Public Projects task

A slice is ready to code only when:

- it has a task card;
- predecessor acceptance is satisfied;
- required decisions from `DECISION_LEDGER.md` are resolved;
- actual `main` delta has been checked;
- `docs/execution/current.yaml` selects the exact task;
- control-plane gate passes;
- scope paths and `REUSE / MODIFY / BUILD / DO-NOT-TOUCH` are known;
- focused tests/evidence plan is known;
- STOP conditions are understood.

If any condition fails, documentation may be ready but execution is `NO-GO`.

---

# 10. Definition of Done for each slice

A slice is not accepted until:

- implementation matches its task-card acceptance;
- focused tests pass;
- required E2E/browser evidence passes;
- server authorization/privacy constraints pass;
- existing My Projects/Classroom/editor flows do not regress;
- L0/L1 complete;
- hygiene counter updated and L2 run if threshold/trigger reached;
- exact final SHA recorded;
- documentation/contract drift corrected;
- agent reports result and **STOPs** instead of auto-starting the next slice.

---

# 11. Current execution status vs documentation status

These are intentionally different:

**Documentation:** IMPLEMENTATION-READY.  
**Production coding:** only the task selected by current control-plane is authorized.

At the last verified execution snapshot, projects lane still held unfinished R3 Project Lifecycle with owner acceptance pending. Therefore Public Projects R7 remains prepared but not self-activated.

Before actual R7 start, this statement must be rechecked against then-current `docs/execution/current.yaml`; never trust a historical snapshot blindly.

---

# 12. Final readiness verdict

## Product definition

**READY.** The desired user experience and lifecycle are specified.

## Architecture/integration definition

**READY.** Existing systems to reuse and gaps to build are identified, with an explicit errata for the stale Gallery raw-document statement.

## Execution decomposition

**READY.** R7/R8 are split into bounded task cards with dependencies, acceptance, tests, hygiene and STOP conditions.

## Coding authorization

**NOT GRANTED BY THESE DOCS.** It occurs only through owner/control-plane transition.

Therefore the correct formulation is:

> **Public Projects is documentation-complete enough to implement sequentially. It is not yet automatically authorized for coding. Readiness is gated by accepted development iterations, not dates.**