---
task_id: TASK-ELECTRONICS-ULTRASONIC-U01-001
kind: repair
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U00-001
  - Accepted mandatory full hygiene checkpoint before product authoring
acceptance_boundary: slice
review: independent
---

# U01 — согласовать Echo/SIG с электрическими токами

## Один результат и вход

Родительская программа [#1238](https://github.com/spikeal8-maker/asa-lab/issues/1238),
существующая задача [#1241](https://github.com/spikeal8-maker/asa-lab/issues/1241).
Оба выхода используют одну электрическую ветвь для solver и terminal-current
observation. Нагрузка 10 кОм больше не вызывает ложный `electrical_quality_failed`.
Component IDs: `electronics.peripheral.ultrasonic`, `electronics.engine.solver`.

Прочитать root/scoped AGENTS, [START_HERE](../START_HERE.md), записи component map,
[ТЗ §2.3, §5, §7, §8](../contracts/ULTRASONIC_EXECUTION_SPEC.md) и принятое
[решение U00 §§2.2–2.6, §5](../evidence/ultrasonic-u00-electrical-decision.md).
Карточка и Issue не активируют себя: дочерняя lane выбирается контроллером и
принимается в `current.yaml` на main. До продуктовой записи обязательны принятое
U00, принятый полный hygiene checkpoint, свежий Git/CI/peer snapshot и scoped
preflight. Просроченный checkpoint означает `BLOCKED_BY HYGIENE_CHECKPOINT`.
Контроллерская подготовка отделена от единственного продуктового автора и его
независимого рецензента. `owner_acceptance: pending` не меняется от тестов.

## Точные разрешённые пути

Production, максимум **4**:

- `contexts/electronics/domain/solver.ts`.
- `contexts/electronics/domain/models/hc-sr04-runtime.ts`.
- `contexts/electronics/domain/models/ping-ultrasonic-runtime.ts`.
- `contexts/electronics/domain/model-identity.ts` — только совместимость этого semantic delta.

Focused test writes, **2**:

- `contexts/electronics/testing/hc-sr04-runtime.spec.ts`.
- `contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts`.

Дополнительно для обязательной совместимости, **2**:

- `contexts/electronics/testing/model-set-golden-compatibility.spec.ts`.
- `contexts/electronics/testing/fixtures/model-set-golden-compatibility.ts`.

Generated-only, **1**: `docs/product/electronics/generated/component-coverage.json`.
Он содержит hash `model-identity.ts`, поэтому после изменения identity пересоздаётся
неизменённым `tools/generate-electronics-component-coverage.mjs`. Ручная правка
JSON, изменение генератора или пятый продуктовый файл не разрешены.

Итого точный план — **9 путей**. Compatibility suites — обоснованное дополнение
к двум focused suites для HIGH-risk изменения identity. Любой иной путь сначала
требует ограниченного контроллерского уточнения scope. Read-only dependencies:
существующие solver/power-balance, GPIO и принятые пересекающиеся L298N tests.
Не менять общие quality thresholds, порядок scheduler, ground topology,
диапазоны, UI, L298N, owner assets или block codegen.

## Одна электрическая ветвь

`Rout = 10 Ω`, положительный terminal current входит в компонент, `Iq = 0` —
явная функциональная идеализация. HIGH: signal↔фактический VCC через 10 Ом;
LOW: signal↔GND через 10 Ом; high-Z: активной ветви нет.
Stamp и полный signed terminal ledger берутся из одной ветви. Ток питания
HIGH равен току нагрузки, обратный ток сохраняется, сумма токов равна нулю.
Legacy scalar `current = abs(I)`, потери `power = I²R`; неактивные пины имеют
нулевой terminal current. HIGH следует VCC при 4,5/5/5,5 В на клеммах.
Нельзя скрывать residual fake observation, нулевым током, исключением из quality
checker, дополнительным источником 5 В или special-case PASS.

## PING: пять фаз

| Фаза | SIG |
| --- | --- |
| Ожидание нового внешнего Trigger | high-Z |
| От принятого спада Trigger до Echo, 350 мкс | LOW через 10 Ом к GND |
| Echo, 5800 мкс при 1 м | HIGH через 10 Ом к VCC |
| После Echo ровно 1 мкс | LOW через 10 Ом к GND |
| После этой 1 мкс | high-Z |

HC-SR04 вне Echo остаётся powered LOW. LOW-фазы, sensor state, deadlines и
`nextDue` принадлежат U01 и сохраняются при поддерживаемом yield/JSON resume.
Смена HIGH/LOW/high-Z должна запрашивать новое электрическое наблюдение через
существующий runtime interface, включая LOW↔high-Z. Busy edges и собственные
переключения не становятся новым измерением: после release нужен заново
наблюдённый внешний LOW→HIGH→LOW. Удержанный через busy HIGH не запускает Echo.
Потеря признанного достоверным питания немедленно освобождает выход и отменяет
старые deadlines. Доказательство земли остаётся U02, общий timestamp ordering — U03.

Архитектура соответствует no-echo решению U00: для latched `echoAvailable=false`
предусмотрены LOW до `Tfall+350 мкс`, затем high-Z без HIGH и завершающей LOW-фазы;
Arduino возвращает 0 только на настоящем timeout. Полная no-echo приёмка — U04.

## Нагрузка, short и GPIO

Для **каждой** модели: distance=1 м, допустимый Trigger, без нагрузки и с 10 кОм
signal→GND публичный результат `ready`, реальный `pulseIn(..., HIGH, timeout)=5800` мкс.
Обе исторические load-regressions становятся обычными PASS без skip/todo/expected-failure.
Raw solve и публичный SimulationResult согласуются по напряжениям, токам и residual.

| Схема | Напряжение нагрузки, В | Ток нагрузки, А |
| --- | ---: | ---: |
| Ровно 5 В на клеммах, Rout=10 Ом, RL=10 кОм | 4,995004995004995 | 0,0004995004995004995 |
| Полная Uno-схема, Rsource=0,1 Ом | 4,99495509535369 | 0,000499495509535369 |

Это независимые аналитические ожидания разных схем, не новые допуски.
Для direct short signal/GND во время HIGH и противоположных активных push-pull
GPIO сохранить конечные напряжения/токи и добавить локальную error-диагностику
`short_circuit` / `conflicting_sources` по topology с компонентом/драйвером/сетью.
Существующий source-protection threshold сохраняется; 0,5/0,25 А идеальных
fixtures не требуют его снижения. Совпадающий OUTPUT LOW в PING delay не конфликт.
Исправный KCL не делает конфликт правильным ультразвуковым измерением.

## Обязательный переход совместимости

Перед записью проверить, что версии на свежем main не заняты другим поведением.
При коллизии требуется ограниченное согласование, а не произвольный следующий номер.

| Поле | Переход U01 |
| --- | --- |
| HC-SR04 modelProfileVersion | 2→3 |
| PING modelProfileVersion | 1→2 |
| Внутренний runtime state обеих моделей | 1→2 |
| electricalModelVersion | остаётся 1 |
| Component/pin/model/profile IDs | сохраняются |
| modelSetDigest | фактически вычисляется заново и закрепляется в проверках |

Сохранение прежней полной identity для этого принятого semantic delta не разрешено.
Whitelist перечисляет **точные** известные HC profiles1/2, PING1 и известные
`unsupported` placeholders с совпавшими IDs/versions. Условие `version<=current`
не заменяет whitelist; неизвестные и будущие tuples fail-closed.
Документ, layout, программа, block workspace, GPIO, провода, distance и пользовательские
параметры сохраняются. Новый Run начинается из сохранённого документа.
Невалидный legacy PING distance=4 м не исправляется молча при upgrade; полное
range/no-echo поведение остаётся U04.

Фактически проверить отказ старого public continuation (`invalid_timed_continuation`),
прямого scheduler (`invalid_clock_continuation`) и старого sensor state в runtime
helpers. Использовать сохранённые на исходной модели состояния для explicit old
identity и legacy document без неё. Не переписывать opaque JSON, digest, версии,
powered, deadlines или instruction pointer для обхода guard.
Golden bridge может переводить только точное metadata-поле известного digest
неизменившихся fixtures. Новые электрические ожидания независимы от solver;
токи, напряжения, residual и opaque state не нормализуются.

## Проверки и доказательства

После принятого контроллерского выбора:

```bash
corepack pnpm agent:preflight --scope electronics-ultrasonic-u01 --planned-path contexts/electronics/domain/solver.ts --planned-path contexts/electronics/domain/models/hc-sr04-runtime.ts --planned-path contexts/electronics/domain/models/ping-ultrasonic-runtime.ts --planned-path contexts/electronics/domain/model-identity.ts --planned-path contexts/electronics/testing/hc-sr04-runtime.spec.ts --planned-path contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts --planned-path contexts/electronics/testing/model-set-golden-compatibility.spec.ts --planned-path contexts/electronics/testing/fixtures/model-set-golden-compatibility.ts --planned-path docs/product/electronics/generated/component-coverage.json --check
corepack pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U01-001
NX_SKIP_NX_CACHE=true corepack pnpm exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts contexts/electronics/testing/power-balance-shunts.spec.ts contexts/electronics/testing/solver.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true corepack pnpm exec vitest run contexts/electronics/testing/model-set-golden-compatibility.spec.ts contexts/electronics/testing/timed-state.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true corepack pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true corepack pnpm benchmark:electronics:ci
node tools/generate-electronics-component-coverage.mjs --write
corepack pnpm validate:electronics-component-information
git diff --check
```

До product edit сохранить сопоставимый benchmark baseline. На фактическом принятом
источнике выполнить существующие пересекающиеся L298N и Arduino GPIO cases согласно
handoff. Не объявлять ещё не принятый L298N runtime присутствующим в main.
После окончательной конвергенции выполнить `agent:preflight --verify-plan --diff-base`
относительно фактической принятой базы со всеми девятью planned paths, получить
evidence, независимое review и required CI окончательного публикуемого SHA.
Каждая проверка: команда, source SHA, exit code, число тестов, cache и CI URL.
Неисполненное — NOT_RUN, диагностический FAIL — FAIL. Датированные U00 дефекты
земли/питания/no-echo/codegen сохраняют владельцев U02/U03/U04/до U05A.

Предъявить voltage/signed-current/residual/pulse table, фазы и повторный Trigger,
short/conflict, whitelist/continuation rejection, новый digest, benchmark baseline/after,
self-review и independent review. При разрешённой интеграции выполнить post-merge
подтверждение и учесть один production slice после принятого checkpoint.
Техническое принятие, owner acceptance и deployment различаются.
**Исполнитель STOP после U01; U02 выбирает контроллер отдельным переходом.
Родительская программа #1238 остаётся открытой.**
