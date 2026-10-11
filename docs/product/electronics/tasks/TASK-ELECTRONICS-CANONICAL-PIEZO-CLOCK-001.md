---
task_id: TASK-ELECTRONICS-CANONICAL-PIEZO-CLOCK-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Preserve the stopped unpublished audio startup candidate and existing canonical runtime contract.
acceptance_boundary: slice
review: independent
---

# E12/E14: сопряжение существующей piezo-модели с canonical clock

Ограниченный [ремонт №553](https://github.com/spikeal8-maker/asa-lab/issues/553), программа №452. Это подтверждённая зависимость полного native tone/PCM journey №552; audio-startup diff не включать в этот ремонт. Первичный компонент electronics.clock.canonical, components/engine-worker-clock.yaml. Высокий риск временного сопряжения; требуется новый независимый review точного финального SHA. Layout impact: none.

## Пользовательский результат и доказанная причина

Настоящая схема с одной из двух установленных пьезодеталей должна запускаться, исполнять tone/noTone и прекращать звук после Stop, сохраняя проект. Обе identity сейчас дают piezo-transducer, отсутствующий в clockedComponent. Сохранённый настоящий controller/evaluator: solved/finite/quality PASS preflight → advance requested=committed H0 fault/result:null/clocked_profile_unsupported → stopped/0 Save. Это подтверждённый локальный механизм, не доказанная частота школьных инцидентов. Исходники и независимая классификация: [зафиксированная зависимость](../evidence/piezo-clock-553-prerequisite.md).

## Вход и контракт модели

Прочитать START_HERE.md, COMPONENT_MAP.yaml, components/engine-worker-clock.yaml, contracts/CANONICAL_CLOCK_CONTRACT.md, README MATH-8A и раздел Arduino, AGENT_GUIDE sections2,5,6,11,12,13. Перед записью: pnpm agent:preflight --scope electronics-arduino --check и pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-CANONICAL-PIEZO-CLOCK-001. Сначала фактические GitHub/main/current/CI и dirty-path проверки; сохранить чужую работу.

Использовать существующий canonical electronics-arduino lane: scheduler уже входит в его scope. Полные task/revisions кандидата №546 и остальные suspended tasks сохраняются. Справочный owned_paths не меняет точный бюджет ниже; перед каждой записью проверить фактические dirty paths, включая общие package/workflow.

Существующая утверждённая модель: passive DC leakage100МОм, active2300Hz/15мА при5В/диапазон3–12В, звук только от подтверждённого сигнала. Переиспользовать waveform runtime и held solver. Новая capacitance/резонанс, произвольное AC recognition, другие частоты/сопротивления/допуски, будущий speaker и новая несовместимая state/schema версия не разрешены этим срезом.

## Точный бюджет записи

- contexts/electronics/domain/arduino-circuit-scheduler.ts — единственный product source.
- contexts/electronics/testing/canonical-piezo-clock.spec.ts — новый направленный conformance.
- apps/web/src/electronics/testing/simulation-worker-piezo.spec.ts — новый настоящий evaluator/controller regression.
- e2e/electronics-piezo-clock.spec.ts — новый построенный браузерный pupil journey.
- docs/product/electronics/components/engine-worker-clock.yaml — только additive exact test mappings.
- package.json — добавить новый browser файл к двум существующим Electronics scripts.
- .github/workflows/electronics-r4-m1-focused.yml — только additive browser path filter.

Audio hook, solver/model identities/параметры, engine/Worker protocol, существующие тесты, schema, quantum/budget, lock/dependencies, digest и owner artwork не менять. Если нужен другой product путь — STOP расширения и координация с контроллером. Исполнитель не меняет current/card и не публикует код.

## Реализация и необходимые проверки

1. Узко допустить настоящую установленную supported piezo-модель в canonical clock. Не включать её автоматически в ELECTROTHERMAL_MODELS: модель алгебраическая и не имеет своей накопленной интеграционной динамики. Unknown/unsupported остаются fail-closed; отрицательный тест kind=visual/piezo-disc не переписывать как настоящую piezo-модель.
2. Проверить конкретную гипотезу DC cache: пять+ быстрых настоящих digitalWrite edges, затем прекращение переключений. Existing sound inference зависит от возраста edges относительно observation H. Сначала направленный counterexample, только при подтверждении — узкий time-sensitive observation/cache guard. Никаких выдуманных edges, второго генератора или продвижения физики по UI cadence.
3. Обе owner identity × active/passive; active частота/current/power/polarity/voltage diagnostics сохраняются. Passive tone1000, постоянный HIGH и медленный Blink silent, duration/noTone и два независимых источника проверяются по настоящим timestamp/events/GPIO/finite KCL/quality. Не требовать tone в первом ready H0 до исполнения инструкции.
4. JSON continuation, разные промежуточные горизонты, перестановка topology и maxEvents=1 против штатного budget дают одинаковый normalized ready result/state на одном H. Yielded result/observation=null, ready C=H. Сохранить state Arduino/loadedSource/variables/Serial/tones, конденсаторов/нагрева/повреждений/моторов/предохранителей на ограниченном существующем mixed-physics fixture; сохранить live-input и Stop/newStart контракты. Не снижать точность/не менять quantum/budget/timeout.
5. Настоящий controller/evaluator BEFORE конкретный unsupported/null, AFTER полный ready. Одинаковые fixed-dependency built browser fixtures BEFORE/AFTER: исходная active схема и UNO tone(8,1000) с каждым passive owner-корпусом, реальный Run/ready/продуктовый audio graph, noTone/Stop. Параллельный пассивный native analyser, исходный PCM/sampleRate/context progression и независимое измерение частоты/энергии; original destination сохраняется. Без fake Audio/Worker/results, autoplay flags, getters или постороннего oscillator. Headless PCM не означает школьную слышимость.
6. Runtime не делает PUT. Один разрешённый pupil edit, один explicit whole Save/CAS revision+1 и cookies-only fresh reopen сохраняют документ/провода/параметры/Arduino source/state/authorization. На PASS/FAIL сохранить raw requests/responses/whole documents/trace/nativePNG/PCM, включая последний завершённый checkpoint при отказе; неполное evidence не считать приёмкой.

## Gate, review и STOP

Один неопубликованный bounded SHA, narrow format/lint/types/discovery/card, meaningful focused tests, self-review/whole foreign-tree proof/original hashmanifest, затем STOP исполнителя. Полные pnpm gate:electronics-m1, pnpm gate:electronics-m1:browser и pnpm gate:repository на финальном exact source в CI с NX_SKIP_NX_CACHE=true и fresh Nx counts. Windows corepack.cmd EINVAL известен как инфраструктурный отказ; не чинить его в этом срезе и не повторять неизменный полный gate без новой причины. Известный независимый №548 не чинить здесь и не обходить для зелёного общего gate.

Контроллер проверяет фактический source/evidence; новый независимый reviewer проверяет финальный SHA/GitHub и пользовательский journey. Whitelist diff, source-ready, авторский отчёт и старые проверки не принимают продукт. Сохранить №552 и остальные кандидаты, два pending conflict decisions №525/№546 и hygiene count. Школу/сервер/БД/сеть/backups не менять. T3/класс/K0/owner acceptance остаются отдельно pending. NEXT_ALLOWED_TASK: STOP.
