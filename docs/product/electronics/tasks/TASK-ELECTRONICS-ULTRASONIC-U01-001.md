---
task_id: TASK-ELECTRONICS-ULTRASONIC-U01-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U00-001
acceptance_boundary: slice
review: independent
---

# U01 — согласовать Echo/SIG с электрическими токами

## Один результат и вход

Оба выхода участвуют в решении и в terminal-current observation одной и той же
электрической модели. Нагрузка 10 кОм больше не вызывает ложный
`electrical_quality_failed`. Component IDs: `electronics.peripheral.ultrasonic`,
`electronics.engine.solver`.

Применяются root/scoped AGENTS, [START_HERE](../START_HERE.md), соответствующие
записи component map и принятое U00. Нормативная граница:
[ТЗ §2.1](../contracts/ULTRASONIC_EXECUTION_SPEC.md#21-питание-и-электрическое-наблюдение),
[§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки) — **UL-E01**.
До записи проверить текущий hygiene counter и принятые пересекающиеся изменения
L298N/solver. При наступившем checkpoint — `BLOCKED_BY HYGIENE_CHECKPOINT`.

## Точные разрешённые пути

Production, максимум **4**:

- `contexts/electronics/domain/solver.ts`.
- `contexts/electronics/domain/models/hc-sr04-runtime.ts`.
- `contexts/electronics/domain/models/ping-ultrasonic-runtime.ts`.
- `contexts/electronics/domain/model-identity.ts` — только принятая U00 совместимость этого semantic delta.

Focused test writes, максимум **2**:

- `contexts/electronics/testing/hc-sr04-runtime.spec.ts`.
- `contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts`.

Read-only dependency: `contexts/electronics/testing/power-balance-shunts.spec.ts`
и существующий solver suite. Расширение paths требует уточнения выбранного
scope до записи. Не менять thresholds, timestamp scheduler, ground topology,
диапазоны, UI, L298N или owner assets. Profile transition допустим только
в пределах принятого U00 compatibility решения этого среза.

## Реализация и приёмка

Реализовать принятую U00 модель выходной ветви и её наблюдение. Stamped current,
terminal currents, знак тока и source/return balance должны описывать одну
ветвь. Нельзя скрывать residual нулевым током, отдельным fake observation,
игнорированием датчика в quality checker или special-case PASS.

Для **каждой** модели обязательны:

1. При 5 В, distance=1 м, допустимом Trigger: без нагрузки и с 10 кОм между
   ECHO/SIG и GND итог `ready`, `pulseIn(..., HIGH, timeout)=5800` мкс.
2. Во время HIGH для принятого 5 В/10 Ом профиля U00: выход около
   4,995005 В, нагрузка около 0,0004995005 А; знак и сумма токов соответствуют
   независимому расчёту. Численная погрешность ограничена существующей точностью
   solver. При иной принятой модели используются её заранее утверждённые oracle.
3. Raw solve и публичный SimulationResult удовлетворяют прежним KCL/source
   quality thresholds. Проверяется численный residual, а не только отсутствие
   fault. Историческая причина — неучтённые примерно 0,0004995 А — должна быть
   исключена именно observation исправлением.
4. HC вне Echo остаётся powered LOW, PING освобождает SIG в high-Z;
   Arduino может сформировать следующий Trigger. Питание, уже принятый timing
   и длительность no-load не меняются.
5. Short сигнала и противодействующий GPIO сохраняют штатную диагностику
   согласно U00; overload не маскируется ослаблением общего quality policy.

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

## Проверки и доказательства

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U01-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts contexts/electronics/testing/power-balance-shunts.spec.ts contexts/electronics/testing/solver.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/model-set-golden-compatibility.spec.ts contexts/electronics/testing/timed-state.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm benchmark:electronics:ci
git diff --check
```

Для child lane заменить только scope на фактически выбранный current lane.
Новые проверки добавляются в существующие два suites; обе load regression
assertions должны быть обычными PASS без skip/todo/expected-failure. Если main
уже содержит L298N solver regression, контроллер добавляет точный существующий
тест к совместной проверке; отсутствующий тест не объявляется выполненным.
Приложить raw voltage/current/residual, итоговые pulse widths, baseline/diff,
команды/exit/counts, self-review и новый independent review финального SHA.
Применяются required CI и формат отчёта ТЗ §8. Принятие увеличивает реальный
hygiene counter на один production slice. Исполнитель STOP; U02 выбирает контроллер.
