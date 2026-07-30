# ASA Lab — Product Documentation

Эта папка определяет **что строит ASA Lab**. Delivery-документы определяют **какая часть конечной цели сейчас исполнима**.

## Продуктовые источники

1. [`PRODUCT_BLUEPRINT.md`](PRODUCT_BLUEPRINT.md) — конечная платформа и пользовательские инварианты.
2. [`CAPABILITY_MAP.yaml`](CAPABILITY_MAP.yaml) — capability IDs и зависимости.
3. [`CAPABILITY_MAP.md`](CAPABILITY_MAP.md) — визуальная карта возможностей.
4. [`CLASSROOM_CORE_SPEC.md`](CLASSROOM_CORE_SPEC.md) — Classroom, StudentSeat, assignments и learner surfaces.
5. [`MODULE_PLATFORM_SPEC.md`](MODULE_PLATFORM_SPEC.md) — Module SDK и предметные среды.
6. [`ASSESSMENT_REWARDS_SPEC.md`](ASSESSMENT_REWARDS_SPEC.md) — review, grades, badges и progress.

Эти документы не означают, что все capabilities уже реализованы или могут разрабатываться параллельно.

## Текущее состояние продукта

Принятый технический Alpha-baseline:

```text
7afebdcf9441b027092ce17a37f1f89950af99c6
```

На нём уже существуют public entry, Account foundation, Personal Workspace, Project Hub, Electronics Alpha, Chess и Chess Online. Функциональная полнота не заявляется.

Текущая executable product task:

```text
TASK-ACCOUNT-C1-001
Issue #48
```

Оставшийся Account C1 scope:

- educator self-attestation;
- provisional audited capability;
- workspace list and ActiveContext switch;
- account menu/profile;
- email verification state;
- active session management;
- Account Chromium evidence.

## Delivery sources

- [`../delivery/EXECUTION_MANIFEST.yaml`](../delivery/EXECUTION_MANIFEST.yaml) — только активированные executable tasks;
- [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md) — current task и owner-gated roadmap;
- [`../delivery/LOCAL_PORT_POLICY.md`](../delivery/LOCAL_PORT_POLICY.md) — Web `4610`, API `4611`, E2E `4612`;
- [`../project-map/project-map.yaml`](../project-map/project-map.yaml) — current focus and status;
- [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md) — current quality gate;
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml) — executable test IDs.

## Исполняемая очередь

```text
Product Docs done
→ Teacher Portal done
→ Account C1 in_progress
→ owner review / stop
```

После Account C1 future task не выбирается автоматически.

## Owner-gated roadmap

```text
R2 Issue №62  Creator Portal
→ R3 Issue №37  Module Registry and full project lifecycle
→ R4 Issue №63  Electronics functional parity
→ Classroom / StudentSeat / learner cycle
→ publication / assignments / review
→ additional modules and administration
```

R2/R3/R4 находятся в roadmap и отсутствуют в текущей executable queue. Для каждого требуется отдельный owner transition.

Старые Project Shell, Checkers Lite и Electronics Alpha task nodes сохраняются только для traceability. Полезная реализация уже находится в единой Alpha-линии; они не являются разрешением возобновить старые branches.

## Source-of-truth rule

- product goal — Product Blueprint;
- capabilities — Capability Map;
- executable task — Execution Manifest;
- current state — Project Map;
- detailed scope — current GitHub Issue;
- API/data behavior — executable contracts and additive migrations;
- readiness — exact test catalog commands and artifacts.

`architecture_horizon` не является execution order. Dependency-ready roadmap work не обходят current task.

## Coding-agent rule

Перед кодом агент обязан:

1. проверить infrastructure terminal/active state;
2. прочитать current focus;
3. найти тот же task в Execution Manifest;
4. проверить Issue, branch и dependencies;
5. отделить already implemented от remaining scope;
6. выполнить только текущий user flow;
7. выполнить exact focused and full gates;
8. обновить maps/evidence;
9. остановиться для owner review.

Запрещено автоматически создавать следующую branch, начинать roadmap capability, менять `main`, делать merge/tag или повторно создавать существующую Account/Principal/Workspace/session модель.

## Главное определение

> ASA Lab — единая образовательная workspace platform: безопасная identity-модель, личные и организационные пространства, проекты, классы и учебный цикл; независимые предметные модули через общий lifecycle.
