# R0 — матрица проверок и доказательств

Единая команда:

```text
python tools/validate_r0.py
```

R0 PASS означает только: нормативный кандидат внутренне согласован, GitHub-ветки находятся в заявленных ролях, а PR №43 не содержит product runtime. PASS **не означает owner approval** и не разрешает R1 автоматически.

## Порядок gates

| № | Validator | Что доказывает | FAIL | BLOCKED |
|---:|---|---|---|---|
| 1 | `validate_r0_diff.py` | clean branch, governance-only diff, no product code/migrations/binaries | forbidden path, dirty tree, missing governance file | нет `origin/main`/git context |
| 2 | `validate_r0_human_contract.py` | актуальный owner-gated human R0–R10 contract | release/Issue/status/owner marker mismatch | отсутствующий файл |
| 3 | `validate_tinkercad_parity.py` | target entities, invariants, parity matrix/evidence/deviations | missing entity/invariant/evidence/deviation | — |
| 4 | `validate_target_execution.py` | R0–R10 order, dependencies, branches, Issues, R0 convergence and owner/agent entry docs | contract mismatch | — |
| 5 | `validate_architecture.py` | architecture baseline, ADR and links | architecture/link invariant broken | — |
| 6 | `validate_project_map.py` | accepted v1 map remains valid before activation transition | broken nodes/edges/queue | — |
| 7 | `validate_test_catalog.py` | existing test catalog remains syntactically and structurally valid | missing/invalid test contract | — |
| 8 | `validate_r0_github_state.py` | live PR/Issue titles, states and roles match R0 contract | merged/closed/mislabelled competing branch | no `gh`, auth or network |

Первый non-zero останавливает suite.

## Отдельные проверки, не заменяемые wrapper

### YAML parse

```text
python -c "from pathlib import Path; import yaml; [yaml.safe_load(p.read_text(encoding='utf-8')) for p in Path('.').rglob('*.yaml') if 'node_modules' not in p.parts]; print('YAML PASS')"
```

### Relative Markdown links

Входит в architecture validator; при сомнении запускается отдельно существующий link-validation flow репозитория.

### GitHub owner review

Владелец открывает:

```text
docs/delivery/R0_OWNER_DECISION.md
```

И принимает или отклоняет пять решений. Это действие не автоматизируется.

## R0 PASS package

После полного PASS PR №43 должен содержать:

```text
commit SHA
base SHA
changed file list
8 validator results
YAML result
working tree clean
R0 GitHub state result
owner decision = pending
product code changed = 0
migration changed = 0
```

## Owner approval package

После технического PASS владелец отдельно подтверждает:

```text
OWNER DECISION: APPROVED
Decisions 1–5: accepted
Convergence order: accepted
```

Только после этого разрешены rebase/merge PR №43 и отдельный post-merge governance transition.

## После merge

В той же сессии нельзя начинать R1. Разрешено только:

1. синхронизировать `main`;
2. обновить Project Map, Quality Map, test catalog и active Issues на R0–R10;
3. отметить R0 `done`;
4. создать один P1 integration PR согласно convergence order;
5. оставить R1 `blocked` до завершения P1 и выбора одной identity-линии;
6. остановиться.

## Anti-fake правила

- отсутствие сети для GitHub-state gate = `BLOCKED`, не PASS;
- dirty tree = FAIL;
- validator нельзя удалить из wrapper ради зелёного результата;
- `BLOCKED`/`NOT_RUN` не закрывают R0;
- screenshots/test count не заменяют owner product decision;
- старый `TASK-PROJECT-SHELL-001` не становится активным из-за старой карты;
- PR №59 и №60 не могут быть одновременно активными R1-линиями.
