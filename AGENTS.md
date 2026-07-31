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
status:                  in_progress / electronics_asset_foundation_audit
owner rejection:         PR #72 comment 5145281700
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml`, Issue #63 and the latest owner directive
are the executable sources of scope. R3B remains blocked/deferred; R4-M2 and R5+
are not activated.

## 2. Источники истины

Читать в таком порядке:

1. `AGENTS.md`;
2. `docs/project-map/infrastructure-focus.yaml`;
3. `docs/project-map/project-map.yaml`;
4. `docs/delivery/EXECUTION_MANIFEST.yaml`;
5. Issue #63, включая owner comments `5145285731` и `5145281700`;
6. `docs/testing/test-catalog.yaml`;
7. `docs/testing/active-task-tests.yaml`.

При конфликте остановиться и назвать точные источники. Нельзя возвращать
breadboard во «вне scope»: владелец явно сделал его обязательным для M1.

## 3. Ветка и Git

- работать только в `agent/r4-electronics-m1` от merge-коммита `67b4f8e`;
- не создавать дополнительные ветки;
- не менять `main`, не merge, не tag, не force-push и не rebase опубликованной истории;
- не трогать PR #29 и `assistant/map-ux-owner-view`;
- не коммитить backups, dumps, credentials и приватные исходные ZIP;
- безопасные manifest, проверенные owner SVG и review screenshots допускаются только в PR #72.

## 4. R3A Gateway

Gateway завершён только как короткая проверка существующей архитектуры:

- один server-side `ModuleRegistry`;
- Electronics и Chess подключены через manifest/provider;
- Project Core не ветвится по `moduleKey`;
- общий `ModuleEditorHost` монтирует зарегистрированный editor key;
- create/open/rename/save/reload/checkpoint остаются module-neutral;
- personal project не требует Classroom;
- существующие Electronics и Chess документы открываются без потери данных.

Полный R3 не заявляется: R3B остаётся blocked/deferred.

## 5. TASK-ELECTRONICS-M1-001 — Electronics Asset Foundation Audit

Текущий solver/editor код сохраняется без изменений. Узкий corrective scope
отменён владельцем: текущий checkpoint — полный аудит всех компонентов в
owner-confirmed archive, а не реализация симулятора, product UI или новых функций.

Обязательный текущий scope:

1. Хэшировать и классифицировать каждый файл канонического ZIP, все читаемые
   вложенные ZIP и уникальные supplemental owner sources.
2. Создать полный logical component manifest. Обязательно классифицировать:
   battery holders, RGB LED, все LED colors/brightness states, displays,
   breadboards, Arduino/microcontrollers, sensors, motors, switches и passives.
3. Создать отдельные physical-dimensions, pin-map, breadboard-footprint-map и
   state-family-map. Отсутствующие данные отмечать `not_declared`/`absent`, не
   вычислять их по догадке.
4. Contact sheet показывает весь каталог и точные owner files. Канонические,
   supplemental и unaccepted candidates визуально и семантически разделяются.
5. Private source ZIP и backups не коммитятся. Review assets копируются строго
   byte-for-byte; их SHA-256 должен совпадать с manifest.

## 6. Запрещено до owner acceptance

- full repository matrix;
- merge PR #72;
- R4-M2;
- новые solver features;
- изменения product Electronics UI;
- новые runtime functions;
- самодельные SVG и угадывание отсутствующих assets;
- использование фоновых pixel-vectorized `resistor-axial.svg` и
  `potentiometer-rotary.svg`;
- заявление о runtime-готовности компонента только на основании наличия файла.

## 7. Проверки и owner checkpoint

До визуального принятия запускать только focused asset-audit checks:

- archive, per-entry hash и manifest consistency;
- полный category coverage;
- transparent-SVG audit для exact review assets;
- physical dimensions completeness/status;
- pin-map completeness/status;
- LED/RGB/display state-family inventory;
- breadboard hole/group/footprint metadata;
- browser smoke полного contact sheet.

Exact SHA развернуть только в существующем `asa-lab-dev` на
`http://localhost:4610`. Не создавать постоянные test/audit/matrix/final/rc/
staging Compose projects. Рабочую БД, volume и backup сохранять.

После публикации manifest, contact sheet и owner-visible screenshots остановиться.
Solver, wiring/simulation UI, full gate, merge и R4-M2 разрешаются только после
отдельного решения владельца.
