# #522: complete-state conformance на matching CI runner

Дата: 2026-10-08 Europe/Moscow. Это evidence выбранного диагностического среза,
не источник execution state и не продуктовая приёмка.

**В текущем CI suite измерен вклад конкуренции за CPU. Историческая причина
5234 мс не доказана; дефект harness/product и repair не установлены.**
Итоговый candidate содержит только этот отчёт; временные тест и workflow
восстановлены. #521 остаётся unresolved, требования к #517 не снимаются.

## Граница и исходный failure

Карточка `TASK-ELECTRONICS-CONFORMANCE-CI-DIAGNOSIS-001` выбрана на `main`
`04b653e7f884d50b30906e786e00d9f3e9bce680`. Исполнитель подтвердил её
`in_progress`, чистое дерево и selected-card validation: 84/84, PASS.
Scope: analysis/inventory, medium, semantic change no;
component `electronics.engine.public-api`, ASA ownership; prerequisite —
independent evidence-only review отчёта #521 `38ca0bcb`.
Временные write paths: существующие conformance test и Electronics workflow;
финальный write path: только этот отчёт. После self-review — STOP / NEW REVIEW.

Исходный #517 SHA `2d4654f207f41e5d3712b3071af05e6d3830fa31`, focused
[run 37680023310](https://github.com/spikeal8-maker/asa-lab/actions/runs/37680023310),
job `112993343304`: named Arduino case 5234 мс при default guard 5000 мс,
632/633 успешны, numerical/state mismatch не зарегистрирован.
Conformance test Git blob `0ddfdee1e5c20c82a422266e92b80697dc81ae9d`
одинаков на этом SHA и исходной базе #522. Локальный #521 с Vitest 3.2.7
не является matching CI evidence: см. [его ограничения](conformance-runtime-521-20261007.md).

Не менялись fixtures, Arduino horizon 1 100 000 us, reference budget 1024,
chunked budget 256, event traces, полный semantic JSON, physical assertions,
default 5000 мс guard и физический шаг 1 мс. Весь исходный body остался внутри
своего test callback. Production engine, `vitest.config.ts`, зависимости,
общий workflow, live Docker/БД, deployment и owner assets не изменялись.

## Выполненный эксперимент и provenance

Временная ветка `codex/electronics-conformance-ci-probe-522`, exact executed
SHA **`b98000b66fadd30237ab07b5090af8d1b0a9be7e`**. Один dispatch;
[run 37688305656](https://github.com/spikeal8-maker/asa-lab/actions/runs/37688305656),
job `113021716753`, 2026-10-07 21:17 UTC / 2026-10-08 00:17 Moscow.
Runner выполнял два этапа последовательно в одном job:

```bash
pnpm exec vitest run contexts/electronics/testing/engine-trace-replay.spec.ts -t 'observation-arduino-led: preserves full state and result through bounded complete horizons'
pnpm test:electronics
```

Это диагностические unit commands, не `gate:electronics-m1` или browser gate.
Исходный `test:electronics` = `vitest run contexts/electronics/testing`;
coverage suite сохранён. Module SDK подготовлен исходной командой
`corepack pnpm nx build module-sdk`: **1 свежая задача**, Nx сообщает
`Cache: Skipped (--skip-nx-cache)`. Для обоих Vitest этапов задач Nx 0.
`NX_SKIP_NX_CACHE` буквально `true`, `CI=true`.

Actual source/patch сохранены **до dispatch**, затем независимо сверены
с CI artifact. Локальный pre-execution ZIP:
`C:/Users/spike/.codex/temp/electronics-522/probe-b98000b6/executed-source.zip`,
SHA-256 `4797cd0b7d7f60003b39289ce9ddd97f10322003356b27c533eba6bf26a34126`.
Patch SHA-256 `97d50d13341ab618dcb01b45c4525f52019618b3709d89051c075a1b5bfd08ff`.
Это оригиналы, не последующая реконструкция.

GitHub original artifact
[11511064962](https://github.com/spikeal8-maker/asa-lab/actions/runs/37688305656/artifacts/11511064962),
`electronics-522-matching-ci-37688305656`, 130960 bytes, retention 30 дней.
API metadata связывает artifact с exact b980 SHA и run.
ZIP SHA-256 совпал с GitHub digest:
`38138ca01c9e985251081687e7e6ff79ba3fd104dd28eaec46f8d6c29bb10935`.
Оригинальный ZIP, metadata и распакованные raw сохранены в
`C:/Users/spike/.codex/temp/electronics-522/run-37688305656/`.
Все строки artifact `SHA256SUMS` проверены. Пять `source/` файлов
(test, workflow, Vitest config, manifest, lock) byte-exact соответствуют
Git blobs b980; `executed.patch` byte-exact соответствует diff 04b → b980.

| Original raw файл           | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `alone-profile.json`        | `f0a8bdef97d0841095c6c343e8618412eafc99f0eeed5c0f43d1ffa563590d2e` |
| `suite-profile.json`        | `9d1c75bf121c16020eb10b244df15c2fab2636b550b4973936380a5f3242574f` |
| `alone-runner.json`         | `1bf8a24e01b33dec150495bb4b9d8a9d1fb53888c22df0c7e29f077b6e143d48` |
| `suite-runner.json`         | `1268170d7cdd8fb4cd740255658511e236d417de8eba7cc6ac55a5c617ec1bf9` |
| `alone.log`                 | `e053265c763484a2d07b72cb5656982bc3c91af0a492b253026b42df00b12f60` |
| `suite.log`                 | `24458b0d726beadaad0f16623c532e16a444387cd879c573b9446f94089f3637` |
| `environment.json`          | `a6be4b7ebb93e5ba9340aa7ea4f510e8a082516d8030cbe2837aadf8814a9eac` |
| actual sampler `runner.mjs` | `9dc163fd9015341af33f08cf9d0a8421816c02a013e707da230b790340eff2e7` |

Actual instrumented test SHA-256
`b4313edbc47239cbed2579024bc17613a3236f499f4a0968698486ac9621bcdb`;
actual workflow SHA-256
`8bb171080411cef3c803eab19b0bac9fa5550856cb53cd47d079673ab852a7e8`.
Единственный full job log дополнительно сохранён для отсутствовавшего в artifact
Nx preparation evidence, SHA-256
`65cc6f77d1f2117eb37cddd1bcc9f703aa159fee9ad934a16942fb4dc933523f`;
повторных загрузок/повторных timing runs не было.

## Среда и workers

Ubuntu 24.04 runner, x64, kernel `6.17.0-1022-azure`; Node **v22.23.3**,
pnpm **9.15.9**, actual Vitest **4.1.11**, install `--frozen-lockfile`.
Версия Vitest проверена установленным package metadata и RUN banner;
локальные dependencies не устанавливались и не измерялись повторно.
Matching означает runner label и заданный software/lock contract;
CPU model/quota исторического run не сохранены и не считаются совпавшими.

AMD EPYC 9V45 96-Core Processor — название host CPU; предоставлено **4 logical
CPUs**, `lscpu`: 2 cores × 2 threads. Node availableParallelism 4,
affinity/cpuset `0-3`. Total memory 16 766 414 848 bytes.
`cpu.max` по записанному cgroup path недоступен (`null`), поэтому quota неизвестна;
записанные `nr_throttled` и `throttled_usec` равны 0.
Это не исключает конкуренцию или гипервизорные ограничения.

CLI worker overrides отсутствовали; original `vitest.config.ts` не задаёт pool,
maxWorkers или timeout. Наблюдаемый internal worker config содержит
`pool=forks`, `testTimeout=5000`; поля maxWorkers/minWorkers/fileParallelism
в сериализованном worker config отсутствуют. Installed Vitest source snippet
`installed-worker-config-source.txt` показывает non-watch default
`max(availableParallelism - 1, 1)`: **derived cap 3**, а не значение,
непосредственно прочитанное из worker config.

External sampler каждые 250 мс записывал PID/PPID/name, CPU ticks, threads,
RSS pages, schedstat и признаки Vitest/worker entrypoint, без commandline или
environment dump. Named case PID `2490` отдельно / `2555` в suite совпадает
с worker-entry-tagged PID. В окне отдельно 5 samples и один такой процесс;
в suite 12 samples и до трёх одновременно, два peer процесса с растущими CPU
counters. Peers менялись: `2552,2553,2575,2582,2590`.
Общее число Node/Vitest-tagged процессов включает CLI и не равно worker count.
У named PID 7 threads; threads не считаются независимыми Vitest workers.

## Результаты исходных этапов

Оба raw runner exitCode **0**, оба step outcomes **success**.
Vitest отдельно: 1 passed / 15 skipped, named case **1385 мс**;
suite: **633/633**, **42/42** файлов, named case **3212 мс**, duration 17.23 с.
Profile `assertions-completed` само по себе не является Vitest PASS: здесь
PASS подтверждают exit codes и оригинальные логи. Workflow SUCCESS при
`continue-on-error` тоже не заменяет outcomes этапов.

| Фаза                                                      | Alone wall, мс | Suite wall, мс | Alone process CPU, мс | Suite process CPU, мс |
| --------------------------------------------------------- | -------------: | -------------: | --------------------: | --------------------: |
| Reference replay, 1024                                    |        814.705 |       1755.846 |              1471.147 |              2049.327 |
| Chunked replay, 256                                       |        567.788 |       1454.446 |              1109.173 |              1568.598 |
| Serialize chunked full semantic payload                   |          0.116 |          0.054 |                 0.113 |                 0.050 |
| Serialize reference full semantic payload                 |          0.034 |          0.042 |                 0.031 |                 0.039 |
| Full equality                                             |          0.028 |          0.027 |                 0.025 |                 0.024 |
| Canonical parse + physical assertions + details buffering |          0.341 |          0.223 |                 0.336 |                 0.218 |
| Measured body before final resource snapshot/flush        |       1383.223 |       3210.885 |              2581.058 |              3618.540 |

Public advance calls совпадают по requested/committed horizons, budgets и statuses
в обоих этапах; logical delta = committed − previous committed, не wall time.

| Replay/budget    | Requested us | Status  | Committed us | Delta us | Alone wall, мс | Suite wall, мс |
| ---------------- | -----------: | ------- | -----------: | -------: | -------------: | -------------: |
| Reference / 1024 |      1100000 | yielded |       908000 |   908000 |        688.607 |       1462.360 |
| Reference / 1024 |      1100000 | ready   |      1100000 |   192000 |        125.536 |        293.244 |
| Chunked / 256    |            0 | ready   |            0 |        0 |          2.467 |          2.815 |
| Chunked / 256    |       500000 | yielded |       226000 |   226000 |        136.884 |        342.456 |
| Chunked / 256    |       500000 | yielded |       454000 |   228000 |        118.203 |        341.347 |
| Chunked / 256    |       500000 | ready   |       500000 |    46000 |         21.297 |         70.589 |
| Chunked / 256    |      1000000 | yielded |       726000 |   226000 |        119.086 |        264.607 |
| Chunked / 256    |      1000000 | yielded |       955000 |   229000 |        107.379 |        269.002 |
| Chunked / 256    |      1000000 | ready   |      1000000 |    45000 |         17.863 |         41.346 |
| Chunked / 256    |      1100000 | ready   |      1100000 |   100000 |         44.158 |        121.776 |

Reference 2 calls: 1 yielded + 1 ready; chunked 8 calls: 4 yielded + 4 ready,
targets `[0,500000,1000000,1100000]`. Оба payload имеют 10037 characters,
полное equality прошло. Final result **ready**, committed/canonical reached
**1100000 us**, Arduino virtualTimeMs **1100**. Yield не трактуется как ready.
Per-call user/system CPU, continuation lengths и counters сохранены в raw profiles.

## Измеренный вклад планировщика и предел вывода

| Named process / main thread                             |                Alone |                 Suite |
| ------------------------------------------------------- | -------------------: | --------------------: |
| Main thread scheduled run, delta schedstat, мс          |             1367.943 |              1940.688 |
| Main thread runqueue wait, delta schedstat, мс          |                6.457 |              1215.718 |
| Main thread nonvoluntary context switches, delta status |                   14 |                  1066 |
| Aggregate process involuntary context switches          |                  215 |                  1847 |
| RSS before → after, bytes                               | 85737472 → 143122432 | 169996288 → 170921984 |
| Heap used delta, bytes                                  |             21022672 |              11390496 |
| New minor / major faults                                |            46269 / 0 |             20389 / 0 |

В suite case исполнил те же 10 public calls при двух конкурирующих worker
entrypoints; main thread непосредственно провёл 1215.718 мс runnable в очереди.
Это измеренный contributor текущего wall time, согласованный с увеличением
context switches и внешними samples. Это сильнее предположения по одному CPU/wall
отношению. Однако aggregate CPU тоже вырос с 2581.058 до 3618.540 мс:
все 1827.662 мс разницы wall нельзя приписать только очереди CPU.

Замер локализует почти всё наблюдаемое время в replay/public advance calls;
внешние serialization/equality/assertions вместе меньше 1 мс. Внутренняя работа
engine, JIT/background threads, internal serialization и GC внутри calls здесь
не разделены. Не найден избыточный replay, который можно удалить, сохранив
partition conformance. Физический horizon/quantum и бюджеты менять необоснованно.

CPU измерен `process.cpuUsage()` и агрегирует все threads процесса; CPU может
превышать wall. Schedstat относится к основному Linux thread, resourceUsage
context switches — ко всему процессу: эти counters не взаимозаменяемы.
GC pauses не измерялись; heap/RSS/fault counters не доказывают отсутствие GC.
Mem pressure/swapping cause не установлена.

Probe overhead не вычитался. 20 пустых пар counters заняли 0.074 / 0.096 мс —
только нижняя оценка части overhead. Initial resource reads и final snapshot/JSON
flush находятся внутри test guard, но вне measured body; phase/call counters
вложены и их CPU нельзя суммировать повторно. External sampler тоже потребляет
CPU и имеет разрешение 250 мс; короткие процессы/паузы могут быть пропущены.
Окна resource/schedstat snapshots окружают measured body и включают часть reads;
они не тождественны окнам phase/call timers.
Main-thread runqueue wait не определяет, какой именно peer/thread или host load
его вызвал. Stage order фиксирован, suite имеет другую preceding workload/JIT
историю; количественный эффект одного worker cap причинно не изолирован.

Временный push также запустил general CI
[37687932410](https://github.com/spikeal8-maker/asa-lab/actions/runs/37687932410):
governance PASS, code FAIL, data/browser skipped. Failure категории A находится
в самом временном probe: standalone counter-calibration expression на строке 63
нарушает `@typescript-eslint/no-unused-expressions`. Он сохранён в executed source;
raw timing подтверждён отдельно, а этот SHA не является кандидатом продукта или
PASS general gate. Failed-step log сохранён один раз; зелёный rerun временного
probe не выполнялся. Восстановление accepted test удаляет эту временную ошибку.

## Продолжение и восстановление

Исторический run 37680023310 не имел этих counters; его 5234 мс не
воспроизведены и не объяснены однозначно. Текущий PASS не доказывает устранение
его причины. **Продуктовый или harness repair candidate не создан.**
Узкая область возможного следующего исследования — test-runner resource
allocation. Перед постоянным изменением нужен отдельно выбранный bounded scope:
default и lower-worker controls в **одном matching CI job**, все исходные
fixtures/assertions/guard/coverage сохранены, сравнение wall/runqueue/CPU и
запись confounders. Такой task здесь не активируется.

Третий comparison не выполнялся: первый job завершился, а второй VM с другим cap
добавил бы host/order confound. Controller подтвердил report-only outcome.
Повторные suite/full/browser/benchmark запуски ради случайного PASS не делались.

После сохранения и проверки original artifact исполнитель переключился с чистой
probe ветки на report ветку и выполнил одну final fast-forward convergence
с `7d53b25f35a13bdb812c777627770ea226baf957` (независимый Portal CSS commit).
Fresh preflight: SAFE_TO_START, dirty paths/overlaps/blockers 0, control-plane PASS.
General run базы 7d53 `37687828212` завершился независимым Portal layout FAIL
(категория C, Access UI step 13, job `113022317016`). Контроллер отдельно
проверил Portal baseline repair `9f93d884a32ec7399a3ff6d475b5bef9bff364c3`
и разрешил один controlled repeat convergence перед report general CI.
Он выполнен fast-forward, own report byte-preserved; четыре Portal paths
не пересекаются со срезом. Это последняя convergence; дальнейшее независимое
движение main не преследуется. Финальный candidate diff против 9f93 — один отчёт.
Temporary test восстановлен в Git blob
`0ddfdee1e5c20c82a422266e92b80697dc81ae9d`; workflow —
`21d10e90a8f2d2e15583d2062c2745fa2531359b`, одинаковые на 04b, 7d53 и 9f93.
Production/test/workflow diff против accepted baseline отсутствует.
Новые тесты, dependency/config edits и execution state edits в candidate отсутствуют.

Локальная проверка report scope: `pnpm gate:governance` PASS (включая remote
`control-plane --require-github`), отдельный `pnpm control-plane:check` PASS,
selected-card validator PASS, explicit Prettier check отчёта PASS
(`--ignore-path .gitignore`, поскольку Markdown исключён из code format gate),
`git diff --check` PASS. Эти проверки не заменяют exact-final-report general CI.

`SELF_REVIEW: PASS_WITH_RISK` для evidence/report scope: original provenance
проверен, вывод ограничен данными, residual risk — historical cause unresolved,
worker-cap effect и GC не изолированы. Independent review и exact-final-report
general CI остаются отдельными обязательными acceptance evidence контроллера;
их результат и report SHA не заявляются этим самоссылочным текстом.

T3 pending реального classroom device по
[owner decision #465](https://github.com/spikeal8-maker/asa-lab/issues/465#issuecomment-6046276634).
CI не заменяет это evidence. #521 не закрывается; #517 сохраняет focused,
full-browser/general требования и NEW review; #516/#505/PR #506 сохраняются.
Owner acceptance, release, deployment, live data actions не выполнялись.

`NEXT_ALLOWED_TASK: STOP / OWNER REVIEW`.
