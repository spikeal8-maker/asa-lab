# №539 R1 — подтверждённая причина вне текущего production-бюджета

## Результат ограниченного исполнителя

**OUTSIDE_BUDGET_FINDING, продуктовый ремонт не выполнялся. STOP этого исполнителя.** Программа452 продолжается контроллером. Нет нового кандидата исправления и нет приёмки539.

Задача539 выбрана канонически на main d56dc2a11d8a2ebccc7f2af185eb339e5db5c859. Входной recover SAFE_TO_START; полный preflight SAFE_TO_START, dirty0/overlap0/control-plane PASS. Точная карточка:114 tests и routing PASS. Отдельная ветка codex/electronics-ready-cadence-539-r1, обычное объединение опубликованного c7 с main: **9036e015195cd367c6e5f84c603a530df9d2e443**, tree **128202f062a3a0fe87d479b620051c1a1b85a212**. Рабочее дерево CLEAN. Изменились только4 канонических документа main; production/tests/package/workflow не менялись. c7/0147/1747 и диагностические refs сохранены. Commit не опубликован исполнителем.

## Что мешает ученику и что уже доказано браузером

Прочитаны сохранённые оригиналы BEFORE/AFTER, NEW independent REQUEST_CHANGES c7 и исходный gpio-saved.json. Повтор браузера, скачивание ZIP и полный CI не выполнялись. В реальном AFTER Serial полный save/run/stop/cookies-only reopen PASS. GPIO получает genuine ready каждые100000µs, но лишь LED0..5 за прежний5s предел: четырнадцать чанков занимают actual Worker compute4113.2ms. UI следует готовому кадру, buffer15/200, потери observer не обнаружены. Это не доказательство физической неисправности LED или частоты поведения на школьных компьютерах.

## Новый направленный профиль настоящего production engine

Внешний esbuild bundle импортирует **неизменённый** contexts/electronics/engine.ts и все его настоящие зависимости. Документ — полный raw.expected из сохранённого AFTER gpio-saved.json, без сокращения8LED или скетча. Последовательные genuine ready горизонты0…2000000µs с шагом100000µs и default maxEvents. Никакого локального браузера, сервера, Docker или БД.

Профиль Node v22.23.3 воспроизводит100ms модельные чанки за173.18–499.41ms; итог2s модели достигается без fault, все21 вызов ready. Это локальная диагностическая стоимость, **не** школьный benchmark и **не** новый browser computeMs.

Sampling CPU profile total5256.329ms (включает build/import/startup), inclusive:

|Функция|Время,ms|Доля total|
|---|---:|---:|
|advanceArduinoCircuitClock|4666.4|88.8%|
|solveRcCircuitWithHeldArduino|3439.9|65.4%|
|withQuality|1071.2|20.4%|
|verifyCircuitQuality|593.7|11.3%|
|compileCircuit|459.2|8.7%|

Inclusive значения вложены и не складываются. AdvanceRuntime значительно меньше основного физического пути; bounded source-cache не устраняет повторные расчёты DC/RC и quality.

## Проверка конкретной причины: счётчики вызовов

Отдельный внешний bundle меняет только call expressions в scheduler на `(counter++, originalFunction)(originalArgs)`. Исходники репозитория не меняются; функции, аргументы, результаты, precision, события и алгоритм сохраняются. Отдельный короткий проход0/100000/200000µs отвечает ready/solved/quality PASS:

|Горизонт,µs|solveRc|compileCircuit|verifyCircuitQuality|advanceClockedArduinoRuntime|
|---:|---:|---:|---:|---:|
|0|3|3|3|3|
|100000|627|627|627|111|
|200000|300|300|300|2|

Показателен **интервал100000→200000µs**: программа находится в delay, всего2 runtime calls, но300 полных RC solves/compilations/quality checks. Runtime/controller не могут устранить этот доминирующий расход, сохранив канонические barriers.

Исходная цепочка contexts/electronics/domain/arduino-circuit-scheduler.ts:

- PHYSICS_QUANTUM_US=1000, неизменённый.
- Строки890–897: на каждом event time advancePhysics(time), physicalState становится advanced.transientState, cachedFrame сбрасывается.
- Строка915: sample(time).
- Строки732–748: sample повторно advancePhysics(time), затем ещё solveRcCircuitWithHeldArduino с advanced.transientState на том же timestamp.
- advancePhysics/withQuality строки704–723 каждый раз compileCircuit и verifyCircuitQuality.

Это источник доказанной повторной стоимости. **Ещё не доказано**, что любой из трёх результатов можно просто удалить или заменить первым: zero-duration follow-up может иметь важную семантику non-linear/thermal состояния. Подмена без full-state+observation parity была бы ошибкой. Физика не изменялась.

## Минимальное предложение отдельного bounded repair

До product edits контроллеру требуется канонически разрешить **один дополнительный production path**: contexts/electronics/domain/arduino-circuit-scheduler.ts. Первым кандидатом исследовать устранение повторной неизменённой same-time electrical solve/compilation, сохраняя1000µs physical quantum, все canonical barriers/order, input/MCU/servo/pulse/physics semantics и независимую quality verification. Не увеличивать horizon/timeout/event budget и не публиковать yielded.

Тестовый бюджет: существующий mapped contexts/electronics/testing/arduino-circuit-scheduler.spec.ts и при необходимости существующий controller spec. Обязательны byte-exact whole/partitioned/yielded/JSON full canonical state+ordered events+observation parity против сохранённой baseline, capacitor/heat/damage/motor/MCU/input fixtures, same-time GPIO/read/input/servo/pulse/fault качества. Если безопасная reuse семантика не подтверждается, не удалять вызовы ради скорости; вернуть конкретный отдельный solver/compilation scope proposal. Исходные два production paths остаются без нового изменения, если профиль не докажет обратное.

После разрешённого bounded кандидата: неизменённые два generic browser сценария целиком на production build с сохранением/переоткрытием; ordinary exact-SHA gates; NEW independent review. Оригинальные полные537 программы проверяются позднее, generic их не заменяет. Root526/E01 сохраняет приоритет; интеграция539 удерживается, обязательный hygiene после526 сохраняется.

## Проверки и ограничения

До записи snapshot восстановлен фактически; c7 General37975631829 SUCCESS, main d56 General37979469897 ещё in_progress при последнем query, Scratch docs37979470048 SUCCESS. Ни один чужой workflow не перезапускался и не приписан этому merge SHA.

Focused gate/новые unit tests/CI/браузер этого ремонта **NOT_RUN**: продукт не менялся, возвращается подтверждённый scope finding до edits. Self-review проверил CLEAN/index, exact merge-only4docs, сохранность production bytes и исходныхrefs. Owner acceptance/deployment/K0/backups/T3/class **NOT_RUN**; школьная установка и защищённые данные не затронуты.

Неудачные внешние пробы сохранены: первый профиль ошибочно использовал parse result вместо `.document` и завершился TypeError до engine compute; исправлен только внешний harness. Первый inline Python aggregate завершился SyntaxError PowerShell quoting, заменён внешним .py. Read-only rg wildcard завершился Windows path syntax error. Recovery SAFE, repo CLEAN. Эти ошибки не являются product defect и не скрыты; исходный невалидный cpu profile сохранён отдельно.

Файлы доказательств находятся в C:/Users/spike/.codex/temp/electronics-e01/; SHA256 и source proof — author-539-r1-outside-budget-manifest.json. Executor STOP, следующий bounded scope выбирает контроллер.
