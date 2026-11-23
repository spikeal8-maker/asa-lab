---
task_id: TASK-ELECTRONICS-L298N-P1-001
kind: implementation
risk: high
semantic_change: "yes"
roadmap_slice: E-OPT-7
prerequisites:
  - "Issue #1199: owner-approved L298N dual H-bridge specification"
  - "P0A #1204 and P0B #1206 merged in main with exact post-merge General checked"
  - "Canonical P1 selection and scoped agent:preflight SAFE_TO_START"
  - "Existing overlapping solver/coverage tasks coordinated before writes"
acceptance_boundary: slice
review: independent
---

# L298N — P1 DOMAIN: два H-моста в общем решателе ASA LAB

## Цель и источник

Завершить **существующий** Draft PR [#1209](https://github.com/spikeal8-maker/asa-lab/pull/1209)
по [Issue #1199](https://github.com/spikeal8-maker/asa-lab/issues/1199).
Никакого второго электрического решателя, переписывания интерфейса или
параллельной реализации. Исходный кандидат P1:
`d1327be437f22114b0053a00a8e398d564ed7b15`.
Базу и текущее состояние PR проверять заново перед работой.

**Эта карточка сама по себе НЕ выбирает P1.** До записи исходников требуется
принятая запись в `docs/execution/current.yaml` на `main`,
проверенное завершение P0B post-merge CI, сквозной preflight и handoff.

## Граница P1 (один high-risk срез)

- `contexts/electronics/domain/model-identity.ts`
- `contexts/electronics/domain/model-registry.ts`
- `contexts/electronics/domain/models/l298n-dc-model.ts`
- `contexts/electronics/domain/models/l298n-input-network.ts` — единственный принимаемый P1 модуль определения активных входов и временно высокоимпедансного Arduino. Новый непересекающийся путь позволяет сохранить `l298n-driven-inputs.ts` из P3 побайтово и только для чтения. Использовать его проверенный алгоритм как явно указанный исходный материал, а не копировать незавершённый файл без анализа. После принятого P1 последующий срез P3 должен использовать этот канонический модуль, не поддерживать две реализации.
- `contexts/electronics/domain/models/l298n-pwm-model.ts`
- `contexts/electronics/domain/arduino-circuit-scheduler.ts`
- `contexts/electronics/domain/simulation.ts`
- `contexts/electronics/testing/l298n-input-network.spec.ts`
- `contexts/electronics/testing/l298n-clock-integration.spec.ts`
- `apps/web/src/electronics/testing/l298n-domain-worker.browser.mjs`
- `contexts/electronics/domain/solver.ts`
- `contexts/electronics/testing/l298n-dc-model.spec.ts`
- `contexts/electronics/testing/l298n-integrated-solver.spec.ts`
- `contexts/electronics/testing/fixtures/model-set-golden-compatibility.ts` — только новый доказанный digest реестра с L298N и неизменные исходные контрольные данные.
- `contexts/electronics/testing/model-set-golden-compatibility.spec.ts` — negative checks и точное сопоставление old/new digests без динамического разрешения.
- `tools/public-electronics-worker-modules.json` — только три точных ID
  `contexts/electronics/domain/models/l298n-dc-model.ts`,
  `contexts/electronics/domain/models/l298n-input-network.ts` и
  `contexts/electronics/domain/models/l298n-pwm-model.ts` для фактически
  достижимых модулей публичного Worker. Сохранить все прежние ID; не менять
  checker, workflows, запреты main-thread/private modules или thresholds.
- `docs/product/electronics/generated/component-coverage.json` — только
  машинно-генерируемые P1 identity/DC-поля, не переписывать ручные данные.

В P1 входят минимальный допуск L298N в существующий Arduino clock,
единая выборка PWM для MNA и обеих проверок KCL, а также реальный
браузерный Worker-test без включения компонента в пользовательский каталог.
Эти доменные зависимости переносятся из уже существующего committed P3,
иначе требование приёмки P1 `preflight → advance` зависело бы от ещё
непринятого P3. Это один канонический clock/solver, не вторая реализация.
Новые тесты проверяют setup/high-Z, активные и плавающие входы, реальные
фронты PWM и продолжение через JSON без зависимости от границ UI-кадров.

Не входят новые P2 UI/LED/перемычки, P3 полная редакторская приёмка,
изменения CI workflows, R4 фикстуры, сервер, production, Docker, 3D или
Robotics. Сохранённые чужие P3 WIP-файлы остаются read-only. Полная
приёмка Workbench, каталога и настоящего API/БД остаётся в P2/P3.

**Shared source:** `solver.ts` исторически учитывается в
`electronics-core-fet` (#658), а `component-coverage.json` в
`electronics-reverse-led-colour` (#718). Эти задачи не закрываются
этой карточкой; требуется реальная координация source/dirty worktrees
и проверенный planned-path preflight перед записью или интеграцией.
Сохранять существующий P3 worktree с четырьмя uncommitted файлами
без перезаписи, stash, reset и force-push. Его текущая правка
`l298n-driven-inputs.ts` пока не является принятой P1.

## Обязательная физика

1. Два независимых канала A(ENA,IN1,IN2,OUT1,OUT2) и
   B(ENB,IN3,IN4,OUT3,OUT4): 00/01/10/11, EN=0/1,
   направление, brake-high/low, coast, смена направления и
   независимая моторная нагрузка. Использовать общие MNA/KCL
   и существующие модели DC/TT.
2. Питание VS/GND/логика +5 В. С 5V_EN допускается только
   обоснованная модель 78M05 при допустимом VS; без шунта
   требуется внешнее логическое питание. Запрещены бесплатный
   источник энергии, обратное питание, скрытый конфликт двух
   источников +5 В и неограниченный регулятор.
3. Управление ENA/ENB и Arduino PWM только через существующий
   физический timestamp; без React timers, усреднённого ложного
   HIGH или второго scheduler.
4. Вход, физически соединённый с **плавающей пассивной нагрузкой**,
   не считается определённым LOW/HIGH просто потому, что к нему
   подсоединён чужой terminal. Реальный активный output Arduino,
   GND, +5 В и резистивная подтяжка распознаются корректно.
   Во время выполнения `setup()` временно плавающие GPIO могут
   оставаться безопасно неактивными, но не становятся фиктивным LOW.
   До загрузки программы самый первый холодный runtime имеет
   `phase=loop` при пустых pinModes: это исключение допустимо
   только в начальном физическом кадре. После начала `setup()`
   исключение ограничено именно `phase=setup`, а после перехода
   к `loop` неизвестные входы вновь строго отвергаются.
   После `setup()/pinMode` digital output не теряется при
   переходе от preflight к фактическому clocked advance.
5. Fail-closed при недопустимом напряжении, сверхтоке,
   неизвестном входе, конфликте регулятора и несходимости.
   Не ослаблять KCL, допуски, лимиты времени или golden.

## Обязательная квалификация

- Точные контролируемые схемы A/B с реальными `dc-motor` и
  `gearmotor`, сменой направления, PWM, перегрузкой и
  обесточиванием; сравнивать токи/мощность/обратную ЭДС
  с законами цепей, а не только с UI.
- Повторяемость `JSON.stringify` для одинакового netlist/time,
  ограниченное количество итераций и неизменность незатронутых
  моделей/registry identities. Golden migrates only through
  separately reviewed exact-digest contract.
- До выпуска P1 обязателен реальный общий Arduino clock и настоящий
  браузерный Worker с двухмоторной схемой: preflight → advance →
  непрерывное продвижение физического времени, без `physical_advance_failed`.
  Нативный тест `l298n-domain-worker.browser.mjs` не подменяет решатель и
  не включает ещё не принятый UI. Native P3 на D2-R2 ранее останавливался
  при первом запуске: это нельзя скрывать успешным direct `solveCircuit`.
- Коммутация индуктивной нагрузки должна сохранять ток/энергию в принятой
  модели моста. Проверить EN=0, торможение и реверс уже вращающегося мотора,
  а не только нулевой ток резистора в стационарной таблице. PWM-fronts
  должны служить барьерами существующего физического clock, а не случайно
  считываться только через шаг 1 мс. Отдельные дефекты общей модели
  вибромотора/отключённого лабораторного БП по #1230 не скрывать и не
  исправлять расширением этого L298N-среза на чужие моторные профили.
- Focused Vitest + uncached electronics type/build, target
  ESLint/Prettier/hygiene, required exact-SHA GitHub General;
  строгий R4 классифицировать по явным A/B/C/D/E причинам.
  Не ослаблять существующие тесты и thresholds ради зелёного статуса.
- Publication run `44339573232` на кандидате
  `1963c25ebddac301b8d3fc0db71229dcd8c18e53` выявил прямую
  зависимость P1 (категория B): emitted graph отвергает новый
  `l298n-dc-model.ts`. До source integration добавить только три
  перечисленных L298N ID в канонический список и получить фактический
  `node tools/public-electronics-emitted-graph.mjs` PASS на exact build
  с capture metadata, затем успешный exact-SHA Publication workflow
  через существующий `pnpm gate:projects-publication` и новый независимый
  review. Локальная проверка только графа не заменяет полный PostgreSQL gate.
- Независимый HIGH-RISK source/physics review **нового exact SHA**,
  затем только разрешённый merge существующего #1209 и
  post-merge checks. Нельзя принимать собственное ревью автора
  как независимое GitHub APPROVE.

## Граница результата

P1 может опубликовать проверенную доменную модель в `main`,
но **не включает L298N в каталог пользователя** и не является
самостоятельной полной приёмкой #1199. P2 (перемычки/LED/editor)
и P3 (Arduino clock/постоянство и реальная браузерная приёмка)
выбираются контроллером отдельно после принятого P1.

**Пока нет canonical selection и успешной P0B post-merge проверки:**
`NEXT_ALLOWED_TASK = PREPARATORY_DOCS_ONLY / NO_PRODUCT_WRITE / NO_MERGE`.
