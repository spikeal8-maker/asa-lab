---
task_id: TASK-ELECTRONICS-ULTRASONIC-U05A-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U05-001
acceptance_boundary: slice
review: independent
---

# U05A — полная справка и рабочий пример каждой модели

## Один результат и вход

По кнопке `?` каждого HC-SR04/PING открывается полная собственная справка с
проверенной схемой, полным Arduino source и безопасно открываемым runnable
примером. Component ID: `electronics.peripheral.ultrasonic`. Смена разновидности
уже принята U05; эту структурную логику здесь не расширять.

Root/web AGENTS → [START_HERE](../START_HERE.md) → ultrasonic entry → принятые
U00 fixtures/U04 model contract/U05 variant →
[ТЗ §4.4](../contracts/ULTRASONIC_EXECUTION_SPEC.md#44-полная-справка-по-вопросительному-знаку)
и [§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки).
Acceptance: **UL-H01/UL-H02**. До записи проверить общий hygiene counter:
дополнительный U05A является отдельным production slice и не обнуляет счётчик.
Если checkpoint уже наступил, он принимается отдельно до этой задачи.

## Точные разрешённые пути

Production, максимум **8**:

- `apps/web/src/electronics/component-help-content.ts`.
- `apps/web/src/electronics/component-information.ts`.
- `apps/web/src/electronics/WorkbenchSidebars.tsx`.
- `apps/web/src/electronics/use-electronics-workbench.ts`.
- `apps/web/src/electronics/use-workbench-project-state.ts`.
- `apps/web/src/electronics/workbench.css`.
- `apps/web/src/pages/SchematicEditor.tsx`.
- `apps/web/src/electronics/ultrasonic-help-examples.ts` — новый заранее объявленный модуль двух typed fixtures на существующей SchematicDocument schema.

Test writes в `apps/web/src/electronics/testing/`:
`component-help-content.spec.ts`, `component-information.spec.ts`,
`production-editor-integration.spec.ts`, `workbench-project-state.spec.ts`;
domain execution — `contexts/electronics/testing/ultrasonic-block-runtime-adapter.spec.ts`;
browser — `e2e/electronics-interactions.spec.ts`.

Read-only dependencies: `apps/web/src/api.ts` — существующие
createProject/openProject/saveDraft; `apps/web/src/App.tsx` — действующий маршрут
редактора. Отдельного Electronics preset API на исходной базе не предполагается.
Восемь файлов ограничивают данные, presentation и безопасное открытие двух
примеров. Не строить новый template framework, не менять API/ACL, общий autosave,
owner assets/manifests, runtime, solver, distance controls или сцену.
Если имеющийся entry требует дополнительных paths, сначала уточнить bounded
scope; отсутствие маршрута не разрешает переписать текущий проект.

## UL-H01 — собственная полная справка

Каждый variant содержит пять раскрываемых содержательных разделов:

| Раздел         | Проверяемое содержание                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Описание       | Правильное название, собственное существующее изображение, назначение, 3/4 вывода, диапазон и 5 В                 |
| Принцип работы | Излучение/отражение/приём, путь туда-обратно, связь длительности Echo и distance; различие общего SIG и TRIG/ECHO |
| Подключение    | Читаемая Arduino Uno схема и таблица каждого реального пина с режимами, общий GND и конкретные GPIO               |
| Использование  | Run, выбор датчика, изменение расстояния, чтение результата, no-reflection/timeout, Pause/Stop и initial values   |
| Подробнее      | Проверенные источники именно этой модели, формула, timeout, ограничения ASA и типовые ошибки подключения          |

HC: VCC/TRIG/ECHO/GND, Trigger ≥10 мкс, 2–400 см. PING: GND/VCC/SIG,
Trigger ≥2 мкс, OUTPUT → INPUT на общем SIG, 2–300 см. Если показывается
PING latency 350 мкс, она названа параметром принятой модели ASA. Не выдавать
описание модели за аппаратную аттестацию и не обещать arbitrary C++/libraries.

Открытая справка меняется вместе с выбранным экземпляром; stale content другой
разновидности не появляется. Keyboard открывает `?`, Escape закрывает с возвратом
focus. Справка читаема при 390/1440 px, доступна до и во время Run без reset
Serial/Arduino/clock; изображения имеют текстовое объяснение выводов.
Существующие content approval/digest правила сохраняются; draft content не
переименовывается в owner-approved ради validation.

## UL-H02 — два готовых примера

У обеих моделей есть «Начало работы»: полная схема, полный копируемый source,
ожидаемое показание и действие «Открыть пример». Буквальный drag стартовой схемы
Tinkercad не требуется. Принятые схемы, скетчи и оракулы из evidence U00
переносятся в объявленный `ultrasonic-help-examples.ts` как единые typed fixtures
на действующей SchematicDocument schema. Эти общие данные формируют схему,
текст справки и runnable document; ручные три расходящиеся версии не допускаются.
Перенос проверяет сохранение принятого поведения, а не меняет электрическое
решение U00 или source/runtime контракт.

| Модель  | Соединения примера                 |
| ------- | ---------------------------------- |
| HC-SR04 | VCC→5V, GND→GND, TRIG→D13, ECHO→D2 |
| PING    | VCC→5V, GND→GND, SIG→D13           |

Каждый source содержит pin constants, полные setup/loop, pinMode, корректный
Trigger, pulseIn с finite timeout, Serial.begin/print, duration=0 handling,
формулу сантиметров и явно заданный период опроса. При 1 м измерение даёт
5800 мкс/100 см; false reflection даёт timeout/0 с понятным выводом. PING
переключает D13 OUTPUT → INPUT; HC читает D2. Copy копирует **весь** source.
Проверить вставку и Run без ручного исправления. Предлагаемые блоки используют
реальный existing codegen/adapter и поддерживаемую эквивалентную программу.

Пример открывается отдельным проектом либо после безопасного сохранения
текущего по действующим schema/create/open механизмам. Текущая схема, source,
unsaved draft и classroom/identity context не теряются. Использовать действующие
permissions и idempotent create: double click/retry не создаёт дубли, ошибка
сети или запрет создания оставляет текущий проект целым и объясняется пользователю.
Не расширять права и не публиковать пример в чужой класс/галерею автоматически.

Справка уже описывает полный целевой пользовательский сценарий ТЗ, включая
будущие controls U06 и цель U07. Приёмка U05A проверяет правильность этих текстов,
саму справку и выполнение готовых примеров на принятых U01–U05. Она не требует
досрочной реализации numeric controls или сцены и не засчитывает их работоспособность:
соответствующие функциональные assertions выполняются в U06/U07 и повторяются
в U08. Критерии справки и безопасного открытия примеров остаются обязательными
уже в U05A.

## Проверки и завершение

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U05A-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run apps/web/src/electronics/testing/component-help-content.spec.ts apps/web/src/electronics/testing/component-information.spec.ts apps/web/src/electronics/testing/production-editor-integration.spec.ts apps/web/src/electronics/testing/workbench-project-state.spec.ts contexts/electronics/testing/ultrasonic-block-runtime-adapter.spec.ts --maxWorkers=1
pnpm validate:electronics-component-information
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm exec playwright test e2e/electronics-interactions.spec.ts
git diff --check
```

Child lane использует свой фактический preflight scope. Browser evidence —
собранное приложение: отдельно оба `?`, пять непустых разделов, code-copy,
готовые примеры, реальный Worker Run и сохранность исходного проекта при
успехе/отказе. Runtime execution проверяет source, извлечённый из тех же fixtures;
string snapshots не доказывают исполняемость. Required CI, self-review и новый
independent review финального SHA обязательны, отчёт — ТЗ §8. После принятия
увеличивается общий hygiene counter. Исполнитель STOP; U06 выбирает контроллер.
