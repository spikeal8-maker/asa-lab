# ASA Lab — Product Documentation

Эта папка определяет **что именно строит ASA Lab**. Архитектурные документы определяют техническую форму системы; продуктовые документы определяют пользовательские возможности, границы и конечный образовательный результат.

## Нормативный порядок чтения

1. [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md) — полное определение платформы и конечной цели.
2. [`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml) — машиночитаемый источник capability IDs, зависимостей и релизов.
3. [`CAPABILITY_MAP.md`](CAPABILITY_MAP.md) — визуальная карта платформы.
4. [`CLASSROOM_CORE_SPEC.md`](CLASSROOM_CORE_SPEC.md) — классы, StudentSeat, задания, submissions и кабинеты.
5. [`MODULE_PLATFORM_SPEC.md`](MODULE_PLATFORM_SPEC.md) — подключение электроники, блочного программирования, 3D, робототехники, шахмат и других модулей.
6. [`ASSESSMENT_REWARDS_SPEC.md`](ASSESSMENT_REWARDS_SPEC.md) — комментарии, проверка, rubric, оценки, badges, certificates и progress.

## Что является источником истины

- Продуктовая цель и инварианты: `PRODUCT_BLUEPRINT.md`.
- Состав возможностей и зависимости: `CAPABILITY_MAP.yaml`.
- Архитектура: `docs/architecture/ARCHITECTURE_BASELINE.md` и ADR.
- Конкретный scope реализации: GitHub Issue, которая обязана ссылаться на capability IDs.
- Фактические API/данные: OpenAPI, JSON Schema и migrations.

## Правило для coding-агентов

Перед реализацией продуктовой задачи агент обязан:

1. прочитать `PRODUCT_BLUEPRINT.md`;
2. найти capability IDs в `CAPABILITY_MAP.yaml`;
3. проверить зависимости capabilities;
4. убедиться, что Issue не противоречит продуктовой карте;
5. перечислить пользовательский flow;
6. перечислить non-goals;
7. обновить карту в том же PR, если изменяется capability или релиз.

При конфликте между сообщением в чате и нормативной Issue/картой агент останавливается. Смысл продукта не меняется молча.

## Главное определение

> ASA Lab — единая образовательная workspace platform: один безопасный вход, единые классы, задания, проекты, submissions, комментарии, оценки и достижения; множество независимых предметных модулей через Module SDK.
