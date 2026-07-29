# R0 — матрица проверок и доказательств

Единая команда:

```text
python tools/validate_r0.py
```

R0 PASS означает только: нормативный кандидат внутренне согласован, GitHub-ветки находятся в заявленных ролях, а PR №43 не содержит product runtime. PASS **не означает owner approval** и не разрешает R1 автоматически.

## Порядок gates

| № | Validator | Что доказывает | FAIL | BLOCKED |
|---:|---|---|---|---|
| 1 | `validate_r0_diff.py` | clean canonical branch, governance-only diff, no product code/migrations/binaries | forbidden path, dirty tree, missing governance file | нет `origin/main`/git context |
| 2 | `validate_r0_contract_refs.py` | machine plan ссылается на актуальный human contract, owner decision, post-merge plan и release-map template | stale/ambiguous reference | отсутствующий файл |
| 3 | `validate_r0_human_contract.py` | актуальный owner-gated human R0–R10 contract | release/Issue/status/owner marker mismatch | отсутствующий файл |
| 4 | `validate_r0_owner_decision.py` | machine-readable owner state не подменён ботом | mixed/forged approval or rejected contract without notes | — |
| 5 | `validate_r0_post_merge.py` | после merge R1 не разблокируется до integration и выбора одной identity-линии | skipped/parallel phase, early R1 activation | — |
| 6 | `validate_r0_release_map.py` | inactive R0–R10 map template совпадает с blueprint/execution plan и не протёк в active map | dependency/status/legacy mismatch | — |
| 7 | `validate_r0_legacy_traceability.py` | все старые v1 tasks/evidence Issues mapped в R0–R10 и не исполнимы | потерянный requirement, неверный replacement, дублированный Issue | — |
| 8 | `validate_r0_review_packets.py` | PR №34 review и PR №59/№60 selection имеют owner-safe scope и no-auto-merge rules | пропавший blocker, автоматическое решение вместо owner stop | — |
| 9 | `validate_tinkercad_parity.py` | target entities, invariants, parity matrix/evidence/deviations | missing entity/invariant/evidence/deviation | — |
| 10 | `validate_target_execution.py` | R0–R10 order, dependencies, branches, Issues, R0 convergence and owner/agent entry docs | contract mismatch | — |
| 11 | `validate_architecture.py` | architecture baseline, ADR and links | architecture/link invariant broken | — |
| 12 | `validate_project_map.py` | accepted v1 active map remains valid before activation transition | broken nodes/edges/queue | — |
| 13 | `validate_test_catalog.py` | existing test catalog remains syntactically and structurally valid | missing/invalid test contract | — |
| 14 | `validate_r0_github_state.py` | live PR/Issue titles, states and roles match R0 contract | merged/closed/mislabelled competing branch | no `gh`, auth or network |

Первый non-zero останавливает suite.

## Owner-decision states

```text
pending_owner             технический R0 может быть PASS, merge/activation запрещены
approved_pending_merge    все 5 решений accepted, convergence accepted, attribution записана
rejected_changes_required контракт должен быть изменён; R0 suite FAIL
```

Файл:

```text
docs/delivery/R0_OWNER_DECISION.yaml
```

## Owner review packets

```text
docs/delivery/R0_FOUNDATION_REVIEW_PR34.md
docs/delivery/R0_R1_CANDIDATE_SELECTION.md
```

Первый ограничивает PR №34 только Project/Electronics foundation. Второй рекомендует PR №60 как R1 base, но требует отдельного owner decision после R0B и запрещает автоматический merge.

## Legacy traceability

```text
docs/delivery/R0_LEGACY_TRACEABILITY.yaml
```

Старые Issues №6/№7/№8/№20/№24/№25/№26 остаются открыты только как traceability. Ни одна не может создать branch/PR или стать current release.

## Post-merge phases

```text
R0A contract activation      governance only; R1 blocked
R0B foundation integration   one owner-facing integration PR
R0C R1 selection             choose PR #59 OR PR #60
R0D completion transition    only here R1 becomes ready
```

Файл:

```text
docs/delivery/R0_POST_MERGE_TRANSITION.yaml
```

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

И принимает или отклоняет пять решений. После решения синхронно обновляется `R0_OWNER_DECISION.yaml`. Это действие не автоматизируется.

## R0 PASS package

После полного PASS PR №43 должен содержать:

```text
commit SHA
base SHA
changed file list
14 validator results
YAML result
working tree clean
R0 GitHub state result
owner decision state
post-merge sequence result
release-map template result
legacy traceability result
owner review packet result
product code changed = 0
migration changed = 0
repository binary changed = 0
```

## Owner approval package

После технического PASS владелец отдельно подтверждает:

```text
OWNER DECISION: APPROVED
Decisions 1–5: accepted
Convergence order: accepted
```

Затем `R0_OWNER_DECISION.yaml` переводится в:

```text
status: approved_pending_merge
all decision statuses: accepted
convergence_order.status: accepted
approved_by / approved_at / evidence_comment_url: заполнены
```

Только после этого разрешены rebase/merge PR №43 и отдельный post-merge governance transition.

## После merge

В той же сессии нельзя начинать R1. Последовательность строго берётся из `R0_POST_MERGE_TRANSITION.yaml`:

1. R0A — активировать contract/map, оставить R1 blocked, stop;
2. R0B — один P1 integration PR, transfer proof, stop;
3. R0C — выбрать PR №59 или №60, закрыть второй, stop;
4. R0D — отметить R0 done, R1 ready, R2–R10 blocked, stop.

## Anti-fake правила

- отсутствие сети для GitHub-state gate = `BLOCKED`, не PASS;
- dirty tree = FAIL;
- validator нельзя удалить из wrapper ради зелёного результата;
- `BLOCKED`/`NOT_RUN` не закрывают R0;
- screenshots/test count не заменяют owner product decision;
- старый `TASK-PROJECT-SHELL-001` не становится активным из-за старой карты;
- PR №59 и №60 не могут быть одновременно активными R1-линиями;
- технический PASS не меняет `pending_owner` автоматически;
- PR №43 не может содержать product runtime, migrations или repository binaries.
