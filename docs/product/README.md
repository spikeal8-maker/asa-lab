# ASA Lab — Product Documentation

Эта папка определяет **что строит ASA Lab**. Delivery-документы определяют **какая часть цели активна сейчас**.

## Продуктовые источники

1. [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md) — конечная платформа и пользовательские инварианты.
2. [`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml) — capability IDs и зависимости.
3. [`CAPABILITY_MAP.md`](CAPABILITY_MAP.md) — визуальная карта возможностей.
4. [`CLASSROOM_CORE_SPEC.md`](CLASSROOM_CORE_SPEC.md) — Classroom, StudentSeat и learner surfaces.
5. [`MODULE_PLATFORM_SPEC.md`](MODULE_PLATFORM_SPEC.md) — Module SDK и предметные среды.
6. [`ASSESSMENT_REWARDS_SPEC.md`](ASSESSMENT_REWARDS_SPEC.md) — review, grades, badges и progress.

Эти документы не означают, что все capabilities уже реализованы или активированы.

## Текущее состояние продукта

```text
product merge SHA:       e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
Account C1 / Issue #48:  completed
active product task:     none
```

В `main` находятся:

- public entry и adult registration;
- Account / Profile / Principal;
- Personal Workspace и sessions_v2;
- educator self-attestation, workspace context, profile и active sessions;
- Project Hub;
- Electronics Alpha;
- ASA Chess и Chess Online;
- Docker/PostgreSQL/RLS/persistence/backup foundation.

Функциональная полнота конечной платформы не заявляется.

## Delivery sources

- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) — completed executable queue и blocked roadmap;
- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md) — человеко-читаемая программа;
- [`../project-map/project-map.yaml`](../project-map/project-map.yaml) — current state;
- [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md) — проверенная матрица;
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — test IDs и commands.

## Завершённая очередь

```text
Product Docs done
→ Teacher Portal done
→ Account C1 done
→ current_focus null
```

## Blocked roadmap

```text
R2 Issue №62  Creator Portal
→ R3 Issue №37  Module Registry and project lifecycle
→ R4 Issue №63  Electronics functional parity
→ Classroom / StudentSeat / learner cycle
→ publication / assignments / review
→ additional modules and administration
```

R2/R3/R4 не являются executable до отдельного owner transition.

## Source-of-truth rule

- product goal — Product Blueprint;
- capabilities — Capability Map;
- executable task — Execution Manifest;
- current state — Project Map;
- detailed scope — active GitHub Issue;
- API/data behavior — contracts and additive migrations;
- readiness — exact test catalog commands and artifacts.

`architecture_horizon` не является execution order.

## Coding-agent rule

При `current_focus: null` агент выводит `NO_ACTIVE_TASK` и не пишет product code. После будущей активации он выполняет только опубликованный vertical flow и останавливается для owner review.

## Главное определение

> ASA Lab — единая образовательная workspace platform: безопасная identity-модель, личные и организационные пространства, проекты, классы и учебный цикл; независимые предметные модули через общий lifecycle.
