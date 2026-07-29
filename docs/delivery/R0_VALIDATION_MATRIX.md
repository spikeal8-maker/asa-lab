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
| 2 | `validate_r0_contract_refs.py` | machine plan ссылается на актуальный human contract и R0 package | stale/ambiguous reference | отсутствующий файл |
| 3 | `validate_r0_human_contract.py` | актуальный owner-gated human R0–R10 contract | release/Issue/status/owner marker mismatch | отсутствующий файл |
| 4 | `validate_r0_owner_decision.py` | пять target decisions не подменены ботом | mixed/forged approval or rejection without notes | — |
| 5 | `validate_r0_foundation_decision.py` | PR №34 остаётся ограниченным foundation и не принимается без corrective evidence | open blocker hidden, owner attribution invalid, parity falsely claimed | — |
| 6 | `validate_r0_post_merge.py` | после merge R1 не разблокируется до integration и выбора одной identity-линии | skipped/parallel phase, early R1 activation | — |
| 7 | `validate_r0_baseline_preservation.py` | R0B сохраняет teacher/classes/projects/Electronics IDs, payloads, hashes, RLS и один integration PR | missing preservation assertion, broadened scope, destructive rollback | — |
| 8 | `validate_r0_release_map.py` | inactive R0–R10 map template совпадает с contracts и не протёк в active map | dependency/status/legacy mismatch | — |
| 9 | `validate_r0_legacy_traceability.py` | все старые v1 tasks/evidence Issues mapped в R0–R10 и не исполнимы | потерянный requirement, неверный replacement, дублированный Issue | — |
| 10 | `validate_r0_review_packets.py` | PR №34 review и PR №59/№60 comparison имеют owner-safe scope | пропавший blocker, automatic merge recommendation | — |
| 11 | `validate_r0_r1_candidate_decision.py` | выбор PR №59/№60 невозможен до R0C; selected/unselected state однозначен | early selection, two selected candidates, forbidden transfer | — |
| 12 | `validate_target_test_matrix.py` | test profiles, release IDs, artifacts и owner flows R0–R10 зафиксированы до кода | duplicate/invalid IDs, missing profile, early activation | — |
| 13 | `validate_r1_migration_contract.py` | выбранная R1-линия сохраняет данные, имеет SessionsV2/Personal Workspace и additive stages | missing entity/stage/API/security/preservation rule | — |
| 14 | `validate_tinkercad_parity.py` | target entities, invariants, parity matrix/evidence/deviations | missing entity/invariant/evidence/deviation | — |
| 15 | `validate_target_execution.py` | R0–R10 order, dependencies, branches, Issues and entry docs | contract mismatch | — |
| 16 | `validate_architecture.py` | architecture baseline, ADR and links | architecture/link invariant broken | — |
| 17 | `validate_project_map.py` | accepted v1 active map remains valid before activation transition | broken nodes/edges/queue | — |
| 18 | `validate_test_catalog.py` | existing active v1 test catalog remains structurally valid | missing/invalid active test contract | — |
| 19 | `validate_r0_github_state.py` | live PR/Issue titles, bases, heads, Draft states and roles match R0 | merged/closed/rebased/mislabelled competing branch | no `gh`, auth or network |

Первый non-zero останавливает suite.

## Target owner-decision state

```text
pending_owner             технический R0 может быть PASS, merge/activation запрещены
approved_pending_merge    все 5 решений accepted, convergence accepted, attribution записана
rejected_changes_required контракт должен быть изменён; R0 suite FAIL
```

Файл: `docs/delivery/R0_OWNER_DECISION.yaml`.

## PR №34 foundation-decision state

```text
pending_owner             review/corrective items не завершены
accepted_pending_merge    все corrective items PASS + owner foundation-only acceptance
rejected_changes_required конкретные blockers должны быть исправлены
rejected_close_candidate  foundation не принимается и PR закрывается
```

Файл: `docs/delivery/R0_FOUNDATION_DECISION.yaml`.

Текущий обязательный blocker: runtime `UPDATE ON projects` должен стать column-scoped и пройти privilege negative matrix.

## R1 candidate-decision state

```text
deferred_until_r0c        оба PR frozen; выбор запрещён
owner_selection_pending   R0C достигнут, evidence сравнивается
selected_pending_rebase   один candidate выбран, второй superseded
selected_ready_for_r1     выбранная линия rebased и прошла R1 contract
rejected_both_changes_required  требуется owner-approved consolidation plan
```

Файл: `docs/delivery/R0_R1_CANDIDATE_DECISION.yaml`.

Рекомендация PR №60 является advisory only и не заменяет owner decision.

## Baseline preservation

```text
docs/delivery/R0_BASELINE_PRESERVATION_CONTRACT.yaml
```

R0B обязан сравнить baseline manifest до/после integration и сохранить:

- teacher login/session;
- classes/memberships/audit;
- tenant/user/class/project/version IDs;
- password hashes;
- project payloads/version digests;
- Electronics component/terminal/wire references;
- RLS policies and least-privilege runtime role.

## Target test matrix

```text
docs/testing/ASA_TARGET_TEST_MATRIX.yaml
```

Матрица неактивна до R0A. Активный v1 `test-catalog.yaml` не изменяется в PR №43.

## Legacy traceability

```text
docs/delivery/R0_LEGACY_TRACEABILITY.yaml
```

Старые Issues №6/№7/№8/№20/№24/№25/№26 остаются открыты только как traceability.

## Post-merge phases

```text
R0A contract activation      governance only; R1 blocked
R0B foundation integration   one owner-facing integration PR
R0C R1 selection             choose PR #59 OR PR #60
R0D completion transition    only here R1 becomes ready
```

Файл: `docs/delivery/R0_POST_MERGE_TRANSITION.yaml`.

## Отдельные проверки

### YAML parse

```text
python -c "from pathlib import Path; import yaml; [yaml.safe_load(p.read_text(encoding='utf-8')) for p in Path('.').rglob('*.yaml') if 'node_modules' not in p.parts]; print('YAML PASS')"
```

### Relative Markdown links

Входит в architecture validator; при сомнении запускается отдельно существующий link-validation flow.

### Owner review

1. PR №34 — `R0_FOUNDATION_REVIEW_PR34.md` + `R0_FOUNDATION_DECISION.yaml`.
2. Target contract — `R0_OWNER_DECISION.md` + `R0_OWNER_DECISION.yaml`.
3. R1 candidate — только в R0C, `R0_R1_CANDIDATE_SELECTION.md` + `R0_R1_CANDIDATE_DECISION.yaml`.

## R0 PASS package

После полного PASS PR №43 должен содержать:

```text
commit SHA
base SHA
changed file list
19 validator results
YAML result
working tree clean
R0 GitHub state result
target owner decision state
foundation decision state
R1 candidate decision state
post-merge sequence result
baseline preservation result
release-map template result
legacy traceability result
owner review packet result
target test matrix result
R1 migration contract result
product code changed = 0
migration changed = 0
repository binary changed = 0
```

## Merge sequence

До merge PR №43:

- PR №34 decision завершён;
- пять target decisions приняты;
- technical R0 PASS;
- owner attribution записана.

После merge:

1. R0A — активировать contract/map/test matrix, оставить R1 blocked, stop;
2. R0B — один integration PR и baseline preservation, stop;
3. R0C — выбрать PR №59 или №60, закрыть второй, stop;
4. R0D — отметить R0 done, R1 ready, R2–R10 blocked, stop.

## Anti-fake правила

- отсутствие сети для GitHub-state gate = `BLOCKED`, не PASS;
- dirty tree = FAIL;
- validator нельзя удалить из wrapper ради зелёного результата;
- `BLOCKED`/`NOT_RUN` не закрывают R0;
- screenshots/test count не заменяют owner product decision;
- технический PASS не меняет owner decision files автоматически;
- PR №59 и №60 не могут быть одновременно selected;
- PR №43 не может содержать product runtime, migrations или repository binaries;
- target release test IDs не активируются до R0A;
- поздний dependency-ready release не обходит strict delivery order.
