# AGENTS.md — обязательный контракт coding-агента ASA Lab

## 1. Каноническое состояние

```text
canonical branch:        main
product merge SHA:       67b4f8eea3804d750684dd1c6dce929f5f1f9bfa
completed task:          TASK-CREATOR-PORTAL-001
completed gateway:       TASK-R3A-ELECTRONICS-GATEWAY-001
active task:             TASK-ELECTRONICS-M1-001
active issue:            #63
active branch:           agent/r4-electronics-m1
status:                  in_progress
```

`docs/delivery/EXECUTION_MANIFEST.yaml` и Issue #63 являются исполняемыми
источниками scope. R3B остаётся blocked/deferred; R4-M2 и R5+ не активированы.

## 2. Источники истины

Читать в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. Issue #63 и owner implementation directive;
6. `docs/testing/test-catalog.yaml`;
7. `docs/testing/active-task-tests.yaml`.

## 3. Ветка и Git

- работать только в `agent/r4-electronics-m1` от merge-коммита `67b4f8e`;
- не создавать дополнительные ветки;
- не менять `main`, не merge, не tag, не force-push и не rebase опубликованной истории;
- не трогать PR #29 и `assistant/map-ux-owner-view`;
- не коммитить backups, dumps, credentials и owner-only browser data.

## 4. R3A Gateway

Gateway считается завершённым только как короткая проверка существующей
архитектуры:

- один server-side `ModuleRegistry`;
- Electronics и Chess подключены через manifest/provider;
- Project Core не ветвится по `moduleKey`;
- общий `ModuleEditorHost` монтирует зарегистрированный editor key;
- create/open/rename/save/reload/checkpoint остаются module-neutral;
- personal project не требует Classroom;
- существующие Electronics и Chess документы открываются без миграции данных.

Полный R3 не заявляется: R3B остаётся blocked/deferred.

## 5. TASK-ELECTRONICS-M1-001

Реализовать рабочий редактор и детерминированный DC-симулятор для источника,
резистора, LED, нормально-разомкнутой кнопки, переключателя, трёхвыводного
потенциометра, диода и лампы. Обязательны последовательные и параллельные
цепи, провода и переподключение, изгибы и цвет, multiselect, rotate,
duplicate, delete, undo/redo, inspector с токами/напряжениями, сохранение,
checkpoint и привязанные к схеме диагностики.

Вне scope: breadboard, измерительные приборы, Arduino, micro:bit, transient/AC,
R4-M2, R5+ и перестройка модульной архитектуры.

## 6. Проверки и показ

До визуальной проверки владельца запускать только focused tests из
`docs/testing/active-task-tests.yaml`. Полную матрицу не запускать.

Финальный exact SHA развернуть только в существующем Compose project
`asa-lab-dev` на `http://localhost:4610`. Не создавать постоянные test/audit/
matrix/final/rc/staging проекты; временные контейнеры должны быть `--rm`.
Рабочую БД, volume и backup сохранять.

Опубликовать шесть screenshots: `empty`, `components`, `wired`, `running`,
`diagnostic`, `reload`. После focused PASS и живого показа остановиться для
owner review: без full gate, merge и R4-M2.
