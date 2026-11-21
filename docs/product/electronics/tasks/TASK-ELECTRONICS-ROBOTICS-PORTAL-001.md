---
task_id: TASK-ELECTRONICS-ROBOTICS-PORTAL-001
kind: implementation
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/execution/current.yaml
  - docs/product/robotics/PORTAL_INTEGRATION_PLAN.md
  - docs/agent/contracts/identity.yaml
  - docs/product/electronics/contracts/CANONICAL_CLOCK_CONTRACT.md
acceptance_boundary: milestone
review: independent
---

# Robotics — серверный проект, портал и публикации

## Goal

Владелец явно поручил пять последовательных результатов: настоящий проект аккаунта; основной редактор и «Создать»; главная и «Мои проекты»; публикация и просмотр другим пользователем; реальная сквозная проверка после повторного входа и на другом устройстве. Программа не завершается на документации, регистрации, локальном dev-host или Draft PR.

Выбранные Issue, branch, source SHA, состояние и ограничения читаются из [current.yaml](../../../execution/current.yaml). [План](../../robotics/PORTAL_INTEGRATION_PLAN.md) задаёт границу пяти результатов и не является вторым журналом состояния. Базовое подключение к порталу выполняется перед дополнительным оборудованием и 3D.

## Component IDs и ownership

- `electronics.engine.public-api` и `electronics.worker.live-controller`: неизменяемое общее ядро и время.
- `electronics.ui.workbench`, `electronics.ui.arduino-editor`, `electronics.ui.catalog`: существующие интерфейсы, генератор и компоненты.
- Robotics владеет каноническим документом мира, конфигурацией, адаптером проектного host и представлением поля.
- Project Core, identity и publications сохраняют существующие серверные права, версии, optimistic concurrency и immutable publication model.

## Minimal read set

Применимые AGENTS, START_HERE_FOR_AI, scoped registry context, identity compact contract, Module SDK/provider и Project Core, snapshot/publication contracts, [review protocol](../../../agent/review-protocol.md), [UI acceptance](../../ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md), канонические clock/host pacing контракты электроники. Прежний M1 прочитывается по нужным файлам; повторный общий аудит не требуется.

## Bounded author slices

1. Shared robotics document/provider и серверное создание/валидация: один browser/server-safe контекст, перенос существующей world-модели без изменения физики, единый seed и совместимость локальных v1/v2 документов; forward project migration.
2. Portal editor/project host: сохранение целого документа, source/revision/history boundaries, штатные аккаунт/StudentSeat context, snapshots, Leave/Save/Open, меню и карточки.
3. Publications: строгий display-only публичный артефакт, existing immutable version lookup, read-only viewer и настоящий каталог; forward publication migration.
4. Integration evidence: один обычный Web/API/real PostgreSQL путь с двумя аккаунтами, независимый review точного итогового SHA и классификация CI.

Root выполняет координацию, Git/publication и регистрацию. Авторы имеют непересекающиеся согласованные файлы; независимый review не выполняет автор своего изменения.

## Expected write paths

Registration ограничена этой карточкой, `docs/product/robotics/PORTAL_INTEGRATION_PLAN.md` и `docs/execution/current.yaml`.

До продуктовой записи контроллер проверяет полный точный file plan. Необходимые области: новый `contexts/robotics` и его workspace/Nx wiring; Web robotics adapters; module registry и разрешённые telemetry module lists; forward migrations; общий editor host/создание/главная; snapshot hook; публичные DTO/API/viewer/catalog; focused tests и существующий publication gate. Новые внешние зависимости и отдельный сервис не нужны. Выпущенные миграции, защищённые owner assets, solver/Worker/Arduino math не переписываются.

## Contract

- `RoboticsProject` сохраняет исходные circuit/program/world вместе. Runtime pose, velocity, current sensor readings и live simulation не записываются как исходная сцена.
- Provider поддерживает создание, whole-document validation и preview без React/DOM/browser catalog. Default seed является данными проверенного общего пресета, а не копией электрического runtime.
- Незавершённую редактируемую схему можно сохранить. Missing bindings и unsupported topology проверяются при Run; они не превращаются в ложный solved result.
- Существующий запрет downgrade электрического schema и optimistic concurrency сохраняются; header title использует Project metadata без необоснованного усечения.
- Сохраняются синхронный flush блоков перед Save/Run/navigation, защита от устаревшей публикации после Undo/Open и сохранность workspace при field-only history.
- Используются существующие права Project Core/identity. Не вводятся глобальная user.role, новая tenant модель, UI-only authorization или обход StudentSeat правил.
- Публикация читает immutable опубликованную версию. Display artifact содержит только явно разрешённую геометрию и provenance, без Arduino source/Blockly, bindings, приватного draft или данных прав.
- Public copy/download и learning capabilities не расширяются этой задачей. Публичная интерактивность означает только реально реализованные действия просмотра, не выдуманную симуляцию.
- Основной пользовательский вход использует обычное приложение и origin ASALab, без отдельного HTML entry для пользователя, отдельного аккаунта, сервиса или установки.
- Изменения схемы БД выполняются новыми версионными миграциями и проверяются на fresh и upgrade test database. Рабочая БД, установка и deployment не входят в авторский срез.

## Visible acceptance

Создать через обычный портал → изменить поле, конструкцию, схему и программу → сохранить → закрыть/войти снова → найти карточку с названием и превью → открыть на новом browser context → получить те же исходные данные → опубликовать → другой аккаунт находит публикацию в общем каталоге и открывает безопасный просмотр. Изменение private draft не меняет опубликованную версию; закрытая публикация недоступна; чужой private project не раскрывается.

## Tests / gates

Registration: formatting/diff check, scoped preflight, control-plane и governance. Продукт: существующие robotics regressions, новые provider/host/artifact/permissions tests, real PostgreSQL create/save/revision/upgrade/publication cases, API/Web types/build/budgets и существующий projects-publication browser gate. Новые тесты добавляются в исполнимый штатный gate; один локальный PASS не заменяет required CI. Пользовательский путь не проверяется прежним dev runner, запрещающим API.

## Explicitly not doing

Новые моторные модели, H-bridge, load/stall, датчики цвета/линии, клешня, hardware BOM, 3D/CAD, открытие приватного кода/экспорта, расширение StudentSeat publication или learning capability, новый backend/Compose stack, исправление чужого модуля ради зелёного CI, рабочая БД и deployment.

## Review и Stop

Каждый автор выполняет согласованный bounded slice, focused/self-review и STOP. Root продолжает все явно порученные пять шагов, а не останавливается на авторском STOP. Independent review проверяет финальный SHA, сохранность source/history, права/конкурентность, публичный payload и реальный browser путь. Продуктовый merge, owner acceptance и deployment остаются отдельными действиями; текущая регистрация не закрывает inherited CI вопросы M0/M1.
