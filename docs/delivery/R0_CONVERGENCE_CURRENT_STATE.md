# R0 — текущее состояние конвергенции

**Дата снимка:** 2026-07-29  
**Статус:** `owner_review_required`  
Current gate: `R0`  
**Product coding:** запрещён до owner approval и merge PR №43.

Этот документ является кратким снимком текущего состояния. Машиночитаемый источник — [`ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`](ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml). При изменении ролей веток обновляются оба файла одним нормативным PR.

## 1. Принятая точка отсчёта

```text
main
└── Teacher Portal foundation
```

`main` сохраняется до owner-решения. Ни одна candidate-ветка не считается production baseline автоматически.

## 2. Роли открытых PR

| PR | Роль в R0 | Разрешено сейчас | Запрещено сейчас |
|---:|---|---|---|
| №34 | Electronics/Project foundation candidate | owner review и defect fixes внутри foundation scope | Identity, StudentSeat, Publication, Assignments, автоматический merge |
| №43 | единственный target-contract candidate | contracts, evidence, validators, governance | product runtime, R1 implementation, автоматический merge |
| №35 | transfer-only Electronics workbench | critical portability fixes | самостоятельный merge в `main`, новые features |
| №45 | transfer-only Registry/Project Hub/Editor Host | critical portability fixes | самостоятельный merge в `main`, Identity/Classroom expansion |
| №47 | transfer-only Visual Product System | critical visual compatibility fixes | самостоятельный merge в `main`, изменение business semantics |
| №59 | frozen competing R1 candidate A | сохранение branch/evidence, critical fix | продолжение C1, merge, destructive cleanup |
| №60 | frozen competing R1 candidate B | сохранение branch/evidence, critical fix | расширение vertical, merge, третья identity branch |
| №29 | non-blocking Map UX candidate | viewer-only fixes | изменение execution order или target semantics |

## 3. Три независимых decision state

```text
R0_FOUNDATION_DECISION.yaml      PR №34: pending_owner
R0_OWNER_DECISION.yaml           target contract: pending_owner
R0_R1_CANDIDATE_DECISION.yaml    PR №59/№60: deferred_until_r0c
```

Технический PASS не меняет ни один owner state автоматически.

## 4. Обязательная последовательность

```text
1. Исправить доказанные blockers PR №34 внутри foundation scope
2. Owner принимает PR №34 как foundation либо требует изменения
3. Если принят — PR №34 merge, foundation status → accepted_merged
4. Owner принимает пять target decisions PR №43
5. PR №43 один раз rebased на main с принятым foundation
6. 19 R0 validators + YAML PASS
7. PR №43 merged
8. R0A governance activation; R1 остаётся blocked
9. Один R0B/P1 integration PR + baseline preservation
10. Transfer proof и закрытие №35/№45/№47
11. R0C: owner выбирает №59 ИЛИ №60
12. Выбранная R1-линия один раз rebased на accepted baseline
13. Вторая R1-линия закрывается superseded
14. Только R0D отмечает R0 done и R1 ready
```

Если PR №34 отклонён с закрытием, текущий integration/source contract сначала пересматривается. PR №43 не merge по плану, который предполагает принятый foundation.

Нельзя переставлять шаги ради удобства конкретной ветки.

## 5. Что не является активной задачей

- Issues №6/№7/№8/№20/№24/№25/№26 — superseded v1 traceability;
- Issues №44/№46/№50/№52 — evidence-only;
- Issue №49 — superseded cross-release bundle;
- Issue №61 — superseded owner-intent roadmap;
- PR №35/№45/№47 — не самостоятельные product releases;
- PR №59/№60 — не две параллельные R1-линии.

## 6. Owner action

### Сначала PR №34

Открыть [`R0_FOUNDATION_REVIEW_PR34.md`](R0_FOUNDATION_REVIEW_PR34.md). Решение и evidence фиксируются в [`R0_FOUNDATION_DECISION.yaml`](R0_FOUNDATION_DECISION.yaml).

### Затем target contract

Открыть [`R0_OWNER_DECISION.md`](R0_OWNER_DECISION.md) и подтвердить пять решений. После локального полного PASS владелец пишет в PR №43:

```text
OWNER DECISION: APPROVED
Decisions 1–5: accepted
Convergence order: accepted
```

Состояние синхронно фиксируется в `R0_OWNER_DECISION.yaml`.

### Выбор R1 — позже

PR №59/№60 не выбираются до R0C. Состояние находится в `R0_R1_CANDIDATE_DECISION.yaml`.

## 7. R0 checks

```text
python tools/validate_r0.py
```

Suite должна доказать:

- parity/target contracts согласованы;
- PR №34/PR №43/R1 candidate states разделены;
- baseline preservation и post-merge sequence непротиворечивы;
- R0–R10 dependencies и strict order непротиворечивы;
- PR №43 не меняет product code, migrations, runtime schemas или binaries;
- release-map/test-matrix templates не активированы раньше времени;
- architecture/map/test catalog validators PASS;
- live GitHub branch roles совпадают с контрактом.

## 8. Stop condition

После технического R0 PASS агент:

1. обновляет PR №43 фактическими результатами;
2. не изменяет owner decision files;
3. не переводит PR в Ready самостоятельно;
4. не merge;
5. не начинает R1;
6. останавливается для owner review.
