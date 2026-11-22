---
task_id: TASK-ELECTRONICS-ULTRASONIC-U00-001
kind: design-decision
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# U00 — квалифицировать электрический контракт и приёмочные схемы

## Один результат

Принять проверяемое решение о питании, выходном каскаде и событиях HC-SR04/PING,
чтобы следующие исполнители исправляли определённое поведение. Component IDs:
`electronics.peripheral.ultrasonic`, `electronics.engine.solver`. Решение не
реализует U01–U09 и не объявляет исторические результаты состоянием текущего main.

## Вход и зависимости

Прочитать root AGENTS, [START_HERE](../START_HERE.md), selected task из current,
записи этих двух компонентов в `COMPONENT_MAP.yaml` и их subsystem cards.
Нормативный контекст: [ТЗ §2](../contracts/ULTRASONIC_EXECUTION_SPEC.md#2-нормативный-контракт-моделей),
[§3](../contracts/ULTRASONIC_EXECUTION_SPEC.md#3-физическое-время),
[§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки),
`contracts/CANONICAL_CLOCK_CONTRACT.md` — только input trace и порядок событий.
Отдельно прочитать `evidence/ultrasonic-audit-20261117.md` как историческую базу.
Контроллер фиксирует свежий main и изменения shared solver/scheduler, включая
L298N, прежде чем сравнивать результаты. Номер U00 не обнуляет hygiene counter.

Формальное выполнение U00 начинается после принятия ТЗ и канонического выбора
этой задачи в `current.yaml`; исполнитель проходит scoped preflight. До этого
по отдельно и явно порученному scope допустим ограниченный черновик решения
в составе подготовки пакета, если штатный preflight и применимые blockers
разрешают такие действия. Черновик не является выполненным U00, не выбирает
задачу и не разрешает продуктовые правки. Порядок — ТЗ §6.1 и §7.1.
Независимый дефект общего CI ведётся отдельным repair и не определяет
электрическую модель датчика. Если он мешает обязательным проверкам интеграции,
merge/release остаются запрещены; подготовка не отменяет AGENTS и blockers.

## Точный контекст и запись

Прочитать `contexts/electronics/domain/solver.ts`,
`domain/models/hc-sr04-runtime.ts`, `domain/models/ping-ultrasonic-runtime.ts`,
`domain/arduino-circuit-scheduler.ts`, `domain/model-identity.ts` относительно
`contexts/electronics/`, а также существующие tests ниже. Это ограниченный
cross-cutting decision; не загружать весь domain или normative README.

Разрешённые записи — только:

- `docs/product/electronics/contracts/ULTRASONIC_EXECUTION_SPEC.md` — уточнения принятого решения.
- `docs/product/electronics/evidence/ultrasonic-u00-electrical-decision.md` — новое evidence с полными fixtures и воспроизводимыми командами.

Production files: **0**. Не переписывать исторический audit. Диагностический
harness допустим вне product source; новые failing tests в main не добавлять.
Полные схемы, скетчи, входы, ожидаемые результаты и команды воспроизведения
сохраняются в указанном evidence-документе. Существующие schema, codegen и
runtime используются без записи в их product fixtures. U05A перенесёт принятые
данные в единый typed fixture для справки, схемы и runnable document.

## Что необходимо решить

1. Описать уравнения HIGH/LOW/high-Z, конечное сопротивление выхода, направление
   terminal currents, обратный ток и связь VCC/GND с сигналом. Указать, учитывает
   ли функциональная модель ток питания/покоя, и почему. Произвольный ток покоя
   ради соединения floating islands не принимается.
2. Определить проверку действительного питания и непрямого возвратного пути,
   не соединяя разные terminals искусственным short. Напряжения независимых
   floating islands нельзя вычитать как имеющие общую опору.
3. Зафиксировать фазы одного timestamp: входное изменение питания, согласование
   электрического состояния, решение об Echo, наблюдение MCU. Существующие
   canonical-time и conflict-order контракты сохраняются.
4. Принять точный список прежних профилей, обновлений model identity и политику
   несовместимого runtime continuation. Для каждого semantic slice U01–U03
   заранее определить, нужна ли новая identity/digest или отказ старого
   continuation; отсутствие version bump требует явного обоснования reviewer.
   Это условие публикации каждого среза, не отложенная работа U04.
   PING latency остаётся **350 мкс**;
   аппаратные 750 мкс не внедряются попутно. `echoAvailable=false` — отдельный
   валидный вход обоих датчиков, не расстояние 0/NaN.

Сравнивать альтернативы по заранее заданным критериям: KCL/source balance,
детерминизм, совместимость сохранённых проектов, pin semantics, canonical time,
main/Worker parity, цена solve и возможность независимого численного oracle.

## Приёмка решения

- Для UL-E01 записаны схема 5 В, выход 10 Ом и нагрузка 10 кОм: ожидаются
  4,995005 В и 0,0004995005 А. Если обоснован другой выходной каскад, до U01
  приняты его уравнения, аналитические значения и compatibility consequences;
  прежние quality thresholds не меняются.
- Для UL-E02/UL-E03 записаны обе модели, обрыв VCC/GND, reverse, 3,3 В,
  floating island, breadboard return, short сигнала, конфликт GPIO и отключение
  питания в Tstart−1/Tstart/Tstart+1/Tstart+100. Tstart вычисляется из принятого
  Trigger, а не копируется из исторического конкретного скетча.
- Есть полные схемы и поддерживаемые text-sketches: HC D13=TRIG/D2=ECHO,
  PING D13=SIG, VCC=5V/GND=GND; отдельные setup/loop cases, две независимые
  модели в одной схеме и настоящий block-codegen adapter. Нет заглушек тела
  `setup()`/`loop()`, внешней библиотеки или обещания arbitrary C++.
- Шесть исходных regression oracles описаны отдельными expected-correct
  assertions: два GND → 0; две нагрузки → ready/5800; два exact-edge → 0.
  Evidence различает воспроизведение текущего дефекта, уже исправленный baseline
  и ещё не проверенную гипотезу. Остальные ожидаемые значения взяты из §5 ТЗ.
  Приёмка U00 допускает воспроизведённые шесть baseline FAIL как доказательство
  дефектов: она принимает bounded decision и fixtures, не требует заранее
  зелёной будущей матрицы U01–U08. Diagnostic FAIL не переименовывается в PASS.
- Независимый reviewer принимает конкретное решение, fixtures и границы
  модели; список открытых design decisions, влияющих на U01, пуст.

## Проверки и завершение

При выбранном root electronics lane выполняются следующие существующие команды;
для отдельно выбранного child lane scope берётся из current, не наследуется.

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U00-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts contexts/electronics/testing/arduino-circuit-scheduler.spec.ts --maxWorkers=1
pnpm validate:electronics-agent-docs
pnpm gate:governance
git diff --check
```

Результаты baseline suites записываются как фактически получены; известный
диагностический FAIL не блокирует принятие документированного решения и не
оправдывает product fix в U00. Приложить focused evidence, команды harness, self-review и
независимый review точного документа. Тяжёлые product gates не заменяют решение
и не запускаются ради docs-only diff. Обязательный CI интеграции проверяется
отдельно: диагностический FAIL известного поведения, независимый FAIL общей
базы и отсутствие обязательной проверки не переименовываются в PASS.
Черновик до канонического выбора остаётся подготовительным evidence, даже если
его focused проверки прошли. Формат отчёта — ТЗ §8. Исполнитель STOP;
контроллер отдельно выбирает U01 после принятия решения.
