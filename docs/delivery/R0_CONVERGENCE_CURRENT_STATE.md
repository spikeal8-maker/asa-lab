# R0 — текущее состояние конвергенции

**Дата снимка:** 2026-07-29  
**Статус:** `owner_review_required`  
Current gate: `R0`  
**Product coding:** запрещён до owner approval и merge PR №43.  
**Functional parity claim:** `not_100_percent`.

Этот документ является кратким снимком текущего состояния. Машиночитаемый источник — [`ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml`](ASA_TARGET_PLATFORM_EXECUTION_PLAN.yaml). При изменении ролей веток или target scope обновляются оба файла одним нормативным PR.

## 1. Принятая точка отсчёта

```text
main
└── Teacher Portal foundation
```

`main` сохраняется до owner-решения. Ни одна candidate-ветка и ни один документ не считаются production baseline автоматически.

## 2. Роли открытых PR

| PR | Роль в R0 | Разрешено сейчас | Запрещено сейчас |
|---:|---|---|---|
| №34 | Electronics/Project foundation candidate | owner review и defect fixes внутри foundation scope | Identity, StudentSeat, Publication, Assignments, автоматический merge |
| №43 | единственный target/interface/parity contract candidate | contracts, complete page/tool inventory, evidence, validators, governance | product runtime, R1 implementation, автоматический merge, ложный 100% claim |
| №35 | transfer-only Electronics workbench | critical portability fixes | самостоятельный merge в `main`, новые features |
| №45 | transfer-only Registry/Project Hub/Editor Host | critical portability fixes | самостоятельный merge в `main`, Identity/Classroom expansion |
| №47 | transfer-only Visual Product System | critical visual compatibility fixes | самостоятельный merge в `main`, изменение business semantics |
| №59 | frozen competing R1 candidate A | сохранение branch/evidence, critical fix | продолжение C1, merge, destructive cleanup |
| №60 | frozen competing R1 candidate B | сохранение branch/evidence, critical fix | расширение vertical, merge, третья identity branch |
| №29 | non-blocking Map UX candidate | viewer-only fixes | изменение execution order или target semantics |

## 3. Три независимых decision state

```text
R0_FOUNDATION_DECISION.yaml      PR №34: pending_owner
R0_OWNER_DECISION.yaml           target/interface/parity contract: pending_owner
R0_R1_CANDIDATE_DECISION.yaml    PR №59/№60: deferred_until_r0c
```

Технический PASS не меняет ни один owner state автоматически.

## 4. Полный target scope теперь определён

```text
docs/product/ASA_TINKERCAD_100_PERCENT_SCOPE.yaml
docs/product/ASA_PRODUCT_SURFACE_CATALOG.yaml
docs/product/ASA_COMPLETE_INTERFACE_BLUEPRINT.md
docs/product/ASA_VISUAL_PRODUCT_SYSTEM.md
docs/product/ASA_ELECTRONICS_TOOL_CATALOG.yaml
docs/product/ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md
docs/product/ASA_STUDENT_EXPERIENCE_SPEC.md
docs/product/ASA_ADMIN_CONSOLE_SPEC.md
docs/product/interface-catalog.html
```

Он охватывает:

- public/account/class-code entry;
- Creator Portal, Projects, Learn, Challenges, Explore, Profiles;
- Classroom, StudentSeat, teacher viewer, assignments, review, grades and badges;
- Electronics components, wiring, instruments, Arduino, micro:bit, code and serial;
- 3D Design;
- Codeblocks;
- Sim Lab/robotics physics;
- school administration;
- platform administration;
- mobile/touch/AR and integrations либо explicit deviations.

Наличие описания не означает runtime implementation. `evidence_required` блокирует parity claim.

## 5. Обязательная последовательность

```text
1. Исправить доказанные blockers PR №34 внутри foundation scope
2. Owner принимает PR №34 как foundation либо требует изменения
3. Если принят — PR №34 merge, foundation status → accepted_merged
4. Owner принимает шесть target decisions PR №43
5. Owner принимает complete interface and functional parity scope
6. PR №43 один раз rebased на main с принятым foundation
7. 25 R0 validators + YAML + interface catalog browser smoke PASS
8. PR №43 merged
9. R0A governance activation; R1 остаётся blocked
10. Один R0B/P1 integration PR + baseline preservation
11. Transfer proof и закрытие №35/№45/№47
12. R0C: owner выбирает №59 ИЛИ №60
13. Выбранная R1-линия один раз rebased на accepted baseline
14. Вторая R1-линия закрывается superseded
15. Только R0D отмечает R0 done и R1 ready
```

Если PR №34 отклонён с закрытием, текущий integration/source contract сначала пересматривается. PR №43 не merge по плану, который предполагает принятый foundation.

Нельзя переставлять шаги ради удобства конкретной ветки.

## 6. Что не является активной задачей

- Issues №6/№7/№8/№20/№24/№25/№26 — superseded v1 traceability;
- Issues №44/№46/№50/№52 — evidence-only;
- Issue №49 — superseded cross-release bundle;
- Issue №61 — superseded owner-intent roadmap;
- PR №35/№45/№47 — не самостоятельные product releases;
- PR №59/№60 — не две параллельные R1-линии;
- описанные future pages/3D/Codeblocks/Sim Lab/admin — не работающий runtime до своих release.

## 7. Owner action

### Сначала визуальный каталог scope

Запустить из корня:

```text
python -m http.server 8080
```

Открыть:

```text
http://127.0.0.1:8080/docs/product/interface-catalog.html
```

Проверить страницы, роли, Electronics tools, admin, learner and parity groups.

### Затем PR №34

Открыть [`R0_FOUNDATION_REVIEW_PR34.md`](R0_FOUNDATION_REVIEW_PR34.md). Решение и evidence фиксируются в [`R0_FOUNDATION_DECISION.yaml`](R0_FOUNDATION_DECISION.yaml).

### Затем target contract

Открыть [`R0_OWNER_DECISION.md`](R0_OWNER_DECISION.md) и подтвердить шесть решений. После локального полного PASS владелец пишет в PR №43:

```text
OWNER DECISION: APPROVED
Decisions 1–6: accepted
Convergence order: accepted
Functional parity scope: accepted
```

Состояние синхронно фиксируется в `R0_OWNER_DECISION.yaml`.

### Выбор R1 — позже

PR №59/№60 не выбираются до R0C. Состояние находится в `R0_R1_CANDIDATE_DECISION.yaml`.

## 8. R0 checks

```text
python tools/validate_r0.py
```

Suite должна доказать:

- parity/target contracts согласованы;
- complete page/admin/student/Electronics catalogs существуют и не заявляют ложный PASS;
- все surfaces mapped в R1–R10;
- PR №34/PR №43/R1 candidate states разделены;
- baseline preservation и post-merge sequence непротиворечивы;
- R0–R10 dependencies и strict order непротиворечивы;
- PR №43 не меняет product code, migrations, runtime schemas или binaries;
- release-map/test-matrix templates не активированы раньше времени;
- architecture/map/test catalog validators PASS;
- live GitHub branch roles совпадают с контрактом.

## 9. Stop condition

После технического R0 PASS агент:

1. обновляет PR №43 фактическими результатами;
2. перечисляет unresolved `evidence_required` count;
3. прикладывает browser result interface catalog;
4. не изменяет owner decision files;
5. не переводит PR в Ready самостоятельно;
6. не merge;
7. не начинает R1;
8. останавливается для owner review.
