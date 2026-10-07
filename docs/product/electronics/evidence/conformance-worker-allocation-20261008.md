# #523: ограничение workers в Electronics conformance suite

Дата: 2026-10-08 Europe/Moscow. Датированное evidence выбранного среза;
execution state читается только из `docs/execution/current.yaml`.

В одном CI job сравнивались исходный full contexts suite с default allocation
и идентичный suite с `--maxWorkers=1`. Default завершился с исходным timeout
Arduino case; single-worker завершил все 633 проверки в 42 файлах. Прямо
измеренное ожидание основного потока в runnable queue уменьшилось с
1401.777 до 0.245 мс. Это обосновывает ограниченный runner maintenance,
сохраняющий физику, семантические проверки и исходный 5000 мс guard.

Это не доказывает единственную причину исторического отказа #517, будущий
гарантированный runtime или частоту проблемы на школьных устройствах.

## Граница

Карточка `TASK-ELECTRONICS-CONFORMANCE-WORKER-ALLOCATION-001`, Issue #523,
выбрана на main `ff5051e5e8bf0a322039c4674e59b45301f714db`; prerequisite —
независимо принятый [matching CI report #522](conformance-ci-diagnosis-522-20261008.md).
Preflight SAFE_TO_START: 0 dirty paths/blockers/overlaps, control-plane PASS;
selected-card validation 84/84 PASS. Component `electronics.engine.public-api`,
maintenance, medium, semantic change no.

Временная проба меняла только существующий complete-state conformance test
и существующий Electronics workflow. Финальный candidate восстанавливает
эти два файла byte-exact; постоянное изменение разрешено только в существующем
`package.json` script `test:electronics`, плюс этот отчёт. Vitest config,
остальные scripts, зависимости/lockfile, общий workflow и production не меняются.

## Единственная matched pair и provenance

TEMP branch `codex/electronics-conformance-worker-probe-523`, exact executed SHA
**`af726c6d6ea217545c8b022180a1675b8dd2475d`**;
[run 37693429149](https://github.com/spikeal8-maker/asa-lab/actions/runs/37693429149),
job `113039025020`, 2026-10-07 22:01–22:03 UTC.

В одном job последовательно выполнены:

```bash
pnpm test:electronics
pnpm test:electronics --maxWorkers=1
```

Обе команды охватывают один полный `contexts/electronics/testing` suite.
Исходный passive probe #522 использован с исправленным временным ESLint
no-unused-expressions calibration (`void` сохраняет вычисление), без изменения
измеряемой нагрузки/fixtures. Сам test body и flush остаются внутри original
guard; no beforeAll bypass. SDK готовился исходной командой
`corepack pnpm nx build module-sdk`: **1 fresh Nx task**, `Cache: Skipped
(--skip-nx-cache)`; literal `NX_SKIP_NX_CACHE=true`, `CI=true`.
Оба прямых Vitest этапа выполняют 0 Nx tasks.
Прямые Vitest этапы не являются focused/general gates.

До dispatch сохранён оригинальный source archive, не реконструкция:
`C:/Users/spike/.codex/temp/electronics-523/probe-af726c6d/executed-source.zip`,
SHA-256 `0fc73de8013ea54aafdd6c1aa8da85b505d32ab69ce22d8d9db0516e952c5637`.
Actual patch SHA-256
`e20107bd3f1c0fe594aad09ab42cf124d52fd1eefd578a38073f1796eaae9aaa`.
Пять source files (test, workflow, config, manifest, lock) и exact diff ff5051→af726
независимо сверены controller до dispatch.

Original GitHub artifact
[11514830241](https://github.com/spikeal8-maker/asa-lab/actions/runs/37693429149/artifacts/11514830241),
`electronics-523-matching-ci-37693429149`, 155720 bytes, retention 30 дней.
ZIP SHA-256 совпал с API digest:
`e01137258e610196b59053c5ee0dcfca0ea58590ae5507b4bfcb4f5f170a78fc`.
Original ZIP, metadata и raw находятся в
`C:/Users/spike/.codex/temp/electronics-523/run-37693429149/`.
Все SHA256SUMS, source blobs и executed.patch сверены с exact Git SHA.
Единственный original job log дополнительно сохранён для отсутствующего в
artifact SDK preparation output: `job-113039025020.log`, SHA-256
`ba121d209bb8c40a0347430e3997cd30f22651cd3ee8aefb84fab09e79a542e9`.

| Original raw         | SHA-256                                                          |
| -------------------- | ---------------------------------------------------------------- |
| default-profile.json | e0a66c1149d5c1ed45663560a7ed3dc69c675cae1ee969e5f55bdaec6b562e93 |
| single-profile.json  | 0ac27d3c263fb996ad376302da26784b1ae33aaf42722081986a485ef131a6d9 |
| default-runner.json  | 8586577271f26d7856665ee87dad853667b4b340d1c28ce66f796750766d3a36 |
| single-runner.json   | 307f3964176402b80a6d24ff66e872272b7d3e6a9fcd513549cd989ed420a995 |
| default.log          | d65856b25cda9f1581fdb0fa56a7f456d4e11f95809c7f80e3ea215e20202559 |
| single.log           | adf89d9abad78baa83eddce060d0c04495139aeeb4af774581d2403bd8fb422b |
| environment.json     | 2ebde5d89a52fe5f9698a675fe54b3fe52495f34414f36be755c6dafa2d89953 |
| runner.mjs           | 3730fc01c1664534b2a3a8f65fcbe8a6578c96b8af3554b4892714ed8835479d |

## Среда и измеренный эффект

Ubuntu 24.04, kernel 6.17.0-1022-azure, Node v22.23.3,
pnpm 9.15.9, installed/checked Vitest 4.1.11, frozen lockfile.
Обе стадии одной VM: AMD EPYC 7763 host name, 4 logical CPUs,
2 cores × 2 threads; availableParallelism=4, cpuset/affinity 0–3.
CPU model отличается от #522 EPYC 9V45: между этими runs hardware match
не заявляется. Recorded cpu.max недоступен (null), quota неизвестна;
cgroup membership/mounts сохранены, recorded throttled counters 0.
Это не исключает host/hypervisor contention.

| Метрика                                 |          Default |   maxWorkers=1 |
| --------------------------------------- | ---------------: | -------------: |
| Raw exit / outcome                      |      1 / failure |    0 / success |
| Suite                                   |   632/633, 41/42 | 633/633, 42/42 |
| Named Arduino Vitest case               | 5206 мс, timeout |  2430 мс, PASS |
| Profile body wall                       |      5194.201 мс |    2429.196 мс |
| Main-thread running (schedstat delta)   |      3699.547 мс |    2424.525 мс |
| Main-thread runnable queue wait         |      1401.777 мс |       0.245 мс |
| Aggregate process CPU, all threads      |      6953.092 мс |    4681.697 мс |
| Observed worker entrypoints during body |                3 |              1 |
| External body samples (250 мс)          |               20 |              9 |
| Full suite wall                         |          31.52 с |        42.89 с |

Workflow conclusion SUCCESS означает сохранение диагностики:
`continue-on-error` сохраняет pipeline; outcomes.txt явно `default=failure`,
`single=success`. Default не считается PASS, даже хотя probe сообщил
`assertions-completed`: Vitest зарегистрировал превышение прежнего 5000 мс.

Обе стадии: **10 одинаковых public advance calls**, reference 2 × 1024,
chunked 8 × 256; 5 ready + 5 yielded, requested targets
`[0,500000,1000000,1100000]`, final committed/canonical horizon 1100000 us,
Arduino virtual time 1100 мс. Full state/observation/diagnostics semantic JSON
по 10037 символов совпал; clockProfile instruction-us-v1 и physical thermal
assertions выполнены. Yield sequences одинаковы: reference `[908000]`,
chunked `[226000,454000,726000,955000]`. Неполный yielded не стал ready.

Reference replay wall: 2809.221→1308.780 мс; chunked: 2383.893→1119.696 мс.
Полные per-call requested/previousCommitted/committed/status/budget/wall/CPU
и phases сохранены в original profiles, не заменены агрегатами отчёта.
Physics step 1 мс, все остальные fixtures/trace/full equality/physical
assertions, 1100000 us horizon, budgets и исходный guard не изменялись.

## Интерпретация и ограничения

Наблюдение подтверждает вклад одновременно выполняемых test workers в
текущем default CI run: recorded runnable wait, 3 worker entrypoints и failure;
single имеет 1 worker, почти нулевой recorded runnable wait и полный PASS
при прежнем guard. Permanent cap ограничивает конкуренцию именно Electronics
contexts suite во всех вызовах существующего script.

Own main-thread running и aggregate CPU тоже уменьшились. Разность wall
не объясняется целиком runqueue; GC паузы не измерялись и их причина не заявляется.
Default→single порядок не counterbalanced: отдельные Vitest процессы дают
отдельный JIT, но файловые caches/предыстория/порядок файлов и изменяющаяся
нагрузка host остаются confounders. Проба/sampler добавляют work, не вычитают
bookkeeping/flush и short-lived процессы могут быть пропущены. Это одна пара,
не статистическая гарантия и не доказательство sole historical cause.

Полный suite single прошёл медленнее по wall (42.89 против 31.52 с): уменьшение
параллелизма имеет throughput tradeoff. Ни timeout, ни precision/coverage
для выигрыша не менялись. Единственная пара закончена; повторов/третьего
timing experiment и local stale Vitest 3.2.7 измерений не проводилось.

T3 остаётся pending owner device evidence на реальном ученическом компьютере.
Dev-PC/CI runner не заменяют школьный benchmark; школьная частота неизвестна.
Первый школьный замер фиксирует CPU/RAM/OS+version/browser+version/экран/питание,
тот же production большой макетки scenario и DOM/long tasks/drag latency;
этот компьютер станет эталоном до явного изменения владельцем.

## Финальный candidate и проверка

Постоянная правка — только `test:electronics`:

```text
vitest run contexts/electronics/testing --maxWorkers=1
```

Temporary conformance/workflow восстановлены byte-exact к baseline.
Production, shared Vitest config, lock/dependencies, general workflow,
другие scripts, #517 product/test candidate, #516 и #505/PR #506 не меняются.
No protected asset, live Docker/БД/network/deployment operation.

Парный run является диагностикой. Приёмка exact final SHA отдельно требует
исходных `pnpm gate:electronics-m1` и `pnpm gate:repository` в существующем
изолированном CI с literal NX_SKIP_NX_CACHE=true и фактическими fresh Nx counts,
self-review и NEW independent exact-head review. Этот документ не объявляет
эти ещё отдельные результаты PASS и не закрывает #521/#517/#516/#505.
Browser для runner-only maintenance не является обязательным отдельным run;
#517 сохраняет свои full browser/focused/general требования.

NEXT_ALLOWED_TASK: STOP / NEW INDEPENDENT REVIEW.
