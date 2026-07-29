# R0 — текущее состояние конвергенции

**Дата снимка:** 2026-07-29  
**Статус:** `owner_review_required`  
**Current gate:** `R0`  
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

## 3. Обязательная последовательность

```text
1. Owner принимает или отклоняет PR №34 как ограниченный foundation
2. Owner принимает пять решений PR №43
3. PR №43 один раз rebased на актуальный main
4. R0 validators PASS
5. PR №43 merged
6. Один P1 integration PR из agent/parity-p1-visual-integration
7. Transfer proof и закрытие №35/№45/№47
8. Owner выбирает №59 ИЛИ №60
9. Выбранная R1-линия один раз rebased на accepted baseline
10. Вторая R1-линия закрывается superseded
```

Нельзя переставлять шаги ради удобства конкретной ветки.

## 4. Что не является активной задачей

- Issue №24 / `TASK-PROJECT-SHELL-001` — superseded историческая спецификация;
- Issues №44/№50/№52 — evidence-only;
- Issue №49 — superseded cross-release bundle;
- Issue №61 — superseded owner-intent roadmap;
- PR №35/№45/№47 — не самостоятельные product releases;
- PR №59/№60 — не две параллельные R1-линии.

## 5. Owner action

Открыть [`R0_OWNER_DECISION.md`](R0_OWNER_DECISION.md) и подтвердить пять решений.

После локального полного PASS владелец пишет в PR №43:

```text
OWNER DECISION: APPROVED
Decisions 1–5: accepted
Convergence order: accepted
```

Без этой записи PR №43 остаётся Draft и R1 не начинается.

## 6. R0 checks

```text
python tools/validate_r0.py
```

Suite должна доказать:

- parity/target contracts согласованы;
- R0–R10 dependencies непротиворечивы;
- PR №43 не меняет product code, migrations или runtime schemas;
- architecture/map/test catalog validators PASS;
- owner decision всё ещё требуется.

## 7. Stop condition

После R0 PASS агент:

1. обновляет PR №43 фактическими результатами;
2. не переводит PR в Ready самостоятельно;
3. не merge;
4. не начинает R1;
5. останавливается для owner review.
