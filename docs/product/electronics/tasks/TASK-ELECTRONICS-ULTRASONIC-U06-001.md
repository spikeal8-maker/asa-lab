---
task_id: TASK-ELECTRONICS-ULTRASONIC-U06-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U05A-001
acceptance_boundary: slice
review: independent
---

# U06 — связать числовой ввод и ползунок с режимом проекта

## Один результат и вход

Число и ползунок управляют одним distance с правильными draft/commit и
Run/Pause/Stop semantics. Component ID: `electronics.peripheral.ultrasonic`.
Root/web AGENTS → [START_HERE](../START_HERE.md) → ultrasonic entry → принятый U05A
→ [ТЗ §4.1](../contracts/ULTRASONIC_EXECUTION_SPEC.md#41-число-ползунок-и-состояния-проекта)
и [§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки).
Acceptance: **UL-U01/UL-U02**. Перед записью проверить общий hygiene counter;
эта карточка не разрешает пропуск требуемого checkpoint.

## Точные разрешённые пути

Production, максимум **5** в `apps/web/src/electronics/`:

- `UltrasonicDistanceControls.tsx`.
- `WorkbenchSidebars.tsx`.
- `use-electronics-workbench.ts`.
- `live-simulation-worker-controller.ts`.
- `workbench.css`.

Test writes в `apps/web/src/electronics/testing/`:
`ultrasonic-distance-controls.spec.ts`, `use-electronics-workbench-clock.spec.ts`,
`live-simulation-worker-controller.spec.ts`, `workbench-runtime-controls.spec.ts`;
browser — `e2e/electronics-interactions.spec.ts`.
`workbench-autosave.spec.ts` читается/выполняется без правки. Сценический target,
solver, clock semantics, source generation и общий autosave refactor вне scope.

## Приёмка ввода

HC 2–400 см, PING 2–300 см, новый ввод с шагом 0,1 см; единый model value в
метрах. Поле и ползунок меняют только distance и сохраняют `echoAvailable`;
они не включают отражение после ручного false или выхода цели за сектор.
Если цель была за границами, её UI-позиция возвращается на допустимую ось,
но reflection остаётся false. Новый ввод сначала проверяется на исходный диапазон, затем
квантуется `cm = Math.round(cm * 10) / 10`, `distanceMeters = cm / 100`;
поле/ползунок/будущая сцена используют один путь. Открытие старого valid exact value не округляет и не помечает проект
dirty. Поле, ползунок и reflection control показывают одно принятое состояние.

Проверить последовательности `1 → 10 → 100`, `2 → 25 → 250`, `12,5` и `12.5`.
Промежуточный draft, включая пустую строку и `0`, не вызывает model commit,
clamp, остановку runtime или перескакивание курсора. Draft/error принадлежат
выбранному component ID: при смене выбора чужой недописанный текст/ошибка не
попадают в другой датчик и не применяются от запоздалого blur. Enter/blur фиксирует один
finite valid value; повтор Enter→blur не дублирует commit. Escape возвращает принятое значение. Invalid, NaN и выход
за диапазон показывают ошибку и сохраняют прежний accepted value. Границы
доступны мышью, touch и клавиатурой.

## Атомарное окружение

Один UI-жест, меняющий distance и reflection, передаёт один согласованный
snapshot на одном timestamp до наблюдения Arduino. Использовать существующий
batch-путь HC и квалифицировать его для PING; отдельные setter calls на C+1/C+2
не принимаются. В Stop это один commit/Undo. Проверка Trigger на той же границе
должна видеть целую новую пару, без промежуточного старого distance/false.
Новый scheduler не создаётся.

## Приёмка жизненного цикла

| Режим/действие                          | Ожидаемое поведение                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Stop, завершённый drag или field commit | Одно изменение исходного документа, один Undo, штатный autosave                      |
| Run, distance/reflection change         | Canonical timed input, документ/history/автосохранение не меняются                   |
| Pause, change                           | Временное accepted value без продвижения physical time; применение на границе Resume |
| Stop после runtime changes              | Возврат к сохранённому initial distance/reflection без записи временных значений     |
| Restart/reopen                          | Исходные параметры, pins и source сохранены                                          |

При Pause с committed horizon C последнее временное значение передаётся
на первой допустимой отметке строго позже C (на текущей базе C+1 мкс) при
Resume, не вставляется в уже committed C. Новый Run не наследует очередь
старой сессии. В Run не сбрасываются setup, Serial buffer, physical clock, Arduino variables и
состояние второго датчика. При двух датчиках менять только выбранный target.
Быстрый drag не создаёт неограниченную очередь: можно объединять ещё не
отправленные previews, но нельзя переписывать уже committed input trace.
Количество accepted input/Undo/autosave проверяется assertions, а не наблюдением
отсутствия console errors. No-echo control использует U04 boolean, не 0 distance.

## Проверки и завершение

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U06-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run apps/web/src/electronics/testing/ultrasonic-distance-controls.spec.ts apps/web/src/electronics/testing/use-electronics-workbench-clock.spec.ts apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts apps/web/src/electronics/testing/workbench-runtime-controls.spec.ts apps/web/src/electronics/testing/workbench-autosave.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm exec playwright test e2e/electronics-interactions.spec.ts
git diff --check
```

Для child lane — его выбранный preflight scope. Browser assertions используют
реальный Worker и собранное приложение; helper mock не заменяет Run acceptance.
Если изменён Worker dispatch/queue, применимы существующие performance budgets
и `NX_SKIP_NX_CACHE=true pnpm benchmark:electronics:ci` с сопоставимым baseline.
Новый independent review проверяет runtime/document boundary на финальном SHA;
required CI, self-review и отчёт — ТЗ §8. Принятие учитывается в hygiene counter;
checkpoint перед U07 определяется фактическими принятыми slices. Исполнитель STOP.
