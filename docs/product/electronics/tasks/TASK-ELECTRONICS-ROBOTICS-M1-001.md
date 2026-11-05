---
task_id: TASK-ELECTRONICS-ROBOTICS-M1-001
kind: implementation
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/execution/current.yaml
  - docs/product/robotics/M1_WORKSPACE_PLAN.md
  - docs/product/electronics/contracts/CANONICAL_CLOCK_CONTRACT.md
  - docs/product/electronics/contracts/HOST_PACING_PAUSE_ADAPTER_V1.md
acceptance_boundary: slice
review: independent
---

# M1 — рабочее пространство и редактируемый мир робота

## Goal

Пользователь явно переключает разделы «Поле», «Робот», «Электроника», «Программа», добавляет настоящие компоненты общей библиотеки, редактирует поле и запускает роботную программу из штатных блоков. Стена, подвижный мяч и разметка имеют разные проверяемые свойства; изменения сохраняются и восстанавливаются.

Срез развивает первый robotics host. Выбранная задача, ветка, исходный PR/SHA и условия интеграции читаются только из [current.yaml](../../../execution/current.yaml). Отдельный [план M1](../../robotics/M1_WORKSPACE_PLAN.md) определяет видимые результаты; он не объявляет их выполненными.

## Component IDs и ownership

- `electronics.ui.workbench`: повторное использование Stage/Sidebars и узкая opt-in активация общих shortcuts.
- `electronics.ui.arduino-editor`: существующий ArduinoCodePanel и генератор; узкий публичный flush незавершённого редактирования.
- `electronics.ui.catalog`: неизменяемый общий каталог, его свойства и честная поддержка моделей.
- `electronics.engine.public-api` и `electronics.worker.live-controller`: неизменяемые зависимости времени, расчёта и input budget.
- Robotics владеет миром, геометрией, контактами предметов, локальной навигацией и конфигурациями.

## Minimal read set

[Electronics START HERE](../START_HERE.md), применимые записи [UI](../components/ui-assets-persistence.yaml), [engine/worker](../components/engine-worker-clock.yaml), [canonical clock](../contracts/CANONICAL_CLOCK_CONTRACT.md), [host pacing](../contracts/HOST_PACING_PAUSE_ADAPTER_V1.md), [review](../../../agent/review-protocol.md), [UI acceptance](../../ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md), [план M1](../../robotics/M1_WORKSPACE_PLAN.md).

Точные исходные входы: RoboticsLab, RobotField, world, robotics-project, use-local-robotics-project; общие WorkbenchSidebars, ArduinoCodePanel, ScratchWorkspace, workbench-shortcuts и use-electronics-workbench. Полный Electronics master не является обязательным preload.

## Expected write paths и бюджет

Registration: только эта карточка, `docs/product/robotics/M1_WORKSPACE_PLAN.md` и `docs/execution/current.yaml`; production source не входит в registration.

Продуктовый план перед записью перечисляет точные пути. Ожидаемые границы:

- `apps/web/src/robotics/RoboticsLab.tsx`, `RobotField.tsx`, `robotics.css`: навигация, постоянные видимые наблюдения, доступные действия.
- Новые `RobotFieldEditor.tsx` и `RobotAssemblyPanel.tsx`: предметы/инспектор и механическая конфигурация.
- Новые `robotics-program-presets.ts`: workspace существующих блоков и штатная генерация исходника.
- `world.ts`, новые `world-document.ts` и `world-physics.ts`: публичный фасад времени, отдельные документ/валидация/миграция и геометрия/динамика круглых тел. Разделение не добавляет второй источник состояния и удерживает parser отдельно от расчёта контактов.
- `robotics-project.ts`, при необходимости `use-local-robotics-project.ts`: совместимость локального проекта, явная смена пресета, актуальное чтение после flush.
- Общие `apps/web/src/electronics/use-electronics-workbench.ts` и `ArduinoCodePanel.tsx`: только ограниченные keyboard/flush seams с прежними legacy defaults.
- Focused тесты robotics, browser runner и существующие тесты workbench/Arduino persistence; README и общий robotics implementation plan после реализации.

Нормальный бюджет — не более 13 production files и две существующие shared UI boundaries. Каждый дополнительный путь сначала получает основание в точном preflight. Новый solver, каталог, пакет, dependency или CI pipeline не требуются.

## Контракт

1. Один host, документ, Worker и экземпляр общего Stage сохраняются при переключении разделов. Stage остаётся реальным видимым участником layout: основной в «Электронике», компактный preview в остальных разделах. Синтетические native ACK запрещены.
2. Глобальные shortcuts электроники активны только в её разделе; legacy caller сохраняет default enabled. В остальных разделах Delete/Undo/Paste/стрелки не изменяют скрытую схему.
3. Программа использует общий ArduinoCodePanel и существующие блоки. Начальный workspace управляет настоящими GPIO моторов и HC-SR04. Смена примера — явная операция с защитой пользовательской программы.
4. Последнее изменение блока публикуется до Save/Run/Open/смены примера; проверяется интервал меньше внутреннего debounce 180 мс. После первого открытия программная панель не теряет workspace при навигации.
5. Поле хранит исходные объекты и стартовую позу; runtime хранит текущую позу и скорости. Drag создаёт один шаг Undo, а не запись на каждое движение. Ошибка числового ввода сохраняет последнюю валидную сцену.
6. Стены препятствуют движению и видны HC-SR04. Мячи — динамические круги с ограниченными конечными массой, трением и упругостью; они взаимодействуют с кинематическим корпусом, стенами и друг другом. Линии/зоны — разметка пола, не препятствия и не вымышленный датчик цвета.
7. Скорость корпуса происходит только из committed motor RPM. Механика предметов продвигается только по committed source time с ограниченными подшагами и воспроизводимым порядком. Пауза замораживает весь мир; Reset восстанавливает и робота, и предметы.
8. Профиль односторонний: моторы задают движение кинематического робота, а обратная нагрузка от предметов не поступает в электрический мотор. Нельзя заявлять stall current, силу реального привода или физическую воспроизводимость. Контакт корпуса с неподвижным/непроходимым телом явно приостанавливает опыт.
9. HC-SR04 получает ближайшее действительное попадание, включая текущие позиции мячей, через прежний validated timed input. Отсутствие попадания не заменяется вымышленной стеной; диапазон, накопленный budget и 40-секундный профиль сохраняются.
10. Назначение component ID мотором/датчиком выполняется явно в «Роботе». Удаление или несовместимая замена компонента даёт понятную причину отказа запуска. Поддержка placement не приравнивается к наличию математической модели.
11. Старые M0-сохранения открываются; недопустимые/перекрывающиеся/вышедшие за границы предметы отвергаются. История, saved source и текущая анимация не смешиваются.
12. Все четыре раздела и ключевые действия работают на 320/390/1024/1440; пустые/ошибочные/disabled состояния и focus проходят проверку.

## Acceptance и evidence

- Четыре раздела действительно меняют рабочий экран; программа и поле доступны одновременно с наблюдением запуска.
- Через общий каталог добавлен поддерживаемый компонент, изменено свойство/провод, выполнено удаление/Undo и сохранение.
- Реальный блоковый пример запускает моторы и реагирует на HC-SR04; изменение блока сразу перед Save/Run не теряется.
- На поле добавлены, перемещены, изменены и удалены стена/мяч/линия/зона; численные координаты совпадают с drag; Undo/Redo и reload восстанавливают сцену.
- Мяч получает толчок, продолжает движение, затухает и сталкивается со стеной/мячом; начальные состояния возвращаются при Reset. Нет проникновения сквозь стену при допустимом максимальном шаге.
- Ошибочные bindings, overlapping objects, NaN/Infinity, плохое сохранение и неподдерживаемая электрическая модель не дают ложного успешного запуска.
- Worker продолжает committed time при переключении разделов, а pause не продвигает предметы.
- Focused unit/contract checks, реальный browser evidence и независимый review относятся к финальному diff; inherited CI failures не объявляются исправленными.

## Tests / gates

Registration: scoped document/control-plane checks, форматирование и `pnpm gate:governance`.

Продукт: существующий `pnpm test:robotics` на ветке с M0, узкие новые world/program/shortcut/flush regressions, `pnpm test:robotics:browser`, typecheck/build и объявленные общие gates. Никакой локальный focused PASS не заменяет required GitHub CI или принятие владельцем.

## Explicitly not doing

Копирование электрического ядра/Arduino/Blockly, двунаправленный драйвер, моторная load/stall seam, новые модели цвета/линии/энкодера, произвольный CAD/STL, 3D, серверные проекты/права/БД, deployment, общий UI cleanup, изменение CI ради зелёного результата и ремонт посторонних baseline failures.

## Review и Stop

Автор реализует этот ограниченный срез, показывает результаты шагов, выполняет focused/self-review и передаёт финальный diff. Независимый review проверяет shared editor/persistence, физическую границу, clock/input и usability. При FAIL — отдельное ограниченное исправление. Карточка не выбирает следующий milestone и не даёт owner acceptance или разрешение на product merge.
