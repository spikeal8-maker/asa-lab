<!-- ROBOTICS-FIELD-CORE-D02-REPORT-20261111 -->

# D02 — публичные API электроники: source audit и проверяемые receipts

**Дата:** 11 ноября 2026 года. **Программа:** ROBOTICS-FIELD-CORE-001, этап E1.
**Тип:** информационный evidence report; semantic change: no.
**Исходный source audit:** `09b4c8162a52fad4e5f54359eace4d18b6799f31`.
**Исторический прогон:** `759ad24813fc0bb7c7ea0c11b1f32d0abd2546d8`.
**Snapshot повторной source-проверки и нового прогона:** `8c58667208202de22b7b8d36851bbcf4a979e3f3`.
**Первичный receipt:** [Issue #1071, комментарий D02](https://github.com/spikeal8-maker/asa-lab/issues/1071#issuecomment-6793330420).
**Machine-readable manifest:** [field-core-d02-public-api-20261111.json](field-core-d02-public-api-20261111.json).

Отчёт сохраняет результаты E1 для review. Он не является самостоятельным
нормативным clock contract, копией `current.yaml`, разрешением E7 или
рецензией реализации PHY-01. Все source-ссылки ниже закреплены за полными SHA;
исторические ссылки не переписаны на движущуюся ветку.

## Вердикт

| Область                                                 | Результат                                    |
| ------------------------------------------------------- | -------------------------------------------- |
| Аудит существующих публичных API и владельцев состояния | Завершён на фиксированном SHA                |
| Историческая регрессия на `759ad248`                    | **PASS: 4 файла, 118 из 118 тестов, exit 0** |
| Новый адресный прогон на `8c586672`                     | **PASS: 4 файла, 118 из 118 тестов, exit 0** |
| Достаточность текущего API для требуемого сопряжения E7 | **GAP**                                      |
| Новый исполняемый прототип пространственного сопряжения | **NOT_RUN**                                  |
| TIME-01, TIME-02, TIME-03 нового 3D-профиля             | **NOT_RUN**                                  |
| Закрытие D02                                            | **Не подтверждено**                          |

Общее ядро уже рассчитывает Arduino, микросекундные события HC-SR04, ток, момент и обороты двигателей. Не хватает доказанного публичного протокола остановки перед измерением по пространственному миру, публикации моторного воздействия за интервал и возврата фактической механической скорости в электрическую модель. Сейчас электрическая модель двигателя сама интегрирует угловую скорость и использует роторную инерцию; второе независимое интегрирование этих же величин в выбранном 3D-движке недопустимо.

Нормативная основа: [REQ-TIME-04…06 и REQ-DRV-06…07](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/docs/product/robotics/FIELD_CORE_SPEC.md#L553-L563), [карточка E1](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/docs/product/electronics/tasks/TASK-ELECTRONICS-ROBOTICS-FIELD-CORE-E1-001.md), [Canonical Clock Contract](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/docs/product/electronics/contracts/CANONICAL_CLOCK_CONTRACT.md).

## 0. Проверка исходников при переносе отчёта

Исходный аудит выполнен на `09b4c8162a52fad4e5f54359eace4d18b6799f31`. Для этого документа выбран
точный snapshot `8c58667208202de22b7b8d36851bbcf4a979e3f3`; это датированное свидетельство, а не
копия текущего execution state. Канонический выбор задачи остаётся в `current.yaml`.
Этот отчёт не задаёт новый clock contract, API или численные допуски.

Read-only сравнение выполнено `2026-11-11T17:08:14.231752+00:00`: **27 из 29**
задействованных файлов совпали побайтно; изменены только два файла из этой выборки.
Из прежних 12 SHA-256 совпали **11**. Полный manifest с Git blob IDs и SHA-256
находится в [JSON](field-core-d02-public-api-20261111.json).

| Файл                                        | SHA-256 исходного аудита                                           | SHA-256 snapshot `8c586672`                                        |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `contexts/electronics/domain/solver.ts`     | `8238d1a715821bafeff7405521d76ebca7e9e1db1210c05243c046f3ca4881ae` | `329567d63e1ed97f2dab707ee240c4425165d2d60fb2905d8dad21e59d7c1166` |
| `contexts/electronics/domain/simulation.ts` | `bf065d4a941aebd9662ded31217b5d33d5aae70903e8e7f508e2ecc264e8ffb6` | `7eedb1d9eb06ce6e1e488300f61098aa0ead4e78fd9f4d5142b4bdb83eefce92` |

Дерево `contexts/electronics` изменилось с
`4664adab2da9d7667b3fb6c68bec2bcecb2e8657` на
`2724990cd287f42c5e7f9f613eb1a1a87be0d2fe`.
В полном diff electronics также есть новый `numerical-shunt-power.ts`,
`power-balance-shunts.spec.ts` и изменения `benchmark-golden.v2.json`,
`simulation-contract.spec.ts`. Эти тесты не входили в разрешённый прогон D02.

Узкий diff показывает: solver передаёт создание и доверенное копирование узлов
функциям `emitNumericalNodes` / `copyNumericalNode`; quality-проверки учитывают
мощность GMIN и требуют соответствующее внутреннее свидетельство, когда баланс
мощности применим. Это реальные новые bytes, поэтому исторические 118 PASS
**не перенесены** как результат на `8c586672`.
[Изменение solver](https://github.com/spikeal8-maker/asa-lab/blob/8c58667208202de22b7b8d36851bbcf4a979e3f3/contexts/electronics/domain/solver.ts#L5033-L5045),
[quality](https://github.com/spikeal8-maker/asa-lab/blob/8c58667208202de22b7b8d36851bbcf4a979e3f3/contexts/electronics/domain/simulation.ts#L638-L658),
[Arduino quality traversal](https://github.com/spikeal8-maker/asa-lab/blob/8c58667208202de22b7b8d36851bbcf4a979e3f3/contexts/electronics/domain/simulation.ts#L1093-L1111),
[внутренний helper](https://github.com/spikeal8-maker/asa-lab/blob/8c58667208202de22b7b8d36851bbcf4a979e3f3/contexts/electronics/domain/numerical-shunt-power.ts#L14-L98).

Package exports, engine DTO, scheduler, HC-SR04, моторная модель, четыре выбранных
теста, прежний UI-путь, clock contract и требования D02 в выборке не изменились.
Проверенный diff не добавляет sensor-query barrier, committed interval motor history
или обратный timed omega/load-порт; он не меняет владельца omega/J.
Выводы о GAP сохраняются по source inspection. Свежая регрессия ниже — отдельное,
действительно выполненное свидетельство.

## 1. Фактическая публичная поверхность

| Вход                                   | Доступные символы и данные                                                                                                                                                         | Граница                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@asa-lab/electronics/engine`          | `advanceElectronicsToHorizon`, `createElectronicsAdvanceSession`, pause/resume/reset; requested/committed horizon, append-only inputs, ready/yielded/fault, наблюдения компонентов | `ElectronicsTimedContinuation.serializedState` прямо объявлен непрозрачным для потребителя                        |
| `@asa-lab/electronics/simulation`      | `advanceArduinoCircuitClock`, `ArduinoCircuitClockAdvance`, `ArduinoCircuitClockState`, `ArduinoCircuitInputEvent`                                                                 | Публичный низкий уровень со структурированным состоянием и Arduino events; нельзя называть весь scheduler private |
| `@asa-lab/electronics` и `/simulation` | `advanceBrushedMotorTransientState`, `brushedMotorCompanion`, `observeBrushedMotorTransientState`, моторные типы и профили                                                         | Публичные переходы существующей модели, но не готовый двусторонний timed-порт всего работающего circuit runtime   |
| Внутри scheduler                       | `observeSensors`, `nextSensorTime`, `nextTime`                                                                                                                                     | Локальные функции; публичный запрос геометрии и остановка перед её потреблением не представлены                   |

Источники: [package exports](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/package.json#L7-L29), [engine DTO](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L68-L173), [публичный scheduler export](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/simulation.ts#L13-L19), [моторные exports](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/index.ts#L94-L114), [локальные функции scheduler](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L1339-L1444).

Наличие публичного структурированного continuation не разрешает вручную переписывать скорость, ток или очередь Echo, обходя предусмотренные переходы модели.

## 2. Возможности и подтверждённые пробелы

### D02-01. Время и no-past guard сохранены

`ElectronicsCanonicalMicroseconds` — неотрицательные целые микросекунды. Запрос содержит горизонт, состояние, новые события и бюджет. Результат различает готовое наблюдение, yielded и fault. Yielded имеет `observation: null`; fault фасада сохраняет прежнее принятое состояние.

Scheduler проверяет целочисленное время, неубывающий порядок и неизменность принятого префикса входов. **Новый вход при `event.atMicroseconds <= previous.reachedMicroseconds` отклоняется с `retroactive_input`. Равенство после commit тоже запрещено.**

Источники: [engine semantics](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L148-L173), [fault/yield projection](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L526-L550), [no-past guard](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L1111-L1121).
Существующий тест отказа входов в 999 и 1000 после `C=1000` входит в выполненный прогон: [test](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts#L371-L383).

Это подтверждает текущую защиту. Дробление горизонта и бюджет работы сами по себе не доказывают синхронизацию с отдельным механическим миром.

### D02-02. HC-SR04 фиксирует среду на принятом Trig

В текущем учебном профиле:

- минимальный HIGH Trig — 10 мкс;
- расстояние и наличие отражения фиксируются **на спадающем фронте принятого Trig**;
- начало Echo назначается через 200 мкс;
- ширина Echo равна `round(distanceMeters × 100 × 58)` мкс;
- `echoAvailable=false` не создаёт Echo, а Arduino использует обычный timeout;
- более поздняя смена среды не отменяет уже принятое Echo.

Это описание реализованного профиля, а не утверждение точности реальной акустики. Источники: [параметры HC](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/models/hc-sr04-runtime.ts#L3-L16), [observeHcSr04Inputs](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/models/hc-sr04-runtime.ts#L177-L233).

Публичный engine принимает timed operations `distanceMeters` и `echoAvailable`; scheduler валидирует для HC расстояние 0,02–4 м и boolean. Внутренний `observeSensors` читает среду из `activeDocument`; после GPIO-обновления есть повторное наблюдение на том же времени. [engine mapper](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L200-L241), [validation](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L399-L408), [sensor observation](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L1339-L1360), [post-GPIO observation](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L1823-L1845).

Сценарии same-time пакета среды/Trig, no-echo, timeout, partition/yield/JSON continuation вошли в свежую регрессию. Они используют заданные входные значения и не являются прототипом измерения движущегося 3D-мира.

### D02-03. Остановка перед внешним измерением — GAP

В `ElectronicsTimedAdvanceRequest` нет callback или результата «нужна геометрия на t до принятия измерения». `createElectronicsAdvanceSession` клонирует запрос целиком; промежуточный `step()` возвращает private pending `null`, а не окно для подстановки нового входа в выполняющийся запрос.

Низкоуровневый публичный `advanceArduinoCircuitClock` принимает `inputs` и `maxClockEvents`, возвращая состояние после выполненной работы, Arduino events и готовый результат только при ready. Локальные `nextTime` и `observeSensors` не образуют публичный sensor-query handshake.

Источники: [request](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L109-L116), [owned session](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L381-L421), [session batching](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L505-L521), [low-level public request](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L773-L798), [result type](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L260-L267).

Дополнительное наблюдение уже достигнутого C возможно, но выполненное измерение от этого не становится непринятым. Вставка поздно вычисленной геометрии на это же C должна продолжать отклоняться. Вывод — отсутствие доказанного явного протокола REQ-TIME-05, а не утверждение математической невозможности любого иного алгоритма.

### D02-04. Старый UI-путь не доказывает геометрию на Trig

Текущий `RoboticsLab` получает опубликованное наблюдение, извлекает оба `outputRpm`, продвигает старую механику до времени кадра, измеряет расстояние по полученной позе и передаёт среду через `setRuntimeHcSr04EnvironmentSample`. Setter принимает componentId и образец без времени измерения и без requested/accepted timestamp. [RoboticsLab](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/apps/web/src/robotics/RoboticsLab.tsx#L465-L539), [setter](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/apps/web/src/electronics/use-electronics-workbench.ts#L540-L598).

Контроллер назначает входу `max(C+1, lastInput+1)`. Если выполняющийся запрос уже продвинул C, метод `retimePendingInputsAfterCommitted` сдвигает ещё не отправленные входы. [назначение времени](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/apps/web/src/electronics/live-simulation-worker-controller.ts#L332-L356), [retime](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/apps/web/src/electronics/live-simulation-worker-controller.ts#L584-L622).

Это текущая семантика UI-команд, а не доказательство точного пространственного измерения на Trig. Нельзя переименовать такой путь в новый SensorQuery или ослабить core no-past guard. Настоящее время геометрического образца и принятое время должны быть определены проверенным контрактом; менять существующую UI-семантику данным аудитом не предлагается.

### D02-05. Момент уже наблюдается; моторный обмен за интервал — GAP

Публичный `ComponentResult` содержит `motorRpm`, `outputRpm`, `electromagneticTorqueNewtonMeter`, `outputTorqueNewtonMeter`, нагрузку, механические мощности, потери, направление, фазу и режим. Утверждение «в ядре нет момента» было бы неверным. Эти значения формирует существующая модель. В компонентной проекции RPM округлены до 3 знаков, моменты — до 12. [ComponentResult](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/solver.ts#L353-L377), [motorComponentObservation](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/solver.ts#L1178-L1236).

Но timed-result не содержит квалифицированной committed истории моторных воздействий по электрическим событиям, интеграла момента или работы за `[tStart,tEnd]`. Опциональное temporal-наблюдение предназначено для LED/дисплеев; это не моторный канал. [timed observation](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L135-L173), [session options](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L382-L400).

Одно конечное значение момента/RPM не доказывает сохранение интеграла PWM внутри механического интервала.

### D02-06. Обратная скорость/нагрузка и владение инерцией — GAP

Публичный `BrushedMotorStepInput` принимает напряжение, dt, неотрицательную величину выходной нагрузки, `shaftLocked` и температуру среды. Поля фактической внешней угловой скорости нет. Нагрузка отражается через редуктор/КПД и получает сопротивляющийся знак по прежней скорости или напряжению. Это не произвольный знаковый двунаправленный энергетический порт. [StepInput](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/models/brushed-motor-transient-model.ts#L38-L47), [reflected load](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/models/brushed-motor-transient-model.ts#L165-L182).

Solver берёт `outputLoadTorqueNewtonMeter` и `shaftLocked` из component.stateProperties. Эти операции и внешняя omega отсутствуют в canonical input union и mapper engine. Наличие аргумента нагрузки в низкоуровневой функции не равно timed-порту обратной связи работающего circuit runtime. [solver input](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/solver.ts#L1128-L1143), [input union](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L194-L220), [engine mapper](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/engine.ts#L200-L277).

`brushedMotorCompanion` использует уравнения `V=Ri+L·di/dt+Ke·omega` и `J·domega/dt=Kt·i−b·omega−load`. `advanceBrushedMotorTransientState` непосредственно вычисляет следующую omega и фазу, используя `rotorInertiaKgMeterSquared`. [companion](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/models/brushed-motor-transient-model.ts#L276-L342), [интегрирование omega](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/models/brushed-motor-transient-model.ts#L503-L528).

**Запрещённый обход:** добавить ту же роторную инерцию в механику, продолжить независимое электрическое интегрирование и вручную подменять omega внутри continuation. До нового профиля требуется решение о единственном владельце состояния и энергетическая квалификация.

### D02-07. Дополнительные границы зависимых работ

Текущий `servo-runtime` декодирует корректную длительность импульса в `angleDegrees`. В этом переходе нет ограничения скорости, момента или реакции на контакт. Это не доказанный пространственный servo-привод. [servo transition](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/models/servo-runtime.ts#L117-L130).

Scheduler ограничивает входной trace значением `MAX_INPUT_EVENTS=1024`. Опыт с более чем 1024 изменениями входов требует отдельного решения ограниченной истории; это не утверждение, что любой десятиминутный опыт обязательно откажет. Собственный предел времени scheduler — `2**50−1001` мкс, а не 40 секунд. [limits](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L115-L119), [input validation](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-circuit-scheduler.ts#L352-L359).
Исторические 40 секунд относятся к старой robotics-цепочке: [world-runtime](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/robotics/domain/world-runtime.ts#L33-L49).

## 3. Владельцы состояния и единицы

| Величина                      | Владелец сегодня                                                       | Единицы / направление                   | Вывод для нового профиля                                                  |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| Принятое время                | Общий circuit scheduler                                                | Целые мкс                               | Механический commit должен быть согласован с ним                          |
| VM Arduino, GPIO, ожидания    | Arduino runtime под scheduler                                          | Мкс на границах, внутренние адаптеры ms | Механика не изменяет VM/очередь                                           |
| Образец среды HC              | Сейчас robotics/UI передаёт среду; HC фиксирует её на Trig             | Метры, echo/no-echo                     | Нужен доказанный образец на времени измерения                             |
| Echo и pulseIn                | HC runtime и Arduino pulse runtime                                     | Целые мкс                               | Сохранить порядок и timeout                                               |
| Ток и электромагнитный момент | Общая электрическая модель                                             | A, Н·м                                  | Не копировать solver в механику                                           |
| Роторные omega и фаза         | **Текущая электрическая модель двигателя**                             | рад/с, рад                              | Будущее разделение владельцев не квалифицировано                          |
| Роторная инерция J            | Параметр motor profile, используемый тем же электрическим интегратором | кг·м²                                   | Это параметр, а не динамическое состояние; исключить двойной учёт инерции |
| Выходные RPM и момент         | Та же модель через редуктор                                            | об/мин, Н·м                             | Нужны явные оси, знаки и баланс энергии                                   |
| Поза старого шасси            | Robotics runtime / Planck                                              | м, рад                                  | Получает RPM; не является 3D torque/load трактом                          |
| Поколение Worker              | Worker/controller protocol                                             | generationId, projectSessionId          | Совместный runId механики ещё не доказан                                  |

Дополнительные источники: [pulseIn wait semantics](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/domain/arduino-pulse-runtime.ts#L50-L117), [Worker protocol](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/apps/web/src/electronics/simulation-worker-protocol.ts#L13-L50), [старый RPM-driven runtime](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/robotics/domain/world-runtime.ts#L65-L89).

## 4. Историческая регрессия на HEAD 759ad248

Второй отдельно порученный срез разрешал только существующие focused tests, без новых тестов/API, install, rebuild, изменений runtime или БД. Автор PHY-01 подтвердил окно без тяжёлых проверок; после завершения уведомлён. Работа выполнялась на D2-R2 в `C:\Users\spike\Projects\asa-lab-robotics-field-core-001`.

До и после именно исторического прогона:

- HEAD: `759ad24813fc0bb7c7ea0c11b1f32d0abd2546d8`.
- Git tree `contexts/electronics` и у этого HEAD, и у source baseline: `4664adab2da9d7667b3fb6c68bec2bcecb2e8657`.
- `git diff --exit-code 09b4c8162a52fad4e5f54359eace4d18b6799f31 -- contexts/electronics`: пустой diff, exit 0.
- `git status --short -- contexts/electronics`: пусто.
- SHA-256 12 проверенных исходников, тестов и fixture совпали до и после.

`rg` отсутствовал в PATH D2-R2; после попытки `rg --files` точные пути подтверждены узким `Get-ChildItem`, без установки инструмента.

**Команда:**

```powershell
Set-Location 'C:\Users\spike\Projects\asa-lab-robotics-field-core-001'
$env:NX_SKIP_NX_CACHE='true'
pnpm.cmd exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts contexts/electronics/testing/engine-timed-api.spec.ts contexts/electronics/testing/brushed-motor-transient-model.spec.ts --maxWorkers=1
```

Среда: Node `v22.23.3`, pnpm `9.15.9`, Vitest `4.1.11`.
Время: **11 ноября 2026, 13:03:31–13:03:48 МСК**.
Сырые UTC timestamps: `2026-11-11T10:03:31.5833917Z` → `2026-11-11T10:03:48.2293566Z`.
PID `37544` завершился с exit 0. Длительность Vitest 15.34 s; полная длительность процесса по инструменту 17.56 s.

| Файл                                    |  Тестов | Итог     |       Время |
| --------------------------------------- | ------: | -------- | ----------: |
| hc-sr04-runtime.spec.ts                 |      11 | PASS     |        6 мс |
| ultrasonic-distance-timed-input.spec.ts |       9 | PASS     |      127 мс |
| engine-timed-api.spec.ts                |      87 | PASS     |   12 187 мс |
| brushed-motor-transient-model.spec.ts   |      11 | PASS     |       73 мс |
| **Всего**                               | **118** | **PASS** | **4 файла** |

```text
Test Files  4 passed (4)
Tests       118 passed (118)
Duration    15.34s (transform 932ms, setup 0ms, import 2.31s, tests 12.39s, environment 0ms)
{"D02VerificationEndUtc":"2026-11-11T10:03:48.2293566Z","VitestExit":0}
Process completed with exit code 0
```

Это исторический прямой Vitest-прогон на `759ad248`, выполненный в 10:03 UTC 11 ноября 2026 года; он не является повтором на `8c586672`. Nx не запускался; результат не взят из Nx cache. Сценарии подтверждают прежние API clock/HC и автономную моторную модель, **не TIME-01…03 нового совместного мира**.

Точные тесты: [HC](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/testing/hc-sr04-runtime.spec.ts), [timed sensor](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts), [engine](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/testing/engine-timed-api.spec.ts), [motor](https://github.com/spikeal8-maker/asa-lab/blob/09b4c8162a52fad4e5f54359eace4d18b6799f31/contexts/electronics/testing/brushed-motor-transient-model.spec.ts).

<details>
<summary>SHA-256 receipt: одинаковые значения до и после прогона</summary>

| Путь                                                                           | SHA-256                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| contexts/electronics/engine.ts                                                 | `0564b8cefc11e4ea3be46b1ad5933cd2c328f1d647a71cb0d26aa1ea01f82528` |
| contexts/electronics/simulation.ts                                             | `65de5b13e64ec79fc80baa7868746e334b8a3ef4720fa321010b62f7199d2857` |
| contexts/electronics/domain/arduino-circuit-scheduler.ts                       | `e0465f5d401da6ad1c6259cdd042b64c1d36417279a0fab5522ab7f4e5b4066a` |
| contexts/electronics/domain/models/hc-sr04-runtime.ts                          | `09fec5f8f0fe40eda1c3649a4c485ebbedb97b8907377c5cd67a8c4c06dce794` |
| contexts/electronics/domain/arduino-pulse-runtime.ts                           | `70b08fe57a0b680e0d807eb3bfbe532465a88819e7c707e81e3ae711884138bd` |
| contexts/electronics/domain/models/brushed-motor-transient-model.ts            | `86570985c5b2bd352b06024748d8e1ee22d1fb58867d1e5e09b935685c00ef0b` |
| contexts/electronics/domain/solver.ts                                          | `8238d1a715821bafeff7405521d76ebca7e9e1db1210c05243c046f3ca4881ae` |
| contexts/electronics/testing/hc-sr04-runtime.spec.ts                           | `af7b8e2347de8777074d9a2855991a27a1ad402eeb40e22944bdf88bdc979b56` |
| contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts           | `b36df2c518b4396c0f2258e38cfa5c1485203d58ff711e38f29df52fa46c2330` |
| contexts/electronics/testing/engine-timed-api.spec.ts                          | `daa07ffad99630d621b5fe46899b4766f3cb5609e7bc87ff8f0c56a124cc2f0e` |
| contexts/electronics/testing/brushed-motor-transient-model.spec.ts             | `14b99a3fe5d4e939c9cc1efcb74cfe7763c62937ff19ba4dc388996654b8357c` |
| contexts/electronics/testing/fixtures/brushed-motor-transient-fixtures.v1.json | `f3ec182e6758d3eb4836f54c5b0680b900c05c271a58fec64e8785ef20e024a5` |

</details>

## 5. Новый адресный прогон на snapshot 8c586672

Изменение solver стало конкретным основанием для одного нового прогона, отдельно
разрешённого контроллером. Использован независимый checkout
`C:\Users\spike\Projects\asa-lab-robotics-d02-report-20261111`.
Перед записью отчётов exact planned-path preflight `--scope robotics --check`
вернул `SAFE_TO_START`, exit 0: HEAD и origin/main равны `8c58667208202de22b7b8d36851bbcf4a979e3f3`,
dirty paths 0, overlaps 0, execution blockers 0, control-plane PASS.
Применимый acceptance blocker сохранён. Это историческая запись preflight,
не разрешение будущих действий.

Подготовка: `pnpm.cmd install --frozen-lockfile`, exit 0, **854 reused,
0 downloaded**, lockfile не изменён. Фактически собран только `module-sdk`
командой `pnpm.cmd exec tsc -p packages/module-sdk/tsconfig.json`, exit 0.
Это команда его штатного build target. Дерево пакета:
`422ec9383c51228e7dab64d3b1ab90c18a8d723d`. Другие workspace-пакеты не собирались;
полный build, physics worlds, БД и серверы не запускались.

**Фактические команды:**

```powershell
Set-Location 'C:\Users\spike\Projects\asa-lab-robotics-d02-report-20261111'
$env:NX_SKIP_NX_CACHE='true'
pnpm.cmd install --frozen-lockfile
pnpm.cmd exec tsc -p packages/module-sdk/tsconfig.json
pnpm.cmd exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts contexts/electronics/testing/engine-timed-api.spec.ts contexts/electronics/testing/brushed-motor-transient-model.spec.ts --maxWorkers=1
```

Среда: Node `v22.23.3`, pnpm `9.15.9`, Vitest `4.1.11`.
UTC: `2026-11-11T17:13:04.0680519Z` → `2026-11-11T17:13:23.2332793Z`
(11 ноября 2026 года, 20:13:04–20:13:23 МСК).
Vitest: **18.12 s; exit 0; 4 файла, 118 из 118 тестов PASS**.
Это один выполненный запуск, без повторов; Nx не запускался, `NX_SKIP_NX_CACHE=true`.

| Файл                                    | Тестов | Результат |     Время |
| --------------------------------------- | -----: | --------- | --------: |
| hc-sr04-runtime.spec.ts                 |     11 | PASS      |      8 мс |
| ultrasonic-distance-timed-input.spec.ts |      9 | PASS      |    153 мс |
| engine-timed-api.spec.ts                |     87 | PASS      | 13 931 мс |
| brushed-motor-transient-model.spec.ts   |     11 | PASS      |     73 мс |

```text
Test Files  4 passed (4)
Tests       118 passed (118)
Duration    18.12s (transform 1.74s, setup 0ms, import 3.27s, tests 14.17s, environment 0ms)
```

HEAD до и после: `8c58667208202de22b7b8d36851bbcf4a979e3f3`; electronics tree:
`2724990cd287f42c5e7f9f613eb1a1a87be0d2fe`.
Все **29 SHA-256 до и после равны**, source diff exit 0.
SHA-256 сериализованного before-manifest:
`586611ad586ce157aa114be040872bc59cb25235d8c1af626321e15e9f96172a`.
Уникальные маркеры: `D02-8C586672-REGRESSION-BEGIN-20261111` и `D02-8C586672-REGRESSION-END-20261111`.
Raw log проверен чтением файла после завершения, а не по одному PID;
его SHA-256: `5926527afce22404b3b859a2cb3b847f0cf948091310820333d3ec8fcb69bb1f`.
Полный текст журнала, включая ANSI sequences и before/after hashes,
сохранён в поле `fresh_regression.raw_log_utf8` соседнего JSON. Его исходные UTF-8 bytes
восстанавливаются из строки без изменения CRLF. Искажение значка checkmark в
Windows stdout сохранено в сыром тексте; counts, timestamps и exit code читаемы.

**Граница PASS:** эти четыре существующих файла проверяют действующий public
clock/HC и автономную моторную модель. Новый spatial coupling prototype,
новый sensor query, обратный omega/load-порт, энергетический обмен совместного мира
и TIME-01…03 **NOT_RUN**. Свежий PASS не устраняет подтверждённые GAP.

## 6. Зависимости и рекомендуемый ограниченный probe

| Зависимая часть                       | Состояние                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| E1, шесть механических TEST_ONLY сцен | Этот D02 GAP сам по себе их не блокирует                                                        |
| E2                                    | Фиксировать только доказанные части; неподтверждённый coupled API не описывать как существующий |
| E7: HC от 3D-мира                     | Заблокирован до query/barrier на точном Trig                                                    |
| E7: электрический привод шасси/рампы  | Заблокирован до двустороннего timed speed/torque/load контракта                                 |
| TIME-03, PHY-12, REQ-DRV-07           | Нужны единый владелец omega/J и проверка энергии                                                |
| Пользовательский servo-механизм       | Команда угла не заменяет ограниченный физический привод                                         |

Рекомендуемый следующий ограниченный D02 probe (**NOT_RUN**; не выбор следующей задачи) на существующих public exports: 10-мкс Trig около 5000 мкс, точные Echo/timeout, поздние входы при t<C и t=C, partition/yield, реальные моторные наблюдения и явный отказ недекларированных timed-портов. Сохранить сырые результаты с exact SHA; не добавлять поддержку выдуманной операции в тот же probe.

Потребуется отдельно выбранное архитектурное решение барьера измерения и владельца omega/J. Имена и форма будущего API этим отчётом не назначаются. История воздействий, обратная скорость и энергетический критерий должны пройти обычное изменение контракта и независимую квалификацию до E7.

## 7. Объём документационного результата

Созданы только `field-core-d02-public-api-20261111.md` и
`field-core-d02-public-api-20261111.json` в `docs/product/robotics/evidence`.
Продукт, tests, package/lock, current.yaml, task selection и blockers этим срезом
не изменяются. Разрешённая подготовка зависимостей создаёт только обычные ignored
install/build/cache artifacts; временные журналы скопированы в evidence в указанном объёме.
Это авторский source audit и self-review отчёта, не независимый review PHY-01
или принятие интегрированного E1.

Ограничения: источник GAP — проверенный публичный surface и точные реализации,
а не невозможность любой будущей архитектуры. Низкоуровневый scheduler публичен;
структурированное состояние не даёт права вручную подменять continuation.
Недостающая возможность не помечается PASS и не появляется от успешного прогона
существующих тестов. Дополнительная dependency E7 остаётся явной.

**Итог D02: GAP. D02 не закрыт; coupling prototype и TIME-01…03 — NOT_RUN.**
Рекомендация probe не меняет выбранную задачу. После данного документационного
среза — STOP и назначенные контроллером обычные publication/review действия.
