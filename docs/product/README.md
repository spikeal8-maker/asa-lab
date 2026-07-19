# ASA Lab — Product Documentation

Эта папка определяет **что строит ASA Lab**. Delivery-документы отдельно определяют **в каком порядке и по какому контракту это реализуется**.

## 1. Продуктовые источники

1. [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md) — полное определение платформы и конечной цели.
2. [`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml) — машиночитаемые capability IDs, зависимости и release slices.
3. [`CAPABILITY_MAP.md`](CAPABILITY_MAP.md) — визуальная карта возможностей.
4. [`CLASSROOM_CORE_SPEC.md`](CLASSROOM_CORE_SPEC.md) — классы, StudentSeat, задания, submissions и кабинеты.
5. [`MODULE_PLATFORM_SPEC.md`](MODULE_PLATFORM_SPEC.md) — подключение электроники, block coding, 3D, robotics, checkers/chess и других модулей.
6. [`ASSESSMENT_REWARDS_SPEC.md`](ASSESSMENT_REWARDS_SPEC.md) — comments, review, rubric, grades, badges, certificates и progress.

## 2. Практический маршрут разработки

- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) — точный machine-readable task/Issue/branch/stage/test/map contract;
- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md) — человекочитаемый путь Product Alpha → School Pilot;
- [`../delivery/LOCAL_PORT_POLICY.md`](../delivery/LOCAL_PORT_POLICY.md) — Web `4610`, API `4611`, E2E `4612`;
- [`../project-map/project-map.yaml`](../project-map/project-map.yaml) — current focus, dynamic statuses и dependencies;
- [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md) — gates каждого этапа;
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — исполняемые test IDs.

Продуктовая документация не требует реализовать всё одновременно. Execution Manifest и Development Program делят конечную систему на девять последовательных executable tasks.

## 3. Два delivery tracks

### Technical Product Alpha

```text
Teacher Portal
→ Universal Project Shell
→ Checkers Lite reference module
→ Electronics Alpha
```

### School Pilot

```text
StudentSeat
→ Assignment and Immutable Submission
→ Comments Review Grade Badge
→ Full Electronics Classroom Cycle
```

Checkers Lite — маленькое доказательство Module SDK. Приоритетный предметный модуль — Electronics.

## 4. Источники истины

- продуктовая цель — `PRODUCT_BLUEPRINT.md`;
- capabilities и release dependencies — `CAPABILITY_MAP.yaml`;
- task contract — `EXECUTION_MANIFEST.yaml`;
- человекочитаемая последовательность — `DEVELOPMENT_PROGRAM_V1.md`;
- architecture horizons — `docs/architecture/IMPLEMENTATION_ROADMAP.md`;
- current status — `project-map.yaml`;
- executable scope — текущая GitHub Issue;
- API/data — OpenAPI, JSON Schema и migrations;
- готовность — manifest profiles + `test-catalog.yaml` + artifacts.

`delivery_stage` задаёт execution order. `architecture_horizon` описывает архитектурную область и не используется для выбора следующей задачи.

## 5. Правило coding-агента

Перед реализацией агент обязан:

1. прочитать current focus;
2. найти task entry в Execution Manifest;
3. открыть указанную Issue и branch;
4. проверить dependencies;
5. прочитать только manifest `read` links;
6. перечислить один user flow и non-goals;
7. соблюдать port policy;
8. выполнить только текущий flow;
9. выполнить все manifest/test-catalog tests;
10. обновить Project/Quality/Nx maps;
11. после merge выполнить map transition и остановиться.

При конфликте агент останавливается. Чат не меняет task/capability/scope/port/test gate.

## 6. Главное определение

> ASA Lab — единая образовательная workspace platform: один безопасный вход, единые классы, проекты, задания, submissions, комментарии, оценки и достижения; множество независимых предметных модулей через Module SDK.
