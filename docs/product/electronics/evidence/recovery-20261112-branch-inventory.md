# ASA-ELECTRONICS-RECOVERY-001 — инвентаризация веток и PR

Дата наблюдения: 12 ноября 2026 года. Это read-only snapshot, а не статус реализации ТЗ. Проверенный main: `9f43e7c5357cbddf06bf11c6fbe60a40c6f0ea77`.

## Полнота и ограничения

- Получены обе страницы открытых PR: 100 + 36 = 136. По Electronics/Arduino/E11/LED тематике названий и refs выделены 22 PR, включая 2 смежных общих CI PR #608/#609. Их exact head SHA, полный набор изменённых файлов и свежие conclusions Actions прочитаны. Это точная классификация выбранных 22, не семантическая ревизия diff всех остальных 114 PR.
- Все refs с подстрокой `electronics` перечислены до пустой страницы: 100 + 100 + 100 + 46 = 346. Это поиск по имени, не доказательство, что в остальных refs нет Electronics; семантическая ревизия всех 346 не выполнена. Не использовать число как число незавершённых продуктовых работ.
- Проверены 22 недавно/исторически закрытых связанных PR; результаты ниже. Закрытые PR искались отдельно, поиск выдаёт первые 100 совпадений, поэтому полный исторический архив не заявляется.
- Прочитаны актуальные AGENTS.md, START_HERE_FOR_AI.md, Electronics START_HERE и current.yaml на указанном main. Активные задачи и blockers остаются только в current.yaml; этот реестр не активирует продуктовую работу и не снимает ограничения.
- GitHub/refs/PR не менялись. Новые браузерные или full solver tests не запускались. CI ниже — прочитанное состояние запусков exact PR head, а не повторный запуск.

## Выбор рабочей ветки

ТЗ следует опубликовать отдельным bounded documentation PR от свежего main, например `codex/electronics-recovery-spec-20261112`. Не продолжать #1072/#1086/#1089 или #839 для документа: они содержат разные непринятые runtime кандидаты и очень старые базы. Эта документационная ветка завершается после публикации ТЗ/реестра и не становится многомесячной второй main. Исполнение ведётся малыми срезами от актуальной канонической базы с сохранением существующего parent programme #452 и intake #703. Main защищён обязательной проверкой ASA / required. Актуальная политика допускает direct_main и опциональные PR; для текущего поручения владельца выбран отдельный документационный PR.

## 22 открытых PR: решение по каждому

`observed_state: OPEN` для всех строк ниже на момент этого snapshot. Решение для #719: `CLOSE_SOURCE_DUPLICATE`, после независимой проверки и публикации реестра. Фактическое закрытие/ссылка на действие добавляются контроллером отдельно; эта запись сама ничего не закрывает.

CI: `G` — последний pull_request General; `E` — Electronics workflow exact HEAD. `cancelled`, `queued` и отсутствие запуска не являются PASS. Отдельные красные причины не расследовались этим inventory.

| PR / HEAD                                                                                                 | Ветка                                                   | Отличие от main                 | Exact CI                                                                                                                                                           | Этап ТЗ                                        | Решение                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1089](https://github.com/spikeal8-maker/asa-lab/pull/1089) / `f7bc736d4ad5106b4214ac683e37f13281e7aed9` | `codex/electronics-strict-blockly-wait-field`           | 15 ahead / 28 behind; 11 files  | G [queued](https://github.com/spikeal8-maker/asa-lab/actions/runs/43098277782); E [queued](https://github.com/spikeal8-maker/asa-lab/actions/runs/43098277766)     | R30–R31 / R51                                  | Сохранить кандидатом. 9 файлов совпадают с #1086, но дополнительно меняется принятие 1 ms optical/load evidence. Проверить контракт времени отдельно; exact CI queued. Не переносить изменение порога как часть UI-оптимизации.                                                                |
| [#1086](https://github.com/spikeal8-maker/asa-lab/pull/1086) / `4736f16b74c2d7f5b8947700b7ec2417de382d8a` | `codex/electronics-strict-multimeter-r`                 | 7 ahead / 28 behind; 9 files    | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/43091767417); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/43091767064)   | R30–R31; R41 K1                                | Сохранить как ограниченный кандидат runtime + native multimeter. Все 7 файлов #1077 сохранены, плюс 2 файла. Выбрать единственного преемника с #1089 до закрытия.                                                                                                                              |
| [#1077](https://github.com/spikeal8-maker/asa-lab/pull/1077) / `3f36cfc3b658788111391ad548358199c4d4cb7b` | `codex/electronics-strict-runtime-throughput`           | 1 ahead / 40 behind; 7 files    | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/43033908685); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/43033908660)   | R30–R31 / R51                                  | Кандидат на административную консолидацию в #1086: ancestor и 7/7 одинаковых blobs. Не объявлять интегрированным в main; сначала зафиксировать retained successor и незакрытые timing checks.                                                                                                  |
| [#1072](https://github.com/spikeal8-maker/asa-lab/pull/1072) / `f4e828f625cc7d1d21dcc70e02673b5091f54176` | `fix/electronics-workspace-menu-reopen-836`             | 10 ahead / 47 behind; 11 files  | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/42976594449); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/42976594389)   | R30–R31 / R51                                  | Сохранить; 11 файлов, включая собственные LED temporal presentation и timing tests. Не считать дублем #1077/#1086. Разделить уникальные изменения и интегрировать только нужный принятый срез.                                                                                                 |
| [#1064](https://github.com/spikeal8-maker/asa-lab/pull/1064) / `963038993170ef1b3fcbe8483ffca19913dca9d4` | `codex/electronics-worker-residual`                     | 1 ahead / 87 behind; 1 files    | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/42851018270); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/42851017962)   | R10 при профиле / R51                          | Сохранить ограниченным кандидатом: 1 solver.ts, уменьшение allocations residual. Изменение не совпадает с текущим main, точный General и Electronics red; причина red здесь не расследована.                                                                                                   |
| [#998](https://github.com/spikeal8-maker/asa-lab/pull/998) / `d0dfb783b48ecce102a6b20057328f625c750de2`   | `codex/electronics-baseline-evidence-20261106`          | 2 ahead / 325 behind; 6 files   | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/42147384824); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/42147384820) | R00 / общая диагностика                        | Сохранить диагностическим источником. 6 workflow/reporter/contract paths; современный main уже изменил эти области. Сделать hunk-level disposition до закрытия, не вносить старый CI поверх нового.                                                                                            |
| [#973](https://github.com/spikeal8-maker/asa-lab/pull/973) / `5c175dac3f39a5cc78ab640d7f19f8dac777de37`   | `fix/mobile-electronics-oracles-909-20261103`           | 3 ahead / 409 behind; 5 files   | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/41584950754); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/41584950701) | R11–R12 / R41                                  | Сверить с merged #1047/#1048. Мобильные орacles частично реализованы иным способом; все 5 итоговых blobs отличаются, 2 добавленных helper-файла отсутствуют в main. Не закрывать как полный дубль без disposition остатка.                                                                     |
| [#955](https://github.com/spikeal8-maker/asa-lab/pull/955) / `c1f654666145945bad5e9b5781944b1512446b7a`   | `ci/register-e11-stopped-fit-390-20261102`              | 1 ahead / 463 behind; 8 files   | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/41501758879); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/41501758880) | R00 / CI evidence                              | Сохранить до решения о методе qualification. 8 blobs равны #954, но роль — регистрация workflow на default branch; это не один и тот же source identity/dispatch contract.                                                                                                                     |
| [#954](https://github.com/spikeal8-maker/asa-lab/pull/954) / `0f1220c104b7dd07b0a737091c9209c47aaee5a6`   | `test/e11-stopped-fit-390-20261102`                     | 3 ahead / 481 behind; 8 files   | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/41500053020); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/41500053269) | R00 / CI evidence                              | Сохранить до решения о ненужности historical fixed-case pipeline. 8 blobs равны #955, однако отдельный candidate trust boundary. Единственный зелёный E11 job не доказывает full native acceptance.                                                                                            |
| [#953](https://github.com/spikeal8-maker/asa-lab/pull/953) / `dca41093fb7349938e51e4eef9dabdc9f9c9b9d4`   | `fix/e11-completed-evidence-836-20261102`               | 2 ahead / 482 behind; 3 files   | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/41497223867); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/41497223403)   | R00 / R12 qualification                        | Сохранить; уникальные checkpoint evidence fences/reuse в 3 тестовых файлах. В main нет двух новых evidence helper/spec файлов. Нужна проверка актуальности и независимая приёмка.                                                                                                              |
| [#839](https://github.com/spikeal8-maker/asa-lab/pull/839) / `b43323be164b8078f68770af1345de9f52e275a7`   | `codex/electronics-committed-result-consumers-20261028` | 9 ahead / 902 behind; 12 files  | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/40754320247); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/40754320317) | R12 / R31 / R41 K2                             | Сохранить до semantic disposition. 4/12 blobs уже точно равны main, часть committed consumers переработана позднее; остальные 8 различаются. Полный reverse-check не проходит. Issue836/840 acceptance остаётся открытой.                                                                      |
| [#746](https://github.com/spikeal8-maker/asa-lab/pull/746) / `3366b925529f1bb00d6c7367760f0662e51cef8a`   | `agent/e11-549-3pr-qa-main-refresh-20261025`            | 20 ahead / 1363 behind; 9 files | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/40178091316); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/40178091168) | R12 / R41 K1–K2                                | Сохранить QA-only, не использовать базой ТЗ. Содержит точные blobs #731 и #741, плюс Auth/MAX. Ветка изначально не предназначена для merge; после переноса нужных проверок архивировать с документированной причиной.                                                                          |
| [#741](https://github.com/spikeal8-maker/asa-lab/pull/741) / `88d25e54bb7d98aedf3bfdcfae0eaa2b471be8bc`   | `agent/e11-549-native-psu-test-20261024`                | 3 ahead / 1422 behind; 1 files  | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/40131363950); E не найден                                                                       | R12 / R41 K1                                   | Сохранить test-only кандидат native PSU clicks. Точный blob присутствует в QA #746, но не совпадает с современным main. Проверить актуальный E11 сценарий и затем определить перенос/закрытие.                                                                                                 |
| [#731](https://github.com/spikeal8-maker/asa-lab/pull/731) / `780c745f32925f3b61a16b4d982262941a40f164`   | `agent/electronics-549-committed-lamp-20261024`         | 3 ahead / 1439 behind; 2 files  | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/40114275017); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/40114275075) | R12 / R41 K2                                   | Сохранить lamp candidate. 2 blobs равны QA #746; отдельный lamp test отсутствует в main, актуальная optical реализация уже отличается. Нужен bounded source/runtime reconciliation.                                                                                                            |
| [#729](https://github.com/spikeal8-maker/asa-lab/pull/729) / `0a04e3340acc5b928bf5014b3ae3cd3a5b8c555c`   | `agent/e11-549-postsnapshot-diagnostic-20261024`        | 3 ahead / 1475 behind; 1 files  | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/40097037725); E не найден                                                                       | R00 / R12 evidence                             | Историческая диагностика post-final snapshot, 1 test file; не является продуктовым исправлением. После сохранения результата и маркировки неизвестного исхода можно закрыть как завершённый эксперимент, без product PASS.                                                                     |
| [#724](https://github.com/spikeal8-maker/asa-lab/pull/724) / `cbc060242450de116a8deb914a36b0dff06a8bd8`   | `codex/electronics-browser-partition-722`               | 11 ahead / 1476 behind; 3 files | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/40138192453); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/40138192479)   | R00 / CI qualification                         | Сверить с merged #1082 (новый sharding уже принят). 3 итоговых blobs различаются; текущая lane722 всё ещё содержит contract-compatibility работу. Не закрывать автоматически как полностью завершённую issue722.                                                                               |
| [#719](https://github.com/spikeal8-maker/asa-lab/pull/719) / `bc123c676eeb74ecee4b8351be43bdd339d1a1fb`   | `codex/electronics-owner23-reverse-led-colour-718`      | 7 ahead / 1644 behind; 7 files  | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/40047454181); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/40047454221) | R31 / R41 K2                                   | `CLOSE_SOURCE_DUPLICATE`: допустимо административно закрыть PR как superseded source после ссылки на этот реестр: все hunks 6 product/test files есть в main; седьмой diff — только устаревший generated browserEvidenceSha256. Issue718 in_review и её acceptance сохраняются. Ref сохранить. |
| [#685](https://github.com/spikeal8-maker/asa-lab/pull/685) / `42f0949c2949805504bfd7b709193c21768813be`   | `work/electronics-share-dialog-lazy-bundle-20261021`    | 10 ahead / 1815 behind; 4 files | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39821628426); E [cancelled](https://github.com/spikeal8-maker/asa-lab/actions/runs/39821628328) | R10–R12 только при измеренной необходимости    | Сохранить отдельно: lazy Share chunk + глобальный preload recovery; 4 файла, новый dialog/spec отсутствуют в main. Это не замена исправлению hover/макетки. Актуальность bundle потребности проверить заново.                                                                                  |
| [#660](https://github.com/spikeal8-maker/asa-lab/pull/660) / `e826794c1cb4aec1280630040f2652272b3d5de1`   | `codex/electronics-core-fet-658`                        | 3 ahead / 1997 behind; 3 files  | G [success](https://github.com/spikeal8-maker/asa-lab/actions/runs/39445810773); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39448747806)   | R41 K4 / R51                                   | Сохранить Draft. FET solver + 8 analytic references + engine contract; действует ELECTRONICS-658-STRICT-BASELINE. Source review не закрывает strict/classroom acceptance.                                                                                                                      |
| [#651](https://github.com/spikeal8-maker/asa-lab/pull/651) / `de9d84a4108a5952b921b40d1575651265391873`   | `projects/d13-generic-preservation-16cbed5d`            | 1 ahead / 2003 behind; 6 files  | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39382393603); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39382393593)   | R51                                            | Сохранить отдельно. Generic ownership/callback semantics затрагивают 6 файлов; текущий main отличается, есть уникальные regressions. Не смешивать с первой оптимизацией визуала.                                                                                                               |
| [#609](https://github.com/spikeal8-maker/asa-lab/pull/609) / `638511aa05cd7bb826e021154d1a2f7d298a5f21`   | `assistant/ci-unblock-convergence-20261018`             | 1 ahead / 2221 behind; 4 files  | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39135965692); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39135965560)   | Смежный общий CI; вне автозакрытия Electronics | Mixed composition Portal + migration + LED replay. package.json совпадает с #608, но остальные 3 файла чужих направлений. Согласовать с общим CI владельцем перед любым закрытием/переносом.                                                                                                   |
| [#608](https://github.com/spikeal8-maker/asa-lab/pull/608) / `e7f2fc90c2fb41b9eeebac20db34cc29699f1f4e`   | `assistant/data-gate-led-worker-20261018`               | 1 ahead / 2221 behind; 1 files  | G [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39135673573); E [failure](https://github.com/spikeal8-maker/asa-lab/actions/runs/39135673569)   | Смежный общий CI; R00 только как зависимость   | 1 package.json diff, точный blob сохранён в #609. Проверять современный gate:data и источник поломки отдельно; не переносить старые package/scripts поверх main и не закрывать общий baseline без registry.                                                                                    |

## Восемь проверок сохранности исходников

| Сопоставление | Свежий факт                                                                                                                                                                      | Следствие                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #719 → main   | У всех 6 product/test files reverse-apply hunks даёт exit 0 на main; единственный оставшийся diff — generatedFrom.browserEvidenceSha256                                          | Можно закрыть устаревший PR без merge как source superseded; acceptance issue718 не закрывать                                          |
| #1077 → #1086 | GitHub compare: ahead 18 / behind 0; все 7 результирующих blobs совпадают                                                                                                        | #1077 сохранён в потомке; можно консолидировать административно после назначения retained successor, без заявления main acceptance     |
| #1086 ↔ #1089 | Все 9 изменённых в #1086 blobs побайтно совпадают с #1089; история diverged 11/3, #1089 добавляет 2 test paths                                                                   | Выбор связан с контрактом 1 ms timing; нельзя автоматически объявлять #1089 принятым или смешивать его с visual-first                  |
| #839 → main   | Точно равны component-presentation-geometry.ts, native-optical-presentation.ts, electronics-classroom-timing.spec.ts, classroom-qualification.spec.ts; другие 8 blobs отличаются | Частичное сохранение доказано, полное завершение нет; нужен semantic disposition                                                       |
| #954 ↔ #955   | Все 8 changed-file blobs равны                                                                                                                                                   | Это candidate и default-branch registration с разными trust/source boundaries; одинаковые blobs не дают автоматического закрытия обоих |
| #731 → #746   | Оба lamp blobs равны                                                                                                                                                             | QA-копия сохраняет источник, но не является принятой main; не переносить целиком смешанную QA ветку                                    |
| #741 → #746   | Единственный E11 file blob равен                                                                                                                                                 | Native-click кандидат сохранён в QA; acceptance pending остаётся                                                                       |
| #608 → #609   | Единственный package.json blob равен                                                                                                                                             | Source сохранён в mixed composition; общий CI scope требует отдельного решения                                                         |

### Точный протокол кандидата #719

PR HEAD: `bc123c676eeb74ecee4b8351be43bdd339d1a1fb`. Main: `9f43e7c5357cbddf06bf11c6fbe60a40c6f0ea77`. GitHub `/pulls/719/files` возвращает 7 файлов, без отсутствующих/truncated patches. На экспортированных неизменённых blobs этого main выполнен `git apply --reverse --check` отдельно для каждого файла — проверка read-only, ничего не откатывалось.

Успешно проверены:

- `apps/web/src/electronics/production-asset-contracts.ts`: exit 0.
- `apps/web/src/electronics/testing/asset-recovery.spec.ts`: exit 0.
- `apps/web/src/electronics/testing/production-assets.spec.ts`: exit 0.
- `apps/web/src/electronics/workbench.css`: exit 0.
- `e2e/electronics-interactions.spec.ts`: exit 0.
- `e2e/electronics-simulation.spec.ts`: exit 0.

Седьмой файл `docs/product/electronics/generated/component-coverage.json` меняет ровно один fingerprint browserEvidenceSha256 старой версии e2e. Это устаревшее генерируемое значение; переносить его на текущий main нельзя. Полное побайтовое равенство всех файлов не заявляется: позднейшие изменения main сохранены. Текущий generated fingerprint `df490f78da43eb8719f394f6687db7fbb195a2c219ad66349e851c05648b504d` совпадает с SHA-256 актуального e2e файла. Независимый рецензент повторил проверку всех 6 non-generated patches на чистом main и подтвердил только административное закрытие PR с сохранением ветки и обязательств issue718. Свежий General для HEAD719 SUCCESS, Electronics CANCELLED. Последний комментарий PR — 24 октября. Каноническая task `TASK-ELECTRONICS-REVERSE-LED-COLOUR-001` / issue718 находится in_review с незакрытой full pipeline/installed/owner acceptance. Административное закрытие PR не снимает эти обязательства и не позволяет писать «LED принят целиком».

Рекомендуемая формулировка закрытия: «Закрыт как устаревший источник изменений, уже присутствующих в main. Проверены все продуктовые и тестовые hunks; старый generated fingerprint не переносится. Оставшаяся приёмка продолжается в issue718 и R31/R41 нового ТЗ. Исходная ветка сохранена. Это не merge и не runtime/owner acceptance».

## Уже закрытые связанные PR

| PR                                                                                                                                                 | GitHub статус      | Merge SHA / источник                       | Значение для ТЗ                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------ | ------------------------------------------------------------- |
| [#1082](https://github.com/spikeal8-maker/asa-lab/pull/1082) Run the full Electronics browser gate in two isolated jobs                            | MERGED             | `e90d555d4cf494746ba933c4b1a03ddbaeb6df76` | Сохранить принятый источник; не повторять вслепую             |
| [#1079](https://github.com/spikeal8-maker/asa-lab/pull/1079) Record isolated checkout approval for Electronics browser sharding                    | MERGED             | `8c58667208202de22b7b8d36851bbcf4a979e3f3` | Сохранить принятый источник; не повторять вслепую             |
| [#1076](https://github.com/spikeal8-maker/asa-lab/pull/1076) Select the Arduino stable-loop throughput repair                                      | MERGED             | `dc3731c67e4c1cdf74cafc324dc3521486d5910e` | Сохранить принятый источник; не повторять вслепую             |
| [#1068](https://github.com/spikeal8-maker/asa-lab/pull/1068) Fix power balance for high-resistance Electronics circuits                            | MERGED             | `ca4f4c8095a2a660dc5e0172ccd1b030c8ba5dab` | Сохранить принятый источник; не повторять вслепую             |
| [#1073](https://github.com/spikeal8-maker/asa-lab/pull/1073) Start Electronics catalog image loading after SVG mount                               | MERGED             | `09b4c8162a52fad4e5f54359eace4d18b6799f31` | Сохранить принятый источник; не повторять вслепую             |
| [#1070](https://github.com/spikeal8-maker/asa-lab/pull/1070) Read saved Arduino wait values from Blockly shadows                                   | MERGED             | `3844aa2d57a451c362cda704eef88fd17b4553b8` | Сохранить принятый источник; не повторять вслепую             |
| [#1067](https://github.com/spikeal8-maker/asa-lab/pull/1067) Select Electronics numerical-shunt power accounting repair                            | MERGED             | `071c5c25bd204a00bda8fa379127694957a29b5b` | Сохранить принятый источник; не повторять вслепую             |
| [#1061](https://github.com/spikeal8-maker/asa-lab/pull/1061) Select the Electronics Worker residual calculation repair                             | MERGED             | `ea8777809f0eef2d2ec2bd804da94b75433d5a9d` | Сохранить принятый источник; не повторять вслепую             |
| [#1057](https://github.com/spikeal8-maker/asa-lab/pull/1057) Fix two Electronics browser readiness waits                                           | MERGED             | `ab8d857a225538c42cb8614c41391f62ae755a09` | Сохранить принятый источник; не повторять вслепую             |
| [#1056](https://github.com/spikeal8-maker/asa-lab/pull/1056) Select the Electronics browser wait repairs                                           | MERGED             | `95840ae87da3d9630de1c2a365e16a4bf20d939e` | Сохранить принятый источник; не повторять вслепую             |
| [#1048](https://github.com/spikeal8-maker/asa-lab/pull/1048) Use a native pinch in mobile electronics field tests                                  | MERGED             | `c9cc1e699211971c804dca7e2324e8801683b41a` | Сохранить принятый источник; не повторять вслепую             |
| [#1047](https://github.com/spikeal8-maker/asa-lab/pull/1047) Exercise visible controls in mobile electronics browser tests                         | MERGED             | `4b3e21467622bed7d2d6e0f2541e137d18e0e3e3` | Сохранить принятый источник; не повторять вслепую             |
| [#1034](https://github.com/spikeal8-maker/asa-lab/pull/1034) Select the Arduino button and Serial timing repair                                    | MERGED             | `27a2ebb951f20786d2410216de71b8f7433df9e3` | Сохранить принятый источник; не повторять вслепую             |
| [#695](https://github.com/spikeal8-maker/asa-lab/pull/695) test(electronics): correct fractional ready integer clock oracle (#557)                 | MERGED             | `512120c71853cf4bcde0910d46b1e9dcd5a0ed79` | Сохранить принятый источник; не повторять вслепую             |
| [#694](https://github.com/spikeal8-maker/asa-lab/pull/694) test(electronics): verify Uno and PSU wire layering (#679)                              | MERGED             | `88930020db9627b085c86f3257b3ff19809c2a95` | Сохранить принятый источник; не повторять вслепую             |
| [#689](https://github.com/spikeal8-maker/asa-lab/pull/689) fix(electronics): точное попадание по видимым контактам провода на ПК и телефоне (#688) | MERGED             | `c72a62d4e131b838c8e844c7486e457734438a74` | Сохранить принятый источник; не повторять вслепую             |
| [#652](https://github.com/spikeal8-maker/asa-lab/pull/652) fix(electronics): publish ordered D2-D4 LEDs with bounded evidence capture              | MERGED             | `628a5b5a999998b008e18e5ab61e843cb5d8b25b` | Сохранить принятый источник; не повторять вслепую             |
| [#665](https://github.com/spikeal8-maker/asa-lab/pull/665) ci(electronics): one fixed D2 classroom dispatch — NEVER MERGE                          | CLOSED, NOT MERGED | `726c5cb8d7cd058df3c3b52c34794148bc240cf5` | Исторический кандидат/эксперимент, не считать интегрированным |
| [#663](https://github.com/spikeal8-maker/asa-lab/pull/663) chore(electronics): temporary single fixed classroom qualification dispatch             | CLOSED, NOT MERGED | `d1eb77a692daa3fc923aa47cb52a53e3afcac7e3` | Исторический кандидат/эксперимент, не считать интегрированным |
| [#661](https://github.com/spikeal8-maker/asa-lab/pull/661) chore(electronics): temporary read-only historical D2 evidence intake                   | CLOSED, NOT MERGED | `7220510d494dab02662c7eea48819c793b516ab8` | Исторический кандидат/эксперимент, не считать интегрированным |
| [#562](https://github.com/spikeal8-maker/asa-lab/pull/562) fix(electronics): не задерживать запуск схемы ожиданием звука                           | CLOSED, NOT MERGED | `86023fb22fbe00cb1ad325d900708846d5516260` | Исторический кандидат/эксперимент, не считать интегрированным |
| [#561](https://github.com/spikeal8-maker/asa-lab/pull/561) fix(electronics): убрать лишнюю голубую тень включённого переключателя                  | CLOSED, NOT MERGED | `da1fb0c712c0e37e27d5e5c354d60b86341ab768` | Исторический кандидат/эксперимент, не считать интегрированным |

## Связанные ветки без текущего открытого product PR и соседние области

Именной список содержит `codex/electronics-owner23-potentiometer-hygiene`, `codex/electronics-instrument-mirror-525` / `...-final`, `codex/electronics-544-owner-field-final`, `codex/electronics-native-observed-phase-20261028`, `codex/electronics-led-thermal-457`, `codex/electronics-touch-wire-461`, `codex/electronics-legacy-wire-538`, несколько save-recovery и десятки diagnostic/before/after refs. По имени их нельзя считать лишними. R00 обязан сопоставить каждую выбранную для удаления ветку с exact head, полным diff/commits, PR/issue, активной task и сохранённым successor. В этом inventory они не прошли такой отбор и удалению не допущены.

Смежные #1095 (Robotics spec), #740 (Auth/MAX), #577 (shared UI), #609 (Portal/migrations/general CI) не закрываются автоматически Electronics-программой. #29 и `assistant/map-ux-owner-view` защищены явной root policy и исключены.

## Протокол системного закрытия

1. До работы над R-срезом заново прочитать main, current.yaml, exact head связанных PR и фактические CI; найти текущих исполнителей и пересечения.
2. Для каждого hunk/уникального теста старого кандидата назначить disposition: уже в main; переносится в выбранный R-срез; сохранён в конкретном successor; устарел с доказанной причиной; остаётся отдельной задачей. Нельзя терять unresolved failure или unique regression.
3. Административно закрывать source PR допускается после документированной source disposition; issue acceptance остаётся открытым, если пользовательский результат не принят. Не использовать `Closes/Fixes #issue` для такого переноса.
4. Продуктовую задачу закрывать после её собственных критериев, нужных gates/review и требуемой установленной/пользовательской проверки. Новое ТЗ не превращает старый CANCELLED/FAIL в PASS и не снимает blocker текстом.
5. Remote ref удалять только после отдельного точного proof: commit ancestry в принятой базе либо сохранение всех уникальных изменений и review/evidence в долговечном successor; ветка не base для другого PR, не активна у исполнителя, не защищена и deletion разрешён существующим поручением. Сохранить head SHA и ссылку на историю. Не force/delete неизвестные refs.
6. После каждого принятого этапа обновлять эту карту (датированный результат), #452/#703 ссылками и канонический execution state по его контракту. Ветка документации не используется как новая параллельная runtime baseline.

## Источники

- [main на момент наблюдения](https://github.com/spikeal8-maker/asa-lab/tree/9f43e7c5357cbddf06bf11c6fbe60a40c6f0ea77)
- [AGENTS.md](https://github.com/spikeal8-maker/asa-lab/blob/9f43e7c5357cbddf06bf11c6fbe60a40c6f0ea77/AGENTS.md)
- [START_HERE_FOR_AI.md](https://github.com/spikeal8-maker/asa-lab/blob/9f43e7c5357cbddf06bf11c6fbe60a40c6f0ea77/START_HERE_FOR_AI.md)
- [current.yaml](https://github.com/spikeal8-maker/asa-lab/blob/9f43e7c5357cbddf06bf11c6fbe60a40c6f0ea77/docs/execution/current.yaml)
- [Parent #452](https://github.com/spikeal8-maker/asa-lab/issues/452) и [intake #703](https://github.com/spikeal8-maker/asa-lab/issues/703)
- [Compare #1077 → #1086](https://github.com/spikeal8-maker/asa-lab/compare/3f36cfc3b658788111391ad548358199c4d4cb7b...4736f16b74c2d7f5b8947700b7ec2417de382d8a)
- [Compare #1086 → #1089](https://github.com/spikeal8-maker/asa-lab/compare/4736f16b74c2d7f5b8947700b7ec2417de382d8a...f7bc736d4ad5106b4214ac683e37f13281e7aed9)
- Полные GitHub files/patches, 346 имён refs, SHA и CI records сохранены в исследовательском snapshot; опубликованный реестр не копирует пользовательские проекты или приватные данные.

## Приложение: полный именной список 346 refs

Имена получены поиском `electronics` с последовательной пагинацией до пустого ответа. У этих 346 refs здесь не проверены индивидуальные HEAD, commit ancestry, уникальные изменения и активные исполнители. Список предназначен для последующей адресной классификации; он не является разрешением на удаление.

<details>
<summary>346 имён веток — исторический snapshot</summary>

```text
agent/electronics-549-committed-lamp-20261024
ci/electronics-836-runtime-three-20261103
codex/electronics-507-diagnosis
codex/electronics-509-e2-style
codex/electronics-510-cadence
codex/electronics-510-directed
codex/electronics-510-directed-loaded
codex/electronics-512-diagnostic-probe
codex/electronics-513-directed
codex/electronics-513-startup
codex/electronics-516-acceptance-verification-20261008
codex/electronics-516-directed-loaded
codex/electronics-516-directed-solo
codex/electronics-517-commit-after-probe
codex/electronics-517-commit-before-probe
codex/electronics-517-controlled-before-probe
codex/electronics-517-head-protocol-correction-20261008
codex/electronics-517-late-fixture-correction-20261008
codex/electronics-517-late-permanent-confirmation-20261008
codex/electronics-517-late-publication-repair-20261008
codex/electronics-517-native-diagnostic
codex/electronics-517-native-probe
codex/electronics-532-870-final-20261102
codex/electronics-532-five-evidence-20261102
codex/electronics-532-native-hit-20261102
codex/electronics-537-canonical-fixture-r1-after-directed-probe
codex/electronics-537-canonical-fixture-r1-before-directed-probe
codex/electronics-537-canonical-fixture-r1
codex/electronics-538-attributed-r2-directed-after
codex/electronics-538-classroom-baseline-final
codex/electronics-538-final-attributed-r2
codex/electronics-538-native-observer-r1-after-directed-probe
codex/electronics-538-native-observer-r1
codex/electronics-539-after-directed-probe
codex/electronics-539-before-directed-probe
codex/electronics-540-after-directed-probe
codex/electronics-541-before-directed-probe
codex/electronics-541-ordinary-final-r1
codex/electronics-543-causal-before
codex/electronics-543-directed-after-four-widths
codex/electronics-543-ordinary-final-r2
codex/electronics-543-r2-mobile-after
codex/electronics-543-r3-reopen-ready-evidence
codex/electronics-543-r3-reopened-ready-after
codex/electronics-544-corrected-single-before
codex/electronics-544-owner-field-final
codex/electronics-544-r2-clamp-single-after
codex/electronics-544-r3-empty-binding-single-after
codex/electronics-544-r3-expected-binding
codex/electronics-544-r3-full32-after
codex/electronics-544-root-single-after
codex/electronics-544-single-native-before
codex/electronics-546-blocks-diagnostic
codex/electronics-546-desktop-close-locator-repair
codex/electronics-546-directed-full-programs
codex/electronics-546-observation-repair
codex/electronics-546-ordinary-final
codex/electronics-546-owner-timing-diagnostic
codex/electronics-546-paint-proof-repair
codex/electronics-546-r1-ordinary-final
codex/electronics-546-r1-static-routing-after
codex/electronics-546-r2-compact-observer
codex/electronics-546-r2-compact-observer-after
codex/electronics-546-r3-linear-directed-after
codex/electronics-546-r3-linear-rows
codex/electronics-546-r4-final-canonical
codex/electronics-546-r5-directed-diagnostic
codex/electronics-546-r5-evidence
codex/electronics-546-r6-compute
codex/electronics-546-r7-paint-proof-diagnostic
codex/electronics-546-r7-timing-diagnostic
codex/electronics-546-r8-diagnostic
codex/electronics-546-r8-model-digest
codex/electronics-546-r8-worker-profile-diagnostic
codex/electronics-546-r9-browser-transport
codex/electronics-546-r9-directed
codex/electronics-546-r9-host-demand
codex/electronics-546-r9-ordinary
codex/electronics-546-r10-frozen-profile
codex/electronics-546-r12-directed
codex/electronics-546-r12-operating-point
codex/electronics-546-r13-directed
codex/electronics-546-r13-startup-clock
codex/electronics-546-r15-ci-followup
codex/electronics-546-r15-ci-followup-directed
codex/electronics-546-r15-composed-directed
codex/electronics-546-r15-directed
codex/electronics-546-r15-event-execution
codex/electronics-546-r15-start-capability
codex/electronics-546-r16-native-worker-cost
codex/electronics-546-r16-native-worker-cost-directed
codex/electronics-546-r16-native-worker-profile
codex/electronics-546-r17-runtime-write-cost
codex/electronics-546-r17-runtime-write-cost-directed
codex/electronics-546-r18-led-temporal-observation
codex/electronics-546-r19-exact-reuse
codex/electronics-546-r21-integration
codex/electronics-547-causal-before-directed
codex/electronics-547-native-r1-causal-before
codex/electronics-547-native-scenario-r1
codex/electronics-547-native-stopped-r2
codex/electronics-547-shadow-before
codex/electronics-547-single-selector-causal-after
codex/electronics-547-single-selector-product
codex/electronics-547-stopped-r2-causal-before
codex/electronics-548-causal-before-directed
codex/electronics-548-controlled-late-sidebar
codex/electronics-548-controlled-late-sidebar-directed
codex/electronics-548-measurement
codex/electronics-548-native-error-observer
codex/electronics-548-native-react-ingress
codex/electronics-548-native-react-ingress-directed
codex/electronics-548-r2-ordinary-observation
codex/electronics-548-r2-ordinary-observation-directed
codex/electronics-548-search-r1-directed
codex/electronics-548-search-r1-evidence
codex/electronics-549-6f27-directed-before
codex/electronics-549-approved-composition-current
codex/electronics-549-outline-directed-before
codex/electronics-549-outline-final-logging-baseline
codex/electronics-549-outline-final-observability-baseline
codex/electronics-549-outline-native-pan-r3
codex/electronics-549-outline-r2-directed-before
codex/electronics-549-outline-r2-final-admin-baseline
codex/electronics-549-outline-r3-directed-before
codex/electronics-549-outline-r4-directed-before
codex/electronics-549-outline-transform-oracle-r4
codex/electronics-549-r6-directed-before
codex/electronics-549-r6-final-source
codex/electronics-549-r7-directed-before
codex/electronics-549-r7-native-oracles
codex/electronics-549-r8-unique-meter-hit
codex/electronics-552-final-canonical-convergence
codex/electronics-552-r1-primary-finalization
codex/electronics-552-r3-directed-after
codex/electronics-552-r3-directed-before
codex/electronics-552-r3-native-witness
codex/electronics-553-r1-directed-before
codex/electronics-553-r1-primary-finalization
codex/electronics-553-r2-directed-before
codex/electronics-553-r2-read-route
codex/electronics-553-r3-directed-after
codex/electronics-553-r3-directed-before
codex/electronics-553-r3-normalized-fixtures
codex/electronics-553-r4-directed-after
codex/electronics-553-r4-directed-before
codex/electronics-553-r5-approved-composition
codex/electronics-554-native-wheel
codex/electronics-554-r2-directed-before
codex/electronics-554-r3-directed-before
codex/electronics-554-r4-directed-after
codex/electronics-554-r4-directed-before
codex/electronics-555-course-order-baseline
codex/electronics-555-directed-pg
codex/electronics-557-final-canonical
codex/electronics-570-after-diagnostic
codex/electronics-570-before-diagnostic
codex/electronics-679-111-frozen
codex/electronics-679-557-causal-fix-measurement
codex/electronics-679-557-final-qualification
codex/electronics-679-557-oracle-eligibility
codex/electronics-679-557-pointerdown-budget
codex/electronics-679-557-preserving-integration
codex/electronics-679-557-qualification
codex/electronics-679-557-safe-final
codex/electronics-679-common-classification-measurement
codex/electronics-679-psu-hit-witness
codex/electronics-682-epoch-production-measurement
codex/electronics-682-native-phase-probe
codex/electronics-682-realtime-baseline
codex/electronics-836-completion-20261101
codex/electronics-836-final-qualification-20261101
codex/electronics-868-caption-20261102
codex/electronics-868-nine-evidence-20261102
codex/electronics-870-one-evidence-20261103
codex/electronics-944-870-final-20261102
codex/electronics-944-final-source-20261102
codex/electronics-944-mobile-navigation-20261102
codex/electronics-944-pin-setup-20261102
codex/electronics-944-seven-evidence-20261102
codex/electronics-952-mobile-properties-20261102
codex/electronics-952-three-evidence-20261102
codex/electronics-arduino-bitwise-537-after-directed-probe
codex/electronics-arduino-bitwise-537-before-directed-probe
codex/electronics-arduino-bitwise-537
codex/electronics-arduino-demand-dedup-649
codex/electronics-arduino-noop-publication-534-directed-probe
codex/electronics-arduino-noop-publication-534
codex/electronics-asset-recovery-453
codex/electronics-autosave-60s-459
codex/electronics-autosave-459
codex/electronics-baseline-evidence-20261106
codex/electronics-blockly-media-init-533-r1-directed-probe
codex/electronics-blockly-media-init-533-r1
codex/electronics-blockly-media-init-533-r2-directed-probe
codex/electronics-blockly-media-init-533-r2
codex/electronics-blockly-media-init-533-r3-directed-probe
codex/electronics-blockly-media-init-533-r3
codex/electronics-browser-clock-456
codex/electronics-browser-partition-722
codex/electronics-browser-readiness-531-directed-probe
codex/electronics-browser-readiness-531-r1-directed-probe
codex/electronics-browser-readiness-531-r1
codex/electronics-browser-readiness-531
codex/electronics-ci-blocker-repair
codex/electronics-ci-image-transport-545-r1
codex/electronics-ci-image-transport-545-r2
codex/electronics-ci-image-transport-545
codex/electronics-classroom-baseline
codex/electronics-classroom-d13-candidate
codex/electronics-committed-result-consumers-20261028
codex/electronics-compact-controls-532-r1-directed-probe
codex/electronics-compact-controls-532-r1
codex/electronics-compact-controls-532-r2-directed-probe
codex/electronics-compact-controls-532-r2
codex/electronics-compact-controls-532-r3-directed-probe
codex/electronics-compact-controls-532-r3
codex/electronics-compact-controls-532-r4-directed-probe
codex/electronics-compact-controls-532-r4
codex/electronics-compact-controls-532
codex/electronics-conformance-ci-diagnosis-522
codex/electronics-conformance-ci-probe-522
codex/electronics-conformance-runtime-521
codex/electronics-conformance-worker-allocation-523
codex/electronics-conformance-worker-probe-523
codex/electronics-core-fet-658
codex/electronics-d2-qualification-dispatch-664
codex/electronics-e01-before-after-fixture-528
codex/electronics-e06-gesture-directed-before
codex/electronics-e06-r1-directed-after
codex/electronics-e06-r1-directed-before
codex/electronics-e06-r1-native-gesture-repair
codex/electronics-e06-r1-pending-primary
codex/electronics-event-queue-copy-20261103
codex/electronics-evidence-intake-649
codex/electronics-four-points-completion-569
codex/electronics-four-points-exact-diagnostic
codex/electronics-hygiene-480
codex/electronics-hygiene-524
codex/electronics-hygiene-542
codex/electronics-hygiene-556
codex/electronics-hygiene-stabilization-004
codex/electronics-inactive-blocks
codex/electronics-instrument-mirror-525-final
codex/electronics-instrument-mirror-525
codex/electronics-integer-time-541
codex/electronics-interpreter-arity-20261103
codex/electronics-led-thermal-457
codex/electronics-legacy-wire-538-after-directed-probe
codex/electronics-legacy-wire-538-before-directed-probe
codex/electronics-legacy-wire-538
codex/electronics-login-fixture-528
codex/electronics-mobile-add-connect-before
codex/electronics-mobile-add-connect-before-r2
codex/electronics-mobile-add-connect-ui
codex/electronics-mobile-ci-transport-429
codex/electronics-mobile-corrected-before-transport
codex/electronics-mobile-guard-composition-gc1
codex/electronics-native-observed-phase-20261028
codex/electronics-natural-wire-routing-undefined
codex/electronics-next-event-scan-20261103
codex/electronics-observation-cadence-516
codex/electronics-ordinary-image-error-517
codex/electronics-owner23-keyboard-ui
codex/electronics-owner23-potentiometer-hygiene
codex/electronics-owner23-reverse-led-colour-718
codex/electronics-parallel-card-guard-536
codex/electronics-prettier-probe-377
codex/electronics-production-cpu-20261103
codex/electronics-project-polling-570
codex/electronics-qualification-dispatch-662
codex/electronics-ready-cadence-539-final
codex/electronics-reset-high-456
codex/electronics-reverse-led-simple-718
codex/electronics-save-cross-tab-566-after
codex/electronics-save-cross-tab-566-before
codex/electronics-save-cross-tab-566-before-hub
codex/electronics-save-cross-tab-566
codex/electronics-save-indicator-569-diagnostic
codex/electronics-save-indicator-569-final-probe
codex/electronics-save-indicator-569-r1-diagnostic
codex/electronics-save-indicator-569-r1-hub-retry
codex/electronics-save-indicator-569
codex/electronics-save-recovery-526-before
codex/electronics-save-recovery-526-crash-scope-probe-r3
codex/electronics-save-recovery-526-final
codex/electronics-save-recovery-526-post-530
codex/electronics-save-recovery-526-r6
codex/electronics-save-recovery-526-review-r1
codex/electronics-save-recovery-526-review-r2
codex/electronics-save-recovery-526-review-r3
codex/electronics-save-recovery-526-review-r4
codex/electronics-save-recovery-526-review-r5
codex/electronics-save-retry-571-after
codex/electronics-save-retry-571-before
codex/electronics-save-retry-571
codex/electronics-scheduler-same-time-540
codex/electronics-sketch-draft-commit-529-evidence-r1
codex/electronics-sketch-draft-commit-529
codex/electronics-strict-blockly-wait-field
codex/electronics-strict-multimeter-r
codex/electronics-strict-runtime-throughput
codex/electronics-touch-wire-461
codex/electronics-ui-679-557-final-delivery
codex/electronics-visual-source-review-518
codex/electronics-wire-menu-layer-530-final
codex/electronics-wire-menu-layer-530-protocol-repair
codex/electronics-wire-menu-layer-530-protocol-repair-after-directed-probe
codex/electronics-wire-menu-layer-530
codex/electronics-worker-quantum-20261103
codex/electronics-worker-residual
diag/electronics-baseline-20261022-d8e4
diagnostics/electronics-546-r18-led-temporal-directed
diagnostics/electronics-546-r21b-joint-led-witness
diagnostics/electronics-546-r22-browser-oracles
diagnostics/electronics-546-r22-compiled-syntax
diagnostics/electronics-546-r22-led-startup
diagnostics/electronics-546-r23-candidate
diagnostics/electronics-546-r23-led-temporal-directed
diagnostics/electronics-546-r23-typed-values
diagnostics/electronics-546-r24-base
diagnostics/electronics-546-r24-held-phase
diagnostics/electronics-546-r25-base
diagnostics/electronics-546-r25-closure-base
diagnostics/electronics-546-r25-complete-origin
diagnostics/electronics-546-r25-model-origin
diagnostics/electronics-546-r25-origin-base
diagnostics/electronics-546-r25-runtime-owned
diagnostics/electronics-546-r26-combined
diagnostics/electronics-546-r26-owned-base
diagnostics/electronics-546-r26-quality
diagnostics/electronics-546-r26-runtime-workspace
diagnostics/electronics-546-r27-base
diagnostics/electronics-d2-png-836
diagnostics/electronics-reverse-led-718-before-ed307
diagnostics/electronics-timing-one-worker-836
docs/electronics-core-stabilization-20261020
docs/electronics-owner-repair-priority-20261008
docs/robotics-guided-electronics-spec-1.2
evidence/electronics-classroom-d13-before
fix/electronics-e09-spdt-shadow-owner-20261013
fix/electronics-e12-nonblocking-audio-owner-20261013
fix/electronics-workspace-menu-reopen-836
fix/mobile-electronics-oracles-909-20261103
test/electronics-fef53a8c-native
work/electronics-share-dialog-lazy-bundle-20261021
```

</details>
