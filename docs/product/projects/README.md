# Public Projects — execution router

Этот каталог не хранит активное execution state. Активная задача определяется только `docs/execution/current.yaml` согласно `AGENTS.md`.

## Нормативные документы

1. `../ASA_PROJECTS_IMPLEMENTATION_TZ.md` — целевая подсистема и execution contract.
2. `../ASA_PROJECTS_IMPLEMENTATION_SPEC.md` — глубокая техническая спецификация.
3. `../ASA_PROJECTS_UI_UX_SPEC.md` — продуктовый/UI/UX контракт.
4. `../ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md` — проверенный AS-IS аудит.

## Подготовленные срезы

| Slice | Статус | Task card | GitHub Issue | Gate до старта |
|---|---|---|---|---|
| PROJ-A0 Current Architecture Audit | **DONE** for `main@b31e113a19f6234a0504ff6bade991294b10d38b` | audit document | — | bounded refresh only if relevant main paths change |
| PROJ-R7-01 Publication Foundation | **PREPARED / BLOCKED** | `tasks/PROJ-R7-01.md` | #211 | R3 accepted + owner transition in `current.yaml` |
| PROJ-R7-02 Public Project Page | NOT ACTIVATED | described in TЗ | parent #38 | PROJ-R7-01 accepted + separate owner transition |
| PROJ-R7-03 Public Artifact Contract | NOT ACTIVATED | described in TЗ | parent #38 | accepted prior dependency + separate transition |
| PROJ-R7-04 Module Viewers | NOT ACTIVATED | described in TЗ | parent #38 | separate bounded slice per module |
| PROJ-R7-05 Publication Editor/Media/Revisions | NOT ACTIVATED | described in TЗ | parent #38 | separate owner transition |
| PROJ-R8-* Discovery/Interactions/Moderation/Comments | BLOCKED BY R7 | described in TЗ | parent #39 | accepted R7 |

## PROJ-A0 результат

Аудит подтверждает:

- Project Core / Working Draft / immutable ProjectVersion уже есть и не дублируются;
- Gallery/publication, copy/remix, reactions и Collections уже существуют и должны эволюционно переиспользоваться;
- текущая publication привязана к snapshot/current draft, поэтому R7 должен перейти на exact immutable ProjectVersion;
- current public detail отдаёт mutable `document_json`, поэтому anonymous public contract строится отдельно и безопасно;
- project-specific revocable/expiring ShareLink отсутствует в проверенном Project/Gallery contract;
- Learning `content_shares` из migration 0059 — другая сущность и не подменяет Project ShareLink;
- R8 discovery/search/moderation/comments не должны попадать в первый R7 slice.

## Текущий blocker

На проверенном `main@b31e113a19f6234a0504ff6bade991294b10d38b`:

- projects lane = `TASK-R3B-PROJECT-LIFECYCLE-001`;
- status = `in_progress`;
- owner acceptance = `pending`;
- PR #112 = Draft/open;
- R7 Issue #38 требует accepted R3 Project Hub/Editor Host gate.

Поэтому подготовка завершена, но **R7 product coding не активирован**.

## Порядок входа после owner activation

```text
AGENTS.md
→ START_HERE_FOR_AI.md
→ pnpm agent:context --scope <activated lane>
→ docs/execution/current.yaml
→ activated Issue/task card
→ ASA_PROJECTS_IMPLEMENTATION_TZ.md
→ ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md
→ только нужные sections Implementation Spec / UI/UX Spec
→ релевантный код/tests
```

Перед coding сравнить актуальный `origin/main` с audit baseline. Если изменились Project/Gallery/Identity/Learning publication paths — обновить только затронутые строки аудита.

Один запуск = один bounded slice. После acceptance/evidence — **STOP**.
