# ASA Lab — Product Documentation

Эта папка определяет **что строит ASA Lab**. Delivery-документы отдельно определяют **в каком порядке это реализуется**.

## 1. Продуктовые источники

1. [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md) — полное определение платформы и конечной цели.
2. [`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml) — машиночитаемые capability IDs, зависимости и release slices.
3. [`CAPABILITY_MAP.md`](CAPABILITY_MAP.md) — визуальная карта возможностей.
4. [`CLASSROOM_CORE_SPEC.md`](CLASSROOM_CORE_SPEC.md) — классы, StudentSeat, задания, submissions и кабинеты.
5. [`MODULE_PLATFORM_SPEC.md`](MODULE_PLATFORM_SPEC.md) — подключение электроники, блочного программирования, 3D, робототехники, шашек/шахмат и других модулей.
6. [`ASSESSMENT_REWARDS_SPEC.md`](ASSESSMENT_REWARDS_SPEC.md) — комментарии, review, rubric, оценки, badges, certificates и progress.

## 2. Практический маршрут разработки

- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md) — канонический путь Product Alpha → School Pilot;
- [`../delivery/LOCAL_PORT_POLICY.md`](../delivery/LOCAL_PORT_POLICY.md) — Web `4610`, API `4611`, E2E `4612`;
- [`../project-map/project-map.yaml`](../project-map/project-map.yaml) — current focus, execution queue и dependencies;
- [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md) — gates каждого этапа;
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — исполняемые test IDs.

Продуктовая документация не является требованием реализовать всё одновременно. Development Program делит конечную систему на девять последовательных executable tasks.

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

Checkers Lite используется только как маленькое доказательство Module SDK. Приоритетный предметный модуль — Electronics.

## 4. Источники истины

- продуктовая цель и инварианты — `PRODUCT_BLUEPRINT.md`;
- состав возможностей и зависимости — `CAPABILITY_MAP.yaml`;
- практическая последовательность — `DEVELOPMENT_PROGRAM_V1.md`;
- архитектура — `docs/architecture/ARCHITECTURE_BASELINE.md` и ADR;
- текущая задача — `project-map.yaml` + связанная GitHub Issue;
- API/данные — OpenAPI, JSON Schema и migrations;
- готовность — `test-catalog.yaml` и фактические artifacts.

## 5. Правило coding-агента

Перед реализацией агент обязан:

1. прочитать current focus;
2. открыть одну связанную executable Issue;
3. прочитать раздел текущего этапа Development Program;
4. найти capability IDs;
5. проверить dependencies;
6. перечислить один user flow;
7. перечислить non-goals;
8. соблюдать port policy;
9. выполнить только текущий flow;
10. остановиться после Draft PR/merge и не начинать следующую Issue.

Агент не обязан перечитывать все документы полностью, если Issue содержит точные ссылки.

При конфликте между чатом и нормативной Issue/картой агент останавливается. Scope не меняется молча.

## 6. Главное определение

> ASA Lab — единая образовательная workspace platform: один безопасный вход, единые классы, проекты, задания, submissions, комментарии, оценки и достижения; множество независимых предметных модулей через Module SDK.