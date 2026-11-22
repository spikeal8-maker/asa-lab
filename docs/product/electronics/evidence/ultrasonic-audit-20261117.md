# Дальномеры: аудит базы и исследование Tinkercad, 17.11.2026

Историческое evidence программы [#1238](https://github.com/spikeal8-maker/asa-lab/issues/1238).
Это наблюдение, не live execution state и не приёмка будущей реализации.

## Проверенная база

GitHub main: `5c5265c717f57100e747f956a133b4c52789b7c8`, tree
`7ec9a408108dfce216d4b00ec7c95056d5fd9cd0`. Исходники первоначального focused
аудита сверены с Git blob hashes. Затем подготовлен чистый полный checkout того
же SHA для оформления программы и повторного воспроизведения.

271 существующая focused проверка прошла: HC runtime, PING runtime, distance timed
input, block adapter, HC query barrier (вместе 42), scheduler (110), Worker controller
(117), distance controls (2). Это не полный repository gate и не deployed browser
приёмка. Отдельные два UI observation-теста подтвердили отказ промежуточного
числового ввода; они не прибавляются к 271 проверке принятого repository source.

## Воспроизведение

Из корня репозитория с его зависимостями:

```bash
NX_SKIP_NX_CACHE=true corepack pnpm exec vitest run --config docs/product/electronics/evidence/ultrasonic-audit-vitest.config.mjs --reporter=verbose
```

[Reproducer](ultrasonic-audit-20261117.reproducer.ts) содержит полные схемы,
скетчи и assertions правильного поведения. На аудированной базе результат —
**6 FAIL и 5 observational PASS, exit 1**. Ненулевой exit здесь фиксирует дефекты,
не успешный продуктовый gate. Обычный Vitest include не включает этот архивный
proof fixture. В U01–U03 соответствующие проверки переносятся в постоянные
mapped suites и должны стать обычными PASS, без skip/todo/expected-failure.

[JSON наблюдений](ultrasonic-audit-20261117.json) хранит значения первичного запуска
и его source SHA. При новом main результаты проверяются заново; архив не
перезаписывается как текущее состояние. Оба варианта проверяются независимо.

## Подтверждённые дефекты и причины

| Дефект                        | Наблюдение на базе                                                                                                 | Область причины                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Отсутствующий GND             | HC и PING при 1 м возвращают 5800 мкс и `powered=true`                                                             | `solver.ts`: islands/reference, модели вычитают напряжения разных островов                        |
| Echo/SIG с 10 кОм             | raw solved, V≈4,995005 В, I≈0,0004995005 А; sensor current=0, KCL residual≈0,0004995005 А при tolerance 0,000001 А | штампуемые ultrasonic ветви отсутствуют в согласованном terminal-current observation              |
| Потеря VCC ровно в Echo start | оба возвращают полный 5800 мкс; за 1 мкс до дают 0                                                                 | порядок due outputs, input events и повторного sensor observation в scheduler                     |
| Изменение после начала Echo   | за 1 мкс после start наблюдался timeout 0                                                                          | требуется electrical settle/read; точный укороченный импульс квалифицируется с реальным pull-down |
| Числовой ввод                 | очистка и промежуточный 0 возвращаются к старому 1; целая вставка 0.25 принимается                                 | controlled numeric value и немедленная валидация вместо строкового draft                          |
| UI distance во время Run      | проходит в `commitDocument`, history/autosave                                                                      | смешаны persisted initial condition и runtime environment input                                   |
| PING→HC                       | SIG назначается ближайшему ECHO, TRIG не подключён, расстояние теряется                                            | generic nearest-pin replacement и замена stateProperties defaults                                 |
| HC→PING                       | связанный вариант возвращает null без понятного UI объяснения                                                      | защитный отказ есть, пользовательской диагностики нет                                             |
| HC справка/метаданные         | описание PING 3-pin, устаревший `not_yet_supported`                                                                | catalog adapter и отсутствие variant-specific full help                                           |
| PING no-echo / диапазон       | `echoAvailable=false` игнорируется; direct helper допускает 4 м, полный engine отвергает                           | неодинаковый профильный/доменный путь                                                             |

Диагностические абсолютные времена Echo start 218 мкс (HC) и 359 мкс (PING)
относятся только к скетчу reproducer. ТЗ использует Trigger fall + profile latency.
Отдельный снимок Arduino interpreter не доказывает поддержку произвольного C++.
Существующее удаление `distanceMeters` из structural Worker signature не позволило
утверждать, что каждое изменение UI расстояния уже перезапускает Arduino.

Основные source routes:

- `contexts/electronics/domain/solver.ts`, `domain/simulation.ts`;
- `contexts/electronics/domain/models/hc-sr04-runtime.ts`, `ping-ultrasonic-runtime.ts`;
- `contexts/electronics/domain/arduino-circuit-scheduler.ts`, `model-identity.ts`;
- `apps/web/src/electronics/UltrasonicDistanceControls.tsx`, `WorkbenchSidebars.tsx`;
- `apps/web/src/electronics/use-electronics-workbench.ts`, `use-workbench-project-state.ts`;
- `apps/web/src/electronics/workbench-document.ts`, `production-manifest-adapter.ts`,
  `component-help-content.ts`.

## Tinkercad

Повторное исследование выполнено в открытой владельцем странице Tinkercad Circuits
через подключённый Chrome, после получения четырёх пользовательских снимков.
Обследованы два реально размещённых экземпляра во время моделирования. Личный
ID проекта, account UI и содержимое других вкладок в это evidence не включаются.

### Что непосредственно проверено

1. В каталоге видны отдельные 3-pin PING и 4-pin HC-SR04. У каждого есть «?»
   в инспекторе. Нажатие открывает справку соответствующей модели.
2. У обеих справок есть описание, объяснение измерения по отражённому звуку,
   раздел подключения, инструкция управления во время моделирования и источники.
   HC поясняет отдельные TRIG/ECHO; PING — единственный сигнал и три контакта.
   В подключении показаны изображения схем с Arduino.
3. У PING дополнительно обнаружена готовая стартовая схема, которую интерфейс
   предлагает перетащить в проект. Её добавление не выполнялось: текущий проект
   владельца не дополнялся компонентами/проводами и не заменялся примером.
4. У выбранного датчика показываются полупрозрачный сектор, круглая цель, две
   пунктирные линии к излучателям и числовая подпись cm/in над корпусом.
5. Цель действительно перемещается свободно в двух измерениях внутри сектора.
   PING показал изменение 113,4→197,5 см при боковом/радиальном drag; HC —
   113,4→175,0 см. Это опровергает достаточность управления только по одной оси.
6. Перемещение PING в недопустимую внутреннюю область изменило сектор на светлый
   красный и скрыло обычную подпись. Конкретный электрический timeout этим не
   доказывается. В одном положении PING показал 319,6 см; по этому отсчёту нельзя
   объявить универсальный max или поменять принятый ASA-профиль 2–300 см.

### Границы исследования и решение для ASA

Датчики на исследованной пользовательской схеме не были подключены. Проверены
справка и интерактивное поведение, но не электрическая правильность Tinkercad,
внутренние времена Echo, save/reopen, точные предельные расстояния или кодогенерация.
Изображения и тексты Tinkercad не импортируются как ресурсы ASA.

Минимальная цель ASA: тот же понятный сектор и свободная цель, раздельная полная
справка каждого варианта, схема подключения и рабочий пример. Точные числовые
контракты ASA принимаются отдельно. Внешний вид, принятый profile, result Arduino
и документ проекта должны быть согласованы; красивый сектор не подтверждает Echo.

Проверенные ссылки из живых справок:

- [HC-SR04 datasheet](https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf).
- [Arduino PING example](https://docs.arduino.cc/built-in-examples/sensors/Ping/).
- [Parallax PING downloads](https://www.parallax.com/package/ping-ultrasonic-distance-sensor-downloads/).
- [Tinkercad lesson](https://www.instructables.com/Ultrasonic-Distance-Sensor-Arduino-Tinkercad/)
  — ссылка присутствует в справке; доступность содержимого не засчитана как PASS.

## Вывод для программы

Ремонт начинается с общей модели/времени, затем раздельной справки и безопасного
выбора разновидности, после этого — runtime controls и 2D цели. Исполнительные
границы и обязательные ID проверок находятся в
[ULTRASONIC_EXECUTION_SPEC](../contracts/ULTRASONIC_EXECUTION_SPEC.md), а не в архиве.
