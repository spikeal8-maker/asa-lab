# Public Projects — execution router

Этот каталог не хранит активное execution state. Активная задача по-прежнему определяется только `docs/execution/current.yaml` согласно `AGENTS.md`.

## Нормативные документы

1. `../ASA_PROJECTS_IMPLEMENTATION_TZ.md` — целевая система и execution contract.
2. `../ASA_PROJECTS_IMPLEMENTATION_SPEC.md` — глубокая техническая спецификация.
3. `../ASA_PROJECTS_UI_UX_SPEC.md` — продуктовый/UI/UX контракт.
4. `../ASA_PROJECTS_CURRENT_ARCHITECTURE_AUDIT.md` — проверенный AS-IS аудит.

## Подготовленные срезы

| Slice | Статус | Task card | GitHub Issue | Gate до старта |
|---|---|---|---|---|
| PROJ-A0 Current Architecture Audit | DONE for baseline `main@3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e` | audit document | — | refresh only if relevant main paths changed |
| PROJ-R7-01 Publication Foundation | PREPARED / BLOCKED | `tasks/PROJ-R7-01.md` | #211 | R3 accepted + owner transition in `current.yaml` |
| PROJ-R7-02 Public Project Page | NOT ACTIVATED | described in TЗ | parent #38 | PROJ-R7-01 accepted + separate owner transition |
| PROJ-R7-03 Public Artifact Contract | NOT ACTIVATED | described in TЗ | parent #38 | R7-02/architecture dependency as accepted |
| PROJ-R7-04 Module Viewers | NOT ACTIVATED | described in TЗ | parent #38 | separate bounded slice per module |
| PROJ-R7-05 Publication Editor/Media/Revisions | NOT ACTIVATED | described in TЗ | parent #38 | separate owner transition |
| PROJ-R8-* Discovery/Interactions/Moderation/Comments | BLOCKED BY R7 | described in TЗ | parent #39 | accepted R7 |

## Текущий blocker

На момент подготовки:

- projects lane в `docs/execution/current.yaml` = `TASK-R3B-PROJECT-LIFECYCLE-001`;
- status = `in_progress`;
- owner acceptance = `pending`;
- PR #112 = Draft/open;
- R7 Issue #38 требует accepted R3 Project Hub/Editor Host gate.

Поэтому документация и первый R7 slice подготовлены, но product coding R7 не должен начинаться до owner/control-plane transition.

## Порядок входа coding-агента после активации

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

Один запуск = один bounded slice. После acceptance/evidence — STOP.
