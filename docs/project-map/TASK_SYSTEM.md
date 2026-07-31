# Система задач ASA Lab

## Источники

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue активной задачи
→ docs/testing/test-catalog.yaml
```

## Текущее состояние

```text
main:                    e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
TASK-ACCOUNT-C1-001:     done
Issue #48:               completed
current_focus:            null
active task:              none
```

## Завершённая очередь

```text
TASK-PRODUCT-DOC-001  done
→ TASK-PORTAL-001     done
→ TASK-ACCOUNT-C1-001 done
→ stop
```

При `current_focus: null` coding-агент выводит `NO_ACTIVE_TASK` и не пишет product code.

## Blocked roadmap

```text
R2 Issue №62  Creator Portal      blocked
R3 Issue №37  Project lifecycle   blocked
R4 Issue №63  Electronics parity  blocked
```

Roadmap не является executable queue.

## Активация будущей задачи

Отдельный owner transition синхронно изменяет:

- [`EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml);
- `project-map.yaml` и `PROJECT_MAP.md`;
- `QUALITY_MAP.md` и test catalog;
- GitHub Issue;
- task branch;
- scope/non-goals/tests/stop condition.

После этого только одна task может иметь status `ready | in_progress | in_review`.

## Status semantics

| Status | Значение |
|---|---|
| `planned` | roadmap без разрешения на реализацию |
| `blocked` | dependency или owner activation отсутствует |
| `ready` | task опубликована и может быть начата |
| `in_progress` | один coding-агент работает |
| `in_review` | flow завершён и ожидает owner review |
| `done` | gate принят и merge/governance transition завершён |
| `deprecated` | historical task, не executable |

## Разделение работы

Coding-агент:

- пишет код только активной task;
- запускает focused/full gates;
- готовит browser evidence;
- останавливается для review.

GitHub/governance работа:

- ведёт документы и карты;
- аудитирует старые PR;
- классифицирует `contained / superseded / still valuable / obsolete`;
- не выдаётся coding-агенту вместо product task.

## Scope freeze

После `in_progress` запрещены следующая capability, competing branch, unrelated refactoring, rewrite migrations и ослабление tests/RLS.

## Test lifecycle

Task runner:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

- `PASS` — exit 0;
- `FAIL` — non-zero;
- `BLOCKED` — обязательная среда отсутствует;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate.

## Git rules

- будущая product branch создаётся только от актуального `main` после task activation;
- force-push и rewrite истории запрещены;
- старые PR/branches не merge/close/delete без preservation audit;
- backups, dumps и credentials не коммитятся.

## Validators

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
```
