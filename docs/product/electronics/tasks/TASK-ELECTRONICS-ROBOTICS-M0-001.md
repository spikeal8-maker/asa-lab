---
task_id: TASK-ELECTRONICS-ROBOTICS-M0-001
kind: implementation
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/execution/current.yaml
  - docs/product/robotics/IMPLEMENTATION_PLAN.md
  - docs/product/electronics/contracts/CANONICAL_CLOCK_CONTRACT.md
  - docs/product/electronics/contracts/HOST_PACING_PAUSE_ADAPTER_V1.md
acceptance_boundary: slice
review: independent
---

# Первый 2D-робот на общем ядре ASA Lab

## Goal

Пользователь запускает существующую Arduino-программу в общем редакторе, наблюдает движение двухколёсной тележки по настоящим motor observations и обратную связь HC-SR04, сохраняя исходную схему и программу в явно локальном проекте.

Карточка определяет один M0-срез новой robotics программы, а не этап оптимизации E-OPT. Последовательность видимых результатов находится в [плане robotics](../../robotics/IMPLEMENTATION_PLAN.md). Выбор задачи, ветка, checkpoint, SHA, blockers и acceptance читаются только из [current.yaml](../../../execution/current.yaml). Принятие registration/docs не является выполнением этой продуктовой карточки.

## Component IDs и ownership

- Основная существующая граница: `electronics.ui.workbench` — общий hook, схема и управление исполнением.
- Вторая существующая граница: `electronics.worker.live-controller` — общий host и ограниченный учёт входных событий; существующее поведение без robotics options сохраняется.
- `electronics.engine.public-api` используется как неизменяемая зависимость общего документного/timed контракта, без изменения solver, моторных уравнений или Arduino runtime.
- `electronics.ui.arduino-editor` и `electronics.ui.catalog` — неизменяемые зависимости повторного использования, а не отдельные реализации в robotics.

Новый world и локальный host принадлежат robotics. Их описание не меняет ownership существующих Electronics symbols и не создаёт новую master-спецификацию электроники. Пока sources не перемещаются и новые shared test/source entry не возникают, существующих component routes достаточно. При реальном изменении source/test ownership обновляется точная subsystem entry тем же продуктовым срезом после уточнения preflight, без общего переписывания Component Map.

## Minimal read set

- [Electronics START HERE](../START_HERE.md), [AGENT_GUIDE §2, §§5–13](../AGENT_GUIDE.md), [Component Map](../COMPONENT_MAP.yaml).
- [UI/workbench entry](../components/ui-assets-persistence.yaml): только `electronics.ui.workbench`, с точечным обращением к Arduino editor/catalog для их публичного использования.
- [Engine public API entry](../components/engine-worker-clock.yaml): только `electronics.engine.public-api` и нужный timed boundary.
- [Canonical clock](../contracts/CANONICAL_CLOCK_CONTRACT.md), [host pacing/pause](../contracts/HOST_PACING_PAUSE_ADAPTER_V1.md), [engineering hygiene](../contracts/ENGINEERING_HYGIENE_CONTRACT.md) и применимая запись [baseline](../evidence/hygiene-baseline.yaml) для общего hook.
- [Review protocol](../../../agent/review-protocol.md), [UI layout acceptance](../../ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md), [план M0](../../robotics/IMPLEMENTATION_PLAN.md).

Точные исходные входы: `contexts/electronics/engine.ts`; `apps/web/src/electronics/use-electronics-workbench.ts`, `ArduinoCodePanel.tsx`, `WorkbenchStage.tsx`, `use-workbench-project-state.ts`, `component-catalog.ts`. Весь Electronics README и source tree не являются обязательным preload.

## Expected write paths и бюджет

Registration-поставка ограничивается `docs/execution/current.yaml`, этой карточкой и двумя robotics документами. Ни одно изменение production source не входит в registration.

Продуктовый preflight ограничивает реализацию десятью production files: `apps/web/robotics-dev.html`; `apps/web/src/robotics/main.tsx`, `RoboticsLab.tsx`, `use-local-robotics-project.ts`, `RobotField.tsx`, `robotics.css`, `world.ts`, `robotics-project.ts`; существующие `apps/web/src/electronics/use-electronics-workbench.ts` и `live-simulation-worker-controller.ts`.

Чистый `world.ts` на первом этапе остаётся внутри Web, без React/DOM и электрических уравнений. Это сохраняет действующие Nx module boundaries без нового пакета и исключений линтера. Будущий перенос в `modules/robotics` потребуется при появлении второго потребителя; отдельная папка UI и чистый domain уже отделяют механику от редактора.

Поддерживающие изменения: существующие `use-electronics-workbench-clock.spec.ts` и `live-simulation-worker-controller.spec.ts`; новые `robotics-local-host.spec.ts`, `robotics-lab.spec.ts`, `robotics-world.spec.ts`, `robotics-project.spec.ts` и `robotics.browser.mjs` в `apps/web/src/robotics/testing`; команды запуска/проверки в `package.json` и три документа этого среза. Ни новых зависимостей, ни изменения общего CI pipeline для M0 не требуется. Новые `.spec.ts` входят в существующий общий Vitest discovery.

Нормальный бюджет — один результат, две существующие основные component boundaries и не более десяти production files. Если чистое разделение world, host, entry и тестируемой связи требует большего, до записи фиксируется конкретная зависимость каждого дополнительного файла. Нет разрешения выносить всё UI ядро или создавать отдельный пакет-копию ради формального бюджета.

## Контракт M0

1. Пресет состоит из поддерживаемых Uno, двух gearmotor, двух низких FET-ключей с flyback-защитой и HC-SR04. Общая земля/питание/пины являются настоящими соединениями. Forward/coast и дифференциальный поворот — вся выбранная область привода.
2. `useElectronicsWorkbench`, `ArduinoCodePanel` и `WorkbenchStage` используются через ограниченный локальный host. Существующие production defaults сохраняются; новый backend, SSR, сервис пользователей или БД не добавляются.
3. World потребляет committed RPM и source time; математическая модель двигателя и Arduino исполняются только каноническим engine. Кинематика/простые геометрические контакты не выдают себя за динамическую нагрузку или достоверный stall current.
4. Узкий публичный `setRuntimeSensorDistance(componentId, distanceMeters)` проверяет component support, running state, конечность и диапазон. Он направляет значение в existing `setRuntimeComponentOverride`; timestamp/rebase выполняет существующая Worker-цепочка. Ни `commitDocument`, ни autosave измерений, ни прямой доступ к переменной скетча не допускаются.
5. Source-time порядок, 20 Hz/40 s demo и консервативный общий event budget определены [единственным протоколом M0](../../robotics/IMPLEMENTATION_PLAN.md#протокол-времени-и-входов-m0). При недостаточном контракте входа нельзя вводить новый timer, обрезать continuation или молча повышать 1024-event предел.
6. Robotics-only Arduino placeholders отключены и не добавляются в electrical document или общий каталог. Ошибка/unsupported останавливает достоверную симуляцию; UI не изобретает частичный успех.
7. Исходный robot project хранит поле, конфигурацию/привязки и общую электронику с программой. Локальный host сообщает свой режим и подтверждает повторное открытие. Вычисленные электрические результаты не сохраняются как исходная истина.
8. Layout функциональный и provisional с обязательным usability gate на 320/390/1024/1440; provisional не означает разрешения на перекрытый Run/Stop, потерянный focus или недоступную схему/программу.

## Acceptance и evidence

- Видимый целый сценарий: открыть пресет, проверить настоящую схему, запустить код/блоки, двигаться/повернуть, остановиться по штатному сигналу HC-SR04.
- Паритет canonical electronics результата при одинаковых document/program/input history; world не вычисляет PWM→RPM отдельной формулой.
- Негативные сценарии: неверная привязка, неподдерживаемый компонент/Arduino syntax, отключённое питание или изменённый провод не оставляют фиктивно работающий робот.
- Проверены forward/coast, несоответствие одного привода, pause/resume/reset, `yielded`/fault и остановка до overflow накопленной input history.
- Измерения датчика не меняют документ/dirty state и не вызывают autosave. Повторное открытие локального проекта сохраняет код, workspace, схему, поле и bindings.
- Existing electronics editor сохраняет исходное поведение при отсутствии robotics host. Нет изменений общей палитры, owner artwork, accounts или прав.
- В браузере доступны основные действия и long/error/disabled states на четырёх ширинах; evidence и provisional/full visual state названы точно по UI contract.
- Финальный отчёт различает функциональную готовность, provisional visual state, локальные команды, exact-SHA CI, deployment и owner acceptance.

Это критерии продукта. Существующие документы и регистрационный governance PASS не заменяют их выполнение.

## Tests / gates

Перед исполнением валидируется канонически выбранная карточка:

```bash
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ROBOTICS-M0-001
```

Registration проверяется scoped control-plane/document/routing validators и форматированием. Её declared gate — существующий `pnpm gate:governance`; результат относится к metadata/docs.

Для product boundary нужны исполнимые unit/contract тесты кинематики/схемы/inputs/local host, регрессии общего hook и настоящая browser демонстрация. Имена новых тестов и быстрый script фиксируются только вместе с реализацией. Существующие `pnpm gate:electronics-m1`, отдельный `pnpm gate:electronics-m1:browser` и требуемый `pnpm gate:repository` сохраняют свои значения; частичный локальный прогон не выдаётся за полный gate. Браузерный/production stack evidence выполняется в разрешённой изолированной среде, без самовольного deployment.

## Explicitly not doing

- Копия solver, Arduino interpreter, генератора блоков, схемного редактора или каталога.
- Изменение физических уравнений, clock semantics, лимитов scheduler или динамического load API ради demo.
- H-bridge/reverse, линия/цвет/энкодеры, полноценный манипулятор, свободная 3D-сборка или автоматическая физика STL.
- Перенос/перерисовка owner assets, общий UI cleanup или ремонт чужих незавершённых Electronics задач.
- Новая серверная persistence-схема, права, tenant/RLS, миграции, production-активация, Docker update или deployment.
- Доведение M1–M5 внутри этой карточки или объявление физической воспроизводимости без реального устройства.

## Review и Stop

Автор делает bounded self-review выбранного diff. Product seam/world bridge требуют независимой проверки сохранения canonical time/input/parity и shared editor поведения; метаданные review в frontmatter задают требование, а не подтверждают его выполнение. Registration review проверяет только выбор задачи, scope и документацию.

После проверяемого результата этого среза исполнитель передаёт diff/evidence и останавливается. Следующий срез выбирает контроллер через current.yaml с применимым preflight; карточка и план не разрешают его автоматически.
