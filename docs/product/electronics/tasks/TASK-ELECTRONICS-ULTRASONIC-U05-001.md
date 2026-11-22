---
task_id: TASK-ELECTRONICS-ULTRASONIC-U05-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U04-001
acceptance_boundary: slice
review: independent
---

# U05 — безопасно менять разновидность датчика

## Один результат и вход

Выбранный HC-SR04/PING имеет правильную идентичность в каталоге, а смена
разновидности сохраняет допустимые данные и не повреждает соединения.
Component ID: `electronics.peripheral.ultrasonic`.

Прочитать root/web AGENTS, [START_HERE](../START_HERE.md), ultrasonic entry,
принятый U04, [ТЗ §4.3](../contracts/ULTRASONIC_EXECUTION_SPEC.md#43-каталог-помощь-и-смена-разновидности)
и [§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки).
Acceptance: **UL-V01**. Полная справка и runnable examples — отдельный U05A;
они не увеличивают этот срез. Перед записью проверить hygiene checkpoint и
актуальные model profiles.

## Точные разрешённые пути

Production, максимум **5** в `apps/web/src/electronics/`:

- `component-catalog.ts`.
- `production-manifest-adapter.ts`.
- `WorkbenchSidebars.tsx`.
- `workbench-document.ts`.
- `use-electronics-workbench.ts`.

Test writes в `apps/web/src/electronics/testing/`:
`production-editor-integration.spec.ts`, `workbench-document.spec.ts`;
browser assertions — `e2e/electronics-interactions.spec.ts`.
Не менять полную help schema/content, preset/open-project flow, owner SVG,
manifest assets, solver, runtime, numeric controls или сцену.

## Приёмка UL-V01

1. HC имеет VCC/TRIG/ECHO/GND, PING — GND/VCC/SIG. Actual terminal identities и
   порядок выводов соответствуют существующей геометрии ASA. Оба default
   distance=1 м; HC не наследует PING label/description и ложный
   `not_yet_supported`. Не менять уже заданное valid distance при выборе.
2. Успешная PING ↔ HC сохраняет только совместимые параметры, ID,
   пользовательское имя, position/rotation/flip и Arduino source. Соединения
   питания сохраняются по именам VCC/GND. Одна успешная смена — один Undo commit;
   Undo/Redo возвращают точный документ. Arduino source автоматически не
   переписывается.
3. В Run/Pause структурная смена запрещена до Stop; пользователь получает
   понятное объяснение, не скрытый restart. Runtime/Serial/clock не сбрасываются
   при отклонённой операции.
4. При любом подключённом SIG/TRIG/ECHO смена блокируется с инструкцией сначала
   отсоединить сигнальные провода. Документ, wires и history неизменны. Нельзя
   превратить SIG в ближайший ECHO или удалить wire ради успешной замены.
5. Mounted breadboard variant не меняется до явного снятия с платы; после смены
   новое размещение проходит штатную pin geometry. Запрет не повреждает bindings.
6. HC distance >3 м блокирует смену на PING до явного допустимого ввода. Скрытый
   clamp/reset запрещён. 300 см допустимы для обоих, 400 см — только для HC;
   попытка переключения HC 400 см оставляет исходный документ byte-equivalent
   по сохранённым полям и не добавляет Undo/autosave.
7. No-op/invalid variant не меняет документ; повторная смена, Undo/Redo и
   save/reopen сохраняют ID, pins, wires, source и точные initial properties.

Проверки должны покрывать обе стороны смены, питание без сигнальных проводов,
подключённый каждый сигнальный pin, mounted breadboard, границу расстояния,
Run/Pause и отмену через Undo. Не ограничиваться пустой схемой без соединений.

## Проверки и завершение

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U05-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run apps/web/src/electronics/testing/production-editor-integration.spec.ts apps/web/src/electronics/testing/workbench-document.spec.ts apps/web/src/electronics/testing/production-state-contracts.spec.ts --maxWorkers=1
pnpm validate:electronics-component-information
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm exec playwright test e2e/electronics-interactions.spec.ts
git diff --check
```

Для child lane используется его фактический preflight scope. Browser evidence —
реальное собранное приложение, запрещённая и успешная смена, Undo/Redo и
сохранность wires; один reducer mock не закрывает пользовательскую приёмку.
Self-review, required CI, новый independent review финального SHA и отчёт —
ТЗ §8. Accepted production slice учитывается в общем hygiene counter, включая
добавленный последовательный U05A. Исполнитель STOP; U05A выбирает контроллер.
