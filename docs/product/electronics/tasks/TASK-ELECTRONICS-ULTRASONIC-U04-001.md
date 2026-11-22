---
task_id: TASK-ELECTRONICS-ULTRASONIC-U04-001
kind: component/peripheral
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U03-001
  - docs/product/electronics/contracts/ENGINEERING_HYGIENE_CONTRACT.md
acceptance_boundary: slice
review: independent
---

# U04 — единый no-echo и совместимые версии моделей

## Один результат и вход

У обоих ultrasonic variants согласованы distance bounds, reflection input,
timeout и versioned model identity. Component ID:
`electronics.peripheral.ultrasonic`. Это одна периферийная способность, не новый
Arduino runtime и не аппаратная переаттестация PING.

Root/scoped AGENTS → [START_HERE](../START_HERE.md) → ultrasonic entry → принятые
U00–U03 → [ТЗ §2](../contracts/ULTRASONIC_EXECUTION_SPEC.md#2-нормативный-контракт-моделей),
[§2.2](../contracts/ULTRASONIC_EXECUTION_SPEC.md#22-отражение-диапазоны-и-совместимость),
[§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки).
Acceptance: **UL-M01/UL-M02/UL-M03**. Если после принятых production slices
наступил hygiene checkpoint, U04 заблокирован до отдельно принятого checkpoint.
Проверяется общий counter, включая чужие принятые slices; номер U04 не является
самостоятельным доказательством, что checkpoint уже выполнен.

## Точные разрешённые пути

Production, максимум **6**:

- `contexts/electronics/domain/models/hc-sr04-runtime.ts`.
- `contexts/electronics/domain/models/ping-ultrasonic-runtime.ts`.
- `contexts/electronics/domain/arduino-circuit-scheduler.ts`.
- `contexts/electronics/domain/model-identity.ts`.
- `contexts/electronics/domain/model-registry.ts`.
- `contexts/electronics/engine.ts`.

Test writes: `contexts/electronics/testing/hc-sr04-runtime.spec.ts`,
`ping-ultrasonic-runtime.spec.ts`, `ultrasonic-distance-timed-input.spec.ts`,
`model-set-golden-compatibility.spec.ts` и
`fixtures/model-set-golden-compatibility.ts` в той же testing directory.
Новый test file, document/API schema или timed-state production change — только
после уточнения выбранного scope, не скрытое расширение. UI и L298N вне scope.

## Приёмка

| Distance | Echo, обе модели |
| -------- | ---------------- |
| 2 см     | 116 мкс          |
| 50 см    | 2900 мкс         |
| 100 см   | 5800 мкс         |
| 200 см   | 11600 мкс        |
| 300 см   | 17400 мкс        |

HC дополнительно принимает 400 см → 23200 мкс; PING 400 см отвергает на каждом
публичном входе, в том числе direct model helper. Проверить 1,999 см, значения
выше собственного max, NaN/Infinity и неверные типы без частичной мутации.
Отсутствующее distance даёт 1 м; существующие точные valid values не округляются.
HC Trigger 9 мкс отвергает/10 принимает; PING 1 отвергает/2 принимает.
Holdoff остаётся 200/350 мкс; формула остаётся round(cm × 58). При raw pulse
5800 мкс существующий block helper сохраняет свой прежний результат около
99,934 см — этот срез не меняет его коэффициент.

`echoAvailable` — boolean default true для обеих моделей. False при принятом
Trigger не создаёт Echo; pulseIn продолжает ждать на deadline−1 и возвращает 0
на deadline. Восстановление reflection без нового Trigger не создаёт Echo.
Distance/reflection фиксируются на принятом Trigger fall: поздняя смена влияет
на следующее измерение. Power loss по-прежнему прерывает текущее Echo по U03.

До изменения identity зафиксировать конкретные installed profiles свежего main.
Известный старый сохранённый проект получает **точно перечисленный** upgrade и
сохраняет component IDs, terminals, wires, source, distance, view state. Неизвестный
profile ID/future version fail-closed, без нормализации в текущую модель.
Старый документ с ошибочным PING distance=4 м остаётся открываемым для
редактирования с понятной ошибкой; Run не становится зелёным, значение не
clamp/reset автоматически. Пользователь исправляет его явно.
Несовместимый runtime continuation отклоняется явно с возможностью нового Run
из сохранённого документа. Golden digest меняется только вместе с независимым
объяснением semantic delta и проверкой legacy fixtures, не ради зелёного snapshot.

## Проверки и завершение

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U04-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts contexts/electronics/testing/model-set-golden-compatibility.spec.ts contexts/electronics/testing/ultrasonic-block-runtime-adapter.spec.ts contexts/electronics/testing/timed-state.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm benchmark:electronics:ci
git diff --check
```

Child lane использует свой preflight scope. Meaningful tests проверяют точные
deadline/identity values и reject state, не только успешную загрузку. Required
CI, self-review и новый independent review финального SHA обязательны;
отчёт — ТЗ §8. Счётчик hygiene учитывает этот принятый production slice.
Исполнитель STOP, контроллер отдельно выбирает U05.
