---
task_id: TASK-ELECTRONICS-ULTRASONIC-U02-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U01-001
acceptance_boundary: slice
review: independent
---

# U02 — измерять только при действительном питании

## Один результат и вход

Оба датчика требуют принятого U00 электрического пути VCC/GND. Разные floating
islands не создают мнимое питание. Component IDs:
`electronics.peripheral.ultrasonic`, `electronics.engine.solver`.

Root/scoped AGENTS → [START_HERE](../START_HERE.md) → два mapped component entries
→ принятое U00/U01 → [ТЗ §2.1](../contracts/ULTRASONIC_EXECUTION_SPEC.md#21-питание-и-электрическое-наблюдение)
и [§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки): **UL-E02**.
До записи проверить hygiene counter, свежий общий solver и принятые изменения
L298N. Чужое пересечение не разрешается автоматическим merge.

## Точные разрешённые пути

Production, максимум **5**:

- `contexts/electronics/domain/solver.ts`.
- `contexts/electronics/domain/netlist.ts`.
- `contexts/electronics/domain/models/hc-sr04-runtime.ts`.
- `contexts/electronics/domain/models/ping-ultrasonic-runtime.ts`.
- `contexts/electronics/domain/model-identity.ts` — только принятая U00 совместимость этого semantic delta.

Test writes, максимум **2**:

- `contexts/electronics/testing/hc-sr04-runtime.spec.ts`.
- `contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts`.

`simulation-contract.spec.ts`, `switch-topology.spec.ts` и U01 fixtures —
read-only tests. Обход общего solver, новый fake ground, broad netlist refactor,
UI, timestamp reorder и исправление посторонних CI дефектов вне scope.

## Приёмка UL-E02

Матрица выполняется отдельно для HC-SR04 и PING с корректным Trigger и finite
timeout. «Нет Echo» означает отсутствие HIGH и результат 0 в момент timeout,
а не преждевременное завершение Arduino.

| Схема                                           | Ожидаемый результат                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Общие 5 В/GND, distance 1 м                     | ready, 5800 мкс                                                                 |
| Удалён только провод GND                        | Нет Echo, 0                                                                     |
| Удалён только VCC                               | Нет Echo, 0                                                                     |
| Обе power terminals отсутствуют                 | Нет Echo, 0                                                                     |
| 3,3 В либо обратная полярность                  | Нет Echo, 0; штатная диагностика согласно U00                                   |
| GND принадлежит несвязанному floating island    | Нет Echo, 0                                                                     |
| Валидный возврат через breadboard rails/провода | ready, 5800 мкс                                                                 |
| ECHO/SIG соединён с GND                         | Нет корректного измерительного импульса; диагностика согласно U00               |
| У HC перепутаны TRIG/ECHO                       | Нет успешного измерения; conflict/fault отражён, если он возникает электрически |

Проверить границы рабочего питания 4,5/5,5 В и соседние значения за пределами
по принятому U00 источнику и допуску. Не требовать прямого провода к Arduino GND:
валидная общая электрическая цепь через макетную плату должна работать.

При потере питания вне спорной одновременной границы pending Echo отменяется,
выход перестаёт управлять сетью. Возврат питания сам по себе не создаёт Echo;
новый допустимый Trigger снова даёт 5800 мкс. Точный same-timestamp case остаётся
отдельной приёмкой U03. Проверки U01 с 10 кОм остаются зелёными.

Обоснование обязано показать, почему новый критерий питания валиден для islands
и не подменён вычитанием двух произвольных нулевых опор. Не добавлять ток покоя
или короткое соединение исключительно ради совпадения topology.

## Совместимость в этом срезе

До публикации выполнить решение U00 о profile/continuation для конкретного
изменения. Старый runtime не должен молча продолжаться под новым смыслом;
известные сохранённые документы сохраняются, неизвестные profiles fail-closed.
Если версия сохраняется, независимый reviewer явно обосновывает bug-fix
compatibility. Отложить этот вопрос до U04 нельзя.

Для необходимого version/digest transition дополнительно разрешены только
`contexts/electronics/testing/model-set-golden-compatibility.spec.ts` и
`contexts/electronics/testing/fixtures/model-set-golden-compatibility.ts`.
Это узкое дополнение к двум repair suites обусловлено HIGH-risk compatibility,
а не разрешение расширить функциональность или обновить golden без oracle.

## Проверки и завершение

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U02-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts contexts/electronics/testing/simulation-contract.spec.ts contexts/electronics/testing/switch-topology.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/model-set-golden-compatibility.spec.ts contexts/electronics/testing/timed-state.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm benchmark:electronics:ci
git diff --check
```

Для child lane применяется его фактический preflight scope. Обе missing-GND
regression assertions — обычный PASS. Evidence содержит схему connections,
raw supply/reference observations, pulse/time results и meaningful negative
controls; self-review и новый independent review — на финальном SHA. Required
CI/отчёт — ТЗ §8. Accepted production slice увеличивает общий hygiene counter;
при наступившем checkpoint дальнейший product scope блокируется. Исполнитель
STOP, U03 не начинается автоматически.
