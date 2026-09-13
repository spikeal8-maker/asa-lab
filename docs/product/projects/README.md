# Public Projects — execution router

Этот каталог не хранит активное execution state. Активная задача определяется только `docs/execution/current.yaml` согласно `AGENTS.md`.

## Нормативные документы

1. `../ASA_PROJECTS_IMPLEMENTATION_TZ.md` — целевая подсистема и execution contract.
2. `../ASA_PROJECTS_IMPLEMENTATION_SPEC.md` — глубокая техническая спецификация.
3. `../ASA_PROJECTS_UI_UX_SPEC.md` — продуктовый/UI/UX контракт.
4. `../ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md` — полный AS-IS аудит.
5. `PROJ-A0-DELTA-2026-09-14.md` — bounded validation полного аудита против `main@247e4a96f317dd0693629b0a61f90f1414a524b1` и документированная коррекция старой AS-IS формулировки Implementation Spec.

При конфликте AS-IS утверждений фактический current `main` и Current Architecture Audit + последний delta имеют приоритет над старыми описательными формулировками Implementation Spec. TARGET/acceptance по-прежнему определяет `ASA_PROJECTS_IMPLEMENTATION_TZ.md`.

## Подготовленные срезы

| Slice | Статус | Task card | GitHub Issue | Gate до старта |
|---|---|---|---|---|
| PROJ-A0 Current Architecture Audit | **DONE + DELTA VERIFIED** through `main@247e4a96f317dd0693629b0a61f90f1414a524b1` | audit + delta document | — | bounded refresh only if relevant main paths change |
| PROJ-R7-01 Publication Foundation | **PREPARED / BLOCKED** | `tasks/PROJ-R7-01.md` | #211 | R3 accepted + owner transition in `current.yaml` |
| PROJ-R7-02 Public Project Page | NOT ACTIVATED | described in ТЗ | parent #38 | PROJ-R7-01 accepted + separate owner transition |
| PROJ-R7-03 Public Artifact Contract | NOT ACTIVATED | described in ТЗ | parent #38 | accepted prior dependency + separate transition |
| PROJ-R7-04 Module Viewers | NOT ACTIVATED | described in ТЗ | parent #38 | separate bounded slice per module |
| PROJ-R7-05 Publication Editor/Media/Revisions | NOT ACTIVATED | described in ТЗ | parent #38 | separate owner transition |
| PROJ-R8-* Discovery/Interactions/Moderation/Comments | BLOCKED BY R7 | described in ТЗ | parent #39 | accepted R7 |

## PROJ-A0 результат

Аудит подтверждает:

- Project Core / Working Draft / immutable ProjectVersion уже есть и не дублируются;
- Gallery/publication, copy/remix, reactions и Collections уже существуют и должны эволюционно переиспользоваться;
- текущая publication привязана к snapshot/current draft, поэтому R7 должен перейти на exact immutable ProjectVersion;
- current public detail отдаёт mutable `document_json`, поэтому anonymous public contract строится отдельно и безопасно;
- project-specific revocable/expiring ShareLink отсутствует в проверенном Project/Gallery contract;
- Learning `content_shares` из migration 0059 — другая сущность и не подменяет Project ShareLink;
- R8 discovery/search/moderation/comments не должны попадать в первый R7 slice.

### Delta 2026-09-14

С `main@b31e113...` до `main@247e4a96...` прошло 59 commits. Production semantics Gallery/Collections/Public Project persistence не изменились: релевантные controller/page/migration/E2E paths остались прежними. Из shared integration paths двигались `App.tsx`, `api.ts`, `PortalHeader.tsx` и `project-hub.css`; повторная проверка не выявила нового PublicationRevision/public artifact/moderation/comments contract.

Отдельно зафиксировано: старая фраза в Implementation Spec о том, что Gallery не отдаёт raw project JSON, неверна для current main. Реальный `gallery_work()` читает `project_drafts.document_json`, `GalleryController` возвращает его как `work.document`, а `GalleryWorkPage` интерпретирует на клиенте. Current Architecture Audit, delta и ТЗ уже исходят из правильной семантики.

## Текущий blocker

На повторно проверенном current state:

- projects lane = `TASK-R3B-PROJECT-LIFECYCLE-001`;
- status = `in_progress`;
- owner acceptance = `pending`;
- PR #112 = Draft/open;
- Prepared Issue #211 = `PREPARED / BLOCKED`;
- R7 требует accepted R3 Project Hub/Editor Host gate и отдельного owner/control-plane transition.

Поэтому подготовка и аудит ТЗ завершены, но **R7 product coding не активирован**.

## Порядок входа после owner activation

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ pnpm agent:recover --scope <activated lane> --check
→ pnpm agent:context --scope <activated lane>
→ docs/execution/current.yaml
→ activated Issue/task card
→ ASA_PROJECTS_IMPLEMENTATION_TZ.md
→ ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md
→ projects/PROJ-A0-DELTA-2026-09-14.md
→ только нужные sections Implementation Spec / UI/UX Spec
→ релевантный код/tests
```

Перед coding сравнить актуальный `origin/main` с последним delta baseline. Если изменились Project/Gallery/Collections/Identity/Learning publication paths — обновить только затронутые выводы аудита.

Один запуск = один bounded slice. После acceptance/evidence — **STOP**.
