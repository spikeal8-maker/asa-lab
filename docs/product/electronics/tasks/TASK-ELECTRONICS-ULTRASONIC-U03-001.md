---
task_id: TASK-ELECTRONICS-ULTRASONIC-U03-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U02-001
acceptance_boundary: slice
review: independent
---

# U03 — согласовать питание и Echo в один timestamp

## Один результат и вход

Внешнее событие питания и переход Echo с одинаковым canonical timestamp
обрабатываются по принятому U00 порядку; оба датчика дают фактическую
длительность импульса. Component IDs: `electronics.peripheral.ultrasonic`,
`electronics.arduino.scheduler`.

Контекст: root/scoped AGENTS, [START_HERE](../START_HERE.md), два mapped entries,
принятые U00–U02, [ТЗ §3](../contracts/ULTRASONIC_EXECUTION_SPEC.md#3-физическое-время),
[§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки),
`contracts/CANONICAL_CLOCK_CONTRACT.md` — event ordering/input trace.
Приёмка: **UL-E03** и domain/scheduler часть **UL-T01**.
До записи проверить фактический hygiene counter и shared scheduler изменения
L298N/Robotics. Этот срез не реализует соседнюю программу.

## Точные разрешённые пути

Production, максимум **4**:

- `contexts/electronics/domain/arduino-circuit-scheduler.ts`.
- `contexts/electronics/domain/models/hc-sr04-runtime.ts`.
- `contexts/electronics/domain/models/ping-ultrasonic-runtime.ts`.
- `contexts/electronics/domain/model-identity.ts` — только принятая U00 совместимость этого semantic delta.

Test writes, максимум **2**:

- `contexts/electronics/testing/arduino-circuit-scheduler.spec.ts`.
- `contexts/electronics/testing/hc-sr04-query-barrier.spec.ts`.

Engine/Worker suites ниже читаются и выполняются без расширения write scope.
Новый scheduler, UI таймер, silent sync fallback, изменение pulseIn API,
query-barrier контракта, топологии вне scope. Model identity меняется только при требуемом U00
compatibility переходе данного semantic delta.

## Точная приёмка

Для каждого датчика определить `Tstart = acceptedTriggerFall + latency`;
latency HC=200, PING=350 мкс. Использовать отдельные positive fixtures,
гарантирующие вход Arduino в ожидание импульса до Tstart. Для after-HIGH
cases подключить **реальный pull-down 10 кОм** между ECHO/SIG и общим GND;
доказать наблюдённый HIGH и последующий электрически определённый LOW.
High-Z сам по себе не трактуется как LOW; без pull-down применяется штатная
floating-input диагностика, а не принудительная длительность 1/100 мкс.

| Потеря питания                          | Echo и pulseIn                        |
| --------------------------------------- | ------------------------------------- |
| Tstart−1                                | HIGH не возникает, 0 по timeout       |
| Tstart                                  | HIGH не наблюдается MCU, 0 по timeout |
| Tstart+1, после уже наблюдённого HIGH   | Фактический спад, 1 мкс               |
| Tstart+100, после уже наблюдённого HIGH | Фактический спад, 100 мкс             |
| Питание сохранено, 1 м                  | 5800 мкс                              |

После restore без нового Trigger импульс не возникает. После нового Trigger —
обычное измерение. Два датчика с совпавшими событиями не подавляют observation
друг друга; отключение одного не сокращает Echo второго. Проверить очередной
Trigger, power loss в ожидании/во время Echo и setup/loop source fixtures.

Одинаковый физический сценарий даёт одинаковые GPIO traces, pulse durations,
committed time и state digest при разбиении advance вокруг Tstart, event budgets
**1/7/1024** и JSON serialize/restore до/на/после границы. Перестановка независимых
событий разных targets сохраняет результат. Конфликтующие события одного target
подчиняются существующему sequence/rejection контракту, а не произвольной сортировке.
Сохранить query barrier: MCU не читает будущее/неподтверждённое окружение.

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
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U03-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/arduino-circuit-scheduler.spec.ts contexts/electronics/testing/hc-sr04-query-barrier.spec.ts contexts/electronics/testing/engine-timed-api.spec.ts contexts/electronics/testing/engine-runtime-conformance.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/model-set-golden-compatibility.spec.ts contexts/electronics/testing/timed-state.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm benchmark:electronics:ci
git diff --check
```

Child lane использует свой preflight scope. Две exact-edge regression assertions
должны стать обычными PASS; U01/U02 controls остаются PASS. Independent reviewer
проверяет causal phase order, actual falling edge и отсутствие скрытого пропуска
sensor observation, а не только совпавшую конечную длительность. Full Worker
transport parity закрывается U08, не объявляется доказанной одним domain suite.
На финальном SHA — self-review, independent review, required CI и отчёт ТЗ §8.
После принятия обновляется реальный hygiene counter: при трёх production slices
контроллер сначала выбирает checkpoint, затем U04. Исполнитель STOP.
