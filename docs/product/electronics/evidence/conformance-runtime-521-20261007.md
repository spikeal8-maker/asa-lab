# #521: направленный замер complete-state conformance

Дата: 2026-10-07. Это evidence выбранного среза, не источник execution state.
База замера: `4e219d105ab4e10cbeb850efbe7742b941a9a1be`, ветка
`codex/electronics-conformance-runtime-521`.

**Результат: причина исторического CI timeout не доказана; harness repair не
обоснован. NO PRODUCT REPAIR / NO ACCEPTANCE / STOP.** Итоговый diff содержит
только этот отчёт. Тестовый файл восстановлен без изменений; probes удалены.

## Подтверждённый исходный failure

На #517 SHA `2d4654f207f41e5d3712b3071af05e6d3830fa31` focused run
[37680023310](https://github.com/spikeal8-maker/asa-lab/actions/runs/37680023310),
job `112993343304`, сообщил 5234 мс против существующих 5000 мс для
`observation-arduino-led: preserves full state and result through bounded complete horizons`
в `contexts/electronics/testing/engine-trace-replay.spec.ts:468`.
632/633 cases прошли; state/numerical mismatch не зарегистрирован.
Это категория C относительно #517: его diff не изменял этот conformance source.
Его general run
[37680001869](https://github.com/spikeal8-maker/asa-lab/actions/runs/37680001869)
имеет SUCCESS. Сам timeout не устанавливает причину.

## Один локальный направленный замер

Перед executable work свежий `pnpm agent:preflight --scope electronics --check`
вернул SAFE_TO_START: выбранная карточка in_progress, dirty paths и overlaps 0,
control plane PASS, HEAD = origin/main = указанная база.
`pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-CONFORMANCE-RUNTIME-001`
завершился PASS: 84/84 validator tests и selected-card validation.

В 23:49:58 Europe/Moscow (20:49:58 UTC) выполнена ровно одна команда замера:

```powershell
$env:NX_SKIP_NX_CACHE='true'
pnpm exec vitest run contexts/electronics/testing/engine-trace-replay.spec.ts -t 'observation-arduino-led: preserves full state and result through bounded complete horizons'
```

Raw log: 1 passed / 15 deselected, named case 1941 мс, file 1943 мс,
Vitest duration 4.33 с. Это targeted diagnostic, не focused gate и не acceptance.
Nx не запускался: fresh Nx tasks 0, cache evidence отсутствует.

| Фаза | Wall, мс | Aggregate process CPU, мс |
| --- | ---: | ---: |
| Reference replay, budget 1024 | 1075.7795 | 1984 |
| Chunked replay, budget 256 | 862.4704 | 1609 |
| Сериализация chunked payload | 0.1341 | 0 |
| Сериализация reference payload | 0.0566 | 0 |
| Полное string equality | 0.0462 | 0 |
| Parse canonical state и physical/Arduino assertions | 0.3086 | 0 |
| Всё измеренное тело до записи console log | 1938.9357 | 3593 |

CPU получен через `process.cpuUsage()` и суммирует user+system CPU процесса,
включая его потоки. Это не время одного worker и не доказательство contention;
CPU может превышать wall. Нулевые короткие CPU фазы отражают разрешение счётчика.
Probe overhead не вычтен; console output не включён в измеренный total.

Public advance calls из raw profile, committed и delta указаны в микросекундах:

| Replay / budget | Requested | Status | Committed | Logical delta | Wall, мс | CPU, мс | Continuation chars |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Reference / 1024 | 1100000 | yielded | 908000 | 908000 | 917.4437 | 1781 | 5501 |
| Reference / 1024 | 1100000 | ready | 1100000 | 192000 | 157.6641 | 203 | 6339 |
| Chunked / 256 | 0 | ready | 0 | 0 | 3.4325 | 16 | 1249 |
| Chunked / 256 | 500000 | yielded | 226000 | 226000 | 174.7459 | 390 | 2371 |
| Chunked / 256 | 500000 | yielded | 454000 | 228000 | 174.3146 | 422 | 3390 |
| Chunked / 256 | 500000 | ready | 500000 | 46000 | 37.0115 | 47 | 3570 |
| Chunked / 256 | 1000000 | yielded | 726000 | 226000 | 180.0797 | 297 | 4678 |
| Chunked / 256 | 1000000 | yielded | 955000 | 229000 | 182.0438 | 265 | 5684 |
| Chunked / 256 | 1000000 | ready | 1000000 | 45000 | 30.1154 | 16 | 5869 |
| Chunked / 256 | 1100000 | ready | 1100000 | 100000 | 80.2230 | 156 | 6339 |

Reference: 2 calls, 1 yielded / 1 ready. Chunked: 8 calls, 4 yielded / 4 ready,
targets `[0, 500000, 1000000, 1100000]`. Logical delta — разница committed
horizon с предыдущей continuation, не длительность host execution.
Оба полных semantic JSON payload имеют 10037 characters и прошли equality.
Raw profile сообщает final canonical `reachedMicroseconds: 1100000`, Arduino
`virtualTimeMs: 1100`.

## Ограничения среды и provenance

- Локально Windows, Intel Core i5-13400, 10 cores / 16 logical processors,
  Node v22.23.3, pnpm 9.15.9. Фактически исполнился **Vitest 3.2.7**:
  это подтверждено raw RUN banner, `pnpm list vitest --depth 0` и установленным
  package metadata. Manifest (`package.json:173`) и lockfile
  (`pnpm-lock.yaml:145–147`) фиксируют **4.1.11**; сохранённый failed-step log
  CI также явно сообщает **RUN v4.1.11**. Локальный замер не воспроизводит CI runner.
- Worktree `node_modules` — обычная директория. Junction `node_modules/vitest`
  ведёт в её же `.pnpm/vitest@3.2.7_@types+node@22.20.1_jsdom@26.1.0_yaml@2.9.0/node_modules/vitest`.
  `.modules.yaml`: isolated linker, private worktree virtualStoreDir, shared
  pnpm content store `C:/Users/spike/AppData/Local/pnpm/store/v3`; metadata
  датирована 2026-10-06. Dependencies не устанавливались и не обновлялись.
- Другие Node processes существовали. Два процесса между внешними before/after
  snapshots накопили около 5.61 и 6.59 CPU seconds. Этот интервал включает
  preparation/tooling и длиннее теста; причинное влияние на этот case не
  измерено. Процессы не останавливались. Историческое CI contention не доказано.
- Текущее tracked source совпадает с исходной сохранённой копией:
  SHA-256 `2285e9c1478ecea3e97f0413d32bce5100ec76c74e15aa9ca2d67a94caa0209c`;
  `git diff` этого файла пуст. Его fixture, horizons, event budgets, equality,
  physical assertions и default 5000 ms guard сохранены.
- Точная инструментированная копия до восстановления **не была архивирована**.
  `temporary-probes-reconstructed.patch` и `engine-trace-replay.probes-reconstructed.ts`
  восстановлены из original source и записанных tool patches после замера.
  Они не являются original executed artifacts и не доказывают независимо
  неизменность instrumentation/guard в выполненном замере. Raw log оригинален;
  `profile.json` извлечён из него. Ограничение нельзя заменить digest реконструкции.

Артефакты сохранены вне репозитория в
`C:/Users/spike/.codex/temp/electronics-521/`: `directed-measurement.log`,
`profile.json`, original source, явно маркированная reconstructed probe source/patch,
`reconstruct-probes.mjs`, `artifact-digests.json`, `node-before.json`, `node-after.json`.
Raw-log SHA-256: `ddb12af9e1906537d332f59c3b1b1f8fde3c7ae81c04943f231861461519b2d6`.

## Вывод и bounded self-review

Оба replay необходимы для canonical partition conformance. Замер не обнаружил
избыточного harness replay; непосредственно equality/serialization/assertion
overhead менее 1 мс не обосновывает repair для historical timeout.
Локальный PASS не устанавливает ни CPU/contention cause, ни production defect.
Несовпадение Vitest требует отдельно выбранного matching-runner investigation;
изменять shared CI configuration или production внутри #521 нельзя.

`SELF_REVIEW: PASS_WITH_RISK` для evidence/report scope; residual risk — причина
не доказана, local runner не совпадает с CI, executed probe source не архивирован.
Routing и тесты не изменены; unrequested changes отсутствуют. Focused/general
gates и browser не повторялись в поисках случайного PASS, repair candidate нет.
На момент проверки exact-base general run `37684431603` оставался in_progress;
это не PASS. Owner acceptance, release, deployment и data actions не выполнялись.
School-device T3 остаётся pending реального classroom device по
[решению #465](https://github.com/spikeal8-maker/asa-lab/issues/465#issuecomment-6046276634);
этот замер его не заменяет.

`NEXT_ALLOWED_TASK: STOP / OWNER REVIEW`. Контроллер выбирает следующий scope;
этот отчёт не закрывает #521 и не снимает focused/full-browser требования #517.
